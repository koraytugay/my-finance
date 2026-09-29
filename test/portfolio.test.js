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
  buildRolling52OverlaySeries
} = require('../performance.js');
const { computeXeqtProgressionOverlay } = require('../api.js');
const {
  computeSimpleAllocation,
  isCashHolding,
  getHoldingAssetKey
} = require('../allocation.js');
const { calculateTimeBack } = require('../main.js');

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
        assert.ok(Number.isFinite(usdOverlay[i].val), `${tf.id} USD point ${i} is finite`);
        assert.ok(Number.isFinite(usdOverlay[i].returnPct), `${tf.id} USD returnPct ${i} is finite`);
      }
    }
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
});
