const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decrypt, encrypt } = require('../scripts/crypto-utils');
const {
  calculateWeeklyStreaks,
  calculateLongestStreaksWithoutATH,
  formatStreakDates,
  computeRolling52Windows,
  calculatePurchasingPower,
  buildRolling52OverlaySeries,
  calculateDrawdownMetrics
} = require('../performance.js');
const { computeXeqtProgressionOverlay, formatCurrency, formatMonthShort, sanitizeHistory, enrichHistoryWithLiveHoldings } = require('../api.js');
const {
  computeSimpleAllocation,
  isCashHolding,
  getHoldingAssetKey,
  getHoldingCostAndGain
} = require('../allocation.js');
const {
  calculateMainData,
  renderMainTopStats,
  renderMainProgressionChart,
  renderMainYearOverlayChart,
  toggleMainXeqtOverlay,
  toggleMainAthsFilter,
  filterHistoryAths,
  calculateTimeBack,
  getDayOfYearFraction,
  getMainYearColor,
  setMainTimeframe,
  setMainCurrency,
  setMainUnit,
  getMainChartState,
  resetMainChartState,
  setMainChartData,
  buildMainYearOverlaySeries,
  syncMainTimeframeButtons
} = require('../main.js');

// Mock portfolio holdings fixture for unit testing (pure synthetic data; zero password dependency)
const MOCK_HOLDINGS = [
  {
    ticker: 'TSE:XEQT',
    symbol: 'XEQT',
    account: 'TFSA',
    brokerage: 'Wealthsimple',
    registered: true,
    count: 2000,
    averageCost: 30.00,
    totalCost: 60000,
    sum: 80000,
    unrealizedGainCAD: 20000,
    currency: 'CAD',
    allocation: { us: 36000, canada: 20000, developed: 16000, emerging: 8000, fixedIncome: 0, crypto: 0, preciousMetals: 0 }
  },
  {
    ticker: 'TSE:XEQT',
    symbol: 'XEQT',
    account: 'RRSP',
    brokerage: 'Questrade',
    registered: true,
    count: 1000,
    averageCost: 32.00,
    totalCost: 32000,
    sum: 40000,
    unrealizedGainCAD: 8000,
    currency: 'CAD',
    allocation: { us: 18000, canada: 10000, developed: 8000, emerging: 4000, fixedIncome: 0, crypto: 0, preciousMetals: 0 }
  },
  {
    ticker: 'TSE:XEC',
    symbol: 'XEC',
    account: 'Non-Registered',
    brokerage: 'Interactive Brokers',
    registered: false,
    count: 1000,
    averageCost: 25.00,
    totalCost: 25000,
    sum: 30000,
    unrealizedGainCAD: 5000,
    currency: 'CAD',
    allocation: { us: 0, canada: 0, developed: 0, emerging: 30000, fixedIncome: 0, crypto: 0, preciousMetals: 0 }
  },
  {
    ticker: 'Cash',
    symbol: 'CASH',
    account: 'CASH',
    brokerage: 'RBC Royal Bank',
    registered: false,
    count: 15000,
    averageCost: 1.0,
    totalCost: 15000,
    sum: 15000,
    unrealizedGainCAD: 0,
    currency: 'CAD',
    allocation: { us: 0, canada: 0, developed: 0, emerging: 0, fixedIncome: 15000, crypto: 0, preciousMetals: 0 }
  },
  {
    ticker: 'Cash',
    symbol: 'CASH',
    account: 'CASH',
    brokerage: 'CIBC',
    registered: false,
    count: 10000,
    averageCost: 1.0,
    totalCost: 10000,
    sum: 10000,
    unrealizedGainCAD: 0,
    currency: 'CAD',
    allocation: { us: 0, canada: 0, developed: 0, emerging: 0, fixedIncome: 10000, crypto: 0, preciousMetals: 0 }
  }
];

// Generates 65 weeks of deterministic mock history spanning late 2024, full 2025, and early 2026
function createMockHistory() {
  const history = [];
  let baseCAD = 200000;
  let baseUSD = 150000;
  let currentDate = new Date('2024-12-27T12:00:00Z');

  const weeklyDeltasCAD = [
    0, // week 1 (2024-12-27) baseline
    // 2025 (weeks 2 to 53: 52 weeks)
    ...[2000, 3000, 1500, 2500, -1000, -2000, 3000, 4000, 2000, 1000, 2500, -1500, 3000, 2000, 1000, 2000, 2500, 1500, -2000, -1000, 3000, 2000, 1000, 1500, 2000, 3000, 2500, 1000, -500, 2000, 3000, 2500, 1500, 2000, 1000, 2500, -1000, -2000, 3000, 2000, 1500, 2000, 2500, 3000, 1000, 2000, 1500, 2500, 3000, 2000, 1000, 2000],
    // 2026 (weeks 54 to 65: 12 weeks: growth to ATH at week 60, followed by a controlled 5-week pullback)
    ...[3000, 4000, 5000, 2000, 3000, 4000, 2000, -3000, -4000, -2000, -3000, -2000]
  ];

  for (let i = 0; i < weeklyDeltasCAD.length; i++) {
    const chgCAD = weeklyDeltasCAD[i];
    baseCAD += chgCAD;
    const chgUSD = Math.round(chgCAD * 0.74);
    baseUSD += chgUSD;

    const dateStr = currentDate.toISOString().slice(0, 10);
    const prevCAD = baseCAD - chgCAD;
    const prevUSD = baseUSD - chgUSD;

    history.push({
      week: i + 1,
      date: dateStr,
      totalCAD: baseCAD,
      weeklyChangeCAD: chgCAD,
      weeklyChangePct: i === 0 ? 0 : Number(((chgCAD / prevCAD) * 100).toFixed(2)),
      totalUSD: baseUSD,
      weeklyChangeUSD: chgUSD,
      weeklyChangeUSDPct: i === 0 ? 0 : Number(((chgUSD / prevUSD) * 100).toFixed(2))
    });

    currentDate.setUTCDate(currentDate.getUTCDate() + 7);
  }
  return history;
}

const MOCK_HISTORY = createMockHistory();

test('Encryption & Decryption Suite', async (t) => {
  await t.test('AES-256-GCM roundtrip encryption and decryption', () => {
    const sample = { message: 'hello portfolio', amount: 12345.67 };
    const encrypted = encrypt(sample, 'test-pass');
    const decrypted = decrypt(encrypted, 'test-pass');
    assert.deepEqual(decrypted, sample);
  });

  await t.test('Decryption with wrong password throws error', () => {
    const sample = { secret: 'data' };
    const encrypted = encrypt(sample, 'correct-pass');
    assert.throws(() => {
      decrypt(encrypted, 'wrong-pass');
    });
  });

  await t.test('Decryption with corrupted payload or tag throws error', () => {
    const sample = { secret: 'data' };
    const encrypted = encrypt(sample, 'correct-pass');
    const corrupted = { ...encrypted, tag: Buffer.alloc(16).toString('base64') };
    assert.throws(() => {
      decrypt(corrupted, 'correct-pass');
    });
  });

  await t.test('Encrypted payload structure contains required security fields', () => {
    const sample = { test: true };
    const enc = encrypt(sample, 'test-pass');
    assert.equal(enc.version, 1);
    assert.equal(enc.algorithm, 'AES-256-GCM');
    assert.equal(enc.kdf, 'PBKDF2');
    assert.ok(enc.iv && typeof enc.iv === 'string', 'Payload must contain IV');
    assert.ok(enc.tag && typeof enc.tag === 'string', 'Payload must contain tag');
    assert.ok(enc.data && typeof enc.data === 'string', 'Payload must contain data');
    assert.ok(enc.salt && typeof enc.salt === 'string', 'Payload must contain salt');
  });
});

