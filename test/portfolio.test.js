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

const PASSWORD = process.env.PORTFOLIO_PASSWORD;

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

  await t.test('Decryption of holdings.enc with portfolio password', (t2) => {
    if (!PASSWORD) {
      t2.skip('PORTFOLIO_PASSWORD environment variable not set');
      return;
    }
    const encPath = path.join(__dirname, '..', 'encrypted', 'holdings.enc');
    assert.ok(fs.existsSync(encPath), 'holdings.enc should exist');
    const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
    const data = decrypt(enc, PASSWORD);
    const holdings = Array.isArray(data) ? data : data.holdings;
    assert.ok(Array.isArray(holdings), 'Decrypted holdings must be an array');
    assert.ok(holdings.length > 0, 'Holdings should not be empty');

    // Verify holding record properties
    for (const h of holdings) {
      assert.ok(h.ticker, 'Holding must have a ticker');
      assert.ok(typeof h.sum === 'number', 'Holding must have numeric sum');
      assert.ok(typeof h.count === 'number', 'Holding must have numeric count');
      assert.ok(h.brokerage, 'Holding must have a brokerage');
    }
  });

  await t.test('Decryption of history.enc with portfolio password', (t2) => {
    if (!PASSWORD) {
      t2.skip('PORTFOLIO_PASSWORD environment variable not set');
      return;
    }
    const encPath = path.join(__dirname, '..', 'encrypted', 'history.enc');
    assert.ok(fs.existsSync(encPath), 'history.enc should exist');
    const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
    const data = decrypt(enc, PASSWORD);
    const history = Array.isArray(data) ? data : data.history;
    assert.ok(Array.isArray(history), 'Decrypted history must be an array');
    assert.ok(history.length > 0, 'History should not be empty');

    for (const rec of history) {
      assert.ok(rec.date, 'History record must have a date');
      assert.ok(typeof rec.totalCAD === 'number', 'History record must have numeric totalCAD');
    }
  });
});

