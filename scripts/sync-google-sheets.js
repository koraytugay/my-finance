const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const { encrypt, decrypt } = require('./crypto-utils');
const { enrichWithLivePrices } = require('./price-fetcher');

// Prefer IPv4 first to avoid IPv6 connection timeouts on CI/GitHub Actions runners
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const ROOT_DIR = path.join(__dirname, '..');
const ENCRYPTED_DIR = path.join(ROOT_DIR, 'encrypted');
const HOLDINGS_ENC = path.join(ENCRYPTED_DIR, 'holdings.enc');
const HISTORY_ENC = path.join(ENCRYPTED_DIR, 'history.enc');
const GOOGLE_KEY_ENC = path.join(ENCRYPTED_DIR, 'google-key.enc');
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '1ofMWRVDjxR1DsEkqWkURfTTyvbO23k2l4YBXUpSx4fM';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Resilient fetch with timeout and exponential backoff retry.
 * Handles transient network dropouts (fetch failed, ECONNRESET, ETIMEDOUT, EAI_AGAIN)
 * and transient HTTP status codes (429, 500, 502, 503, 504).
 */
async function fetchWithRetry(url, options = {}, maxRetries = 4, baseDelayMs = 1500) {
  let lastError;
  const timeoutMs = options.timeoutMs || 25000;
  const fetchOpts = { ...options };
  delete fetchOpts.timeoutMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);

    try {
      const res = await fetch(url, {
        ...fetchOpts,
        signal: controller.signal
      });
      clearTimeout(timer);

      // Retry on transient server errors or rate limiting
      if (!res.ok && (res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
        console.warn(`[Google API Warning] ${url} returned HTTP ${res.status}. Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const causeMsg = err.cause ? ` (${err.cause.message || err.cause})` : '';

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
        console.warn(`[Google API Warning] Fetch failed for ${url}: ${err.message}${causeMsg}. Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  const causeDetail = lastError.cause ? ` (cause: ${lastError.cause.message || lastError.cause})` : '';
  const finalError = new Error(`Request failed after ${maxRetries} attempts for ${url}: ${lastError.message}${causeDetail}`);
  finalError.cause = lastError.cause || lastError;
  throw finalError;
}

function loadGoogleKey(password) {
  if (fs.existsSync(GOOGLE_KEY_ENC)) {
    try {
      const encKey = JSON.parse(fs.readFileSync(GOOGLE_KEY_ENC, 'utf8'));
      const key = decrypt(encKey, password);
      if (key && key.client_email && key.private_key) {
        return key;
      }
    } catch (e) {
      throw new Error(`Failed to decrypt google-key.enc with provided password: ${e.message}`);
    }
  }

  // Fallback to local raw file only if google-key.enc does not exist (initial bootstrap)
  const files = fs.readdirSync(ROOT_DIR);
  const match = files.find(f => f.startsWith('gen-lang-client-') && f.endsWith('.json'));
  if (match) {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, match), 'utf8'));
    } catch (e) {}
  }

  return null;
}

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: key.token_uri,
    exp: now + 3600,
    iat: now
  };

  const encHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encClaims = base64url(Buffer.from(JSON.stringify(claims)));
  const signInput = encHeader + '.' + encClaims;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = base64url(signer.sign(key.private_key));
  const jwt = signInput + '.' + signature;

  const res = await fetchWithRetry(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }),
    timeoutMs: 20000
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Auth Error HTTP ${res.status}: ${errText}`);
  }

  const tokenData = await res.json();
  return tokenData.access_token;
}

function parseNumber(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = val.toString().replace(/[$,]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

async function fetchTab(spreadsheetId, tabName, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tabName)}?valueRenderOption=FORMATTED_VALUE`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: 'Bearer ' + token },
    timeoutMs: 25000
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to fetch tab "${tabName}": HTTP ${res.status} - ${errText}`);
  }
  const data = await res.json();
  return data.values || [];
}

async function fetchGoogleSheetsData(password, spreadsheetId = SPREADSHEET_ID) {
  if (!password) {
    throw new Error('Password is required to decrypt Google Cloud Service Account key.');
  }
  const key = loadGoogleKey(password);
  if (!key) {
    throw new Error('Google Cloud Service Account key not found or could not be decrypted.');
  }

  const token = await getAccessToken(key);

  // 1. Fetch ETF Facts Tab
  const etfFactsRows = await fetchTab(spreadsheetId, 'ETF Facts', token);
  const tickersRegistry = {};

  if (etfFactsRows.length > 1) {
    for (let i = 1; i < etfFactsRows.length; i++) {
      const row = etfFactsRows[i];
      if (!row || !row[0]) continue;
      const ticker = row[0].trim();
      const unitPrice = parseNumber(row[1]);
      const usPct = parseNumber(row[2]);
      const canadaPct = parseNumber(row[3]);
      const developedPct = parseNumber(row[4]);
      const emergingPct = parseNumber(row[5]);
      const fixedPct = parseNumber(row[6]);
      const cryptoPct = parseNumber(row[7]);
      const metalsPct = parseNumber(row[8]);
      const strategy = row[9] || 'Broad Market';

      let symbol = ticker;
      let currency = 'CAD';
      if (ticker === 'Cash' || ticker === 'CASH') {
        symbol = 'CASH';
        currency = 'CAD';
      } else if (ticker.startsWith('TSE:')) {
        symbol = ticker.replace('TSE:', '') + '.TO';
        currency = 'CAD';
      } else if (ticker.endsWith('.TO')) {
        symbol = ticker;
        currency = 'CAD';
      } else {
        symbol = ticker;
        currency = 'USD';
      }

      tickersRegistry[ticker] = {
        symbol,
        name: ticker,
        currency,
        unitPrice,
        strategy,
        defaultAllocation: {
          us: usPct,
          canada: canadaPct,
          developed: developedPct,
          emerging: emergingPct,
          fixedIncome: fixedPct,
          crypto: cryptoPct,
          preciousMetals: metalsPct
        }
      };
    }
  }

  // 2. Fetch Holdings Tab
  const holdingsRows = await fetchTab(spreadsheetId, 'Holdings', token);
  const holdings = [];

  if (holdingsRows.length > 1) {
    for (let i = 1; i < holdingsRows.length; i++) {
      const row = holdingsRows[i];
      if (!row || !row[0]) continue;

      const brokerage = row[0].trim();
      const ticker = row[1].trim();
      const account = row[2].trim();
      const registered = row[3] === '1' || row[3] === 1 || String(row[3]).toLowerCase() === 'true';
      const count = parseNumber(row[4]);
      const sum = parseNumber(row[5]);
      const us = parseNumber(row[6]);
      const canada = parseNumber(row[7]);
      const developed = parseNumber(row[8]);
      const emerging = parseNumber(row[9]);
      const fixedIncome = parseNumber(row[10]);
      const crypto = parseNumber(row[11]);
      const preciousMetals = parseNumber(row[12]);
      const strategy = row[13] || 'Broad Market';
      const averageCost = parseNumber(row[14]);

      const fact = tickersRegistry[ticker] || {};
      const symbol = fact.symbol || (ticker.startsWith('TSE:') ? ticker.replace('TSE:', '') + '.TO' : ticker);
      const name = fact.name || ticker;
      const currency = fact.currency || (symbol.endsWith('.TO') ? 'CAD' : (symbol === 'CASH' ? 'CAD' : 'USD'));

      const id = `${brokerage.toLowerCase()}-${ticker.toLowerCase().replace(/[^a-z0-9]/g, '')}-${account.toLowerCase()}-${i}`;

      if (ticker === 'Cash' || ticker === 'CASH' || symbol === 'CASH') {
        const cashAmt = count > 0 ? count : sum;
        holdings.push({
          id,
          brokerage,
          ticker: 'Cash',
          symbol: 'CASH',
          name: 'Cash',
          currency: 'CAD',
          account,
          registered,
          count: cashAmt,
          unitPrice: 1,
          averageCost: 1,
          totalCost: cashAmt,
          unrealizedGainCAD: 0,
          unrealizedGainPct: 0,
          sum: cashAmt,
          allocation: { us: 0, canada: 0, developed: 0, emerging: 0, fixedIncome: cashAmt, crypto: 0, preciousMetals: 0 },
          allocationPct: { us: 0, canada: 0, developed: 0, emerging: 0, fixedIncome: 1, crypto: 0, preciousMetals: 0 },
          strategy: 'Fixed Income'
        });
        continue;
      }
      const unitPrice = count > 0 ? Number((sum / count).toFixed(4)) : (sum > 0 ? sum : 0);
      const totalCost = averageCost > 0 && count > 0 ? Number((count * averageCost).toFixed(2)) : 0;
      const unrealizedGainCAD = totalCost > 0 ? Number((sum - totalCost).toFixed(2)) : 0;
      const unrealizedGainPct = totalCost > 0 ? Number(((sum - totalCost) / totalCost * 100).toFixed(2)) : 0;

      const allocPct = sum > 0 ? {
        us: Number((us / sum).toFixed(6)),
        canada: Number((canada / sum).toFixed(6)),
        developed: Number((developed / sum).toFixed(6)),
        emerging: Number((emerging / sum).toFixed(6)),
        fixedIncome: Number((fixedIncome / sum).toFixed(6)),
        crypto: Number((crypto / sum).toFixed(6)),
        preciousMetals: Number((preciousMetals / sum).toFixed(6))
      } : (fact.defaultAllocation || { us: 0, canada: 0, developed: 0, emerging: 0, fixedIncome: 0, crypto: 0, preciousMetals: 0 });

      holdings.push({
        id,
        brokerage,
        ticker,
        symbol,
        name,
        currency,
        account,
        registered,
        count,
        unitPrice,
        averageCost,
        totalCost,
        unrealizedGainCAD,
        unrealizedGainPct,
        sum,
        allocation: { us, canada, developed, emerging, fixedIncome, crypto, preciousMetals },
        allocationPct: allocPct,
        strategy
      });
    }
  }

  // 3. Fetch Carry Over Tab (History)
  const carryRows = await fetchTab(spreadsheetId, 'Carry Over', token);
  const history = [];

  if (carryRows.length > 1) {
    for (let i = 1; i < carryRows.length; i++) {
      const row = carryRows[i];
      if (!row || row[0] === undefined || row[0] === '') continue;

      const week = parseInt(row[0], 10);
      if (isNaN(week)) continue;

      const date = row[1];
      const stocks = parseNumber(row[2]);
      const fixed = parseNumber(row[3]);
      const preciousMetals = parseNumber(row[4]);
      const crypto = parseNumber(row[5]);
      const totalCAD = parseNumber(row[6]);
      const totalUSD = parseNumber(row[7]);
      const weeklyChangeCAD = parseNumber(row[8]);
      const weeklyChangePct = parseNumber(row[9]);
      const extraNote = row[10] ? row[10].toString() : '';
      const runningPeakCAD = parseNumber(row[11]);
      const drawdownCAD = parseNumber(row[12]);

      history.push({
        week,
        date,
        stocks,
        fixed,
        preciousMetals,
        crypto,
        totalCAD,
        totalUSD,
        weeklyChangeCAD,
        weeklyChangePct,
        runningPeakCAD,
        drawdownCAD,
        note: extraNote
      });
    }
  }

  // 4. Check public APIs for latest ETF market prices (with safe fallback to Google Sheets)
  try {
    const lastRecord = history[history.length - 1];
    const fallbackRate = (lastRecord && lastRecord.totalCAD && lastRecord.totalUSD)
      ? Number((lastRecord.totalCAD / lastRecord.totalUSD).toFixed(4))
      : 1.414;
    await enrichWithLivePrices(tickersRegistry, holdings, fallbackRate);
  } catch (e) {
    // If public API check fails, Google Sheets prices remain intact
  }

  return { tickersRegistry, holdings, history };
}

async function syncGoogleSheets(password = process.env.PORTFOLIO_PASSWORD || process.argv[2]) {
  if (!password) {
    console.error('Error: PORTFOLIO_PASSWORD environment variable or argument is required.');
    process.exit(1);
  }

  const { tickersRegistry, holdings, history } = await fetchGoogleSheetsData(password);

  if (!fs.existsSync(ENCRYPTED_DIR)) {
    fs.mkdirSync(ENCRYPTED_DIR, { recursive: true });
  }

  const encHoldings = encrypt(holdings, password);
  fs.writeFileSync(HOLDINGS_ENC, JSON.stringify(encHoldings, null, 2));

  const encHistory = encrypt(history, password);
  fs.writeFileSync(HISTORY_ENC, JSON.stringify(encHistory, null, 2));

  console.log('✓ Encrypted data updated successfully.');
}

if (require.main === module) {
  const pwd = process.argv[2] || process.env.PORTFOLIO_PASSWORD;
  if (!pwd) {
    console.error('\n[Fatal Error in Google Sheets Sync] PORTFOLIO_PASSWORD environment variable or command-line argument is required.');
    process.exit(1);
  }
  syncGoogleSheets(pwd).catch(err => {
    console.error('\n[Fatal Error in Google Sheets Sync]', err.message);
    process.exit(1);
  });
}

module.exports = {
  fetchGoogleSheetsData,
  syncGoogleSheets,
  loadGoogleKey
};