test('Financial Calculations Suite', async (t) => {
  const holdings = MOCK_HOLDINGS;
  const history = MOCK_HISTORY;

  await t.test('Accounts partition: cash + registered + non-registered = total', () => {
    const totalCAD = holdings.reduce((s, h) => s + h.sum, 0);
    let registeredCAD = 0;
    let nonRegisteredCAD = 0;
    let cashCAD = 0;

    holdings.forEach(h => {
      const isCash = h.symbol === 'CASH' || h.account === 'CASH' || h.ticker === 'Cash';
      const isReg = !isCash && (h.registered === true || h.registered === 1 || String(h.registered).toLowerCase() === 'true' || (h.account && /TFSA|RRSP|FHSA/i.test(h.account)));

      if (isCash) {
        cashCAD += h.sum;
      } else if (isReg) {
        registeredCAD += h.sum;
      } else {
        nonRegisteredCAD += h.sum;
      }
    });

    const sumPartition = registeredCAD + nonRegisteredCAD + cashCAD;
    assert.equal(Math.round(sumPartition * 100), Math.round(totalCAD * 100), 'Partition sum must exactly equal totalCAD');
  });

  await t.test('Cost basis and market ROI consistency', () => {
    let totalCostBasisCAD = 0;
    let totalMarketValCAD = 0;
    let totalUnrealizedGainCAD = 0;

    holdings.forEach(h => {
      const isCash = h.symbol === 'CASH' || h.account === 'CASH' || h.ticker === 'Cash';
      if (!isCash) {
        const cost = typeof h.totalCost === 'number' && h.totalCost > 0
          ? h.totalCost
          : (h.averageCost || 0) * (h.count || 0);
        totalCostBasisCAD += cost;
        totalMarketValCAD += (h.sum || 0);
        totalUnrealizedGainCAD += (h.unrealizedGainCAD || ((h.sum || 0) - cost));
      }
    });

    const calculatedGain = totalMarketValCAD - totalCostBasisCAD;
    assert.ok(Math.abs(calculatedGain - totalUnrealizedGainCAD) < 1, 'Calculated gain matches sum of unrealized gains');

    const marketRoiPct = totalCostBasisCAD > 0 ? (totalUnrealizedGainCAD / totalCostBasisCAD) * 100 : 0;
    assert.ok(marketRoiPct > 0 && marketRoiPct < 100, `Market ROI should be a reasonable rate, got ${marketRoiPct}%`);
  });

  await t.test('Annual return reconciliation between stats and history', () => {
    const recs2025 = history.filter(r => r.date.startsWith('2025-'));
    assert.ok(recs2025.length > 0, '2025 records should exist');
    const start2025 = recs2025[0];
    const end2025 = recs2025[recs2025.length - 1];

    const initialNetWorth2025 = start2025.totalCAD - (start2025.weeklyChangeCAD || 0);
    const annualNetChange2025 = end2025.totalCAD - initialNetWorth2025;
    const weeklySumChange2025 = recs2025.reduce((s, r) => s + (r.weeklyChangeCAD || 0), 0);

    assert.ok(Math.abs(annualNetChange2025 - weeklySumChange2025) < 0.05,
      `Sum of weekly changes (${weeklySumChange2025}) must closely match end - initial (${annualNetChange2025})`);

    const firstIdx2025 = history.findIndex(r => r.date.startsWith('2025-'));
    assert.ok(Math.abs(history[firstIdx2025 - 1].totalCAD - initialNetWorth2025) < 0.01,
      'Prior year ending balance must exactly match annual baseline');
  });

  await t.test('Rolling 52-week best and worst period dynamic calculation', () => {
    assert.ok(history.length >= 52, 'History must have at least 52 weeks');
    const windows = [];
    for (let i = 0; i <= history.length - 52; i++) {
      const win = history.slice(i, i + 52);
      const startRec = win[0];
      const endRec = win[51];
      const startVal = i > 0 ? history[i - 1].totalCAD : (startRec.totalCAD - (startRec.weeklyChangeCAD || 0));
      const endVal = endRec.totalCAD;
      const dollarGain = endVal - startVal;
      const pctGain = startVal > 0 ? (dollarGain / startVal) * 100 : 0;
      windows.push({
        startIndex: i,
        endIndex: i + 51,
        startWeek: startRec.week,
        endWeek: endRec.week,
        dollarGain,
        pctGain,
        length: win.length
      });
    }

    assert.equal(windows.length, history.length - 52 + 1, 'Number of rolling windows must be N - 52 + 1');
    assert.ok(windows.every(w => w.length === 52), 'Every window must contain exactly 52 records');

    windows.sort((a, b) => b.pctGain - a.pctGain);
    const best = windows[0];
    const worst = windows[windows.length - 1];

    assert.ok(best.pctGain > worst.pctGain, 'Best 52W return must be greater than worst 52W return');
    assert.ok(best.dollarGain > 0, 'Best 52W dollar gain must be positive');
    assert.ok(worst.pctGain > 0, 'Worst 52W return in this dataset should be positive');
  });

  await t.test('Time setback (drawdown time-lag) calculation for USD and CAD', () => {
    const latest = history[history.length - 1];
    const usdBack = calculateTimeBack(history, latest.totalUSD, 'totalUSD');
    assert.equal(usdBack.isAth, false);
    assert.ok(usdBack.weeks >= 1);
    assert.ok(usdBack.record);
    assert.ok(usdBack.record.totalUSD <= latest.totalUSD + 1.0);

    const cadBack = calculateTimeBack(history, latest.totalCAD, 'totalCAD');
    assert.equal(cadBack.isAth, false);
    assert.ok(cadBack.weeks >= 1);
    assert.ok(cadBack.record);
    assert.ok(cadBack.record.totalCAD <= latest.totalCAD + 1.0);

    // Drawdown setback correctly identifies week 55 milestone (10 weeks ago)
    assert.equal(cadBack.weeks, 10);
    assert.equal(usdBack.weeks, 10);

    // Explicitly test known non-ATH condition
    const minHistoricalCAD = Math.min(...history.map(r => r.totalCAD));
    const nonAthBack = calculateTimeBack(history, minHistoricalCAD, 'totalCAD');
    assert.equal(nonAthBack.isAth, false);
    assert.ok(nonAthBack.weeks >= 1);

    // Explicitly test ATH condition
    const maxHistoricalCAD = Math.max(...history.map(r => r.totalCAD));
    const athBack = calculateTimeBack(history, maxHistoricalCAD + 1000, 'totalCAD');
    assert.equal(athBack.isAth, true);
    assert.equal(athBack.weeks, 0);
  });

  await t.test('Time setback correctly ignores self-comparison when latest week bounces during drawdown', () => {
    // History where portfolio peaked at week 107 (491k), was 482k at week 103 (Aug 7),
    // dropped to 477k at week 111, and bounced to 478.9k at week 112.
    const reboundHistory = [
      { week: 101, date: '2026-07-24', totalUSD: 462927 },
      { week: 102, date: '2026-07-31', totalUSD: 469487 },
      { week: 103, date: '2026-08-07', totalUSD: 482415 },
      { week: 104, date: '2026-08-14', totalUSD: 489499 },
      { week: 107, date: '2026-09-04', totalUSD: 491082 },
      { week: 110, date: '2026-09-25', totalUSD: 480813 },
      { week: 111, date: '2026-10-02', totalUSD: 477923 },
      { week: 112, date: '2026-10-09', totalUSD: 478978.95 }
    ];

    const currentUSD = 478978.95;
    const res = calculateTimeBack(reboundHistory, currentUSD, 'totalUSD');
    assert.equal(res.isAth, false);
    assert.equal(res.weeks, 10, 'Must be 10 weeks back to Jul 31, 2026 baseline before week 103 (Aug 7)');
    assert.equal(res.record.week, 102);
    assert.equal(res.record.date, '2026-07-31');
    assert.equal(res.label, '10 weeks');
    assert.ok(res.sub.includes('Jul 31, 2026'));
  });

  await t.test('Rolling 52-week percentage overlay series normalization with current window', () => {
    const extremes = computeRolling52Windows(history, 'pct');
    assert.ok(extremes, 'computeRolling52Windows should return results for >=52 records');
    assert.equal(extremes.totalWindows, history.length - 52 + 1);

    const { best, worst, current } = extremes;
    assert.ok(best && worst && current, 'extremes should contain best, worst, and current windows');

    // Current 52-week window must end at the latest available historical week
    const latestRecord = history[history.length - 1];
    assert.equal(current.endWeek, latestRecord.week, 'Current 52W end week must match latest history week');
    assert.equal(current.endDate, latestRecord.date, 'Current 52W end date must match latest history date');
    assert.equal(current.records.length, 52, 'Current 52W window must span exactly 52 weekly records');

    // Normalized series generation: W0 at 0%, followed by 52 elapsed weekly percent returns
    const bestSeriesPct = buildRolling52OverlaySeries(best, 'pct', 'CAD');
    const worstSeriesPct = buildRolling52OverlaySeries(worst, 'pct', 'CAD');
    const currentSeriesPct = buildRolling52OverlaySeries(current, 'pct', 'CAD');

    assert.equal(bestSeriesPct.length, 53, 'Best series must have 53 points (W0 to W52)');
    assert.equal(worstSeriesPct.length, 53, 'Worst series must have 53 points (W0 to W52)');
    assert.equal(currentSeriesPct.length, 53, 'Current series must have 53 points (W0 to W52)');

    assert.equal(bestSeriesPct[0].plotVal, 0, 'Best series must start at 0%');
    assert.equal(worstSeriesPct[0].plotVal, 0, 'Worst series must start at 0%');
    assert.equal(currentSeriesPct[0].plotVal, 0, 'Current series must start at 0%');

    assert.ok(bestSeriesPct[52].plotVal >= worstSeriesPct[52].plotVal, 'Best end return must be >= worst end return');
    assert.ok(bestSeriesPct[52].plotVal >= currentSeriesPct[52].plotVal, 'Best end return must be >= current end return');

    // Test CAD Dollar metric normalization
    const bestSeriesCAD = buildRolling52OverlaySeries(best, 'cad', 'CAD');
    const worstSeriesCAD = buildRolling52OverlaySeries(worst, 'cad', 'CAD');
    const currentSeriesCAD = buildRolling52OverlaySeries(current, 'cad', 'CAD');

    assert.equal(bestSeriesCAD.length, 53, 'Best CAD series must have 53 points');
    assert.equal(bestSeriesCAD[0].plotVal, 0, 'Best CAD series must start at +$0');
    assert.equal(worstSeriesCAD[0].plotVal, 0, 'Worst CAD series must start at +$0');
    assert.equal(currentSeriesCAD[0].plotVal, 0, 'Current CAD series must start at +$0');
    assert.equal(bestSeriesCAD[52].plotVal, best.gainCAD, 'Best CAD end point must equal best.gainCAD');
    assert.equal(worstSeriesCAD[52].plotVal, worst.gainCAD, 'Worst CAD end point must equal worst.gainCAD');
    assert.equal(currentSeriesCAD[52].plotVal, current.gainCAD, 'Current CAD end point must equal current.gainCAD');

    // Test USD Dollar metric normalization
    const bestSeriesUSD = buildRolling52OverlaySeries(best, 'usd', 'USD');
    const worstSeriesUSD = buildRolling52OverlaySeries(worst, 'usd', 'USD');
    const currentSeriesUSD = buildRolling52OverlaySeries(current, 'usd', 'USD');

    assert.equal(bestSeriesUSD.length, 53, 'Best USD series must have 53 points');
    assert.equal(bestSeriesUSD[0].plotVal, 0, 'Best USD series must start at +US$0');
    assert.equal(worstSeriesUSD[0].plotVal, 0, 'Worst USD series must start at +US$0');
    assert.equal(currentSeriesUSD[0].plotVal, 0, 'Current USD series must start at +US$0');
    assert.equal(bestSeriesUSD[52].plotVal, best.gainUSD, 'Best USD end point must equal best.gainUSD');
    assert.equal(worstSeriesUSD[52].plotVal, worst.gainUSD, 'Worst USD end point must equal worst.gainUSD');
    assert.equal(currentSeriesUSD[52].plotVal, current.gainUSD, 'Current USD end point must equal current.gainUSD');
  });

  await t.test('Continuous rolling 52-week trailing returns timeline generation', () => {
    const extremes = computeRolling52Windows(history, 'pct');
    assert.ok(extremes.timeline, 'extremes must contain timeline array');
    const expectedWindows = history.length - 52 + 1;
    assert.equal(extremes.timeline.length, expectedWindows, `Timeline must contain ${expectedWindows} windows`);

    // First window ends at week 52
    assert.equal(extremes.timeline[0].endWeek, 52);
    assert.equal(extremes.timeline[0].startDate, history[0].date);
    assert.equal(extremes.timeline[0].endDate, history[51].date);

    // Final window ends at latest week
    const latestWin = extremes.timeline[extremes.timeline.length - 1];
    const latestRec = history[history.length - 1];
    assert.equal(latestWin.endWeek, latestRec.week);
    assert.equal(latestWin.endDate, latestRec.date);
    assert.equal(latestWin.startValCAD, extremes.current.startValCAD);
    assert.equal(latestWin.endValCAD, extremes.current.endValCAD);
    assert.equal(latestWin.pctCAD, extremes.current.pctCAD);

    // Timeline min and max match extremes best and worst
    const timelinePcts = extremes.timeline.map(w => w.pctCAD);
    const maxPct = Math.max(...timelinePcts);
    const minPct = Math.min(...timelinePcts);

    assert.equal(maxPct, extremes.best.pctCAD, 'Max timeline pct must match best window pct');
    assert.equal(minPct, extremes.worst.pctCAD, 'Min timeline pct must match worst window pct');

    // Verify all windows have valid metrics
    for (const w of extremes.timeline) {
      assert.ok(w.gainCAD > 0, 'Every 52-week window in history had positive CAD gain');
      assert.ok(w.pctCAD > 0, 'Every 52-week window in history had positive CAD return %');
      assert.ok(w.startValCAD > 0);
      assert.ok(w.endValCAD > w.startValCAD);
      assert.equal(w.records.length, 52);
    }
  });

  await t.test('Weekly momentum & streak calculations for CAD and USD', () => {
    const cadStreaks = calculateWeeklyStreaks(history, 'CAD');
    assert.equal(cadStreaks.longestUp.count, 21, 'CAD longest up streak should be 21 weeks');
    assert.equal(cadStreaks.longestUp.startWeek, 40);
    assert.equal(cadStreaks.longestUp.endWeek, 60);
    assert.equal(cadStreaks.longestUp.change, 52000);
    assert.ok(cadStreaks.longestUp.pct > 20);

    assert.equal(cadStreaks.longestDown.count, 5, 'CAD longest down streak should be 5 weeks');
    assert.equal(cadStreaks.longestDown.startWeek, 61);
    assert.equal(cadStreaks.longestDown.endWeek, 65);
    assert.equal(cadStreaks.longestDown.change, -14000);
    assert.ok(cadStreaks.longestDown.pct < -4);

    const usdStreaks = calculateWeeklyStreaks(history, 'USD');
    assert.equal(usdStreaks.longestUp.count, 21);
    assert.equal(usdStreaks.longestDown.count, 5);

    // formatStreakDates helper
    assert.equal(formatStreakDates('2025-09-26', '2026-02-13'), '2025-09-26 – 2026-02-13');
    assert.equal(formatStreakDates('2025-12-12', '2025-12-12'), '2025-12-12');
    assert.equal(formatStreakDates('', ''), '');

    // Edge cases
    assert.equal(calculateWeeklyStreaks([]).longestUp.count, 0);
    assert.equal(calculateWeeklyStreaks([{ totalCAD: 100 }]).longestUp.count, 0);
  });

  await t.test('Top 3 longest streaks without all-time highs for CAD and USD', () => {
    const cadAthStreaks = calculateLongestStreaksWithoutATH(history, 'CAD', 3);
    assert.equal(cadAthStreaks.length, 3, 'Should return top 3 CAD ATH streaks');
    assert.equal(cadAthStreaks[0].nonAthWeeks, 5, 'Top 1 CAD streak without ATH is 5 weeks');
    assert.equal(cadAthStreaks[0].startWeek, 61);
    assert.equal(cadAthStreaks[0].endWeek, 65);
    assert.equal(cadAthStreaks[0].isOngoing, true);

    const usdAthStreaks = calculateLongestStreaksWithoutATH(history, 'USD', 3);
    assert.equal(usdAthStreaks.length, 3, 'Should return top 3 USD ATH streaks');
    assert.equal(usdAthStreaks[0].nonAthWeeks, 5, 'Top 1 USD streak without ATH is 5 weeks');

    // Verify properties and monotonicity
    [...cadAthStreaks, ...usdAthStreaks].forEach(s => {
      assert.ok(s.nonAthWeeks >= 1);
      assert.ok(s.elapsedWeeks >= s.nonAthWeeks);
      assert.ok(s.maxDD <= 0, 'Drawdown during streak without ATH must be <= 0');
      assert.ok(s.maxDDPct <= 0);
      assert.ok(s.peakVal > 0);
    });

    // Edge cases
    assert.deepEqual(calculateLongestStreaksWithoutATH([]), []);
    assert.deepEqual(calculateLongestStreaksWithoutATH(null), []);
    assert.deepEqual(calculateLongestStreaksWithoutATH([{ totalCAD: 100 }]), []);
  });
});

