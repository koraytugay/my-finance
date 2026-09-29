const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { encrypt } = require('./scripts/crypto-utils');
const { fetchGoogleSheetsData } = require('./scripts/sync-google-sheets');
const { updateBenchmarks } = require('./scripts/benchmark-fetcher');

// Prefer IPv4 first to avoid IPv6 connection timeouts on CI/GitHub Actions runners
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const ROOT_DIR = __dirname;
const ENCRYPTED_DIR = path.join(ROOT_DIR, 'encrypted');
const HOLDINGS_ENC = path.join(ENCRYPTED_DIR, 'holdings.enc');
const HISTORY_ENC = path.join(ENCRYPTED_DIR, 'history.enc');

function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

async function syncPortfolio(password = process.env.PORTFOLIO_PASSWORD || process.argv[2], maxRetries = 3) {
  if (!password) {
    console.error('Error: PORTFOLIO_PASSWORD environment variable or argument is required.');
    process.exit(1);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`Starting portfolio synchronization (attempt ${attempt}/${maxRetries})...`);
      log('Checking public market APIs for latest ETF prices...');

      const { holdings, history } = await fetchGoogleSheetsData(password);

      if (!fs.existsSync(ENCRYPTED_DIR)) {
        fs.mkdirSync(ENCRYPTED_DIR, { recursive: true });
      }

      // 1. Encrypt Holdings
      const encHoldings = encrypt(holdings, password);
      fs.writeFileSync(HOLDINGS_ENC, JSON.stringify(encHoldings, null, 2));

      // 2. Encrypt History
      const encHistory = encrypt(history, password);
      fs.writeFileSync(HISTORY_ENC, JSON.stringify(encHistory, null, 2));

      // 3. Update Public ETF Benchmark Performance
      try {
        const startDate = history?.[0]?.date || '2024-08-23';
        log(`Fetching public ETF benchmarks since inception (${startDate})...`);
        await updateBenchmarks(startDate);
        log('Benchmark metrics successfully recorded in data/benchmarks.json.');
      } catch (benchErr) {
        console.warn('Benchmark update non-fatal warning:', benchErr.message);
      }

      log('Sync completed successfully. Encrypted data and benchmarks updated with live market quotes.');
      return;
    } catch (err) {
      const causeMsg = err.cause ? ` (cause: ${err.cause.message || err.cause})` : '';
      console.error(`[Sync] Attempt ${attempt}/${maxRetries} failed:`, err.message + causeMsg);

      if (attempt < maxRetries) {
        const delay = 4000 * attempt;
        log(`Waiting ${delay / 1000}s before retrying sync...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        if (err.stack) {
          console.error(err.stack);
        }
        process.exit(1);
      }
    }
  }
}

if (require.main === module) {
  syncPortfolio();
}

module.exports = { syncPortfolio };
