/**
 * Benchmark Performance Fetcher
 * Fetches real historical returns and drawdowns for standard Canadian ETF benchmarks
 * from Yahoo Finance API over the portfolio's inception-to-date timeframe.
 * Saves unencrypted public data to data/benchmarks.json.
 */

const fs = require('fs');
const path = require('path');

const BENCHMARKS_CONFIG = [
  {
    id: 'XEQT',
    symbol: 'XEQT.TO',
    name: 'Global Equity (XEQT)',
    category: '100% All-Equity passive blend',
    color: '#16a34a'
  },
  {
    id: 'VFV',
    symbol: 'VFV.TO',
    name: 'S&P 500 CAD (VFV)',
    category: '100% US Mega-cap equity (CAD)',
    color: '#d97706'
  },
  {
    id: 'XBAL',
    symbol: 'XBAL.TO',
    name: 'Balanced 60/40 (XBAL)',
    category: '60% Stocks / 40% Bonds benchmark',
    color: '#8250df'
  },
  {
    id: 'XCB',
    symbol: 'XCB.TO',
    name: 'CDN Corp Bonds (XCB)',
    category: 'Canadian corporate bond index',
    color: '#64748b'
  }
];

const DEFAULT_START_DATE = '2024-08-23';

function formatDateDisplay(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function fetchBenchmarkHistory(item, startDateStr = DEFAULT_START_DATE, timeoutMs = 8000) {
  const startObj = new Date(startDateStr + 'T00:00:00Z');
  // Start 4 days earlier to guarantee capturing the exact start date or preceding trading day
  const p1 = Math.floor((startObj.getTime() - (4 * 86400000)) / 1000);
  const p2 = Math.floor(Date.now() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?period1=${p1}&period2=${p2}&interval=1d`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from Yahoo Finance for ${item.symbol}`);
    }

    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
      throw new Error(`Empty chart data for ${item.symbol}`);
    }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;

    // Find first close on or immediately after startDateStr
    let startIdx = 0;
    for (let i = 0; i < timestamps.length; i++) {
      const dt = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      if (dt >= startDateStr && closes[i] != null && closes[i] > 0) {
        startIdx = i;
        break;
      }
    }

    // Find latest valid close
    let endIdx = closes.length - 1;
    while (endIdx >= startIdx && (closes[endIdx] == null || closes[endIdx] <= 0)) {
      endIdx--;
    }

    if (startIdx > endIdx) {
      throw new Error(`Insufficient data range for ${item.symbol}`);
    }

    const startPrice = closes[startIdx];
    const currentPrice = closes[endIdx];
    const returnPct = ((currentPrice - startPrice) / startPrice) * 100;

    // Compute maximum drawdown in the period
    let peak = -Infinity;
    let maxDrawdown = 0;
    for (let i = startIdx; i <= endIdx; i++) {
      const p = closes[i];
      if (p == null || p <= 0) continue;
      if (p > peak) peak = p;
      const dd = (p - peak) / peak;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }

    const actualStartDate = new Date(timestamps[startIdx] * 1000).toISOString().slice(0, 10);
    const actualEndDate = new Date(timestamps[endIdx] * 1000).toISOString().slice(0, 10);

    // Sample weekly Friday closes from actualStartDate to actualEndDate
    const weeklyPrices = [];
    let curDate = new Date(actualStartDate + 'T00:00:00Z');
    const stopDate = new Date(actualEndDate + 'T00:00:00Z');
    let lastSampledDate = null;
    while (curDate <= stopDate) {
      const dtStr = curDate.toISOString().slice(0, 10);
      let matchedPrice = null;
      for (let i = timestamps.length - 1; i >= 0; i--) {
        const dt = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        if (dt <= dtStr && closes[i] != null && closes[i] > 0) {
          matchedPrice = Number(closes[i].toFixed(2));
          break;
        }
      }
      if (matchedPrice != null) {
        weeklyPrices.push(matchedPrice);
        lastSampledDate = dtStr;
      }
      curDate = new Date(curDate.getTime() + (7 * 86400000));
    }

    // If actualEndDate extends past the last weekly sample, include current close
    // so live/mid-week snapshots have their corresponding price point
    if (lastSampledDate && actualEndDate > lastSampledDate && currentPrice != null && currentPrice > 0) {
      weeklyPrices.push(Number(currentPrice.toFixed(2)));
    }

    return {
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      category: item.category,
      color: item.color,
      startPrice: Number(startPrice.toFixed(2)),
      currentPrice: Number(currentPrice.toFixed(2)),
      returnPct: Number(returnPct.toFixed(2)),
      maxDrawdownPct: Number((maxDrawdown * 100).toFixed(2)),
      startDate: actualStartDate,
      endDate: actualEndDate,
      weeklyPrices
    };
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[benchmark-fetcher] Error fetching ${item.symbol}: ${err.message}`);
    return null;
  }
}

async function updateBenchmarks(startDate = DEFAULT_START_DATE, outPath = null) {
  const targetFile = outPath || path.join(__dirname, '..', 'data', 'benchmarks.json');
  const targetDir = path.dirname(targetFile);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Load existing file for fallback if individual fetches fail
  let fallbackData = {};
  if (fs.existsSync(targetFile)) {
    try {
      fallbackData = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    } catch (_) {}
  }

  const results = await Promise.allSettled(
    BENCHMARKS_CONFIG.map(cfg => fetchBenchmarkHistory(cfg, startDate))
  );

  const benchmarks = fallbackData.benchmarks || {};
  let latestEndDate = '';

  results.forEach((res, i) => {
    const cfg = BENCHMARKS_CONFIG[i];
    if (res.status === 'fulfilled' && res.value) {
      benchmarks[cfg.id] = res.value;
      if (!latestEndDate || res.value.endDate > latestEndDate) {
        latestEndDate = res.value.endDate;
      }
    } else if (!benchmarks[cfg.id]) {
      // Provide reasonable fallback if neither exists
      benchmarks[cfg.id] = {
        id: cfg.id,
        symbol: cfg.symbol,
        name: cfg.name,
        category: cfg.category,
        color: cfg.color,
        startPrice: 0,
        currentPrice: 0,
        returnPct: 0,
        maxDrawdownPct: 0,
        startDate: startDate,
        endDate: new Date().toISOString().slice(0, 10)
      };
    }
  });

  if (!latestEndDate) {
    latestEndDate = new Date().toISOString().slice(0, 10);
  }

  const startDisplay = formatDateDisplay(startDate);
  const endDisplay = formatDateDisplay(latestEndDate);
  const msDiff = new Date(latestEndDate).getTime() - new Date(startDate).getTime();
  const approxWeeks = Math.max(1, Math.round(msDiff / (7 * 86400000)));

  const payload = {
    updatedAt: new Date().toISOString(),
    window: {
      startDate,
      endDate: latestEndDate,
      weeks: approxWeeks,
      label: `${startDisplay} – ${endDisplay} (${approxWeeks}-Week Window)`
    },
    benchmarks
  };

  fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[benchmark-fetcher] Successfully updated benchmarks in ${targetFile}`);
  return payload;
}

if (require.main === module) {
  const start = process.argv[2] || DEFAULT_START_DATE;
  updateBenchmarks(start)
    .then(p => {
      console.log('Window:', p.window.label);
      Object.values(p.benchmarks).forEach(b => {
        console.log(`- ${b.name}: ${b.returnPct >= 0 ? '+' : ''}${b.returnPct}% (Drawdown: ${b.maxDrawdownPct}%)`);
      });
    })
    .catch(err => {
      console.error('Fatal benchmark fetch error:', err);
      process.exit(1);
    });
}

module.exports = {
  BENCHMARKS_CONFIG,
  fetchBenchmarkHistory,
  updateBenchmarks
};