test('Public ETF Benchmarks Suite', async (t) => {
  const benchPath = path.join(__dirname, '..', 'data', 'benchmarks.json');
  assert.ok(fs.existsSync(benchPath), 'data/benchmarks.json should exist');

  const raw = fs.readFileSync(benchPath, 'utf8');
  const benchData = JSON.parse(raw);

  await t.test('Benchmark window and metadata structure', () => {
    assert.ok(benchData.updatedAt, 'benchmarks.json must have updatedAt timestamp');
    assert.ok(benchData.window, 'benchmarks.json must have window object');
    assert.equal(benchData.window.startDate, '2024-08-23');
    assert.ok(benchData.window.weeks >= 100, 'Window weeks should span >= 100 weeks');
  });

  await t.test('All standard Canadian benchmarks are present with valid returns', () => {
    const expected = ['XEQT', 'VFV', 'XBAL', 'XCB'];
    for (const key of expected) {
      const b = benchData.benchmarks[key];
      assert.ok(b, `Benchmark ${key} must exist`);
      assert.ok(b.symbol, `${key} must have symbol`);
      assert.ok(typeof b.startPrice === 'number' && b.startPrice > 0, `${key} startPrice must be positive`);
      assert.ok(typeof b.currentPrice === 'number' && b.currentPrice > 0, `${key} currentPrice must be positive`);
      assert.ok(typeof b.returnPct === 'number', `${key} returnPct must be a number`);
      assert.ok(typeof b.maxDrawdownPct === 'number' && b.maxDrawdownPct <= 0, `${key} maxDrawdownPct must be <= 0`);
    }

    // Sanity checks on real market numbers
    assert.ok(benchData.benchmarks.XEQT.returnPct > 35, 'XEQT return should exceed +35%');
    assert.ok(benchData.benchmarks.VFV.returnPct > 35, 'VFV return should exceed +35%');
    assert.ok(benchData.benchmarks.XBAL.returnPct > 15, 'XBAL return should exceed +15%');
  });

  await t.test('XEQT rolling 52-week return benchmark series calculation', () => {
    const xeqtPrices = benchData.benchmarks.XEQT.weeklyPrices;
    assert.ok(xeqtPrices && xeqtPrices.length >= 60, 'XEQT weeklyPrices must exist');

    const xeqtRollingPcts = [];
    for (let i = 0; i <= 60 - 1; i++) {
      const pStart = xeqtPrices[i];
      const pEnd = xeqtPrices[Math.min(xeqtPrices.length - 1, i + 51)];
      const pct = ((pEnd - pStart) / pStart) * 100;
      xeqtRollingPcts.push(pct);
    }

    assert.equal(xeqtRollingPcts.length, 60);
    const avgXeqt52WPct = xeqtRollingPcts.reduce((a, b) => a + b, 0) / xeqtRollingPcts.length;

    // Sanity check: XEQT average 52-week rolling return is positive (~21%)
    assert.ok(avgXeqt52WPct > 15 && avgXeqt52WPct < 30, 'Average XEQT 52W return should be between 15% and 30%');
  });

  await t.test('Live USD/CAD FX rate is pulled fresh and stored in benchmarks.json and fx.json', () => {
    assert.ok(benchData.fx, 'benchmarks.json must have fx object');
    assert.equal(benchData.fx.symbol, 'USDCAD=X');
    assert.ok(benchData.fx.usdCadRate > 1.0 && benchData.fx.usdCadRate < 2.0, 'usdCadRate should be realistic (1.0 to 2.0)');
    assert.ok(benchData.fx.cadUsdRate > 0.5 && benchData.fx.cadUsdRate < 1.0, 'cadUsdRate should be realistic (0.5 to 1.0)');
    assert.ok(benchData.fx.updatedAt, 'fx.updatedAt must exist');

    const fxPath = path.join(__dirname, '..', 'data', 'fx.json');
    assert.ok(fs.existsSync(fxPath), 'data/fx.json must exist');
    const fxData = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
    assert.equal(fxData.symbol, 'USDCAD=X');
    assert.equal(fxData.usdCadRate, benchData.fx.usdCadRate);
    assert.equal(fxData.cadUsdRate, benchData.fx.cadUsdRate);
  });
});

test('Purchasing Power & Inflation Suite', async (t) => {
  await t.test('Purchasing power with 0% inflation preserves exact nominal values', () => {
    const pp = calculatePurchasingPower(100000, 150000, 52.14, 0);
    assert.equal(pp.deflator, 1.0);
    assert.equal(pp.realNetWorth, 150000);
    assert.equal(pp.realGain, 50000);
    assert.equal(pp.realGainPct, 50.0);
    assert.equal(pp.inflationDrag, 0);
  });

  await t.test('Purchasing power with 5% inflation over 1 year (52.14 weeks)', () => {
    const pp = calculatePurchasingPower(100000, 120000, 52.14, 5.0);
    assert.equal(pp.deflator, 1.05);
    // 120,000 / 1.05 = 114285.71
    assert.equal(pp.realNetWorth, 114285.71);
    assert.equal(pp.realGain, 14285.71);
    assert.equal(pp.realGainPct, 14.29);
    assert.equal(pp.inflationDrag, 5714.29);
    assert.ok(pp.realWeeklyPace > 0, 'Weekly real pace should be positive');
  });

  await t.test('Inflation drag increases monotonically with higher inflation rates', () => {
    const pp3 = calculatePurchasingPower(300000, 600000, 100, 3.0);
    const pp5 = calculatePurchasingPower(300000, 600000, 100, 5.0);
    const pp7 = calculatePurchasingPower(300000, 600000, 100, 7.0);

    assert.ok(pp3.deflator < pp5.deflator && pp5.deflator < pp7.deflator);
    assert.ok(pp3.realNetWorth > pp5.realNetWorth && pp5.realNetWorth > pp7.realNetWorth);
    assert.ok(pp3.inflationDrag < pp5.inflationDrag && pp5.inflationDrag < pp7.inflationDrag);
  });
});

test('Net Worth Progression XEQT Overlay Suite', async (t) => {
  const fullHistory = MOCK_HISTORY;
  const benchPath = path.join(__dirname, '..', 'data', 'benchmarks.json');
  const benchData = JSON.parse(fs.readFileSync(benchPath, 'utf8'));
  const xeqtPrices = benchData.benchmarks.XEQT.weeklyPrices;

  await t.test('computeXeqtProgressionOverlay returns empty array on empty inputs', () => {
    assert.deepEqual(computeXeqtProgressionOverlay([], fullHistory, xeqtPrices), []);
    assert.deepEqual(computeXeqtProgressionOverlay(null, fullHistory, xeqtPrices), []);
    assert.deepEqual(computeXeqtProgressionOverlay(fullHistory, fullHistory, []), []);
    assert.deepEqual(computeXeqtProgressionOverlay(fullHistory, fullHistory, null), []);
  });

  await t.test('computeXeqtProgressionOverlay starts at 0% return and matches portfolio starting capital', () => {
    const records = fullHistory.length > 52 ? fullHistory.slice(-53) : fullHistory;
    const overlay = computeXeqtProgressionOverlay(records, fullHistory, xeqtPrices, 'CAD');

    assert.equal(overlay.length, records.length);
    assert.equal(overlay[0].val, records[0].totalCAD);
    assert.equal(overlay[0].returnPct, 0);
    assert.equal(overlay[0].gain, 0);
    assert.equal(overlay[0].spreadVal, 0);
    assert.equal(overlay[0].spreadPct, 0);
  });

  await t.test('computeXeqtProgressionOverlay accurately scales with simulated synthetic prices', () => {
    const mockRecords = [
      { week: 1, date: '2025-01-01', totalCAD: 100000, totalUSD: 70000 },
      { week: 2, date: '2025-01-08', totalCAD: 110000, totalUSD: 77000 },
      { week: 3, date: '2025-01-15', totalCAD: 120000, totalUSD: 84000 }
    ];
    // Start price 50, then 55 (+10%), then 60 (+20%)
    const mockPrices = [50, 55, 60];

    const overlay = computeXeqtProgressionOverlay(mockRecords, mockRecords, mockPrices, 'CAD');
    assert.equal(overlay.length, 3);

    // Week 1: 0% return, $100,000
    assert.equal(overlay[0].val, 100000);
    assert.equal(overlay[0].returnPct, 0);
    assert.equal(overlay[0].spreadVal, 0);

    // Week 2: +10% return, $110,000. Portfolio also grew to $110,000 (+10%), so spread is 0
    assert.equal(overlay[1].val, 110000);
    assert.equal(overlay[1].returnPct, 10);
    assert.equal(overlay[1].spreadVal, 0);
    assert.equal(overlay[1].spreadPct, 0);

    // Week 3: +20% return, $120,000. Portfolio also grew to $120,000 (+20%), so spread is 0
    assert.equal(overlay[2].val, 120000);
    assert.equal(overlay[2].returnPct, 20);
    assert.equal(overlay[2].spreadVal, 0);
  });

  await t.test('computeXeqtProgressionOverlay correctly captures outperformance spread', () => {
    const mockRecords = [
      { week: 1, date: '2025-01-01', totalCAD: 100000, totalUSD: 70000 },
      { week: 2, date: '2025-01-08', totalCAD: 115000, totalUSD: 80500 } // +15%
    ];
    // XEQT only went from 50 to 52.5 (+5%)
    const mockPrices = [50, 52.5];

    const overlay = computeXeqtProgressionOverlay(mockRecords, mockRecords, mockPrices, 'CAD');
    assert.equal(overlay[1].val, 105000);
    assert.equal(overlay[1].returnPct, 5);
    assert.equal(overlay[1].portfolioReturnPct, 15);
    assert.equal(overlay[1].spreadVal, 10000); // $115,000 - $105,000 = $10,000 ahead of XEQT
    assert.equal(overlay[1].spreadPct, 10);    // 15% - 5% = +10% alpha
  });

  await t.test('computeXeqtProgressionOverlay dynamically uses currentBenchmarkPrice on latest node preventing clamping duplication', () => {
    const mockRecords = [
      { week: 1, date: '2025-01-01', totalCAD: 100000, totalUSD: 70000 },
      { week: 2, date: '2025-01-08', totalCAD: 105000, totalUSD: 73500 },
      { week: 3, date: '2025-01-12', totalCAD: 104000, totalUSD: 72800 } // mid-week update
    ];
    // Historical weekly prices only has 2 weeks: 50, 52
    const mockPrices = [50, 52];
    // Live price for week 3 is 51
    const currentPrice = 51;

    const overlay = computeXeqtProgressionOverlay(mockRecords, mockRecords, mockPrices, 'CAD', currentPrice);
    assert.equal(overlay.length, 3);
    assert.equal(overlay[0].price, 50);
    assert.equal(overlay[1].price, 52);
    assert.equal(overlay[2].price, 51);
    assert.notEqual(overlay[1].val, overlay[2].val, 'Latest node value must not duplicate node before');
    assert.equal(overlay[2].val, 102000); // 100000 * (51 / 50)
  });

  await t.test('computeXeqtProgressionOverlay operates smoothly across all real timeframes', () => {
    const timeframes = [
      { id: 'all', recs: fullHistory },
      { id: '2026', recs: fullHistory.filter(r => r.date.startsWith('2026')) },
      { id: '2025', recs: fullHistory.filter(r => r.date.startsWith('2025')) },
      { id: 'last-52', recs: fullHistory.length > 52 ? fullHistory.slice(-53) : fullHistory },
      { id: 'last-26', recs: fullHistory.length > 26 ? fullHistory.slice(-27) : fullHistory }
    ];

    for (const tf of timeframes) {
      const cadOverlay = computeXeqtProgressionOverlay(tf.recs, fullHistory, xeqtPrices, 'CAD');
      const usdOverlay = computeXeqtProgressionOverlay(tf.recs, fullHistory, xeqtPrices, 'USD');

      assert.equal(cadOverlay.length, tf.recs.length, `${tf.id} CAD length matches`);
      assert.equal(usdOverlay.length, tf.recs.length, `${tf.id} USD length matches`);

      // First point matches starting capital exactly
      assert.equal(cadOverlay[0].val, tf.recs[0].totalCAD, `${tf.id} CAD starts at portfolio start value`);
      assert.equal(usdOverlay[0].val, tf.recs[0].totalUSD, `${tf.id} USD starts at portfolio start value`);

      // All values are valid numbers
      for (let i = 0; i < cadOverlay.length; i++) {
        assert.ok(Number.isFinite(cadOverlay[i].val), `${tf.id} CAD point ${i} is finite`);
        assert.ok(Number.isFinite(cadOverlay[i].returnPct), `${tf.id} CAD returnPct ${i} is finite`);
      }
    }
  });

  await t.test('computeXeqtProgressionOverlay reflects currency-adjusted return: CAD (~18%) vs USD (~13%)', () => {
    // Over the last 52 weeks in benchmarks.json:
    // Starting week 58 price is 38.69 CAD (idx 57)
    // Ending price is 45.64 CAD (idx 110)
    // In CAD: (45.64 - 38.69) / 38.69 = +17.96%
    // In USD: with CAD weakening from ~0.74 to ~0.707, USD return is ~12.99% (~13%)
    const recs52 = [];
    let curD = new Date('2025-09-26T12:00:00Z');
    for (let w = 58; w <= 110; w++) {
      const cad = 100000;
      // Exchange rate drops from 0.74 to 0.707 over 52 weeks
      const rate = 0.74 - ((w - 58) / 52) * (0.74 - 0.707);
      recs52.push({
        week: w,
        date: curD.toISOString().slice(0, 10),
        totalCAD: cad,
        totalUSD: Math.round(cad * rate)
      });
      curD.setUTCDate(curD.getUTCDate() + 7);
    }

    const livePrice = 45.64;
    const overlayCAD = computeXeqtProgressionOverlay(recs52, recs52, xeqtPrices, 'CAD', livePrice);
    const overlayUSD = computeXeqtProgressionOverlay(recs52, recs52, xeqtPrices, 'USD', livePrice);

    const lastCAD = overlayCAD[overlayCAD.length - 1];
    const lastUSD = overlayUSD[overlayUSD.length - 1];

    assert.equal(lastCAD.returnPct, 17.96, 'CAD 52W return should be +17.96%');
    assert.equal(Math.round(lastUSD.returnPct), 13, 'USD 52W return should be ~13% due to CAD depreciation');
  });

  await t.test('formatMonthShort converts YYYY-MM-DD date strings to 3-letter month abbreviations', () => {
    assert.equal(formatMonthShort('2026-04-03'), 'Apr');
    assert.equal(formatMonthShort('2024-01-15'), 'Jan');
    assert.equal(formatMonthShort('2025-12-31'), 'Dec');
    assert.equal(formatMonthShort('2025-07-04'), 'Jul');
    assert.equal(formatMonthShort('2025-09-22'), 'Sep');
    assert.equal(formatMonthShort(''), '');
    assert.equal(formatMonthShort(null), '');
  });
});