test('Financial Calculations Suite', async (t) => {
  if (!PASSWORD) {
    t.skip('PORTFOLIO_PASSWORD environment variable not set');
    return;
  }
  const holdingsEnc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'encrypted', 'holdings.enc'), 'utf8'));
  const holdingsData = decrypt(holdingsEnc, PASSWORD);
  const holdings = Array.isArray(holdingsData) ? holdingsData : holdingsData.holdings;

  const historyEnc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'encrypted', 'history.enc'), 'utf8'));
  const historyData = decrypt(historyEnc, PASSWORD);
  const history = Array.isArray(historyData) ? historyData : historyData.history;

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
    // Check 2025 calculation
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
    if (!usdBack.isAth) {
      assert.ok(usdBack.weeks >= 1);
      assert.ok(usdBack.record);
      assert.ok(usdBack.record.totalUSD <= latest.totalUSD + 1.0);
    } else {
      assert.equal(usdBack.weeks, 0);
      assert.equal(usdBack.isAth, true);
    }

    const cadBack = calculateTimeBack(history, latest.totalCAD, 'totalCAD');
    if (!cadBack.isAth) {
      assert.ok(cadBack.weeks >= 1);
      assert.ok(cadBack.record);
      assert.ok(cadBack.record.totalCAD <= latest.totalCAD + 1.0);
    } else {
      assert.equal(cadBack.weeks, 0);
      assert.equal(cadBack.isAth, true);
    }

    // Specific verification for current USD drawdown:
    // 8 weeks ago (2026-08-07) was $482k USD, current is ~$475.6k USD.
    // Setback correctly identifies 9 weeks ago (July 31, 2026, $469.5k USD).
    assert.equal(usdBack.weeks, 9);
    assert.equal(usdBack.record.date, '2026-07-31');
    assert.ok(usdBack.record.totalUSD < latest.totalUSD);

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
    assert.ok(currentSeriesPct[52].plotVal >= worstSeriesPct[52].plotVal, 'Current end return must be >= worst end return');

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
    assert.equal(cadStreaks.longestUp.count, 7, 'CAD longest up streak should be 7 weeks');
    assert.equal(cadStreaks.longestUp.startWeek, 69);
    assert.equal(cadStreaks.longestUp.endWeek, 75);
    assert.ok(cadStreaks.longestUp.change > 33000, 'CAD longest up streak gain > 33k');
    assert.ok(cadStreaks.longestUp.pct > 6, 'CAD longest up streak pct > 6%');

    assert.equal(cadStreaks.longestDown.count, 2, 'CAD longest down streak should be 2 weeks');
    assert.equal(cadStreaks.longestDown.startWeek, 32);
    assert.equal(cadStreaks.longestDown.endWeek, 33);
    assert.ok(cadStreaks.longestDown.change < -29000, 'CAD longest down streak total down < -29k');
    assert.ok(cadStreaks.longestDown.pct < -7, 'CAD longest down streak pct < -7%');

    const usdStreaks = calculateWeeklyStreaks(history, 'USD');
    assert.equal(usdStreaks.longestUp.count, 14, 'USD longest up streak should be 14 weeks');
    assert.equal(usdStreaks.longestUp.startWeek, 67);
    assert.equal(usdStreaks.longestUp.endWeek, 80);
    assert.ok(usdStreaks.longestUp.change > 60000, 'USD longest up streak gain > 60k');
    assert.ok(usdStreaks.longestUp.pct > 15, 'USD longest up streak pct > 15%');

    assert.equal(usdStreaks.longestDown.count, 4, 'USD longest down streak should be 4 weeks');
    assert.equal(usdStreaks.longestDown.startWeek, 81);
    assert.equal(usdStreaks.longestDown.endWeek, 84);
    assert.ok(usdStreaks.longestDown.change < -35000, 'USD longest down streak total down < -35k');
    assert.ok(usdStreaks.longestDown.pct < -8, 'USD longest down streak pct < -8%');

    assert.equal(cadStreaks.longestUp.startDate, '2025-12-12');
    assert.equal(cadStreaks.longestUp.endDate, '2026-01-23');
    assert.equal(cadStreaks.longestDown.startDate, '2025-03-28');
    assert.equal(cadStreaks.longestDown.endDate, '2025-04-04');
    assert.equal(usdStreaks.longestUp.startDate, '2025-11-28');
    assert.equal(usdStreaks.longestUp.endDate, '2026-02-27');
    assert.equal(usdStreaks.longestDown.startDate, '2026-03-06');
    assert.equal(usdStreaks.longestDown.endDate, '2026-03-27');

    // formatStreakDates helper
    assert.equal(formatStreakDates('2025-12-12', '2026-01-23'), '2025-12-12 – 2026-01-23');
    assert.equal(formatStreakDates('2025-12-12', '2025-12-12'), '2025-12-12');
    assert.equal(formatStreakDates('', ''), '');

    // Edge cases
    assert.equal(calculateWeeklyStreaks([]).longestUp.count, 0);
    assert.equal(calculateWeeklyStreaks([{ totalCAD: 100 }]).longestUp.count, 0);
  });

  await t.test('Top 3 longest streaks without all-time highs for CAD and USD', () => {
    const cadAthStreaks = calculateLongestStreaksWithoutATH(history, 'CAD', 3);
    assert.equal(cadAthStreaks.length, 3, 'Should return top 3 CAD ATH streaks');
    assert.equal(cadAthStreaks[0].nonAthWeeks, 6, 'Top 1 CAD streak without ATH is 6 weeks');
    assert.equal(cadAthStreaks[0].startWeek, 81);
    assert.equal(cadAthStreaks[0].endWeek, 86);
    assert.equal(cadAthStreaks[1].nonAthWeeks, 5, 'Top 2 CAD streak without ATH is 5 weeks');
    assert.equal(cadAthStreaks[1].startWeek, 29);
    assert.equal(cadAthStreaks[1].endWeek, 33);
    assert.equal(cadAthStreaks[2].nonAthWeeks, 4, 'Top 3 CAD streak without ATH is 4 weeks');

    const usdAthStreaks = calculateLongestStreaksWithoutATH(history, 'USD', 3);
    assert.equal(usdAthStreaks.length, 3, 'Should return top 3 USD ATH streaks');
    assert.equal(usdAthStreaks[0].nonAthWeeks, 7, 'Top 1 USD streak without ATH is 7 weeks');
    assert.equal(usdAthStreaks[1].nonAthWeeks, 7, 'Top 2 USD streak without ATH is 7 weeks');
    assert.equal(usdAthStreaks[2].nonAthWeeks, 6, 'Top 3 USD streak without ATH is 6 weeks');

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
  if (!PASSWORD) {
    t.skip('PORTFOLIO_PASSWORD environment variable not set');
    return;
  }
  const encPath = path.join(__dirname, '..', 'encrypted', 'history.enc');
  const historyEnc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
  const fullHistory = decrypt(historyEnc, PASSWORD);
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
  let realHoldings = [];
  if (PASSWORD) {
    const holdingsEnc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'encrypted', 'holdings.enc'), 'utf8'));
    const holdingsData = decrypt(holdingsEnc, PASSWORD);
    realHoldings = Array.isArray(holdingsData) ? holdingsData : holdingsData.holdings;
  }

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

  await t.test('computeSimpleAllocation on decrypted user holdings', (t2) => {
    if (!PASSWORD) {
      t2.skip('PORTFOLIO_PASSWORD environment variable not set');
      return;
    }
    const totalCAD = realHoldings.reduce((s, h) => s + (h.sum || 0), 0);
    const alloc = computeSimpleAllocation(realHoldings);

    assert.ok(alloc.length > 0, 'Aggregated allocations must not be empty');
    assert.equal(alloc.length, 25, 'Should aggregate 37 holding lines into 25 unique assets');

    // CASH must be present as a single aggregated item
    const cashItems = alloc.filter(x => x.asset === 'CASH');
    assert.equal(cashItems.length, 1, 'There must be exactly one merged CASH item');
    assert.ok(cashItems[0].sum > 60000, 'Cash should aggregate all cash accounts');

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

    // Verify multi-account tickers are merged
    const caemItems = alloc.filter(x => x.asset === 'CAEM');
    assert.equal(caemItems.length, 1, 'CAEM should be merged into one asset');
    assert.ok(caemItems[0].sum > 30000, 'CAEM sum should be combined across RRSP, TFSA, Non-Registered');
  });
});



