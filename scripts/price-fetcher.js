/**
 * Public Market Price Fetcher
 * Queries public Yahoo Finance API for latest ETF market prices.
 * If live price cannot be fetched for any reason, falls back safely to Google Sheets data.
 */

function toYahooSymbol(ticker) {
  if (!ticker || ticker === 'Cash' || ticker === 'CASH') return null;
  if (ticker.startsWith('TSE:')) return ticker.replace('TSE:', '') + '.TO';
  if (ticker.endsWith('.TO')) return ticker;
  return ticker;
}

function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

async function fetchQuote(symbol, timeoutMs = 4000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json.chart?.result?.[0]?.meta;
    if (meta && typeof meta.regularMarketPrice === 'number' && meta.regularMarketPrice > 0) {
      let changePct = typeof meta.regularMarketChangePercent === 'number' ? meta.regularMarketChangePercent : 0;
      if (!changePct && typeof meta.previousClose === 'number' && meta.previousClose > 0) {
        changePct = ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100;
      }
      return {
        price: meta.regularMarketPrice,
        currency: (meta.currency || 'CAD').toUpperCase(),
        dayChangePct: Number(changePct.toFixed(2))
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function fetchUsdCadRate(timeoutMs = 4000) {
  const quote = await fetchQuote('USDCAD=X', timeoutMs);
  if (quote && quote.price > 0) {
    return quote.price;
  }
  return null;
}

async function enrichWithLivePrices(tickersRegistry, holdings, fallbackUsdCadRate = 1.414) {
  // 1. Fetch live USDCAD rate
  const liveUsdCad = await fetchUsdCadRate();
  const usdCadRate = liveUsdCad || fallbackUsdCadRate;

  // 2. Collect unique non-cash tickers
  const uniqueTickers = [...new Set([
    ...Object.keys(tickersRegistry || {}),
    ...(holdings || []).map(h => h.ticker)
  ])].filter(t => t && t !== 'Cash' && t !== 'CASH');

  // 3. Fetch quotes concurrently
  const quotePromises = uniqueTickers.map(async (ticker) => {
    const ySymbol = toYahooSymbol(ticker);
    if (!ySymbol) return { ticker, quote: null };
    const quote = await fetchQuote(ySymbol);
    return { ticker, quote };
  });

  const results = await Promise.allSettled(quotePromises);
  const liveQuotes = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.quote) {
      liveQuotes[r.value.ticker] = r.value.quote;
    }
  }

  // 4. Update tickersRegistry if live quote exists
  for (const [ticker, fact] of Object.entries(tickersRegistry || {})) {
    const q = liveQuotes[ticker];
    if (q) {
      const isCad = q.currency === 'CAD' || ticker.startsWith('TSE:') || ticker.endsWith('.TO');
      const sheetPrice = fact.unitPrice || 0;
      let effectivePrice = sheetPrice;

      if (isCad) {
        const roundedLive = round2(q.price);
        if (sheetPrice <= 0 || Math.abs(roundedLive - sheetPrice) >= 0.01) {
          effectivePrice = roundedLive;
        }
      } else {
        const currentUsdApprox = sheetPrice > 0 ? (sheetPrice / usdCadRate) : 0;
        if (currentUsdApprox <= 0 || Math.abs(q.price - currentUsdApprox) / currentUsdApprox > 0.005) {
          effectivePrice = round2(q.price * usdCadRate);
        }
      }

      fact.unitPrice = effectivePrice;
      fact.livePriceSource = 'public-api';
    }
  }

  // 5. Update holdings if live quote exists
  for (const h of (holdings || [])) {
    if (h.ticker === 'Cash' || h.ticker === 'CASH' || h.symbol === 'CASH') continue;
    const q = liveQuotes[h.ticker];
    if (q) {
      const isCad = q.currency === 'CAD' || h.currency === 'CAD' || h.ticker.startsWith('TSE:') || (h.symbol && h.symbol.endsWith('.TO'));
      const fact = (tickersRegistry || {})[h.ticker] || {};
      const sheetPrice = fact.unitPrice || h.unitPrice || 0;
      let effectivePrice = sheetPrice;

      if (isCad) {
        const roundedLive = round2(q.price);
        if (sheetPrice <= 0 || Math.abs(roundedLive - sheetPrice) >= 0.01) {
          effectivePrice = roundedLive;
        }
      } else {
        const currentUsdApprox = sheetPrice > 0 ? (sheetPrice / usdCadRate) : 0;
        if (currentUsdApprox <= 0 || Math.abs(q.price - currentUsdApprox) / currentUsdApprox > 0.005) {
          effectivePrice = round2(q.price * usdCadRate);
        }
      }

      h.unitPrice = effectivePrice;
      if (q.dayChangePct !== undefined) {
        h.dayChangePct = q.dayChangePct;
      }
      if (h.count > 0) {
        h.sum = Number((h.count * h.unitPrice).toFixed(2));
      }
      if (h.averageCost > 0 && h.count > 0) {
        h.totalCost = Number((h.count * h.averageCost).toFixed(2));
        h.unrealizedGainCAD = Number((h.sum - h.totalCost).toFixed(2));
        h.unrealizedGainPct = h.totalCost > 0 ? Number(((h.sum - h.totalCost) / h.totalCost * 100).toFixed(2)) : 0;
      }
      // Re-scale allocations using existing allocation percentages
      if (h.allocationPct && h.sum > 0) {
        h.allocation = {
          us: Number((h.sum * (h.allocationPct.us || 0)).toFixed(2)),
          canada: Number((h.sum * (h.allocationPct.canada || 0)).toFixed(2)),
          developed: Number((h.sum * (h.allocationPct.developed || 0)).toFixed(2)),
          emerging: Number((h.sum * (h.allocationPct.emerging || 0)).toFixed(2)),
          fixedIncome: Number((h.sum * (h.allocationPct.fixedIncome || 0)).toFixed(2)),
          crypto: Number((h.sum * (h.allocationPct.crypto || 0)).toFixed(2)),
          preciousMetals: Number((h.sum * (h.allocationPct.preciousMetals || 0)).toFixed(2))
        };
      }
    }
  }

  return { tickersRegistry, holdings };
}

module.exports = {
  toYahooSymbol,
  fetchQuote,
  fetchUsdCadRate,
  enrichWithLivePrices
};