test('Aggregated ETF & Cash Allocation Suite', async (t) => {
  await t.test('Cash identification detects various cash representations', () => {
    assert.equal(isCashHolding({ ticker: 'Cash', account: 'CASH' }), true);
    assert.equal(isCashHolding({ ticker: 'CASH', account: 'Non-Registered' }), true);
    assert.equal(isCashHolding({ symbol: 'CASH', account: 'TFSA' }), true);
    assert.equal(isCashHolding({ account: 'CASH' }), true);
    assert.equal(isCashHolding({ ticker: 'TSE:XEQT' }), false);
    assert.equal(isCashHolding(null), false);
  });

  await t.test('getHoldingAssetKey standardizes tickers and cash', () => {
    assert.equal(getHoldingAssetKey({ ticker: 'TSE:XEQT' }), 'XEQT');
    assert.equal(getHoldingAssetKey({ ticker: 'TSE:XEC' }), 'XEC');
    assert.equal(getHoldingAssetKey({ ticker: 'VTI' }), 'VTI');
    assert.equal(getHoldingAssetKey({ ticker: 'Cash' }), 'CASH');
    assert.equal(getHoldingAssetKey({ account: 'CASH' }), 'CASH');
  });

  await t.test('computeSimpleAllocation handles synthetic data correctly', () => {
    const synthetic = [
      { ticker: 'TSE:XEQT', sum: 50000 },
      { ticker: 'TSE:XEQT', sum: 10000 }, // same ticker in different account
      { ticker: 'TSE:XEC', sum: 20000 },
      { ticker: 'Cash', account: 'CASH', sum: 5000 },
      { ticker: 'Cash', account: 'CASH', sum: 15000 } // multiple cash balances
    ];
    // Total = 100,000
    const alloc = computeSimpleAllocation(synthetic);
    assert.equal(alloc.length, 3);
    assert.equal(alloc[0].asset, 'XEQT');
    assert.equal(alloc[0].sum, 60000);
    assert.equal(alloc[0].pct, 60);

    assert.equal(alloc[1].asset, 'CASH');
    assert.equal(alloc[1].sum, 20000);
    assert.equal(alloc[1].pct, 20);

    assert.equal(alloc[2].asset, 'XEC');
    assert.equal(alloc[2].sum, 20000);
    assert.equal(alloc[2].pct, 20);
  });

  await t.test('computeSimpleAllocation on multi-account mock portfolio', () => {
    const holdings = MOCK_HOLDINGS;
    const totalCAD = holdings.reduce((s, h) => s + (h.sum || 0), 0);
    const alloc = computeSimpleAllocation(holdings);

    assert.ok(alloc.length > 0, 'Aggregated allocations must not be empty');
    assert.equal(alloc.length, 3, 'Should aggregate 5 holding records into 3 unique assets: XEQT, XEC, CASH');

    // CASH must be present as a single aggregated item
    const cashItems = alloc.filter(x => x.asset === 'CASH');
    assert.equal(cashItems.length, 1, 'There must be exactly one merged CASH item');
    assert.equal(cashItems[0].sum, 25000, 'Cash should combine RBC (15k) and CIBC (10k)');

    // XEQT must be merged across TFSA and RRSP
    const xeqtItems = alloc.filter(x => x.asset === 'XEQT');
    assert.equal(xeqtItems.length, 1, 'XEQT should be merged into one asset');
    assert.equal(xeqtItems[0].sum, 120000, 'XEQT should combine TFSA (80k) and RRSP (40k)');

    // Sum of asset values must equal total portfolio CAD
    const sumValues = alloc.reduce((s, x) => s + x.sum, 0);
    assert.equal(Math.round(sumValues * 100), Math.round(totalCAD * 100));

    // Sum of percentages must equal 100%
    const sumPct = alloc.reduce((s, x) => s + x.pct, 0);
    assert.ok(Math.abs(sumPct - 100) < 0.001, `Sum of percentages should equal 100%, got ${sumPct}`);

    // Verify descending order
    for (let i = 0; i < alloc.length - 1; i++) {
      assert.ok(alloc[i].sum >= alloc[i + 1].sum, `Item ${i} should be >= item ${i + 1}`);
      assert.ok(alloc[i].pct >= alloc[i + 1].pct, `Pct ${i} should be >= pct ${i + 1}`);
    }
  });

  await t.test('computeSimpleAllocation accurately aggregates unrealized gains and losses across accounts', () => {
    const holdings = MOCK_HOLDINGS;
    const alloc = computeSimpleAllocation(holdings);

    // XEQT is held in TFSA (gain 20k, cost 60k) and RRSP (gain 8k, cost 32k)
    const xeqt = alloc.find(x => x.asset === 'XEQT');
    assert.ok(xeqt, 'XEQT must be present');
    assert.equal(xeqt.sum, 120000);
    assert.equal(xeqt.cost, 92000);
    assert.equal(xeqt.gainCAD, 28000, 'XEQT unrealized gain must be 20k + 8k = 28k');
    assert.equal(xeqt.gainPct, 30.43, 'XEQT gain percentage should be (28000 / 92000) * 100 = 30.43%');

    // XEC: sum 30k, cost 25k, gain 5k (20.00%)
    const xec = alloc.find(x => x.asset === 'XEC');
    assert.ok(xec, 'XEC must be present');
    assert.equal(xec.sum, 30000);
    assert.equal(xec.cost, 25000);
    assert.equal(xec.gainCAD, 5000);
    assert.equal(xec.gainPct, 20.00);

    // CASH: sum 25k, cost 25k, gain 0 (0.00%)
    const cash = alloc.find(x => x.asset === 'CASH');
    assert.ok(cash, 'CASH must be present');
    assert.equal(cash.sum, 25000);
    assert.equal(cash.cost, 25000);
    assert.equal(cash.gainCAD, 0);
    assert.equal(cash.gainPct, 0);

    // Total portfolio unrealized gain matches sum of components
    const totalGainCAD = alloc.reduce((s, x) => s + x.gainCAD, 0);
    assert.equal(totalGainCAD, 33000, 'Total unrealized gains across assets must equal 33k CAD');
  });

  await t.test('computeSimpleAllocation handles positions with unrealized losses correctly', () => {
    const portfolioWithLoss = [
      { ticker: 'TSE:XEQT', sum: 50000, totalCost: 40000, unrealizedGainCAD: 10000 },
      { ticker: 'TSE:VEE', sum: 8000, totalCost: 10000, unrealizedGainCAD: -2000 }, // $2,000 loss (-20%)
      { ticker: 'Cash', account: 'CASH', sum: 2000 }
    ];
    const alloc = computeSimpleAllocation(portfolioWithLoss);

    const vee = alloc.find(x => x.asset === 'VEE');
    assert.ok(vee, 'VEE must be present');
    assert.equal(vee.sum, 8000);
    assert.equal(vee.cost, 10000);
    assert.equal(vee.gainCAD, -2000, 'Unrealized loss should be negative');
    assert.equal(vee.gainPct, -20.00, 'Unrealized loss percentage should be -20.00%');
  });

  await t.test('getHoldingCostAndGain correctly derives cost and gain under various holding representations', () => {
    // 1. With totalCost and unrealizedGainCAD explicitly provided
    const h1 = { sum: 1000, totalCost: 800, unrealizedGainCAD: 200 };
    assert.deepEqual(getHoldingCostAndGain(h1), { cost: 800, gainCAD: 200 });

    // 2. With averageCost and count provided
    const h2 = { sum: 1500, averageCost: 10, count: 100 };
    assert.deepEqual(getHoldingCostAndGain(h2), { cost: 1000, gainCAD: 500 });

    // 3. Cash holding
    const h3 = { ticker: 'Cash', sum: 5000 };
    assert.deepEqual(getHoldingCostAndGain(h3), { cost: 5000, gainCAD: 0 });

    // 4. Unrealized loss with totalCost
    const h4 = { sum: 700, totalCost: 1000 };
    assert.deepEqual(getHoldingCostAndGain(h4), { cost: 1000, gainCAD: -300 });
  });
});

test('Net Worth Progression Multi-Year Overlay Suite', async (t) => {
  await t.test('getDayOfYearFraction calculates normalized calendar position accurately', () => {
    // Jan 1 should be near 0.0
    const jan1 = getDayOfYearFraction('2025-01-01');
    assert.ok(Math.abs(jan1 - 0.0) < 0.005, `Jan 1 must be near 0.0, got ${jan1}`);

    // Dec 31 should be near 1.0
    const dec31 = getDayOfYearFraction('2025-12-31');
    assert.ok(Math.abs(dec31 - 1.0) < 0.005, `Dec 31 must be near 1.0, got ${dec31}`);

    // Mid-year (July 2) should be near 0.50
    const mid = getDayOfYearFraction('2025-07-02');
    assert.ok(Math.abs(mid - 0.50) < 0.02, `Mid-year must be near 0.50, got ${mid}`);

    // Monotonic progression
    const mar = getDayOfYearFraction('2025-03-15');
    const jun = getDayOfYearFraction('2025-06-15');
    const sep = getDayOfYearFraction('2025-09-15');
    assert.ok(mar < jun && jun < sep, 'Fractions must increase monotonically across the year');

    // Leap year (2024) handles smoothly
    const leapDec = getDayOfYearFraction('2024-12-31');
    assert.ok(Math.abs(leapDec - 1.0) < 0.005, `Leap year Dec 31 must be near 1.0, got ${leapDec}`);

    // Invalid inputs fallback to 0 safely
    assert.equal(getDayOfYearFraction(null), 0);
    assert.equal(getDayOfYearFraction(''), 0);
    assert.equal(getDayOfYearFraction('bad-date'), 0);
  });

  await t.test('getMainYearColor provides distinct colors with fallback', () => {
    assert.equal(getMainYearColor('2026'), '#0969da');
    assert.equal(getMainYearColor('2025'), '#8250df');
    assert.equal(getMainYearColor('2024'), '#d97706');
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(getMainYearColor('2030')));
  });

  await t.test('setMainTimeframe manages multi-year toggles and exclusive single views', () => {
    resetMainChartState();

    // Default state: single mode with last-52
    let state = getMainChartState();
    assert.equal(state.currentMainMode, 'single');
    assert.equal(state.currentMainSingleTimeframe, 'last-52');
    assert.equal(state.currentMainSelectedYears.size, 0);

    // Clicking a year (e.g. 2026) transitions to years mode with 2026 active
    setMainTimeframe('2026');
    state = getMainChartState();
    assert.equal(state.currentMainMode, 'years');
    assert.equal(state.currentMainSingleTimeframe, null);
    assert.deepEqual(Array.from(state.currentMainSelectedYears), ['2026']);

    // Clicking another year (e.g. 2025) adds it as an overlay toggle
    setMainTimeframe('2025');
    state = getMainChartState();
    assert.equal(state.currentMainMode, 'years');
    assert.deepEqual(Array.from(state.currentMainSelectedYears).sort(), ['2025', '2026']);

    // Clicking 2024 adds a 3rd year
    setMainTimeframe('2024');
    state = getMainChartState();
    assert.equal(state.currentMainMode, 'years');
    assert.deepEqual(Array.from(state.currentMainSelectedYears).sort(), ['2024', '2025', '2026']);

    // Clicking 2025 toggles it off
    setMainTimeframe('2025');
    state = getMainChartState();
    assert.equal(state.currentMainMode, 'years');
    assert.deepEqual(Array.from(state.currentMainSelectedYears).sort(), ['2024', '2026']);

    // Clicking "All Time" switches to exclusive single view
    setMainTimeframe('all');
    state = getMainChartState();
    assert.equal(state.currentMainMode, 'single');
    assert.equal(state.currentMainSingleTimeframe, 'all');
    assert.equal(state.currentMainSelectedYears.size, 0);

    // Clicking "Last 52W" switches to exclusive single view
    setMainTimeframe('last-52');
    state = getMainChartState();
    assert.equal(state.currentMainMode, 'single');
    assert.equal(state.currentMainSingleTimeframe, 'last-52');
    assert.equal(state.currentMainSelectedYears.size, 0);

    // Clicking 2026 from single view switches to years mode
    setMainTimeframe('2026');
    state = getMainChartState();
    assert.equal(state.currentMainMode, 'years');
    assert.deepEqual(Array.from(state.currentMainSelectedYears), ['2026']);

    // Toggling off the only active year falls back to last-52
    setMainTimeframe('2026');
    state = getMainChartState();
    assert.equal(state.currentMainMode, 'single');
    assert.equal(state.currentMainSingleTimeframe, 'last-52');
    assert.equal(state.currentMainSelectedYears.size, 0);

    resetMainChartState();
  });

  await t.test('buildMainYearOverlaySeries accurately groups records and normalizes fractions and percentage returns', () => {
    const overlay = buildMainYearOverlaySeries(MOCK_HISTORY, ['2025', '2026'], 'CAD');
    assert.equal(overlay.yearSeries.length, 2, 'Should build 2 series for 2025 and 2026');

    const s2025 = overlay.yearSeries.find(s => s.year === '2025');
    const s2026 = overlay.yearSeries.find(s => s.year === '2026');

    assert.ok(s2025, '2025 series exists');
    assert.ok(s2026, '2026 series exists');
    assert.equal(s2025.color, '#8250df');
    assert.equal(s2026.color, '#0969da');

    // Both series must have Jan 1 anchor point with 0.00% return
    assert.equal(s2025.points[0].isAnchor, true, '2025 must start with Jan 1 anchor');
    assert.equal(s2025.points[0].fraction, 0.0, 'Anchor fraction must be 0.0');
    assert.equal(s2025.points[0].pct, 0.0, 'Anchor return must be exactly 0.0%');

    assert.equal(s2026.points[0].isAnchor, true, '2026 must start with Jan 1 anchor');
    assert.equal(s2026.points[0].pct, 0.0, 'Anchor return must be exactly 0.0%');

    // 2025 points should span across the whole year from near 0 to near 1
    assert.ok(s2025.points.length > 50, '2025 should have full year of weekly records');
    assert.ok(s2025.points[s2025.points.length - 1].fraction > 0.95, 'Late 2025 should end near 100%');

    // Fractions must be strictly between 0 and 1, and percentage returns must be finite
    s2025.points.forEach(p => {
      assert.ok(p.fraction >= 0 && p.fraction <= 1, `Point fraction ${p.fraction} must be in [0, 1]`);
      assert.ok(Number.isFinite(p.pct), 'Point percentage return must be finite');
      assert.ok(Number.isFinite(p.val), 'Point value must be finite');
    });

    // 2025 ending return should reflect growth over the year
    const last2025 = s2025.points[s2025.points.length - 1];
    assert.ok(last2025.pct > 20, `2025 ending return should be > 20%, got ${last2025.pct}%`);

    // Percentage bounds
    assert.ok(overlay.minPct <= 0, 'minPct must be <= 0%');
    assert.ok(overlay.maxPct >= 20, 'maxPct must be >= 20%');
    assert.ok(overlay.paddedMin <= overlay.minPct, 'paddedMin must provide breathing room below minPct');
    assert.ok(overlay.paddedMax >= overlay.maxPct, 'paddedMax must provide breathing room above maxPct');
    assert.ok([1, 2, 5, 10].includes(overlay.step), `step must be a clean interval, got ${overlay.step}`);

    // Dollar value bounds preserved
    assert.ok(overlay.minVal > 0, 'minVal should be positive');
    assert.ok(overlay.maxVal >= overlay.minVal, 'maxVal should be >= minVal');
  });

  await t.test('buildMainYearOverlaySeries handles USD currency and empty edge cases', () => {
    const overlayUSD = buildMainYearOverlaySeries(MOCK_HISTORY, ['2025'], 'USD');
    assert.equal(overlayUSD.yearSeries.length, 1);
    assert.equal(overlayUSD.yearSeries[0].points[0].pct, 0.0);
    assert.ok(overlayUSD.yearSeries[0].points.length > 50);
    // Currency USD values must be lower than CAD values
    assert.ok(overlayUSD.minVal < 200000, 'USD values must be scaled to USD');

    // Empty selections
    const emptyOverlay = buildMainYearOverlaySeries([], ['2025'], 'CAD');
    assert.equal(emptyOverlay.yearSeries.length, 0);

    const noYearsOverlay = buildMainYearOverlaySeries(MOCK_HISTORY, [], 'CAD');
    assert.equal(noYearsOverlay.yearSeries.length, 0);
  });

  await t.test('syncMainTimeframeButtons renders buttons in order 2024 - 2025 - 2026 - Last 52W - All Time', () => {
    const mockContainer = { innerHTML: '' };
    global.document = {
      getElementById: (id) => id === 'main-timeframe-toggle' ? mockContainer : null
    };

    try {
      syncMainTimeframeButtons(MOCK_HISTORY);
      const matches = Array.from(mockContainer.innerHTML.matchAll(/data-timeframe="([^"]+)"/g)).map(m => m[1]);
      assert.deepEqual(matches, ['2024', '2025', '2026', 'last-52', 'all'], 'Buttons must strictly follow 2024 - 2025 - 2026 - last-52 - all order');
    } finally {
      delete global.document;
    }
  });

  await t.test('Separated currency (CAD/USD) and unit ($/%) toggles maintain independent states and update UI', () => {
    resetMainChartState();

    const mockButtons = {
      'btn-main-cur-cad': { classList: new Set(), style: {} },
      'btn-main-cur-usd': { classList: new Set(), style: {} },
      'btn-main-unit-val': { classList: new Set(), style: {} },
      'btn-main-unit-pct': { classList: new Set(), style: {} }
    };

    for (const key of Object.keys(mockButtons)) {
      mockButtons[key].classList.toggle = function(cls, force) {
        if (force) this.add(cls); else this.delete(cls);
      };
    }

    global.document = {
      getElementById: (id) => mockButtons[id] || null,
      querySelectorAll: () => []
    };

    try {
      // Default: CAD and VAL ($)
      let state = getMainChartState();
      assert.equal(state.currentMainUnit, 'VAL');
      assert.equal(state.currentMainCurrency, 'CAD');

      // Switch currency to USD
      setMainCurrency('USD');
      state = getMainChartState();
      assert.equal(state.currentMainCurrency, 'USD');
      assert.equal(state.currentMainUnit, 'VAL');
      assert.ok(mockButtons['btn-main-cur-usd'].classList.has('active'));
      assert.ok(!mockButtons['btn-main-cur-cad'].classList.has('active'));
      assert.ok(mockButtons['btn-main-unit-val'].classList.has('active'));
      assert.ok(!mockButtons['btn-main-unit-pct'].classList.has('active'));

      // Switch unit to % (PCT) - currency remains USD and stays highlighted!
      setMainUnit('PCT');
      state = getMainChartState();
      assert.equal(state.currentMainUnit, 'PCT');
      assert.equal(state.currentMainCurrency, 'USD');
      assert.ok(mockButtons['btn-main-unit-pct'].classList.has('active'));
      assert.ok(!mockButtons['btn-main-unit-val'].classList.has('active'));
      assert.ok(mockButtons['btn-main-cur-usd'].classList.has('active'), 'USD remains active even when in % mode');
      assert.ok(!mockButtons['btn-main-cur-cad'].classList.has('active'));

      // Switch currency to CAD - unit remains % and stays highlighted!
      setMainCurrency('CAD');
      state = getMainChartState();
      assert.equal(state.currentMainCurrency, 'CAD');
      assert.equal(state.currentMainUnit, 'PCT');
      assert.ok(mockButtons['btn-main-cur-cad'].classList.has('active'));
      assert.ok(!mockButtons['btn-main-cur-usd'].classList.has('active'));
      assert.ok(mockButtons['btn-main-unit-pct'].classList.has('active'), '% remains active when switching currency');

      // Switch unit to $ (VAL)
      setMainUnit('VAL');
      state = getMainChartState();
      assert.equal(state.currentMainUnit, 'VAL');
      assert.equal(state.currentMainCurrency, 'CAD');
      assert.ok(mockButtons['btn-main-unit-val'].classList.has('active'));
      assert.ok(!mockButtons['btn-main-unit-pct'].classList.has('active'));
      assert.ok(mockButtons['btn-main-cur-cad'].classList.has('active'));

      // Reset restores CAD and VAL
      resetMainChartState();
      state = getMainChartState();
      assert.equal(state.currentMainUnit, 'VAL');
      assert.equal(state.currentMainCurrency, 'CAD');
      assert.equal(state.currentMainMode, 'single');
    } finally {
      delete global.document;
      resetMainChartState();
    }
  });

  await t.test('XEQT overlay is enabled on single year view (e.g. 2025) and disabled only on multi-year overlay', () => {
    resetMainChartState();

    const mockXeqtInput = { checked: false, disabled: false };
    const mockXeqtLabel = { style: {}, title: '' };
    mockXeqtInput.closest = (sel) => sel === 'label' ? mockXeqtLabel : null;

    global.document = {
      getElementById: (id) => id === 'main-overlay-xeqt' ? mockXeqtInput : null,
      querySelectorAll: () => []
    };

    try {
      // In single mode (Last 52W or All Time): enabled
      setMainTimeframe('last-52');
      assert.equal(mockXeqtInput.disabled, false, 'XEQT overlay enabled in Last 52W');

      // Selecting single year (2025): enabled!
      setMainTimeframe('2025');
      let state = getMainChartState();
      assert.equal(state.currentMainMode, 'years');
      assert.equal(state.currentMainSelectedYears.size, 1);
      assert.equal(mockXeqtInput.disabled, false, 'XEQT overlay MUST be enabled when a single year is selected');

      // Selecting another year (2024 + 2025 multi-year overlay): disabled!
      setMainTimeframe('2024');
      state = getMainChartState();
      assert.equal(state.currentMainSelectedYears.size, 2);
      assert.equal(mockXeqtInput.disabled, true, 'XEQT overlay MUST be disabled when multiple years are overlaid');

      // Deselecting 2024 (returning to single year 2025): re-enabled!
      setMainTimeframe('2024');
      state = getMainChartState();
      assert.equal(state.currentMainSelectedYears.size, 1);
      assert.equal(mockXeqtInput.disabled, false, 'XEQT overlay re-enabled when back to single year');
    } finally {
      delete global.document;
      resetMainChartState();
    }
  });

  await t.test('renderMainYearOverlayChart renders XEQT dashed overlay, points, legend, and info card when single year has XEQT overlay active', async () => {
    resetMainChartState();

    const mockBox = { innerHTML: '', querySelector: () => null };
    const mockTooltip = { innerHTML: '', style: {} };
    const mockTitle = { textContent: '' };
    const mockLegend = { innerHTML: '' };
    const mockCard = { innerHTML: '', classList: { add: () => {}, remove: () => {} } };

    global.document = {
      getElementById: (id) => {
        if (id === 'main-chart-legend') return mockLegend;
        if (id === 'main-chart-title') return mockTitle;
        if (id === 'main-chart-info-card') return mockCard;
        if (id === 'main-chart-svg-box') return mockBox;
        if (id === 'main-chart-tooltip') return mockTooltip;
        return null;
      },
      querySelectorAll: () => []
    };

    try {
      const api = require('../api.js');
      global.formatCurrency = api.formatCurrency;
      global.formatDate = api.formatDate;
      global.formatPercent = api.formatPercent;
      global.computeXeqtProgressionOverlay = api.computeXeqtProgressionOverlay;

      // Provide mock history for 2025 and mock XEQT benchmarks
      const testHistory2025 = [
        { week: 19, date: '2025-01-03', totalCAD: 100000, totalUSD: 74000, weeklyChangeCAD: 1000, weeklyChangePct: 1.0, stocks: 80000, fixed: 15000, preciousMetals: 3000, crypto: 2000 },
        { week: 20, date: '2025-01-10', totalCAD: 102000, totalUSD: 75000, weeklyChangeCAD: 2000, weeklyChangePct: 2.0, stocks: 82000, fixed: 15000, preciousMetals: 3000, crypto: 2000 },
        { week: 21, date: '2025-01-17', totalCAD: 105000, totalUSD: 77000, weeklyChangeCAD: 3000, weeklyChangePct: 2.9, stocks: 85000, fixed: 15000, preciousMetals: 3000, crypto: 2000 }
      ];
      const testBenchmarks = {
        benchmarks: {
          XEQT: {
            id: 'XEQT',
            symbol: 'XEQT.TO',
            weeklyPrices: [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
            currentPrice: 50.0
          }
        }
      };

      setMainChartData(testHistory2025, testBenchmarks);
      setMainTimeframe('2025');
      await toggleMainXeqtOverlay(true);

      const width = 1000;
      const height = 220;
      const padding = { top: 18, right: 25, bottom: 32, left: 65 };
      const plotW = width - padding.left - padding.right;
      const plotH = height - padding.top - padding.bottom;

      renderMainYearOverlayChart(mockBox, mockTooltip, 'totalCAD', 'CAD', width, height, padding, plotW, plotH, mockTitle);

      // Verify Title includes currency
      assert.ok(mockTitle.textContent.includes('2025 - CAD'), `Title should include 2025 and CAD, got: ${mockTitle.textContent}`);

      // Verify SVG contains XEQT dashed path and point markers
      assert.ok(mockBox.innerHTML.includes('stroke="#16a34a" stroke-width="2.2" stroke-dasharray="4,4"'), 'SVG must include green dashed XEQT path');
      assert.ok(mockBox.innerHTML.includes('class="main-year-xeqt-point"'), 'SVG must include XEQT point markers');

      // Verify legend contains XEQT Benchmark (CAD) and Spread
      assert.ok(mockLegend.innerHTML.includes('XEQT Benchmark (CAD)'), 'Legend must include XEQT Benchmark (CAD)');
      assert.ok(mockLegend.innerHTML.includes('Spread:'), 'Legend must include Spread');

      // Verify right panel info card is updated with XEQT benchmark and spread
      assert.ok(mockCard.innerHTML.includes('XEQT Benchmark:'), 'Right panel info card must include XEQT Benchmark section');
      assert.ok(mockCard.innerHTML.includes('Spread:'), 'Right panel info card must include Spread');
      assert.ok(mockCard.innerHTML.includes('Return:'), 'Right panel info card must include Return comparison');

      // Toggle off XEQT overlay and verify info card updates to remove XEQT
      await toggleMainXeqtOverlay(false);
      assert.ok(!mockCard.innerHTML.includes('XEQT Benchmark:'), 'Right panel info card must NOT include XEQT Benchmark after toggling off');
    } finally {
      delete global.document;
      delete global.formatCurrency;
      delete global.formatDate;
      delete global.formatPercent;
      delete global.computeXeqtProgressionOverlay;
      resetMainChartState();
      setMainChartData([], null);
    }
  });



  await t.test('buildMainYearOverlaySeries dynamically starts 2024 from the lowest overlay node for that week', () => {
    // Generate multi-year history where 2024 starts in late August (Week 1 at 2024-08-23)
    const testHistory = [];

    // 2024: starts Aug 23, 2024 (Day 237) with $200k, progresses 18 weeks to Dec 20, 2024 (ends at $217k)
    let d = new Date('2024-08-23T12:00:00Z');
    let val = 200000;
    for (let w = 1; w <= 18; w++) {
      testHistory.push({
        week: w,
        date: d.toISOString().slice(0, 10),
        totalCAD: val,
        totalUSD: Math.round(val * 0.74),
        weeklyChangeCAD: w === 1 ? 0 : 1000,
        weeklyChangePct: w === 1 ? 0 : Number(((1000 / (val - 1000)) * 100).toFixed(2))
      });
      val += 1000;
      d.setUTCDate(d.getUTCDate() + 7);
    }

    // 2025: full year 52 weeks (Jan 3 to Dec 26) - moderate growth
    d = new Date('2025-01-03T12:00:00Z');
    val = 220000;
    for (let w = 19; w <= 70; w++) {
      testHistory.push({
        week: w,
        date: d.toISOString().slice(0, 10),
        totalCAD: val,
        totalUSD: Math.round(val * 0.74),
        weeklyChangeCAD: 1500,
        weeklyChangePct: 0.6
      });
      val += 1500;
      d.setUTCDate(d.getUTCDate() + 7);
    }

    // 2026: 35 weeks (Jan 2 to Aug 28, reaching Day 234 on Aug 21 with controlled gain)
    d = new Date('2026-01-02T12:00:00Z');
    val = 300000;
    for (let w = 71; w <= 105; w++) {
      testHistory.push({
        week: w,
        date: d.toISOString().slice(0, 10),
        totalCAD: val,
        totalUSD: Math.round(val * 0.74),
        weeklyChangeCAD: 1200,
        weeklyChangePct: 0.4
      });
      val += 1200;
      d.setUTCDate(d.getUTCDate() + 7);
    }

    // 1. Overlay 2024 and 2026: 2024 must start from 2026's node at Day 234
    const ov24_26 = buildMainYearOverlaySeries(testHistory, ['2024', '2026'], 'CAD', 'PCT');
    assert.equal(ov24_26.yearSeries.length, 2);

    const s2024 = ov24_26.yearSeries.find(s => s.year === '2024');
    const s2026 = ov24_26.yearSeries.find(s => s.year === '2026');
    assert.ok(s2024, '2024 series must be present');
    assert.ok(s2026, '2026 series must be present');

    assert.equal(s2024.chainedFromYear, '2026', '2024 must chain from 2026');
    assert.ok(s2024.chainedStartPct > 10, '2024 starting return must match 2026 return at that week');

    // 2024 should NOT have a Jan 1 anchor when overlaid
    assert.equal(s2024.points[0].isAnchor, false, 'Overlaid 2024 must NOT start with Jan 1 flat anchor');
    assert.equal(s2024.points[0].isOverlayStart, true, 'First point must be marked as isOverlayStart');
    assert.equal(s2024.points[0].overlayFromYear, '2026', 'Overlay source year must be 2026');
    assert.equal(s2024.points[0].pct, s2024.chainedStartPct, 'Point 0 return must equal chainedStartPct');
    const closest2026Node = s2026.points.filter(p => !p.isAnchor).reduce((closest, p) => {
      const d = Math.abs(p.fraction - s2024.points[0].fraction);
      return d < Math.abs(closest.fraction - s2024.points[0].fraction) ? p : closest;
    });
    assert.equal(s2024.points[0].fraction, closest2026Node.fraction, 'Fraction must align with 2026 node');

    // Subsequent 2024 points must grow onward from the starting node
    const last2024 = s2024.points[s2024.points.length - 1];
    assert.ok(last2024.pct > s2024.points[0].pct, '2024 progression must grow onward to year end');

    // 2. Overlay 2024, 2025, and 2026: 2024 must pick whichever year is lowest at that week
    const ovAll = buildMainYearOverlaySeries(testHistory, ['2024', '2025', '2026'], 'CAD', 'PCT');
    const s2024All = ovAll.yearSeries.find(s => s.year === '2024');
    const s2025All = ovAll.yearSeries.find(s => s.year === '2025');
    const s2026All = ovAll.yearSeries.find(s => s.year === '2026');

    // Find the nodes in 2025 and 2026 near Day 234
    const node25 = s2025All.points.filter(p => !p.isAnchor).reduce((closest, p) => {
      const d = Math.abs(p.fraction - s2024All.points[0].fraction);
      return d < Math.abs(closest.fraction - s2024All.points[0].fraction) ? p : closest;
    });
    const node26 = s2026All.points.filter(p => !p.isAnchor).reduce((closest, p) => {
      const d = Math.abs(p.fraction - s2024All.points[0].fraction);
      return d < Math.abs(closest.fraction - s2024All.points[0].fraction) ? p : closest;
    });
    const expectedLowestPct = Math.min(node25.pct, node26.pct);
    assert.ok(Math.abs(s2024All.points[0].pct - expectedLowestPct) < 0.001, '2024 must start from whichever node is lowest for that week');

    // 3. Selecting 2024 ALONE: Starts from normal Jan 1 anchor at 0.00% (no overlay)
    const ovAlone = buildMainYearOverlaySeries(testHistory, ['2024'], 'CAD', 'PCT');
    assert.equal(ovAlone.yearSeries.length, 1);
    assert.equal(ovAlone.yearSeries[0].chainedFromYear, undefined, '2024 alone must not be chained');
    assert.equal(ovAlone.yearSeries[0].points[0].isAnchor, true, '2024 alone must start with Jan 1 baseline anchor');
    assert.equal(ovAlone.yearSeries[0].points[0].pct, 0.0, '2024 alone must start at 0%');

    // 4. Currency mode: selects the lowest dollar node and chains dollar value onwards
    const ovCAD = buildMainYearOverlaySeries(testHistory, ['2024', '2025', '2026'], 'CAD', 'CAD');
    const s2024CAD = ovCAD.yearSeries.find(s => s.year === '2024');
    assert.ok(s2024CAD.chainedStartVal > 0, 'Must have a positive chainedStartVal');
    assert.equal(s2024CAD.points[0].val, s2024CAD.chainedStartVal, 'Point 0 dollar value must match chainedStartVal');
  });

  await t.test('renderMainTopStats dynamically calculates totalUSD using cadUsdRate instead of stale lastRecord.totalUSD', () => {
    const mockElements = {
      'main-stat-total-cad': { textContent: '' },
      'main-stat-total-usd': { textContent: '' }
    };

    global.document = {
      getElementById: (id) => mockElements[id] || null
    };

    // Stale lastRecord from previous week had totalCAD=100000, totalUSD=70000 (FX 0.7000)
    const history = [
      { week: 1, date: '2026-09-25', totalCAD: 100000, totalUSD: 70000 }
    ];
    // Today live holdings grew to 120,000 CAD
    const holdings = [
      { sum: 120000 }
    ];
    const mainData = {
      metrics: { totalValue: 120000 }
    };

    try {
      global.formatCurrency = formatCurrency;
      // With global live FX rate set to 0.7200
      global.window = {
        cachedPrices: { cadUsdRate: 0.72 }
      };

      renderMainTopStats(mainData, holdings, history);

      assert.equal(mockElements['main-stat-total-cad'].textContent, '$120,000.00');
      // Must equal 120,000 * 0.72 = $86,400.00 (US$86,400.00), NOT the stale 70,000!
      assert.equal(mockElements['main-stat-total-usd'].textContent, '≈ US$86,400.00');
    } finally {
      delete global.document;
      delete global.window;
      delete global.formatCurrency;
    }
  });
});

test('History Sanitization & Weekly Closed Period Integrity Suite', async (t) => {
  await t.test('sanitizeHistory excludes placeholder rows (totalCAD <= 0, missing, or empty)', () => {
    const raw = [
      { week: 1, date: '2024-08-23', totalCAD: 100000 },
      { week: 2, date: '2024-08-30', totalCAD: 0 }, // empty placeholder
      { week: 3, date: '2024-09-06', totalCAD: -500 }, // invalid negative
      { week: 4, date: '2024-09-13' }, // missing totalCAD
      null, // invalid entry
      { week: 5, date: '2024-09-20', totalCAD: 105000 }
    ];

    const clean = sanitizeHistory(raw);
    assert.equal(clean.length, 2);
    assert.equal(clean[0].week, 1);
    assert.equal(clean[1].week, 5);
  });

  await t.test('sanitizeHistory excludes empty placeholder rows but retains valid week-ending records', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const nextFriday = new Date(Date.now() + (3 * 86400000)).toISOString().slice(0, 10);

    const raw = [
      { week: 110, date: '2026-09-25', totalCAD: 350000 },
      { week: 111, date: nextFriday, totalCAD: 352000 }, // week ending this Friday with entered data
      { week: 112, date: tomorrow, totalCAD: 0 } // future placeholder with 0 totalCAD
    ];

    const clean = sanitizeHistory(raw);
    assert.equal(clean.length, 2);
    assert.equal(clean[0].week, 110);
    assert.equal(clean[0].date, '2026-09-25');
    assert.equal(clean[1].week, 111);
    assert.equal(clean[1].date, nextFriday);
    assert.equal(clean[1].totalCAD, 352000);
  });

  await t.test('calculateMainData correctly calculates current in-progress week against last closed week', () => {
    // Week 110 closed on 2026-09-25 with $300,000 net worth
    const history = [
      { week: 109, date: '2026-09-18', totalCAD: 295000, weeklyChangeCAD: 5000, weeklyChangePct: 1.72 },
      { week: 110, date: '2026-09-25', totalCAD: 300000, weeklyChangeCAD: 5000, weeklyChangePct: 1.69 },
      // Upcoming Friday placeholder in sheet
      { week: 111, date: '2026-10-02', totalCAD: 0 }
    ];

    // Today mid-week holdings live total is $303,000 (+3,000 this week)
    const holdings = [
      { sum: 303000, registered: true, count: 1000, averageCost: 200 }
    ];

    const mainData = calculateMainData(holdings, history);
    assert.ok(mainData.metrics.currentWeek, 'currentWeek metrics must exist');
    // Current in-progress week should be Week 111
    assert.equal(mainData.metrics.currentWeek.weekNumber, 'Week 111');
    // Change this week should be 303,000 - 300,000 = +3,000
    assert.equal(mainData.metrics.currentWeek.changeCAD, 3000);
    assert.equal(mainData.metrics.currentWeek.isUp, true);
    // Percentage return should be (3000 / 300000) * 100 = 1.0%
    assert.equal(Number(mainData.metrics.currentWeek.changePct.toFixed(2)), 1.00);
  });

  await t.test('calculateMainData populates allTimeMetrics matching 52-week and YTD metrics structure', () => {
    const history = [
      { week: 1, date: '2024-01-01', totalCAD: 100000 },
      { week: 26, date: '2024-07-01', totalCAD: 120000 },
      { week: 52, date: '2025-01-01', totalCAD: 110000 }
    ];
    const holdings = [
      { sum: 130000, registered: true, count: 1000, averageCost: 100 }
    ];

    const mainData = calculateMainData(holdings, history);
    const atm = mainData.allTimeMetrics;

    assert.ok(atm, 'allTimeMetrics must exist');
    assert.equal(atm.totalValue, 130000);
    assert.equal(atm.startValue, 100000);
    assert.equal(atm.changeCAD, 30000);
    assert.equal(atm.returnPct, '30.00%');
    assert.equal(atm.peakValue, 130000);
    assert.ok(atm.monthlyGainCAD > 0, 'monthlyGainCAD should be positive');
  });
});

test('Portfolio Drawdown & High-Water Mark Integrity Suite', async (t) => {
  await t.test('calculateDrawdownMetrics correctly computes running peak and drawdown even when sheet columns are missing or zero', () => {
    // 5 historical weeks: starts at 100k, rises to 110k, drops to 100k, drops to 95k, recovers to 105k
    const history = [
      { week: 1, date: '2025-01-03', totalCAD: 100000, runningPeakCAD: 0, drawdownCAD: 0 },
      { week: 2, date: '2025-01-10', totalCAD: 110000, runningPeakCAD: 0, drawdownCAD: 0 }, // peak = 110k
      { week: 3, date: '2025-01-17', totalCAD: 100000, runningPeakCAD: 0, drawdownCAD: 0 }, // -10k (-9.09%)
      { week: 4, date: '2025-01-24', totalCAD: 95000, runningPeakCAD: 0, drawdownCAD: 0 },  // -15k (-13.64%) -> max drawdown
      { week: 5, date: '2025-01-31', totalCAD: 105000, runningPeakCAD: 0, drawdownCAD: 0 }  // -5k (-4.55%)
    ];

    const metrics = calculateDrawdownMetrics(history);

    assert.equal(metrics.overallPeakCAD, 110000);
    assert.equal(metrics.currentPeakCAD, 110000);
    assert.equal(metrics.maxDDCAD, -15000);
    assert.equal(Number(metrics.maxDDPct.toFixed(2)), -13.64);
    assert.equal(metrics.maxDDRecord.week, 4);
    assert.equal(metrics.currentDDCAD, -5000);
    assert.equal(Number(metrics.currentDDPct.toFixed(2)), -4.55);
    assert.equal(metrics.longestRecoveryWeeks, 3); // weeks 3, 4, 5 spent under water
    assert.equal(metrics.points.length, 5);
    assert.equal(metrics.points[0].peak, 100000);
    assert.equal(metrics.points[0].ddCAD, 0);
    assert.equal(metrics.points[1].peak, 110000);
    assert.equal(metrics.points[1].ddCAD, 0);
    assert.equal(metrics.points[2].peak, 110000);
    assert.equal(metrics.points[2].ddCAD, -10000);
    assert.equal(metrics.points[3].peak, 110000);
    assert.equal(metrics.points[3].ddCAD, -15000);
    assert.equal(metrics.points[4].peak, 110000);
    assert.equal(metrics.points[4].ddCAD, -5000);
  });

  await t.test('calculateDrawdownMetrics dynamically reflects current drawdown below ATH with live valuation', () => {
    const history = [
      { week: 1, date: '2025-01-03', totalCAD: 200000 },
      { week: 2, date: '2025-01-10', totalCAD: 220000 }, // ATH = 220k
      { week: 3, date: '2025-01-17', totalCAD: 215000 }
    ];

    // Live portfolio value is $210,000 (below peak of 220k by -10k)
    const metrics = calculateDrawdownMetrics(history, 210000);
    assert.equal(metrics.overallPeakCAD, 220000);
    assert.equal(metrics.currentDDCAD, -10000);
    assert.equal(Number(metrics.currentDDPct.toFixed(2)), -4.55);
  });

  await t.test('calculateDrawdownMetrics reflects 0.00% and marks ATH when live valuation is at or exceeds previous ATH', () => {
    const history = [
      { week: 1, date: '2025-01-03', totalCAD: 200000 },
      { week: 2, date: '2025-01-10', totalCAD: 220000 },
      { week: 3, date: '2025-01-17', totalCAD: 215000 }
    ];

    // Case A: Exactly at ATH (220k)
    const metricsA = calculateDrawdownMetrics(history, 220000);
    assert.equal(metricsA.overallPeakCAD, 220000);
    assert.equal(metricsA.currentDDCAD, 0);
    assert.equal(metricsA.currentDDPct, 0);

    // Case B: New record ATH (225k)
    const metricsB = calculateDrawdownMetrics(history, 225000);
    assert.equal(metricsB.overallPeakCAD, 225000);
    assert.equal(metricsB.currentDDCAD, 0);
    assert.equal(metricsB.currentDDPct, 0);
  });

  await t.test('sanitizeHistory populates runningPeakCAD, drawdownCAD, and drawdownPct for all records', () => {
    const raw = [
      { week: 1, date: '2025-01-03', totalCAD: 50000 },
      { week: 2, date: '2025-01-10', totalCAD: 60000 },
      { week: 3, date: '2025-01-17', totalCAD: 54000 } // down 6k (-10%)
    ];

    const clean = sanitizeHistory(raw);
    assert.equal(clean.length, 3);
    assert.equal(clean[0].runningPeakCAD, 50000);
    assert.equal(clean[0].drawdownCAD, 0);
    assert.equal(clean[0].drawdownPct, 0);

    assert.equal(clean[1].runningPeakCAD, 60000);
    assert.equal(clean[1].drawdownCAD, 0);
    assert.equal(clean[1].drawdownPct, 0);

    assert.equal(clean[2].runningPeakCAD, 60000);
    assert.equal(clean[2].drawdownCAD, -6000);
    assert.equal(clean[2].drawdownPct, -10);
  });

  await t.test('filterHistoryAths returns empty array on empty or invalid records', () => {
    assert.deepEqual(filterHistoryAths([]), []);
    assert.deepEqual(filterHistoryAths(null), []);
  });

  await t.test('filterHistoryAths filters to ATH milestones and numbers them chronologically', () => {
    const history = [
      { week: 1, date: '2025-01-03', totalCAD: 100000 }, // ATH #1
      { week: 2, date: '2025-01-10', totalCAD: 95000 },  // down
      { week: 3, date: '2025-01-17', totalCAD: 105000 }, // ATH #2
      { week: 4, date: '2025-01-24', totalCAD: 102000 }, // down
      { week: 5, date: '2025-01-31', totalCAD: 110000 }  // ATH #3 (and final record)
    ];

    const nodes = filterHistoryAths(history, history, 'totalCAD');
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0].rec.week, 1);
    assert.equal(nodes[0].athNumber, 1);
    assert.equal(nodes[0].isAth, true);
    assert.equal(nodes[0].timeIndex, 0);

    assert.equal(nodes[1].rec.week, 3);
    assert.equal(nodes[1].athNumber, 2);
    assert.equal(nodes[1].isAth, true);
    assert.equal(nodes[1].timeIndex, 2);

    assert.equal(nodes[2].rec.week, 5);
    assert.equal(nodes[2].athNumber, 3);
    assert.equal(nodes[2].isAth, true);
    assert.equal(nodes[2].timeIndex, 4);
  });

  await t.test('filterHistoryAths includes final node with drawdown stats when latest week is below peak', () => {
    const history = [
      { week: 1, date: '2025-01-03', totalCAD: 100000 }, // ATH #1
      { week: 2, date: '2025-01-10', totalCAD: 120000 }, // ATH #2 (Peak)
      { week: 3, date: '2025-01-17', totalCAD: 115000 }, // down
      { week: 4, date: '2025-01-24', totalCAD: 108000 }  // down & latest (-12k, -10%)
    ];

    const nodes = filterHistoryAths(history, history, 'totalCAD');
    assert.equal(nodes.length, 3); // ATH #1, ATH #2, and final down node
    assert.equal(nodes[0].isAth, true);
    assert.equal(nodes[0].athNumber, 1);
    assert.equal(nodes[1].isAth, true);
    assert.equal(nodes[1].athNumber, 2);

    const finalNode = nodes[2];
    assert.equal(finalNode.rec.week, 4);
    assert.equal(finalNode.isAth, false);
    assert.equal(finalNode.athNumber, null);
    assert.equal(finalNode.timeIndex, 3);
    assert.equal(finalNode.downCAD, -12000);
    assert.equal(finalNode.downPct, -10);
    assert.equal(finalNode.peakVal, 120000);
  });

  await t.test('filterHistoryAths preserves chronological numbering and peak tracking across sliced window and USD currency', () => {
    const fullHistory = [
      { week: 1, date: '2024-01-05', totalCAD: 100000, totalUSD: 75000 },  // ATH 1
      { week: 2, date: '2024-01-12', totalCAD: 150000, totalUSD: 110000 }, // ATH 2
      { week: 3, date: '2025-01-03', totalCAD: 140000, totalUSD: 105000 }, // down
      { week: 4, date: '2025-01-10', totalCAD: 180000, totalUSD: 130000 }, // ATH 3
      { week: 5, date: '2025-01-17', totalCAD: 171000, totalUSD: 123500 }  // down & latest
    ];

    // Window: only weeks 3..5 (2025)
    const windowRecords = fullHistory.slice(2);
    const nodes = filterHistoryAths(windowRecords, fullHistory, 'totalUSD');

    // ATH 3 (week 4) and Final node (week 5) should be present in this window
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].rec.week, 4);
    assert.equal(nodes[0].isAth, true);
    assert.equal(nodes[0].athNumber, 3);
    assert.equal(nodes[0].timeIndex, 1); // relative to windowRecords

    const finalNode = nodes[1];
    assert.equal(finalNode.rec.week, 5);
    assert.equal(finalNode.isAth, false);
    assert.equal(finalNode.downCAD, 123500 - 130000); // -6500 USD
    assert.equal(finalNode.downPct, ((123500 - 130000) / 130000) * 100); // -5%
    assert.equal(finalNode.timeIndex, 2);
  });

  await t.test('toggleMainAthsFilter toggles ATH filter state and preserves multi-year selections', async () => {
    resetMainChartState();
    assert.equal(getMainChartState().currentMainFilterAths, false);

    await toggleMainAthsFilter(true);
    assert.equal(getMainChartState().currentMainFilterAths, true);

    // In multi-year mode, toggling ATHs preserves selected years
    setMainTimeframe('2025');
    assert.equal(getMainChartState().currentMainMode, 'years');
    assert.deepEqual(Array.from(getMainChartState().currentMainSelectedYears), ['2025']);

    // Selecting additional year (e.g. 2024) works seamlessly in ATH mode
    setMainTimeframe('2024');
    assert.equal(getMainChartState().currentMainMode, 'years');
    assert.deepEqual(Array.from(getMainChartState().currentMainSelectedYears).sort(), ['2024', '2025']);
    assert.equal(getMainChartState().currentMainFilterAths, true);

    await toggleMainAthsFilter(false);
    assert.equal(getMainChartState().currentMainFilterAths, false);
    assert.equal(getMainChartState().currentMainMode, 'years');
    assert.deepEqual(Array.from(getMainChartState().currentMainSelectedYears).sort(), ['2024', '2025']);
    resetMainChartState();
  });

  await t.test('filterHistoryAths correctly distributes ATH milestones across multi-year overlay series', () => {
    const history = [
      { week: 1, date: '2024-11-01', totalCAD: 100000 }, // 2024 ATH 1
      { week: 2, date: '2024-12-06', totalCAD: 120000 }, // 2024 ATH 2
      { week: 3, date: '2025-02-14', totalCAD: 110000 }, // 2025 down
      { week: 4, date: '2025-06-20', totalCAD: 130000 }, // 2025 ATH 3
      { week: 5, date: '2026-01-09', totalCAD: 140000 }, // 2026 ATH 4
      { week: 6, date: '2026-03-13', totalCAD: 135000 }  // 2026 down & current
    ];

    const allAths = filterHistoryAths(history, history, 'totalCAD');
    assert.equal(allAths.length, 5); // 4 ATHs + 1 final down node

    const athDateMap = new Map();
    allAths.forEach(n => athDateMap.set(n.rec.date, n));

    const overlay = buildMainYearOverlaySeries(history, ['2024', '2025', '2026'], 'CAD', 'PCT');
    assert.equal(overlay.yearSeries.length, 3);

    // 2024 ATH points
    const s2024 = overlay.yearSeries.find(s => s.year === '2024');
    const pts2024 = s2024.points.filter(p => !p.isAnchor && athDateMap.has(p.date));
    assert.equal(pts2024.length, 2);

    // 2025 ATH points
    const s2025 = overlay.yearSeries.find(s => s.year === '2025');
    const pts2025 = s2025.points.filter(p => !p.isAnchor && athDateMap.has(p.date));
    assert.equal(pts2025.length, 1);
    assert.equal(athDateMap.get(pts2025[0].date).athNumber, 3);

    // 2026 ATH + Drawdown points
    const s2026 = overlay.yearSeries.find(s => s.year === '2026');
    const pts2026 = s2026.points.filter(p => !p.isAnchor && athDateMap.has(p.date));
    assert.equal(pts2026.length, 2); // 1 ATH + 1 final down node
    assert.equal(athDateMap.get(pts2026[0].date).isAth, true);
    assert.equal(athDateMap.get(pts2026[1].date).isAth, false);
    assert.equal(athDateMap.get(pts2026[1].date).downCAD, -5000);
  });
});

test('Rolling 52-Week Ranking & Overlay Consistency Suite', async (t) => {
  await t.test('computeRolling52Windows ranks by USD dollar gain when rankBy="usd"', () => {
    // Construct 54 weeks:
    // Window 0 (weeks 1..52): starts 100k USD, ends 210k USD -> gainUSD = +110k, pct = +110%
    // Window 1 (weeks 2..53): starts 150k USD, ends 270k USD -> gainUSD = +120k, pct = +80%
    // Window 2 (weeks 3..54, current): starts 200k USD, ends 305k USD -> gainUSD = +105k, pct = +52.5%
    const records = [];
    for (let w = 1; w <= 54; w++) {
      let usd = 100000 + (w * 2000);
      if (w === 52) usd = 210000;
      if (w === 53) usd = 270000;
      if (w === 54) usd = 305000;
      records.push({
        week: w,
        date: `2025-01-${String(w).padStart(2, '0')}`,
        totalCAD: usd * 1.35,
        totalUSD: usd,
        weeklyChangeCAD: 2000 * 1.35,
        weeklyChangeUSD: 2000
      });
    }

    // When ranked by USD:
    const extremesUSD = computeRolling52Windows(records, 'usd');
    assert.ok(extremesUSD);
    // Best USD gain should be Window 1 (+120k)
    assert.equal(extremesUSD.best.gainUSD, extremesUSD.best.endValUSD - extremesUSD.best.startValUSD);
    // Worst USD gain must be <= current USD gain
    assert.ok(extremesUSD.worst.gainUSD <= extremesUSD.current.gainUSD,
      `Worst USD gain (${extremesUSD.worst.gainUSD}) must be <= Current USD gain (${extremesUSD.current.gainUSD})`);
    assert.ok(extremesUSD.best.gainUSD >= extremesUSD.current.gainUSD,
      `Best USD gain (${extremesUSD.best.gainUSD}) must be >= Current USD gain (${extremesUSD.current.gainUSD})`);

    // When ranked by percentage:
    const extremesPct = computeRolling52Windows(records, 'pct');
    assert.ok(extremesPct);
    assert.ok(extremesPct.worst.pctCAD <= extremesPct.current.pctCAD,
      `Worst pct (${extremesPct.worst.pctCAD}) must be <= Current pct (${extremesPct.current.pctCAD})`);
  });

  await t.test('computeRolling52Windows ranks by CAD dollar gain when rankBy="cad"', () => {
    const mock = createMockHistory();
    const extremesCAD = computeRolling52Windows(mock, 'cad');
    assert.ok(extremesCAD);
    assert.ok(extremesCAD.worst.gainCAD <= extremesCAD.current.gainCAD,
      `Worst CAD gain (${extremesCAD.worst.gainCAD}) must be <= Current CAD gain (${extremesCAD.current.gainCAD})`);
    assert.ok(extremesCAD.best.gainCAD >= extremesCAD.current.gainCAD,
      `Best CAD gain (${extremesCAD.best.gainCAD}) must be >= Current CAD gain (${extremesCAD.current.gainCAD})`);
  });
});

test('Live Holdings History Enrichment & Graph Consistency Suite', async (t) => {
  await t.test('enrichHistoryWithLiveHoldings updates current week row with live holdings valuation and weekly change', () => {
    // Week 110 closed on Sep 25 with $300,000.
    // Week 111 had recorded -$314 in Carry Over sheet.
    const rawHistory = [
      { week: 109, date: '2026-09-18', totalCAD: 295000, weeklyChangeCAD: 5000, weeklyChangePct: 1.72 },
      { week: 110, date: '2026-09-25', totalCAD: 300000, weeklyChangeCAD: 5000, weeklyChangePct: 1.69 },
      { week: 111, date: '2026-10-02', totalCAD: 299686, weeklyChangeCAD: -314, weeklyChangePct: -0.10 }
    ];

    // Current live holdings reflect a $3,052 loss relative to Week 110 ($300,000 - $3,052 = $296,948)
    const holdings = [
      { ticker: 'TSE:XEQT', sum: 200000, allocation: { us: 90000, canada: 50000, developed: 40000, emerging: 20000 } },
      { ticker: 'Cash', sum: 96948, allocation: { fixedIncome: 96948 } }
    ];

    const enriched = enrichHistoryWithLiveHoldings(rawHistory, holdings, 0.7073);
    assert.equal(enriched.length, 3);
    const latest = enriched[2];
    assert.equal(latest.week, 111);
    assert.equal(latest.date, '2026-10-02');
    assert.equal(latest.totalCAD, 296948);
    // Weekly change must be -$3,052 CAD (not the stale -$314 CAD)
    assert.equal(latest.weeklyChangeCAD, -3052);
    assert.equal(Number(latest.weeklyChangePct.toFixed(2)), -1.02);
    assert.equal(latest.isLive, true);
    assert.equal(latest.stocks, 200000);
    assert.equal(latest.fixed, 96948);
  });

  await t.test('enrichHistoryWithLiveHoldings always enriches latest row as active week without appending synthetic rows', () => {
    const rawHistory = [
      { week: 110, date: '2026-09-25', totalCAD: 300000, weeklyChangeCAD: 5000, weeklyChangePct: 1.69 }
    ];

    const holdings = [
      { sum: 296948, allocation: { us: 100000 } }
    ];

    const enriched = enrichHistoryWithLiveHoldings(rawHistory, holdings, 0.7073);
    assert.equal(enriched.length, 1, 'Length must remain 1 without appending phantom rows');
    const liveWeek = enriched[0];
    assert.equal(liveWeek.week, 110);
    assert.equal(liveWeek.totalCAD, 296948);
    assert.equal(liveWeek.isLive, true);
  });
});
