/**
 * Performance & Returns Analytics Controller
 */

let allHistory = [];
let allHoldings = [];
let allBenchmarks = null;
let drawdownMode = 'pct'; // 'pct' or 'cad'
let currentInflationRate = 5.0; // Default 5.0% annual inflation

async function initPerformance() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('main-content');
    const errorEl = document.getElementById('error');

    try {
        const [history, holdings, benchmarks] = await Promise.all([
            getHistory(),
            getHoldings(),
            typeof getBenchmarks === 'function' ? getBenchmarks().catch(() => null) : Promise.resolve(null)
        ]);

        allHistory = history;
        allHoldings = holdings;
        allBenchmarks = benchmarks;

        if (!allHistory || allHistory.length === 0) {
            throw new Error('No historical records found');
        }

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';

        renderOverviewCards();
        renderMonthlyHeatmap();
        renderWeeklyBarChart();
        renderRolling52Charts();
        renderDrawdownChart();
        renderAnnualSummary();
        renderRiskAnalytics();
        renderCrisisStressTest();

        window.addEventListener('resize', () => {
            renderWeeklyBarChart();
            renderRolling52Charts();
            renderDrawdownChart();
        });
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initPerformance());
            return;
        }
        console.error('Failed to init performance:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error loading performance data: ${err.message}`;
    }
}

/**
 * Calculates the longest weekly up-streak and down-streak for the portfolio.
 * An up streak is consecutive weeks where change > 0.
 * A down streak is consecutive weeks where change < 0.
 * @param {Array} history
 * @param {string} currency 'CAD' or 'USD'
 */
function calculateWeeklyStreaks(history, currency = 'CAD') {
    const emptyResult = {
        longestUp: { count: 0, change: 0, pct: 0, startWeek: null, endWeek: null, startDate: '', endDate: '' },
        longestDown: { count: 0, change: 0, pct: 0, startWeek: null, endWeek: null, startDate: '', endDate: '' }
    };
    if (!history || history.length < 2) return emptyResult;

    const valKey = currency === 'USD' ? 'totalUSD' : 'totalCAD';
    const chgKey = currency === 'USD' ? 'weeklyChangeUSD' : 'weeklyChangeCAD';

    let currentUp = null;
    let currentDown = null;
    const upStreaks = [];
    const downStreaks = [];

    for (let i = 1; i < history.length; i++) {
        const rec = history[i];
        const prev = history[i - 1];
        const chg = (rec[chgKey] !== undefined) ? rec[chgKey] : ((rec[valKey] || 0) - (prev[valKey] || 0));

        if (chg > 0) {
            if (currentUp) {
                currentUp.endIndex = i;
                currentUp.count++;
            } else {
                currentUp = { startIndex: i, endIndex: i, count: 1 };
            }
            if (currentDown) {
                downStreaks.push(currentDown);
                currentDown = null;
            }
        } else if (chg < 0) {
            if (currentDown) {
                currentDown.endIndex = i;
                currentDown.count++;
            } else {
                currentDown = { startIndex: i, endIndex: i, count: 1 };
            }
            if (currentUp) {
                upStreaks.push(currentUp);
                currentUp = null;
            }
        } else {
            // Flat week (0 change) ends both streaks
            if (currentUp) {
                upStreaks.push(currentUp);
                currentUp = null;
            }
            if (currentDown) {
                downStreaks.push(currentDown);
                currentDown = null;
            }
        }
    }
    if (currentUp) upStreaks.push(currentUp);
    if (currentDown) downStreaks.push(currentDown);

    function summarizeStreak(streak) {
        if (!streak) {
            return { count: 0, change: 0, pct: 0, startWeek: null, endWeek: null, startDate: '', endDate: '' };
        }
        const sRec = history[streak.startIndex];
        const eRec = history[streak.endIndex];
        const startVal = history[streak.startIndex - 1][valKey] || 0;
        const endVal = eRec[valKey] || 0;
        const change = endVal - startVal;
        const pct = startVal > 0 ? (change / startVal) * 100 : 0;
        return {
            count: streak.count,
            change,
            pct,
            startWeek: sRec.week || streak.startIndex + 1,
            endWeek: eRec.week || streak.endIndex + 1,
            startDate: sRec.date || '',
            endDate: eRec.date || ''
        };
    }

    upStreaks.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const changeA = (history[a.endIndex][valKey] || 0) - (history[a.startIndex - 1][valKey] || 0);
        const changeB = (history[b.endIndex][valKey] || 0) - (history[b.startIndex - 1][valKey] || 0);
        return changeB - changeA;
    });

    downStreaks.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const changeA = Math.abs((history[a.endIndex][valKey] || 0) - (history[a.startIndex - 1][valKey] || 0));
        const changeB = Math.abs((history[b.endIndex][valKey] || 0) - (history[b.startIndex - 1][valKey] || 0));
        return changeB - changeA;
    });

    return {
        longestUp: summarizeStreak(upStreaks[0]),
        longestDown: summarizeStreak(downStreaks[0])
    };
}

function formatStreakDates(startDate, endDate) {
    if (!startDate) return '';
    const fmt = typeof formatDate === 'function' ? formatDate : (d => d);
    if (!endDate || startDate === endDate) return fmt(startDate);
    return `${fmt(startDate)} – ${fmt(endDate)}`;
}

/**
 * Calculates the longest streaks without setting an all-time high (ATH droughts).
 * A streak is measured by consecutive weekly reports that failed to set a new all-time high.
 * @param {Array} history
 * @param {string} currency 'CAD' or 'USD'
 * @param {number} limit Number of top streaks to return (default 3)
 * @returns {Array} Array of streak objects sorted descending by nonAthWeeks
 */
function calculateLongestStreaksWithoutATH(history, currency = 'CAD', limit = 3) {
    if (!history || history.length < 2) return [];

    const valKey = currency === 'USD' ? 'totalUSD' : 'totalCAD';

    let peak = 0;
    const athIndices = [];

    history.forEach((r, idx) => {
        const val = r[valKey] || 0;
        if (idx === 0 || val > peak) {
            peak = val;
            athIndices.push(idx);
        }
    });

    const streaks = [];

    // Analyze non-ATH gaps between consecutive ATHs
    for (let i = 0; i < athIndices.length - 1; i++) {
        const pIdx = athIndices[i];
        const nIdx = athIndices[i + 1];
        const nonAthWeeks = nIdx - pIdx - 1;

        if (nonAthWeeks > 0) {
            const pRec = history[pIdx];
            const nRec = history[nIdx];
            const droughtRecords = history.slice(pIdx + 1, nIdx);
            const minVal = Math.min(...droughtRecords.map(r => r[valKey] || 0));
            const maxDD = minVal - (pRec[valKey] || 0);
            const maxDDPct = (pRec[valKey] || 0) > 0 ? (maxDD / pRec[valKey]) * 100 : 0;

            streaks.push({
                nonAthWeeks,
                elapsedWeeks: nIdx - pIdx,
                startWeek: history[pIdx + 1].week,
                endWeek: history[nIdx - 1].week,
                startDate: history[pIdx + 1].date,
                endDate: history[nIdx - 1].date,
                peakWeek: pRec.week,
                peakDate: pRec.date,
                peakVal: pRec[valKey],
                recoveryWeek: nRec.week,
                recoveryDate: nRec.date,
                recoveryVal: nRec[valKey],
                maxDD,
                maxDDPct,
                isOngoing: false
            });
        }
    }

    // Check ongoing streak after the latest ATH
    const lastAthIdx = athIndices[athIndices.length - 1];
    if (lastAthIdx < history.length - 1) {
        const nonAthWeeks = history.length - 1 - lastAthIdx;
        const pRec = history[lastAthIdx];
        const droughtRecords = history.slice(lastAthIdx + 1);
        const minVal = Math.min(...droughtRecords.map(r => r[valKey] || 0));
        const maxDD = minVal - (pRec[valKey] || 0);
        const maxDDPct = (pRec[valKey] || 0) > 0 ? (maxDD / pRec[valKey]) * 100 : 0;

        streaks.push({
            nonAthWeeks,
            elapsedWeeks: nonAthWeeks,
            startWeek: history[lastAthIdx + 1].week,
            endWeek: history[history.length - 1].week,
            startDate: history[lastAthIdx + 1].date,
            endDate: history[history.length - 1].date,
            peakWeek: pRec.week,
            peakDate: pRec.date,
            peakVal: pRec[valKey],
            recoveryWeek: null,
            recoveryDate: null,
            recoveryVal: null,
            maxDD,
            maxDDPct,
            isOngoing: true
        });
    }

    // Sort descending by nonAthWeeks, breaking ties by deeper drawdown (maxDD ascending)
    streaks.sort((a, b) => {
        if (b.nonAthWeeks !== a.nonAthWeeks) {
            return b.nonAthWeeks - a.nonAthWeeks;
        }
        return a.maxDD - b.maxDD;
    });

    return streaks.slice(0, limit);
}

function renderAthStreaksSection(history) {
    if (!history || history.length === 0) return;

    const cadStreaks = calculateLongestStreaksWithoutATH(history, 'CAD', 3);
    const usdStreaks = calculateLongestStreaksWithoutATH(history, 'USD', 3);

    // Stat Cards
    const cadCardStat = document.getElementById('stat-cad-ath-streak');
    const cadCardSub = document.getElementById('stat-cad-ath-streak-sub');
    const usdCardStat = document.getElementById('stat-usd-ath-streak');
    const usdCardSub = document.getElementById('stat-usd-ath-streak-sub');

    if (cadCardStat && cadStreaks.length > 0) {
        cadCardStat.innerHTML = cadStreaks.map(s => `${s.nonAthWeeks} wks`).join(' &bull; ');
        if (cadCardSub) {
            cadCardSub.textContent = `Top 1: ${cadStreaks[0].nonAthWeeks} weeks (W${cadStreaks[0].startWeek}–W${cadStreaks[0].endWeek})`;
        }
    }

    if (usdCardStat && usdStreaks.length > 0) {
        usdCardStat.innerHTML = usdStreaks.map(s => `${s.nonAthWeeks} wks`).join(' &bull; ');
        if (usdCardSub) {
            usdCardSub.textContent = `Top 1: ${usdStreaks[0].nonAthWeeks} weeks (W${usdStreaks[0].startWeek}–W${usdStreaks[0].endWeek})`;
        }
    }

    // Header Pill
    const headerPill = document.getElementById('ath-streak-header-pill');
    if (headerPill && cadStreaks.length > 0 && usdStreaks.length > 0) {
        const cadSummary = cadStreaks.map(s => `${s.nonAthWeeks} wks`).join(', ');
        const usdSummary = usdStreaks.map(s => `${s.nonAthWeeks} wks`).join(', ');
        headerPill.innerHTML = `CAD: ${cadSummary} &bull; USD: ${usdSummary}`;
    }

    // Card Pills
    const cadPill = document.getElementById('ath-cad-summary-pill');
    if (cadPill && cadStreaks.length > 0) {
        cadPill.innerHTML = cadStreaks.map(s => `${s.nonAthWeeks} wks`).join(' &bull; ');
    }
    const usdPill = document.getElementById('ath-usd-summary-pill');
    if (usdPill && usdStreaks.length > 0) {
        usdPill.innerHTML = usdStreaks.map(s => `${s.nonAthWeeks} wks`).join(' &bull; ');
    }

    function renderStreakItems(streaks, currency) {
        const badgeBg = currency === 'USD' ? '#8250df' : '#0969da';

        return streaks.map((s, idx) => {
            const dateStr = formatStreakDates(s.startDate, s.endDate);
            const peakStr = formatCurrency(s.peakVal, currency);
            const recoveryStr = s.recoveryVal ? formatCurrency(s.recoveryVal, currency) : 'Awaiting ATH';
            const recoveryPart = s.isOngoing
                ? '<span style="color: #d97706; font-weight: 700;">Ongoing consolidation</span>'
                : `Recovery: ${recoveryStr} (W${s.recoveryWeek})`;
            const dipColor = s.maxDD < 0 ? '#cf222e' : '#16a34a';

            return `
                <div style="background: #f8fafc; border-radius: 8px; padding: 10px 14px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                            <span style="background: ${badgeBg}; color: white; font-size: 0.68rem; font-weight: 800; padding: 1px 6px; border-radius: 4px;">#${idx + 1}</span>
                            <strong style="font-size: 0.95rem; color: #1f2328;">${s.nonAthWeeks} week${s.nonAthWeeks === 1 ? '' : 's'}</strong>
                            <span style="font-size: 0.74rem; color: #64748b;">(${s.elapsedWeeks} wks ${s.isOngoing ? 'elapsed' : 'recovery'})</span>
                        </div>
                        <div style="font-size: 0.74rem; color: #64748b;">
                            Weeks ${s.startWeek}–${s.endWeek} &bull; ${dateStr}
                        </div>
                        <div style="font-size: 0.72rem; color: #475569; margin-top: 2px;">
                            Prior Peak: ${peakStr} (W${s.peakWeek}) &rarr; ${recoveryPart}
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.88rem; font-weight: 800; color: ${dipColor};">
                            ${formatCurrency(s.maxDD, currency)}
                        </div>
                        <div style="font-size: 0.72rem; color: ${dipColor}; font-weight: 600;">
                            ${s.maxDDPct.toFixed(2)}% max dip
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    const cadList = document.getElementById('ath-cad-streak-list');
    if (cadList) {
        cadList.innerHTML = renderStreakItems(cadStreaks, 'CAD');
    }

    const usdList = document.getElementById('ath-usd-streak-list');
    if (usdList) {
        usdList.innerHTML = renderStreakItems(usdStreaks, 'USD');
    }
}

function renderOverviewCards() {
    const first = allHistory[0];
    const latest = allHistory[allHistory.length - 1];

    // 1. Calculate Real Market Wealth Created (Unrealized Profit from Holdings)
    const costBasis = calculateHoldingsCostBasis(allHoldings);
    const totalMarketCAD = costBasis.totalMarketCAD;
    const totalBookCostCAD = costBasis.totalBookCostCAD;
    const totalMarketGainsCAD = costBasis.totalMarketGainsCAD;
    const marketRoiPct = costBasis.marketRoiPct;

    // 2. Calculate Total Net Worth Expansion (History Progression)
    const startingCAD = first.totalCAD || 1;
    const currentCAD = latest.totalCAD || totalMarketCAD;
    const totalGrowthCAD = currentCAD - startingCAD;
    const totalGrowthPct = startingCAD > 0 ? (totalGrowthCAD / startingCAD) * 100 : 0;

    // Contributions & Realized Growth = Total Growth minus Current Unrealized Gains
    const netSavingsCAD = Math.max(0, totalGrowthCAD - totalMarketGainsCAD);

    // 3. Weekly Streak & Win/Loss Statistics
    let upWeeks = 0;
    let downWeeks = 0;
    let bestWeek = allHistory.length > 1 ? allHistory[1] : allHistory[0];
    let worstWeek = allHistory.length > 1 ? allHistory[1] : allHistory[0];

    for (let i = 1; i < allHistory.length; i++) {
        const r = allHistory[i];
        if (r.weeklyChangeCAD > 0) upWeeks++;
        else if (r.weeklyChangeCAD < 0) downWeeks++;

        if ((r.weeklyChangeCAD || 0) > (bestWeek.weeklyChangeCAD || 0)) bestWeek = r;
        if ((r.weeklyChangeCAD || 0) < (worstWeek.weeklyChangeCAD || 0)) worstWeek = r;
    }

    const totalActiveWeeks = upWeeks + downWeeks;
    const winRatio = totalActiveWeeks > 0 ? (upWeeks / totalActiveWeeks) * 100 : 0;
    const avgGain = (allHistory.length > 1) ? totalGrowthCAD / (allHistory.length - 1) : 0;

    // 4. Update Top Stat Cards
    const totalGainEl = document.getElementById('stat-total-gain');
    const totalGainPctEl = document.getElementById('stat-total-gain-pct');
    const sign = totalMarketGainsCAD >= 0 ? '+' : '';
    totalGainEl.textContent = `${sign}${formatCurrency(totalMarketGainsCAD, 'CAD')}`;
    totalGainEl.style.color = totalMarketGainsCAD >= 0 ? '#16a34a' : '#cf222e';
    const gainPctNW = currentCAD > 0 ? (totalMarketGainsCAD / currentCAD) * 100 : 0;
    totalGainPctEl.textContent = `Open positions • ${gainPctNW.toFixed(1)}% of NW`;

    const investedCadEl = document.getElementById('stat-invested-cad');
    const investedSubEl = document.getElementById('stat-invested-sub');
    if (investedCadEl) {
        const cSign = netSavingsCAD >= 0 ? '+' : '';
        investedCadEl.textContent = `${cSign}${formatCurrency(netSavingsCAD, 'CAD')}`;
        const savPctNW = currentCAD > 0 ? (netSavingsCAD / currentCAD) * 100 : 0;
        if (investedSubEl) {
            investedSubEl.textContent = `Added since W1 • ${savPctNW.toFixed(1)}% of NW`;
        }
    }

    const growthCadEl = document.getElementById('stat-growth-cad');
    const growthSubEl = document.getElementById('stat-growth-sub');
    if (growthCadEl) {
        const gSign = totalGrowthCAD >= 0 ? '+' : '';
        growthCadEl.textContent = `${gSign}${formatCurrency(totalGrowthCAD, 'CAD')}`;
        growthCadEl.style.color = totalGrowthCAD >= 0 ? '#0969da' : '#cf222e';
        growthSubEl.textContent = `${gSign}${totalGrowthPct.toFixed(1)}% Growth (contributions + gains)`;
    }

    document.getElementById('stat-win-ratio').textContent = `${winRatio.toFixed(1)}%`;
    document.getElementById('stat-win-count').textContent = `${upWeeks} up / ${downWeeks} down`;

    const bestSign = (bestWeek.weeklyChangeCAD || 0) >= 0 ? '+' : '';
    const bestPctSign = (bestWeek.weeklyChangePct || 0) >= 0 ? '+' : '';
    document.getElementById('stat-best-week').textContent = `${bestSign}${formatCurrency(bestWeek.weeklyChangeCAD || 0, 'CAD')}`;
    document.getElementById('stat-best-week-date').textContent = `Week ${bestWeek.week} (${bestWeek.date}) ${bestPctSign}${bestWeek.weeklyChangePct}%`;

    document.getElementById('stat-worst-week').textContent = formatCurrency(worstWeek.weeklyChangeCAD || 0, 'CAD');
    document.getElementById('stat-worst-week-date').textContent = `Week ${worstWeek.week} (${worstWeek.date}) ${worstWeek.weeklyChangePct}%`;

    const avgSign = avgGain >= 0 ? '+' : '';
    document.getElementById('stat-avg-week').textContent = `${avgSign}${formatCurrency(avgGain, 'CAD')}`;
    document.getElementById('stat-weeks-tracked').textContent = `${allHistory.length} weeks tracked`;

    // 4b. Update Weekly Momentum & Streak Analytics Cards (CAD & USD)
    const cadStreaks = calculateWeeklyStreaks(allHistory, 'CAD');
    const usdStreaks = calculateWeeklyStreaks(allHistory, 'USD');

    const cadUpEl = document.getElementById('stat-cad-up-streak');
    const cadUpSub = document.getElementById('stat-cad-up-streak-sub');
    const cadDownEl = document.getElementById('stat-cad-down-streak');
    const cadDownSub = document.getElementById('stat-cad-down-streak-sub');

    const usdUpEl = document.getElementById('stat-usd-up-streak');
    const usdUpSub = document.getElementById('stat-usd-up-streak-sub');
    const usdDownEl = document.getElementById('stat-usd-down-streak');
    const usdDownSub = document.getElementById('stat-usd-down-streak-sub');

    if (cadUpEl && cadStreaks.longestUp && cadStreaks.longestUp.count > 0) {
        const u = cadStreaks.longestUp;
        const dateRange = formatStreakDates(u.startDate, u.endDate);
        cadUpEl.textContent = `${u.count} week${u.count === 1 ? '' : 's'}`;
        if (cadUpSub) {
            cadUpSub.innerHTML = `Total gain: +${formatCurrency(u.change, 'CAD')} (+${u.pct.toFixed(2)}%)<br><span style="color: #64748b;">${dateRange}</span>`;
        }
        const card = document.getElementById('card-cad-up-streak');
        if (card) card.title = `CAD Up Streak: ${dateRange} (+${formatCurrency(u.change, 'CAD')})`;
    }

    if (cadDownEl && cadStreaks.longestDown && cadStreaks.longestDown.count > 0) {
        const d = cadStreaks.longestDown;
        const dateRange = formatStreakDates(d.startDate, d.endDate);
        cadDownEl.textContent = `${d.count} week${d.count === 1 ? '' : 's'}`;
        if (cadDownSub) {
            cadDownSub.innerHTML = `Total down: ${formatCurrency(d.change, 'CAD')} (${d.pct.toFixed(2)}%)<br><span style="color: #64748b;">${dateRange}</span>`;
        }
        const card = document.getElementById('card-cad-down-streak');
        if (card) card.title = `CAD Down Streak: ${dateRange} (${formatCurrency(d.change, 'CAD')})`;
    }

    if (usdUpEl && usdStreaks.longestUp && usdStreaks.longestUp.count > 0) {
        const u = usdStreaks.longestUp;
        const dateRange = formatStreakDates(u.startDate, u.endDate);
        usdUpEl.textContent = `${u.count} week${u.count === 1 ? '' : 's'}`;
        if (usdUpSub) {
            usdUpSub.innerHTML = `Total gain: +${formatCurrency(u.change, 'USD')} (+${u.pct.toFixed(2)}%)<br><span style="color: #64748b;">${dateRange}</span>`;
        }
        const card = document.getElementById('card-usd-up-streak');
        if (card) card.title = `USD Up Streak: ${dateRange} (+${formatCurrency(u.change, 'USD')})`;
    }

    if (usdDownEl && usdStreaks.longestDown && usdStreaks.longestDown.count > 0) {
        const d = usdStreaks.longestDown;
        const dateRange = formatStreakDates(d.startDate, d.endDate);
        usdDownEl.textContent = `${d.count} week${d.count === 1 ? '' : 's'}`;
        if (usdDownSub) {
            usdDownSub.innerHTML = `Total down: ${formatCurrency(d.change, 'USD')} (${d.pct.toFixed(2)}%)<br><span style="color: #64748b;">${dateRange}</span>`;
        }
        const card = document.getElementById('card-usd-down-streak');
        if (card) card.title = `USD Down Streak: ${dateRange} (${formatCurrency(d.change, 'USD')})`;
    }

    // 4c. Update Longest Streaks Without All-Time Highs (CAD & USD)
    renderAthStreaksSection(allHistory);

    // 5. Update Wealth Decomposition Section
    renderWealthDecomposition(startingCAD, netSavingsCAD, totalMarketGainsCAD, currentCAD, marketRoiPct);

    // 5b. Calculate Historical Maximum Drawdown for Portfolio
    let peakValCAD = -Infinity;
    let portfolioMaxDDCAD = 0;
    let portfolioMaxDDPct = 0;
    allHistory.forEach(r => {
        const val = r.totalCAD || 0;
        if (val > peakValCAD) peakValCAD = val;
        const ddCAD = val - peakValCAD;
        const ddPct = peakValCAD > 0 ? (ddCAD / peakValCAD) * 100 : 0;
        if (ddCAD < portfolioMaxDDCAD) {
            portfolioMaxDDCAD = ddCAD;
            portfolioMaxDDPct = ddPct;
        }
    });

    // 6. Benchmark Comparison (Dynamic from data/benchmarks.json)
    renderBenchmarkComparison(totalGrowthPct, totalGrowthCAD, portfolioMaxDDPct, allBenchmarks);

    // 7. Purchasing Power (Inflation-Adjusted Real Net Worth)
    renderPurchasingPower();
}

function renderBenchmarkComparison(growthPct, growthCAD, maxDrawdownPct, benchmarksData) {
    // 1. Window Dates in Header
    const windowEl = document.getElementById('bench-window-dates');
    if (windowEl) {
        if (allHistory && allHistory.length > 0) {
            const sDate = allHistory[0].date;
            const eDate = allHistory[allHistory.length - 1].date;
            const fmt = d => {
                if (!d) return '';
                const parts = d.split('-');
                if (parts.length >= 2) {
                    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const m = parseInt(parts[1], 10) - 1;
                    return `${months[m]} ${parts[0]}`;
                }
                return d;
            };
            windowEl.textContent = `${fmt(sDate)} – ${fmt(eDate)} (${allHistory.length}-Week Window)`;
        } else if (benchmarksData?.window?.label) {
            windowEl.textContent = benchmarksData.window.label;
        }
    }

    // 2. Portfolio Card
    const portRetEl = document.getElementById('bench-my-etf-return');
    const portNwEl = document.getElementById('bench-my-nw-return');
    const portDdEl = document.getElementById('bench-my-drawdown');

    const gSign = growthPct >= 0 ? '+' : '';
    if (portRetEl) portRetEl.textContent = `${gSign}${growthPct.toFixed(1)}%`;
    if (portNwEl) portNwEl.textContent = `${gSign}${formatCurrency(growthCAD, 'CAD')} Growth (contributions + gains)`;
    if (portDdEl) portDdEl.textContent = `${maxDrawdownPct.toFixed(1)}%`;

    // 3. Benchmark Cards
    const bData = benchmarksData?.benchmarks || {};
    const benchmarkItems = [
        { id: 'XEQT', key: 'xeqt', defaultCategory: '100% All-Equity passive blend', defaultRet: 43.81, defaultDd: -15.3, color: '#16a34a' },
        { id: 'XBAL', key: 'xbal', defaultCategory: '60% Stocks / 40% Bonds benchmark', defaultRet: 22.30, defaultDd: -9.9, color: '#8250df' },
        { id: 'VFV', key: 'vfv', defaultCategory: '100% US Mega-cap equity (CAD)', defaultRet: 43.11, defaultDd: -19.3, color: '#d97706' },
        { id: 'XCB', key: 'xcb', defaultCategory: 'Canadian corporate bond index', defaultRet: -2.05, defaultDd: -4.9, color: '#64748b' }
    ];

    benchmarkItems.forEach(item => {
        const data = bData[item.id] || {};
        const ret = data.returnPct !== undefined ? data.returnPct : item.defaultRet;
        const dd = data.maxDrawdownPct !== undefined ? data.maxDrawdownPct : item.defaultDd;
        const retEl = document.getElementById(`bench-${item.key}-return`);
        const subEl = document.getElementById(`bench-${item.key}-sub`);
        const ddEl = document.getElementById(`bench-${item.key}-drawdown`);

        const sign = ret >= 0 ? '+' : '';
        if (retEl) {
            retEl.textContent = `${sign}${ret.toFixed(1)}%`;
            retEl.style.color = ret >= 0 ? item.color : '#cf222e';
        }
        if (subEl) {
            if (data.startPrice && data.currentPrice) {
                subEl.innerHTML = `${item.defaultCategory}<br><span style="font-size: 0.7rem; color: #64748b;">$${data.startPrice.toFixed(2)} &rarr; $${data.currentPrice.toFixed(2)}</span>`;
            } else {
                subEl.textContent = item.defaultCategory;
            }
        }
        if (ddEl) {
            ddEl.textContent = `${dd.toFixed(1)}%`;
        }
    });

    // 4. Visual Comparison Bars
    const barsContainer = document.getElementById('bench-bars-container');
    if (barsContainer) {
        const series = [
            { label: 'My Portfolio (Total Growth)', val: growthPct, color: '#0969da', isPortfolio: true },
            { label: 'S&P 500 CAD (VFV.TO)', val: (bData.VFV?.returnPct !== undefined ? bData.VFV.returnPct : 43.11), color: '#d97706' },
            { label: 'Global Equity (XEQT.TO)', val: (bData.XEQT?.returnPct !== undefined ? bData.XEQT.returnPct : 43.81), color: '#16a34a' },
            { label: 'Balanced 60/40 (XBAL.TO)', val: (bData.XBAL?.returnPct !== undefined ? bData.XBAL.returnPct : 22.30), color: '#8250df' },
            { label: 'CDN Corp Bonds (XCB.TO)', val: (bData.XCB?.returnPct !== undefined ? bData.XCB.returnPct : -2.05), color: '#64748b' }
        ];

        const maxVal = Math.max(...series.map(s => Math.max(0, s.val)), 1);

        barsContainer.innerHTML = series.map(s => {
            const widthPct = Math.max(3, (Math.max(0, s.val) / maxVal) * 100);
            const valSign = s.val >= 0 ? '+' : '';
            return `
                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-weight: ${s.isPortfolio ? '800' : '700'}; margin-bottom: 3px;">
                        <span style="color: ${s.isPortfolio ? '#0969da' : '#1f2328'};">${s.isPortfolio ? '🔵 ' : ''}${escapeHtml(s.label)}</span>
                        <span style="color: ${s.color}; font-weight: 800;">${valSign}${s.val.toFixed(1)}%</span>
                    </div>
                    <div style="width: 100%; height: 10px; background: #e2e8f0; border-radius: 5px; overflow: hidden;">
                        <div style="width: ${widthPct.toFixed(1)}%; height: 100%; background: ${s.color}; border-radius: 5px; transition: width 0.4s ease;"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 5. Dynamic Risk-Adjusted Insight
    const insightEl = document.getElementById('bench-insight');
    if (insightEl) {
        const xeqtRet = bData.XEQT?.returnPct !== undefined ? bData.XEQT.returnPct : 43.81;
        const xeqtDd = bData.XEQT?.maxDrawdownPct !== undefined ? bData.XEQT.maxDrawdownPct : -15.3;
        const vfvRet = bData.VFV?.returnPct !== undefined ? bData.VFV.returnPct : 43.11;
        const vfvDd = bData.VFV?.maxDrawdownPct !== undefined ? bData.VFV.maxDrawdownPct : -19.3;

        insightEl.innerHTML = `
            💡 <strong>Risk-Adjusted Insight:</strong> While pure equity indexes delivered robust market appreciation during this period (Global Equity XEQT at <strong>+${xeqtRet.toFixed(1)}%</strong>, S&amp;P 500 VFV at <strong>+${vfvRet.toFixed(1)}%</strong>), your disciplined personal contributions and multi-asset allocation propelled total portfolio net worth by <strong>+${growthPct.toFixed(1)}%</strong> (<strong>+${formatCurrency(growthCAD, 'CAD')}</strong>). Importantly, your balanced diversification provided superior capital preservation: your historical maximum drawdown was held to just <strong style="color: #0969da;">${maxDrawdownPct.toFixed(1)}%</strong>, compared to <strong style="color: #cf222e;">${xeqtDd.toFixed(1)}%</strong> for XEQT and <strong style="color: #cf222e;">${vfvDd.toFixed(1)}%</strong> for the S&amp;P 500.
        `;
    }
}

function calculatePurchasingPower(startingCAD, currentCAD, weeksElapsed, annualInflationRate = 5.0) {
    const yearsElapsed = weeksElapsed / 52.14;
    const deflator = Math.pow(1 + (annualInflationRate / 100), yearsElapsed);
    const realNetWorth = currentCAD / deflator;
    const realGain = realNetWorth - startingCAD;
    const realGainPct = startingCAD > 0 ? (realGain / startingCAD) * 100 : 0;
    const inflationDrag = Math.max(0, currentCAD - realNetWorth);
    const realWeeklyPace = weeksElapsed > 0 ? realGain / weeksElapsed : 0;
    return {
        deflator: Number(deflator.toFixed(4)),
        realNetWorth: Number(realNetWorth.toFixed(2)),
        realGain: Number(realGain.toFixed(2)),
        realGainPct: Number(realGainPct.toFixed(2)),
        inflationDrag: Number(inflationDrag.toFixed(2)),
        realWeeklyPace: Number(realWeeklyPace.toFixed(2))
    };
}

function setInflationRate(rate) {
    currentInflationRate = Number(rate) || 5.0;
    const btn3 = document.getElementById('btn-inf-3');
    const btn5 = document.getElementById('btn-inf-5');
    const btn7 = document.getElementById('btn-inf-7');

    const resetBtn = b => { if (b) { b.style.background = 'white'; b.style.color = '#24292f'; } };
    const setBtn = b => { if (b) { b.style.background = '#1f2328'; b.style.color = 'white'; } };

    resetBtn(btn3);
    resetBtn(btn5);
    resetBtn(btn7);

    if (currentInflationRate === 3.0) setBtn(btn3);
    else if (currentInflationRate === 7.0) setBtn(btn7);
    else setBtn(btn5);

    renderPurchasingPower();
}

function renderPurchasingPower() {
    if (!allHistory || allHistory.length < 2) return;

    const first = allHistory[0];
    const latest = allHistory[allHistory.length - 1];

    const startingCAD = first.totalCAD || 1;
    const currentCAD = latest.totalCAD || startingCAD;
    const totalGrowthCAD = currentCAD - startingCAD;
    const weeksElapsed = allHistory.length - 1;
    const yearsElapsed = weeksElapsed / 52.14;

    const pp = calculatePurchasingPower(startingCAD, currentCAD, weeksElapsed, currentInflationRate);
    const nominalWeeklyPace = weeksElapsed > 0 ? totalGrowthCAD / weeksElapsed : 0;

    const realNwEl = document.getElementById('pp-real-nw');
    const realNwSubEl = document.getElementById('pp-real-nw-sub');
    const realGainEl = document.getElementById('pp-real-gain');
    const realGainSubEl = document.getElementById('pp-real-gain-sub');
    const infDragEl = document.getElementById('pp-inf-drag');
    const infDragSubEl = document.getElementById('pp-inf-drag-sub');
    const weeklyPaceEl = document.getElementById('pp-weekly-pace');
    const weeklyPaceSubEl = document.getElementById('pp-weekly-pace-sub');

    if (realNwEl) realNwEl.textContent = formatCurrency(pp.realNetWorth, 'CAD');
    let startDateStr = 'Inception';
    if (first && first.date) {
        const parts = first.date.split('-');
        if (parts.length >= 2) {
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const m = parseInt(parts[1], 10) - 1;
            startDateStr = `${months[m]} ${parts[0]}`;
        }
    }
    if (realNwSubEl) realNwSubEl.textContent = `In constant ${startDateStr} purchasing power (${yearsElapsed.toFixed(2)} yrs @ ${currentInflationRate.toFixed(1)}%)`;

    const rSign = pp.realGain >= 0 ? '+' : '';
    if (realGainEl) {
        realGainEl.textContent = `${rSign}${formatCurrency(pp.realGain, 'CAD')}`;
        realGainEl.style.color = pp.realGain >= 0 ? '#16a34a' : '#cf222e';
    }
    if (realGainSubEl) realGainSubEl.textContent = `${rSign}${pp.realGainPct.toFixed(1)}% real expansion above inflation`;

    if (infDragEl) infDragEl.textContent = `-${formatCurrency(pp.inflationDrag, 'CAD')}`;
    if (infDragSubEl) infDragSubEl.textContent = `${((pp.deflator - 1) * 100).toFixed(1)}% cumulative price inflation erosion`;

    if (weeklyPaceEl) weeklyPaceEl.textContent = `${rSign}${formatCurrency(pp.realWeeklyPace, 'CAD')} / wk`;
    if (weeklyPaceSubEl) weeklyPaceSubEl.textContent = `vs +${formatCurrency(nominalWeeklyPace, 'CAD')} / wk nominal pace`;

    // Progress Bar
    const barReal = document.getElementById('pp-bar-real');
    const barDrag = document.getElementById('pp-bar-drag');
    const lblReal = document.getElementById('pp-bar-label-real');
    const lblDrag = document.getElementById('pp-bar-label-drag');

    if (barReal && barDrag) {
        const totalNominal = Math.max(1, pp.realGain + pp.inflationDrag);
        const realShare = Math.max(5, Math.min(95, (pp.realGain / totalNominal) * 100));
        const dragShare = 100 - realShare;

        barReal.style.width = `${realShare.toFixed(1)}%`;
        barDrag.style.width = `${dragShare.toFixed(1)}%`;

        if (lblReal) lblReal.textContent = `■ Real Purchasing Power Expansion: +${formatCurrency(pp.realGain, 'CAD')} (${pp.realGainPct.toFixed(1)}%)`;
        if (lblDrag) lblDrag.textContent = `■ Cost-of-Living Drag: -${formatCurrency(pp.inflationDrag, 'CAD')} (${((pp.deflator - 1) * 100).toFixed(1)}% inflation)`;
    }

    // Insight Note
    const insightEl = document.getElementById('pp-insight-note');
    if (insightEl) {
        insightEl.innerHTML = `
            💡 <strong>Purchasing Power Insight:</strong> At an assumed <strong>${currentInflationRate.toFixed(1)}% annual inflation hurdle</strong>, cumulative price increases absorbed <strong>${formatCurrency(pp.inflationDrag, 'CAD')}</strong> of your nominal wealth. However, your portfolio's investment appreciation and consistent savings substantially outpaced inflation, creating <strong>+${formatCurrency(pp.realGain, 'CAD')}</strong> of true, uncompromised purchasing power expansion (<strong>${rSign}${pp.realGainPct.toFixed(1)}% real growth</strong>).
        `;
    }
}



function renderWealthDecomposition(startingCAD, savingsCAD, gainsCAD, currentCAD, roiPct) {
    const startPill = document.getElementById('wealth-stat-starting');
    const startSub = document.getElementById('wealth-stat-starting-sub');
    const savPill = document.getElementById('wealth-stat-savings');
    const savSub = document.getElementById('wealth-stat-savings-sub');
    const gainPill = document.getElementById('wealth-stat-gains');
    const gainSub = document.getElementById('wealth-stat-gains-sub');
    const curPill = document.getElementById('wealth-stat-current');
    const curSub = document.getElementById('wealth-stat-current-sub');
    const summaryPill = document.getElementById('wealth-summary-pill');

    if (!curPill) return;

    const startPct = currentCAD > 0 ? (startingCAD / currentCAD) * 100 : 0;
    const savPct = currentCAD > 0 ? (savingsCAD / currentCAD) * 100 : 0;
    const gainPct = currentCAD > 0 ? (gainsCAD / currentCAD) * 100 : 0;

    startPill.textContent = formatCurrency(startingCAD, 'CAD');
    startSub.textContent = `${startPct.toFixed(1)}% of wealth at inception (${allHistory[0].date})`;

    const savSign = savingsCAD >= 0 ? '+' : '';
    savPill.textContent = `${savSign}${formatCurrency(savingsCAD, 'CAD')}`;
    savSub.textContent = `${savPct.toFixed(1)}% of wealth (contributions & realized gains)`;

    const gainSign = gainsCAD >= 0 ? '+' : '';
    gainPill.textContent = `${gainSign}${formatCurrency(gainsCAD, 'CAD')}`;
    gainSub.textContent = `${gainPct.toFixed(1)}% of wealth (current unrealized gains)`;

    curPill.textContent = formatCurrency(currentCAD, 'CAD');
    curSub.textContent = `100.0% current portfolio valuation`;

    if (summaryPill) {
        summaryPill.textContent = `Current Unrealized Gains: ${gainSign}${formatCurrency(gainsCAD, 'CAD')} (${gainPct.toFixed(1)}% of NW)`;
    }

    // Update Progress Bars
    const barStart = document.getElementById('wealth-bar-starting');
    const barSav = document.getElementById('wealth-bar-savings');
    const barGain = document.getElementById('wealth-bar-gains');

    if (barStart && barSav && barGain) {
        barStart.style.width = `${Math.max(2, startPct)}%`;
        barSav.style.width = `${Math.max(2, savPct)}%`;
        barGain.style.width = `${Math.max(2, gainPct)}%`;

        document.getElementById('wealth-bar-label-starting').textContent = `■ Starting Baseline: ${formatCurrency(startingCAD, 'CAD')} (${startPct.toFixed(1)}%)`;
        document.getElementById('wealth-bar-label-savings').textContent = `■ Contributions & Realized: +${formatCurrency(savingsCAD, 'CAD')} (${savPct.toFixed(1)}%)`;
        document.getElementById('wealth-bar-label-gains').textContent = `■ Current Unrealized Gains: +${formatCurrency(gainsCAD, 'CAD')} (${gainPct.toFixed(1)}%)`;
    }
}

function renderMonthlyHeatmap() {
    const yearsMap = {};

    allHistory.forEach(r => {
        if (!r.date) return;
        const [yStr, mStr] = r.date.split('-');
        const year = parseInt(yStr, 10);
        const month = parseInt(mStr, 10) - 1; // 0-indexed

        if (!yearsMap[year]) {
            yearsMap[year] = Array.from({ length: 12 }, () => []);
        }
        yearsMap[year][month].push(r);
    });

    const tbody = document.getElementById('heatmap-body');
    tbody.innerHTML = '';

    const years = Object.keys(yearsMap).map(Number).sort((a, b) => b - a);

    years.forEach(year => {
        const tr = document.createElement('tr');
        let rowHtml = `<td><strong>${year}</strong></td>`;

        let yearStartVal = null;
        let yearEndVal = null;

        for (let m = 0; m < 12; m++) {
            const records = yearsMap[year][m];
            if (!records || records.length === 0) {
                rowHtml += `<td class="heatmap-cell heat-neutral">-</td>`;
                continue;
            }

            const monthStart = records[0].totalCAD - (records[0].weeklyChangeCAD || 0);
            const monthEnd = records[records.length - 1].totalCAD;
            const mGainPct = monthStart > 0 ? ((monthEnd - monthStart) / monthStart) * 100 : 0;

            if (yearStartVal === null) yearStartVal = monthStart;
            yearEndVal = monthEnd;

            let heatClass = 'heat-neutral';
            if (mGainPct >= 4.0) heatClass = 'heat-green-deep';
            else if (mGainPct >= 1.5) heatClass = 'heat-green-med';
            else if (mGainPct > 0) heatClass = 'heat-green-soft';
            else if (mGainPct <= -4.0) heatClass = 'heat-red-deep';
            else if (mGainPct <= -1.5) heatClass = 'heat-red-med';
            else if (mGainPct < 0) heatClass = 'heat-red-soft';

            const sign = mGainPct > 0 ? '+' : '';
            rowHtml += `<td class="heatmap-cell ${heatClass}" title="${sign}${mGainPct.toFixed(2)}% (${formatCurrency(monthEnd - monthStart, 'CAD')})">
                ${sign}${mGainPct.toFixed(1)}%
            </td>`;
        }

        // Full Year Total
        let fullYearPct = 0;
        if (yearStartVal && yearEndVal) {
            fullYearPct = ((yearEndVal - yearStartVal) / yearStartVal) * 100;
        }
        const ySign = fullYearPct > 0 ? '+' : '';
        const yColor = fullYearPct >= 0 ? '#166534' : '#991b1b';
        rowHtml += `<td style="text-align: center; font-weight: 800; color: ${yColor}; background: ${fullYearPct >= 0 ? '#dcfce7' : '#fee2e2'};">
            ${ySign}${fullYearPct.toFixed(1)}%
        </td>`;

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });
}

function renderWeeklyBarChart() {
    const container = document.getElementById('bar-chart-container');
    const svgWrap = document.getElementById('bar-svg-wrap') || container;
    const tooltip = document.getElementById('chart-tooltip');
    if (!container || !svgWrap) return;
    svgWrap.innerHTML = '';

    const records = allHistory.slice(1);
    if (records.length === 0) return;

    let maxAbsChange = 0;
    records.forEach(r => {
        const absVal = Math.abs(r.weeklyChangeCAD || 0);
        if (absVal > maxAbsChange) maxAbsChange = absVal;
    });

    if (maxAbsChange === 0) maxAbsChange = 1000;

    const width = container.clientWidth || 900;
    const height = 220;
    const padding = { top: 15, bottom: 25, left: 10, right: 10 };
    const chartHeight = height - padding.top - padding.bottom;
    const chartWidth = width - padding.left - padding.right;
    const barWidth = Math.max(3, (chartWidth / records.length) - 2);
    const zeroY = padding.top + (chartHeight / 2);

    let svg = `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="display: block; width: 100%; height: 100%; overflow: visible;">`;

    // Zero baseline
    svg += `<line x1="${padding.left}" y1="${zeroY}" x2="${width - padding.right}" y2="${zeroY}" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="3,3"/>`;

    records.forEach((r, idx) => {
        const x = padding.left + (idx * (chartWidth / records.length));
        const change = r.weeklyChangeCAD || 0;
        const normalizedH = (Math.abs(change) / maxAbsChange) * (chartHeight / 2);
        const barH = Math.max(2, normalizedH);

        let barY, color;
        if (change >= 0) {
            barY = zeroY - barH;
            color = '#16a34a';
        } else {
            barY = zeroY;
            color = '#dc2626';
        }

        svg += `<rect x="${x}" y="${barY}" width="${barWidth}" height="${barH}" rx="1" fill="${color}" opacity="0.85"
            style="cursor: pointer; transition: opacity 0.1s;"
            onmouseover="showBarTip(event, '${r.date}', ${r.week}, ${change}, ${r.weeklyChangePct})"
            onmouseout="hideBarTip()" />`;
    });

    svg += `</svg>`;
    svgWrap.innerHTML = svg;

    window.showBarTip = function(evt, date, week, change, pct) {
        if (!tooltip) return;
        const rect = container.getBoundingClientRect();
        const mouseX = evt.clientX - rect.left;
        const mouseY = evt.clientY - rect.top;

        tooltip.style.display = 'block';
        const tipWidth = 200;
        let tipLeft = mouseX + 12;
        if (tipLeft + tipWidth > rect.width - 10) {
            tipLeft = Math.max(10, mouseX - tipWidth - 12);
        }
        tooltip.style.left = `${tipLeft}px`;
        tooltip.style.top = `${Math.max(10, mouseY - 30)}px`;
        const sign = change >= 0 ? '+' : '';
        tooltip.innerHTML = `
            <strong>Week ${week} (${date})</strong><br>
            Net Change: <span style="color: ${change >= 0 ? '#4ade80' : '#f87171'}">${sign}${formatCurrency(change, 'CAD')} (${sign}${pct}%)</span>
        `;
    };

    window.hideBarTip = function() {
        if (tooltip) tooltip.style.display = 'none';
    };
}

/* ================= Rolling 52-Week Extremes (Best & Worst) ================= */

let rolling52ViewMode = 'both'; // 'both', 'current', 'best', 'worst'
let rolling52TimelineMetric = 'pct'; // 'pct', 'cad', 'usd'
let rolling52OverlayMetric = 'pct'; // 'pct', 'cad', 'usd'

function setRolling52View(mode) {
    rolling52ViewMode = mode;
    const btnBoth = document.getElementById('btn-r52-view-both');
    const btnCurrent = document.getElementById('btn-r52-view-current');
    const btnBest = document.getElementById('btn-r52-view-best');
    const btnWorst = document.getElementById('btn-r52-view-worst');

    [btnBoth, btnCurrent, btnBest, btnWorst].forEach(btn => {
        if (btn) {
            btn.style.background = 'white';
            btn.style.color = '#24292f';
        }
    });

    if (mode === 'current') {
        if (btnCurrent) { btnCurrent.style.background = '#1f2328'; btnCurrent.style.color = 'white'; }
    } else if (mode === 'best') {
        if (btnBest) { btnBest.style.background = '#1f2328'; btnBest.style.color = 'white'; }
    } else if (mode === 'worst') {
        if (btnWorst) { btnWorst.style.background = '#1f2328'; btnWorst.style.color = 'white'; }
    } else {
        if (btnBoth) { btnBoth.style.background = '#1f2328'; btnBoth.style.color = 'white'; }
    }

    renderRolling52Charts();
}

function setRolling52OverlayMetric(metric) {
    rolling52OverlayMetric = metric;
    const btnPct = document.getElementById('btn-r52-overlay-pct');
    const btnCad = document.getElementById('btn-r52-overlay-cad');
    const btnUsd = document.getElementById('btn-r52-overlay-usd');

    [btnPct, btnCad, btnUsd].forEach(btn => {
        if (btn) {
            btn.style.background = 'white';
            btn.style.color = '#24292f';
        }
    });

    if (metric === 'cad') {
        if (btnCad) { btnCad.style.background = '#1f2328'; btnCad.style.color = 'white'; }
    } else if (metric === 'usd') {
        if (btnUsd) { btnUsd.style.background = '#1f2328'; btnUsd.style.color = 'white'; }
    } else {
        if (btnPct) { btnPct.style.background = '#1f2328'; btnPct.style.color = 'white'; }
    }

    renderRolling52Charts();
}

function setRolling52TimelineMetric(metric) {
    rolling52TimelineMetric = metric;
    const btnPct = document.getElementById('btn-r52-metric-pct');
    const btnCad = document.getElementById('btn-r52-metric-cad');
    const btnUsd = document.getElementById('btn-r52-metric-usd');

    [btnPct, btnCad, btnUsd].forEach(btn => {
        if (btn) {
            btn.style.background = 'white';
            btn.style.color = '#24292f';
        }
    });

    if (metric === 'cad') {
        if (btnCad) { btnCad.style.background = '#1f2328'; btnCad.style.color = 'white'; }
    } else if (metric === 'usd') {
        if (btnUsd) { btnUsd.style.background = '#1f2328'; btnUsd.style.color = 'white'; }
    } else {
        if (btnPct) { btnPct.style.background = '#1f2328'; btnPct.style.color = 'white'; }
    }

    renderRolling52Charts();
}

function buildRolling52OverlaySeries(windowData, metric = 'pct', currency = 'CAD') {
    if (!windowData || !windowData.records) return [];
    const startCAD = windowData.startValCAD;
    const startUSD = windowData.startValUSD;
    const startVal = currency === 'USD' ? startUSD : startCAD;

    const baselineDate = (windowData.startIndex > 0 && typeof allHistory !== 'undefined' && allHistory && allHistory[windowData.startIndex - 1])
        ? allHistory[windowData.startIndex - 1].date
        : windowData.startDate;

    const series = [{
        weekIdx: 0,
        pct: 0,
        pctCAD: 0,
        pctUSD: 0,
        val: startVal,
        valCAD: startCAD,
        valUSD: startUSD,
        gainCAD: 0,
        gainUSD: 0,
        plotVal: 0,
        record: null,
        date: baselineDate
    }];

    windowData.records.forEach((r, idx) => {
        const valCAD = r.totalCAD || 0;
        const valUSD = r.totalUSD || 0;
        const gainCAD = valCAD - startCAD;
        const gainUSD = valUSD - startUSD;
        const pctCAD = startCAD > 0 ? (gainCAD / startCAD) * 100 : 0;
        const pctUSD = startUSD > 0 ? (gainUSD / startUSD) * 100 : 0;
        const pct = currency === 'USD' ? pctUSD : pctCAD;
        const val = currency === 'USD' ? valUSD : valCAD;

        let plotVal = pct;
        if (metric === 'cad') plotVal = gainCAD;
        else if (metric === 'usd') plotVal = gainUSD;

        series.push({
            weekIdx: idx + 1,
            pct,
            pctCAD,
            pctUSD,
            val,
            valCAD,
            valUSD,
            gainCAD,
            gainUSD,
            plotVal,
            record: r,
            date: r.date
        });
    });

    return series;
}

let rolling52ShowXeqt = true;

function toggleRolling52Xeqt() {
    rolling52ShowXeqt = !rolling52ShowXeqt;
    const btn = document.getElementById('btn-r52-toggle-xeqt');
    const check = document.getElementById('r52-xeqt-check');
    const banner = document.getElementById('r52-timeline-banner-xeqt');
    const spreadWrap = document.getElementById('r52-timeline-stat-spread-wrap');

    if (btn && check) {
        if (rolling52ShowXeqt) {
            btn.style.background = '#f0fdf4';
            btn.style.borderColor = '#16a34a';
            btn.style.color = '#16a34a';
            check.style.background = '#16a34a';
        } else {
            btn.style.background = '#f8fafc';
            btn.style.borderColor = '#d0d7de';
            btn.style.color = '#64748b';
            check.style.background = '#94a3b8';
        }
    }
    if (banner) {
        banner.style.display = rolling52ShowXeqt ? 'inline' : 'none';
    }
    if (spreadWrap) {
        spreadWrap.style.display = rolling52ShowXeqt ? 'inline-block' : 'none';
    }
    renderRolling52Charts();
}

function computeRolling52Windows(records, rankBy = 'pct') {
    if (!records || records.length < 52) return null;

    const windows = [];
    for (let i = 0; i <= records.length - 52; i++) {
        const win = records.slice(i, i + 52);
        const startRec = win[0];
        const endRec = win[51];

        // CAD metrics
        const startValCAD = i > 0 ? records[i - 1].totalCAD : (startRec.totalCAD - (startRec.weeklyChangeCAD || 0));
        const endValCAD = endRec.totalCAD;
        const gainCAD = endValCAD - startValCAD;
        const pctCAD = startValCAD > 0 ? (gainCAD / startValCAD) * 100 : 0;

        // USD metrics
        const startValUSD = i > 0 ? records[i - 1].totalUSD : (startRec.totalUSD - (startRec.weeklyChangeUSD || 0));
        const endValUSD = endRec.totalUSD;
        const gainUSD = endValUSD - startValUSD;
        const pctUSD = startValUSD > 0 ? (gainUSD / startValUSD) * 100 : 0;

        let upWeeks = 0;
        let downWeeks = 0;
        win.forEach(r => {
            const chg = r.weeklyChangeCAD || 0;
            if (chg >= 0) upWeeks++;
            else downWeeks++;
        });

        const avgWeeklyGainCAD = gainCAD / 52;
        const avgWeeklyGainUSD = gainUSD / 52;

        windows.push({
            startIndex: i,
            endIndex: i + 51,
            startWeek: startRec.week,
            endWeek: endRec.week,
            startDate: startRec.date,
            endDate: endRec.date,
            startValCAD,
            endValCAD,
            gainCAD,
            pctCAD,
            startValUSD,
            endValUSD,
            gainUSD,
            pctUSD,
            avgWeeklyGainCAD,
            avgWeeklyGainUSD,
            upWeeks,
            downWeeks,
            winRate: (upWeeks / 52) * 100,
            records: win
        });
    }

    const timelineWindows = [...windows];
    const currentWindow = timelineWindows[timelineWindows.length - 1]; // Latest chronological 52-week period
    const sortKey = rankBy === 'dollar' ? 'gainCAD' : 'pctCAD';
    windows.sort((a, b) => b[sortKey] - a[sortKey]);
    return {
        best: windows[0],
        worst: windows[windows.length - 1],
        current: currentWindow,
        totalWindows: windows.length,
        timeline: timelineWindows
    };
}

function renderRolling52Charts() {
    if (!allHistory || allHistory.length < 52) {
        const wrap = document.getElementById('r52-charts-wrapper');
        if (wrap) {
            wrap.innerHTML = `<p class="empty-state" style="padding: 24px; text-align: center; color: #64748b;">At least 52 weeks of historical records are required to calculate rolling 52-week periods (currently ${allHistory ? allHistory.length : 0} weeks recorded).</p>`;
        }
        return;
    }

    const rankBy = 'pct';
    const currency = rolling52OverlayMetric === 'usd' ? 'USD' : 'CAD';

    const extremes = computeRolling52Windows(allHistory, rankBy);
    if (!extremes) return;

    const { best, worst, current, timeline } = extremes;
    const signOf = (val) => val >= 0 ? '+' : '';

    // Update Best Card
    const bestWeeksPill = document.getElementById('r52-best-weeks-pill');
    const bestDates = document.getElementById('r52-best-dates');
    const bestProgPct = document.getElementById('r52-best-progress-pct');
    const bestProgUsdPct = document.getElementById('r52-best-progress-usd-pct');
    const bestProgCad = document.getElementById('r52-best-progress-cad');
    const bestStartEndCad = document.getElementById('r52-best-start-end-cad');
    const bestProgUsd = document.getElementById('r52-best-progress-usd');
    const bestStartEndUsd = document.getElementById('r52-best-start-end-usd');
    const bestPace = document.getElementById('r52-best-pace');
    const bestWinRatio = document.getElementById('r52-best-win-ratio');

    const getWinBaselineDate = (w) => (w && w.startIndex > 0 && allHistory && allHistory[w.startIndex - 1])
        ? allHistory[w.startIndex - 1].date
        : (w ? w.startDate : '');

    if (bestWeeksPill) bestWeeksPill.textContent = `Weeks ${best.startWeek}–${best.endWeek}`;
    if (bestDates) bestDates.textContent = `${formatDate(getWinBaselineDate(best))} – ${formatDate(best.endDate)}`;
    if (bestProgPct) bestProgPct.textContent = `${signOf(best.pctCAD)}${best.pctCAD.toFixed(2)}%`;
    if (bestProgUsdPct) bestProgUsdPct.textContent = `${signOf(best.pctUSD)}${best.pctUSD.toFixed(2)}% USD`;
    if (bestProgCad) bestProgCad.textContent = `${signOf(best.gainCAD)}${formatCurrency(best.gainCAD, 'CAD')}`;
    if (bestStartEndCad) bestStartEndCad.innerHTML = `${formatCurrency(best.startValCAD, 'CAD')} &rarr; ${formatCurrency(best.endValCAD, 'CAD')}`;
    if (bestProgUsd) bestProgUsd.textContent = `${signOf(best.gainUSD)}${formatCurrency(best.gainUSD, 'USD')}`;
    if (bestStartEndUsd) bestStartEndUsd.innerHTML = `${formatCurrency(best.startValUSD, 'USD')} &rarr; ${formatCurrency(best.endValUSD, 'USD')}`;
    if (bestPace) bestPace.textContent = `Avg: +${formatCurrency(best.avgWeeklyGainCAD, 'CAD')} / wk (+${formatCurrency(best.avgWeeklyGainUSD, 'USD')} USD)`;
    if (bestWinRatio) bestWinRatio.textContent = `${best.upWeeks} up / ${best.downWeeks} down (${best.winRate.toFixed(1)}% win rate)`;

    // Update Current (Last) 52-Week Card
    const currentWeeksPill = document.getElementById('r52-current-weeks-pill');
    const currentDates = document.getElementById('r52-current-dates');
    const currentProgPct = document.getElementById('r52-current-progress-pct');
    const currentProgUsdPct = document.getElementById('r52-current-progress-usd-pct');
    const currentProgCad = document.getElementById('r52-current-progress-cad');
    const currentStartEndCad = document.getElementById('r52-current-start-end-cad');
    const currentProgUsd = document.getElementById('r52-current-progress-usd');
    const currentStartEndUsd = document.getElementById('r52-current-start-end-usd');
    const currentPace = document.getElementById('r52-current-pace');
    const currentWinRatio = document.getElementById('r52-current-win-ratio');

    if (current && currentWeeksPill) {
        currentWeeksPill.textContent = `Weeks ${current.startWeek}–${current.endWeek}`;
        if (currentDates) currentDates.textContent = `${formatDate(getWinBaselineDate(current))} – ${formatDate(current.endDate)}`;
        if (currentProgPct) currentProgPct.textContent = `${signOf(current.pctCAD)}${current.pctCAD.toFixed(2)}%`;
        if (currentProgUsdPct) currentProgUsdPct.textContent = `${signOf(current.pctUSD)}${current.pctUSD.toFixed(2)}% USD`;
        if (currentProgCad) currentProgCad.textContent = `${signOf(current.gainCAD)}${formatCurrency(current.gainCAD, 'CAD')}`;
        if (currentStartEndCad) currentStartEndCad.innerHTML = `${formatCurrency(current.startValCAD, 'CAD')} &rarr; ${formatCurrency(current.endValCAD, 'CAD')}`;
        if (currentProgUsd) currentProgUsd.textContent = `${signOf(current.gainUSD)}${formatCurrency(current.gainUSD, 'USD')}`;
        if (currentStartEndUsd) currentStartEndUsd.innerHTML = `${formatCurrency(current.startValUSD, 'USD')} &rarr; ${formatCurrency(current.endValUSD, 'USD')}`;
        if (currentPace) currentPace.textContent = `Avg: +${formatCurrency(current.avgWeeklyGainCAD, 'CAD')} / wk (+${formatCurrency(current.avgWeeklyGainUSD, 'USD')} USD)`;
        if (currentWinRatio) currentWinRatio.textContent = `${current.upWeeks} up / ${current.downWeeks} down (${current.winRate.toFixed(1)}% win rate)`;
    }

    // Update Worst Card
    const worstWeeksPill = document.getElementById('r52-worst-weeks-pill');
    const worstDates = document.getElementById('r52-worst-dates');
    const worstProgPct = document.getElementById('r52-worst-progress-pct');
    const worstProgUsdPct = document.getElementById('r52-worst-progress-usd-pct');
    const worstProgCad = document.getElementById('r52-worst-progress-cad');
    const worstStartEndCad = document.getElementById('r52-worst-start-end-cad');
    const worstProgUsd = document.getElementById('r52-worst-progress-usd');
    const worstStartEndUsd = document.getElementById('r52-worst-start-end-usd');
    const worstPace = document.getElementById('r52-worst-pace');
    const worstWinRatio = document.getElementById('r52-worst-win-ratio');

    if (worstWeeksPill) worstWeeksPill.textContent = `Weeks ${worst.startWeek}–${worst.endWeek}`;
    if (worstDates) worstDates.textContent = `${formatDate(getWinBaselineDate(worst))} – ${formatDate(worst.endDate)}`;
    if (worstProgPct) worstProgPct.textContent = `${signOf(worst.pctCAD)}${worst.pctCAD.toFixed(2)}%`;
    if (worstProgUsdPct) worstProgUsdPct.textContent = `${signOf(worst.pctUSD)}${worst.pctUSD.toFixed(2)}% USD`;
    if (worstProgCad) worstProgCad.textContent = `${signOf(worst.gainCAD)}${formatCurrency(worst.gainCAD, 'CAD')}`;
    if (worstStartEndCad) worstStartEndCad.innerHTML = `${formatCurrency(worst.startValCAD, 'CAD')} &rarr; ${formatCurrency(worst.endValCAD, 'CAD')}`;
    if (worstProgUsd) worstProgUsd.textContent = `${signOf(worst.gainUSD)}${formatCurrency(worst.gainUSD, 'USD')}`;
    if (worstStartEndUsd) worstStartEndUsd.innerHTML = `${formatCurrency(worst.startValUSD, 'USD')} &rarr; ${formatCurrency(worst.endValUSD, 'USD')}`;
    if (worstPace) worstPace.textContent = `Avg: +${formatCurrency(worst.avgWeeklyGainCAD, 'CAD')} / wk (+${formatCurrency(worst.avgWeeklyGainUSD, 'USD')} USD)`;
    if (worstWinRatio) worstWinRatio.textContent = `${worst.upWeeks} up / ${worst.downWeeks} down (${worst.winRate.toFixed(1)}% win rate)`;

    // Update Overlay Title & Subtitle
    const overlayTitle = document.getElementById('r52-overlay-title');
    const overlaySub = document.getElementById('r52-overlay-sub');
    if (overlayTitle) {
        if (rolling52OverlayMetric === 'cad') {
            overlayTitle.textContent = '📊 52-Week Progression Overlay: Current vs. Best vs. Worst ($ CAD)';
        } else if (rolling52OverlayMetric === 'usd') {
            overlayTitle.textContent = '📊 52-Week Progression Overlay: Current vs. Best vs. Worst ($ USD)';
        } else {
            overlayTitle.textContent = '📊 52-Week Progression Overlay: Current vs. Best vs. Worst (%)';
        }
    }
    if (overlaySub) {
        if (rolling52OverlayMetric === 'cad') {
            overlaySub.textContent = 'Cumulative dollar growth comparison over 52 consecutive elapsed weeks starting at +$0 CAD.';
        } else if (rolling52OverlayMetric === 'usd') {
            overlaySub.textContent = 'Cumulative dollar growth comparison over 52 consecutive elapsed weeks starting at +US$0 USD.';
        } else {
            overlaySub.textContent = 'Normalized return comparison over 52 consecutive elapsed weeks starting at 0.00%.';
        }
    }

    // Sync Overlay Metric Buttons Active State
    const btnOvPct = document.getElementById('btn-r52-overlay-pct');
    const btnOvCad = document.getElementById('btn-r52-overlay-cad');
    const btnOvUsd = document.getElementById('btn-r52-overlay-usd');
    [btnOvPct, btnOvCad, btnOvUsd].forEach(btn => {
        if (btn) { btn.style.background = 'white'; btn.style.color = '#24292f'; }
    });
    if (rolling52OverlayMetric === 'cad') {
        if (btnOvCad) { btnOvCad.style.background = '#1f2328'; btnOvCad.style.color = 'white'; }
    } else if (rolling52OverlayMetric === 'usd') {
        if (btnOvUsd) { btnOvUsd.style.background = '#1f2328'; btnOvUsd.style.color = 'white'; }
    } else {
        if (btnOvPct) { btnOvPct.style.background = '#1f2328'; btnOvPct.style.color = 'white'; }
    }

    // Update Overlay Legend values
    const legCurrentVal = document.getElementById('r52-legend-current-val');
    const legBestVal = document.getElementById('r52-legend-best-val');
    const legWorstVal = document.getElementById('r52-legend-worst-val');
    const legSpreadVal = document.getElementById('r52-legend-spread-val');

    if (rolling52OverlayMetric === 'cad') {
        const curGain = current ? current.gainCAD : 0;
        const bestGain = best.gainCAD;
        const worstGain = worst.gainCAD;
        const spreadGain = bestGain - worstGain;
        if (legCurrentVal) legCurrentVal.textContent = `${signOf(curGain)}${formatCurrency(curGain, 'CAD')}`;
        if (legBestVal) legBestVal.textContent = `${signOf(bestGain)}${formatCurrency(bestGain, 'CAD')}`;
        if (legWorstVal) legWorstVal.textContent = `${signOf(worstGain)}${formatCurrency(worstGain, 'CAD')}`;
        if (legSpreadVal) legSpreadVal.textContent = `${signOf(spreadGain)}${formatCurrency(spreadGain, 'CAD')}`;
    } else if (rolling52OverlayMetric === 'usd') {
        const curGain = current ? current.gainUSD : 0;
        const bestGain = best.gainUSD;
        const worstGain = worst.gainUSD;
        const spreadGain = bestGain - worstGain;
        if (legCurrentVal) legCurrentVal.textContent = `${signOf(curGain)}${formatCurrency(curGain, 'USD')}`;
        if (legBestVal) legBestVal.textContent = `${signOf(bestGain)}${formatCurrency(bestGain, 'USD')}`;
        if (legWorstVal) legWorstVal.textContent = `${signOf(worstGain)}${formatCurrency(worstGain, 'USD')}`;
        if (legSpreadVal) legSpreadVal.textContent = `${signOf(spreadGain)}${formatCurrency(spreadGain, 'USD')}`;
    } else {
        const currentReturnPct = current ? (currency === 'USD' ? current.pctUSD : current.pctCAD) : 0;
        const bestReturnPct = currency === 'USD' ? best.pctUSD : best.pctCAD;
        const worstReturnPct = currency === 'USD' ? worst.pctUSD : worst.pctCAD;
        const spreadPct = bestReturnPct - worstReturnPct;
        if (legCurrentVal) legCurrentVal.textContent = `${signOf(currentReturnPct)}${currentReturnPct.toFixed(2)}%`;
        if (legBestVal) legBestVal.textContent = `${signOf(bestReturnPct)}${bestReturnPct.toFixed(2)}%`;
        if (legWorstVal) legWorstVal.textContent = `${signOf(worstReturnPct)}${worstReturnPct.toFixed(2)}%`;
        if (legSpreadVal) legSpreadVal.textContent = `+${spreadPct.toFixed(2)}%`;
    }

    const legOverlapBadge = document.getElementById('r52-legend-overlap-badge');
    if (legOverlapBadge) {
        if (current && worst && current.startWeek === worst.startWeek && current.endWeek === worst.endWeek) {
            legOverlapBadge.style.display = 'inline-flex';
            legOverlapBadge.innerHTML = `ℹ️ Current 52W coincides with Worst 52W (Weeks ${worst.startWeek}–${worst.endWeek})`;
        } else if (current && best && current.startWeek === best.startWeek && current.endWeek === best.endWeek) {
            legOverlapBadge.style.display = 'inline-flex';
            legOverlapBadge.innerHTML = `ℹ️ Current 52W coincides with Best 52W (Weeks ${best.startWeek}–${best.endWeek})`;
        } else {
            legOverlapBadge.style.display = 'none';
        }
    }

    // Render Overlay SVG Chart
    renderRolling52OverlayChart(best, worst, current, currency, rolling52ViewMode, rolling52OverlayMetric);

    // Render Continuous Rolling 52-Week Trailing Returns Timeline Chart
    if (timeline && timeline.length > 0) {
        const descCountEl = document.getElementById('r52-timeline-window-count');
        if (descCountEl) descCountEl.textContent = timeline.length;
        renderRolling52TimelineChart(timeline, rolling52TimelineMetric, allBenchmarks);
    }
}

function renderRolling52OverlayChart(best, worst, current, currency = 'CAD', viewMode = 'both', overlayMetric = 'pct') {
    const box = document.getElementById('r52-overlay-svg-box');
    const container = document.getElementById('r52-overlay-container');
    const tooltip = document.getElementById('r52-overlay-tooltip');
    if (!box || !container || !best || !worst || !best.records || !worst.records) return;

    // Series of 53 points: index 0 is Week 0 (0%), index 1..52 is Week 1..52
    const bestSeries = buildRolling52OverlaySeries(best, overlayMetric, currency);
    const worstSeries = buildRolling52OverlaySeries(worst, overlayMetric, currency);
    const currentSeries = (current && current.records) ? buildRolling52OverlaySeries(current, overlayMetric, currency) : [];

    const showBest = true;
    const showWorst = true;
    const showCurrent = currentSeries.length > 0;

    let activePoints = [];
    if (showBest) activePoints = activePoints.concat(bestSeries.map(p => p.plotVal));
    if (showWorst) activePoints = activePoints.concat(worstSeries.map(p => p.plotVal));
    if (showCurrent) activePoints = activePoints.concat(currentSeries.map(p => p.plotVal));
    if (activePoints.length === 0) activePoints = [0];

    const minRaw = Math.min(...activePoints);
    const maxRaw = Math.max(...activePoints);

    let minY, maxY;
    if (overlayMetric === 'pct') {
        const minPct = Math.min(0, minRaw);
        const maxPct = Math.max(0, maxRaw);
        const range = maxPct - minPct || 10;
        minY = Math.floor((minPct - range * 0.08) / 5) * 5;
        maxY = Math.ceil((maxPct + range * 0.08) / 5) * 5;
    } else {
        const minDollar = Math.min(0, minRaw);
        const maxDollar = Math.max(0, maxRaw);
        const diff = maxDollar - minDollar || 10000;
        let step = 25000;
        if (diff <= 50000) step = 10000;
        else if (diff <= 100000) step = 20000;
        else if (diff <= 250000) step = 50000;
        else step = 100000;

        minY = minDollar < 0 ? Math.floor((minDollar - diff * 0.05) / step) * step : 0;
        maxY = Math.ceil((Math.max(maxDollar, 10000) * 1.10) / step) * step;
    }

    const rangeY = maxY - minY || 1;
    const width = 1000;
    const height = 250;
    const padding = { top: 20, right: 30, bottom: 35, left: overlayMetric === 'pct' ? 65 : 75 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const getX = (w) => padding.left + (w / 52) * plotW;
    const getY = (val) => padding.top + plotH - ((val - minY) / rangeY) * plotH;
    const clampedZeroY = Math.min(padding.top + plotH, Math.max(padding.top, getY(0)));

    // Y Gridlines
    const ySteps = 5;
    let gridLinesHtml = '';
    for (let i = 0; i <= ySteps; i++) {
        const val = minY + (i / ySteps) * rangeY;
        const y = getY(val);
        const isZero = Math.abs(val) < 0.01;
        const strokeColor = isZero ? '#64748b' : '#e2e8f0';
        const strokeWidth = isZero ? '1.5' : '1';
        const strokeDash = isZero ? '' : '3 3';
        let label = '';
        if (overlayMetric === 'pct') {
            label = Math.abs(val) < 0.001 ? '0%' : `${val > 0 ? '+' : ''}${val.toFixed(0)}%`;
        } else {
            const currSymbol = overlayMetric === 'usd' ? 'US$' : '$';
            const absK = Math.round(Math.abs(val) / 1000);
            if (Math.abs(val) < 100) {
                label = `${currSymbol}0`;
            } else if (val < 0) {
                label = `-${currSymbol}${absK}k`;
            } else {
                label = `+${currSymbol}${absK}k`;
            }
        }
        gridLinesHtml += `
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDash}" />
            <text x="${padding.left - 10}" y="${y + 4}" fill="${isZero ? '#1e293b' : '#8c959f'}" font-size="11" font-weight="${isZero ? '700' : '400'}" text-anchor="end">${label}</text>
        `;
    }

    // X Ticks (Weeks 0, 10, 20, 30, 40, 52)
    const xTicks = [0, 10, 20, 30, 40, 52];
    let xTicksHtml = '';
    xTicks.forEach(w => {
        const x = getX(w);
        const label = w === 0 ? 'W0 (Start)' : (w === 52 ? 'W52 (End)' : `Week ${w}`);
        xTicksHtml += `
            <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${padding.top + plotH}" stroke="#f1f5f9" stroke-width="1" />
            <text x="${x}" y="${height - 10}" fill="#64748b" font-size="11" font-weight="600" text-anchor="middle">${label}</text>
        `;
    });

    // Build Paths for Best
    const bestPoints = bestSeries.map(p => `${getX(p.weekIdx).toFixed(1)},${getY(p.plotVal).toFixed(1)}`);
    const bestLineD = 'M ' + bestPoints.join(' L ');
    const bestAreaD = `${bestLineD} L ${getX(52).toFixed(1)},${clampedZeroY.toFixed(1)} L ${getX(0).toFixed(1)},${clampedZeroY.toFixed(1)} Z`;

    // Build Paths for Worst (dashed so it remains distinguishable even if overlapping)
    const worstPoints = worstSeries.map(p => `${getX(p.weekIdx).toFixed(1)},${getY(p.plotVal).toFixed(1)}`);
    const worstLineD = 'M ' + worstPoints.join(' L ');
    const worstAreaD = `${worstLineD} L ${getX(52).toFixed(1)},${clampedZeroY.toFixed(1)} L ${getX(0).toFixed(1)},${clampedZeroY.toFixed(1)} Z`;

    // Build Paths for Current
    let currentLineD = '';
    let currentAreaD = '';
    if (currentSeries.length > 0) {
        const currentPoints = currentSeries.map(p => `${getX(p.weekIdx).toFixed(1)},${getY(p.plotVal).toFixed(1)}`);
        currentLineD = 'M ' + currentPoints.join(' L ');
        currentAreaD = `${currentLineD} L ${getX(52).toFixed(1)},${clampedZeroY.toFixed(1)} L ${getX(0).toFixed(1)},${clampedZeroY.toFixed(1)} Z`;
    }

    let pathsHtml = '';
    // Draw area fills first so lines are never obscured by fills
    if (showWorst) {
        pathsHtml += `
            <path d="${worstAreaD}" fill="url(#r52WorstGradient)" opacity="0.45" />
        `;
    }
    if (showCurrent && currentAreaD) {
        pathsHtml += `
            <path d="${currentAreaD}" fill="url(#r52CurrentGradient)" opacity="0.35" />
        `;
    }
    if (showBest) {
        pathsHtml += `
            <path d="${bestAreaD}" fill="url(#r52BestGradient)" opacity="0.55" />
        `;
    }

    // Line paths: Best (green), Current (solid blue), then Worst (dashed red on top)
    // When Current and Worst share the exact same historical period (e.g. Current IS the Worst 52W window),
    // drawing dashed red on top of solid blue creates an alternating red/blue dashed pattern so both are distinctly visible!
    if (showBest) {
        pathsHtml += `
            <path d="${bestLineD}" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        `;
    }
    if (showCurrent && currentLineD) {
        pathsHtml += `
            <path d="${currentLineD}" fill="none" stroke="#0969da" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        `;
    }
    if (showWorst) {
        pathsHtml += `
            <path d="${worstLineD}" fill="none" stroke="#cf222e" stroke-width="2.5" stroke-dasharray="6,6" stroke-linecap="round" stroke-linejoin="round" />
        `;
    }

    const svg = `
        <svg viewBox="0 0 ${width} ${height}" class="svg-chart" style="width: 100%; max-height: 260px; display: block; overflow: visible;">
            <defs>
                <linearGradient id="r52BestGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#16a34a" stop-opacity="0.20" />
                    <stop offset="100%" stop-color="#16a34a" stop-opacity="0.0" />
                </linearGradient>
                <linearGradient id="r52WorstGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#cf222e" stop-opacity="0.15" />
                    <stop offset="100%" stop-color="#cf222e" stop-opacity="0.0" />
                </linearGradient>
                <linearGradient id="r52CurrentGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#0969da" stop-opacity="0.22" />
                    <stop offset="100%" stop-color="#0969da" stop-opacity="0.0" />
                </linearGradient>
            </defs>
            ${gridLinesHtml}
            ${xTicksHtml}
            ${pathsHtml}
            <!-- Vertical Crosshair Line -->
            <line id="r52-cursor-line" x1="0" y1="${padding.top}" x2="0" y2="${padding.top + plotH}" stroke="#475569" stroke-width="1.5" stroke-dasharray="3,3" style="display: none; pointer-events: none;" />
            <!-- Worst Hover Dot (rendered first so inner dot sits on top if overlapping) -->
            <circle id="r52-dot-worst" r="5" fill="#cf222e" stroke="#ffffff" stroke-width="2" style="display: none; pointer-events: none;" />
            <!-- Best Hover Dot -->
            <circle id="r52-dot-best" r="5" fill="#16a34a" stroke="#ffffff" stroke-width="2" style="display: none; pointer-events: none;" />
            <!-- Current Hover Dot -->
            <circle id="r52-dot-current" r="5" fill="#0969da" stroke="#ffffff" stroke-width="2" style="display: none; pointer-events: none;" />
            <!-- Mouse Tracking Overlay -->
            <rect id="r52-mouse-overlay" x="${padding.left}" y="${padding.top}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor: crosshair;" />
        </svg>
    `;

    box.innerHTML = svg;

    // Interactive Hover Tracking
    const svgEl = box.querySelector('svg');
    const overlay = box.querySelector('#r52-mouse-overlay');
    const cursor = box.querySelector('#r52-cursor-line');
    const dotCurrent = box.querySelector('#r52-dot-current');
    const dotBest = box.querySelector('#r52-dot-best');
    const dotWorst = box.querySelector('#r52-dot-worst');

    if (!svgEl || !overlay) return;

    overlay.addEventListener('mousemove', (e) => {
        const ctm = svgEl.getScreenCTM();
        if (!ctm) return;

        const pt = svgEl.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgP = pt.matrixTransform(ctm.inverse());
        const svgX = svgP.x;

        const clampedX = Math.max(padding.left, Math.min(padding.left + plotW, svgX));
        const fraction = (clampedX - padding.left) / plotW;
        const weekIdx = Math.round(fraction * 52);

        const bestPt = bestSeries[weekIdx];
        const worstPt = worstSeries[weekIdx];
        const currentPt = currentSeries[weekIdx];
        const posX = getX(weekIdx);

        if (cursor) {
            cursor.setAttribute('x1', posX);
            cursor.setAttribute('x2', posX);
            cursor.style.display = 'block';
        }

        const isCurrentWorstCoinciding = currentPt && worstPt && Math.abs(currentPt.plotVal - worstPt.plotVal) < 0.001;

        if (dotWorst && showWorst && worstPt) {
            dotWorst.setAttribute('cx', posX);
            dotWorst.setAttribute('cy', getY(worstPt.plotVal));
            dotWorst.setAttribute('r', isCurrentWorstCoinciding ? '6.5' : '5');
            dotWorst.style.display = 'block';
        } else if (dotWorst) {
            dotWorst.style.display = 'none';
        }

        if (dotCurrent && showCurrent && currentPt) {
            dotCurrent.setAttribute('cx', posX);
            dotCurrent.setAttribute('cy', getY(currentPt.plotVal));
            dotCurrent.setAttribute('r', isCurrentWorstCoinciding ? '3.5' : '5');
            dotCurrent.style.display = 'block';
        } else if (dotCurrent) {
            dotCurrent.style.display = 'none';
        }

        if (dotBest && showBest && bestPt) {
            dotBest.setAttribute('cx', posX);
            dotBest.setAttribute('cy', getY(bestPt.plotVal));
            dotBest.setAttribute('r', '5');
            dotBest.style.display = 'block';
        } else if (dotBest) {
            dotBest.style.display = 'none';
        }

        if (tooltip) {
            const containerRect = container.getBoundingClientRect();
            const dotScreenPt = svgEl.createSVGPoint();
            dotScreenPt.x = posX;
            const primaryVal = showCurrent && currentPt ? currentPt.plotVal : (showBest && bestPt ? bestPt.plotVal : (worstPt ? worstPt.plotVal : 0));
            dotScreenPt.y = getY(primaryVal);
            const dotScreen = dotScreenPt.matrixTransform(ctm);
            const localX = dotScreen.x - containerRect.left;
            const localY = dotScreen.y - containerRect.top;

            const tipWidth = 270;
            let tipLeft = localX - (tipWidth / 2);
            if (tipLeft < 10) tipLeft = 10;
            if (tipLeft + tipWidth > containerRect.width - 10) {
                tipLeft = containerRect.width - tipWidth - 10;
            }

            let tipTop = localY - 145;
            if (tipTop < 10) {
                tipTop = localY + 25;
            }

            tooltip.style.left = `${tipLeft}px`;
            tooltip.style.top = `${tipTop}px`;
            tooltip.style.display = 'block';

            const signOfVal = v => v >= 0 ? '+' : '';
            const fmtPrimary = (pt) => {
                if (!pt) return '';
                if (overlayMetric === 'cad') return `${signOfVal(pt.gainCAD)}${formatCurrency(pt.gainCAD, 'CAD')}`;
                if (overlayMetric === 'usd') return `${signOfVal(pt.gainUSD)}${formatCurrency(pt.gainUSD, 'USD')}`;
                return `${signOfVal(pt.pct)}${pt.pct.toFixed(2)}%`;
            };
            const fmtSecondary = (pt) => {
                if (!pt) return '';
                const wkInfo = pt.record ? ` &bull; W${pt.record.week}` : '';
                const dateInfo = pt.date ? ` (${formatDate(pt.date)})` : '';
                if (overlayMetric === 'cad') {
                    const s = pt.pctCAD >= 0 ? '+' : '';
                    return `${s}${pt.pctCAD.toFixed(2)}% &bull; Net Worth: ${formatCurrency(pt.valCAD, 'CAD')}${wkInfo}`;
                }
                if (overlayMetric === 'usd') {
                    const s = pt.pctUSD >= 0 ? '+' : '';
                    return `${s}${pt.pctUSD.toFixed(2)}% &bull; Net Worth: ${formatCurrency(pt.valUSD, 'USD')}${wkInfo}`;
                }
                return `${formatCurrency(pt.val, currency)}${wkInfo}${dateInfo}`;
            };

            let tipContent = '';
            if (weekIdx === 0) {
                const baseLabel = overlayMetric === 'cad' ? '+$0 CAD' : (overlayMetric === 'usd' ? '+US$0 USD' : '0.00%');
                tipContent = `
                    <div style="font-weight: 800; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px; margin-bottom: 6px;">
                        Week 0 &bull; Baseline Inception (${baseLabel})
                    </div>
                    <div style="font-size: 0.74rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 4px;">
                        ${showCurrent && currentPt ? `<div><span style="color: #60a5fa;">● Current 52W Start:</span> <strong>${formatCurrency(currentPt.val, currency)}</strong> (${formatDate(currentPt.date)})</div>` : ''}
                        ${showBest && bestPt ? `<div><span style="color: #4ade80;">● Best 52W Start:</span> <strong>${formatCurrency(bestPt.val, currency)}</strong> (${formatDate(bestPt.date)})</div>` : ''}
                        ${showWorst && worstPt ? `<div><span style="color: #f87171;">● Worst 52W Start:</span> <strong>${formatCurrency(worstPt.val, currency)}</strong> (${formatDate(worstPt.date)})</div>` : ''}
                    </div>
                `;
            } else {
                let spreadStr = '';
                if (bestPt && worstPt) {
                    if (overlayMetric === 'cad') {
                        const sp = bestPt.gainCAD - worstPt.gainCAD;
                        spreadStr = `${signOfVal(sp)}${formatCurrency(sp, 'CAD')}`;
                    } else if (overlayMetric === 'usd') {
                        const sp = bestPt.gainUSD - worstPt.gainUSD;
                        spreadStr = `${signOfVal(sp)}${formatCurrency(sp, 'USD')}`;
                    } else {
                        const sp = bestPt.pct - worstPt.pct;
                        spreadStr = `${signOfVal(sp)}${sp.toFixed(2)}%`;
                    }
                }

                tipContent = `
                    <div style="font-weight: 800; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px; margin-bottom: 6px;">
                        Elapsed Week ${weekIdx} of 52
                    </div>
                    ${showCurrent && currentPt ? `
                    <div style="margin-bottom: 5px;">
                        <div style="display: flex; justify-content: space-between; align-items: baseline;">
                            <span style="color: #60a5fa; font-weight: 700;">🔵 Current 52W:</span>
                            <strong style="color: #60a5fa; font-size: 0.95rem;">${fmtPrimary(currentPt)}</strong>
                        </div>
                        <div style="font-size: 0.71rem; color: #94a3b8;">${fmtSecondary(currentPt)}</div>
                    </div>` : ''}
                    ${showBest && bestPt ? `
                    <div style="margin-bottom: 5px;">
                        <div style="display: flex; justify-content: space-between; align-items: baseline;">
                            <span style="color: #4ade80; font-weight: 700;">🟢 Best 52W:</span>
                            <strong style="color: #4ade80; font-size: 0.95rem;">${fmtPrimary(bestPt)}</strong>
                        </div>
                        <div style="font-size: 0.71rem; color: #94a3b8;">${fmtSecondary(bestPt)}</div>
                    </div>` : ''}
                    ${showWorst && worstPt ? `
                    <div style="margin-bottom: 5px;">
                        <div style="display: flex; justify-content: space-between; align-items: baseline;">
                            <span style="color: #f87171; font-weight: 700;">🔴 Worst 52W:</span>
                            <strong style="color: #f87171; font-size: 0.95rem;">${fmtPrimary(worstPt)}</strong>
                        </div>
                        <div style="font-size: 0.71rem; color: #94a3b8;">${fmtSecondary(worstPt)}</div>
                    </div>` : ''}
                    ${showBest && showWorst && spreadStr ? `
                    <div style="border-top: 1px solid rgba(255,255,255,0.15); padding-top: 4px; margin-top: 4px; display: flex; justify-content: space-between; align-items: baseline; font-size: 0.76rem;">
                        <span style="color: #c084fc; font-weight: 700;">⚡ Best/Worst Spread:</span>
                        <strong style="color: #c084fc;">${spreadStr}</strong>
                    </div>` : ''}
                `;
            }

            tooltip.innerHTML = tipContent;
        }
    });

    overlay.addEventListener('mouseleave', () => {
        if (cursor) cursor.style.display = 'none';
        if (dotCurrent) dotCurrent.style.display = 'none';
        if (dotBest) dotBest.style.display = 'none';
        if (dotWorst) dotWorst.style.display = 'none';
        if (tooltip) tooltip.style.display = 'none';
    });
}

function renderRolling52TimelineChart(timeline, metric = 'pct', benchmarksData = null) {
    const box = document.getElementById('r52-timeline-svg-box');
    const container = document.getElementById('r52-timeline-container');
    const tooltip = document.getElementById('r52-timeline-tooltip');
    if (!box || !container || !timeline || timeline.length === 0) return;

    // 1. Calculate values for the chosen metric (metric: 'pct' | 'cad' | 'usd')
    const N = timeline.length;
    const series = timeline.map((w, idx) => {
        let val = 0;
        if (metric === 'cad') val = w.gainCAD;
        else if (metric === 'usd') val = w.gainUSD;
        else val = w.pctCAD;
        return {
            index: idx,
            val,
            window: w,
            endWeek: w.endWeek,
            endDate: w.endDate,
            startDate: w.startDate,
            pctCAD: w.pctCAD,
            pctUSD: w.pctUSD,
            gainCAD: w.gainCAD,
            gainUSD: w.gainUSD,
            startValCAD: w.startValCAD,
            endValCAD: w.endValCAD,
            winRate: w.winRate,
            upWeeks: w.upWeeks,
            downWeeks: w.downWeeks
        };
    });

    // 1b. Calculate XEQT Benchmark Rolling 52W values
    const bData = benchmarksData || (typeof allBenchmarks !== 'undefined' ? allBenchmarks : null);
    const xeqtBenchmark = bData?.benchmarks?.XEQT;
    const xeqtPrices = xeqtBenchmark?.weeklyPrices || [];
    const hasXeqtData = xeqtPrices.length > 0;
    const liveXeqtPrice = xeqtBenchmark?.currentPrice;

    const xeqtSeries = timeline.map((w, idx) => {
        let pct = 0;
        let pctUSD = 0;
        if (hasXeqtData) {
            // A rolling 52-week period spans 52 elapsed weeks between the baseline before the window and the window end.
            // For idx > 0, the baseline is at idx - 1, and the window end is at idx + 51: (idx + 51) - (idx - 1) = 52 weeks.
            // For idx = 0, the window spans records 0 to 51 (from inception baseline).
            const startIdx = idx > 0 ? (idx - 1) : 0;
            const endIdx = idx + 51;

            const pStart = xeqtPrices[Math.min(xeqtPrices.length - 1, startIdx)] || xeqtPrices[0];
            let pEnd = xeqtPrices[Math.min(xeqtPrices.length - 1, endIdx)];

            // If this is the latest window and a live market price is available, use it for the ending price
            if (idx === timeline.length - 1 && liveXeqtPrice != null && liveXeqtPrice > 0) {
                pEnd = liveXeqtPrice;
            }

            pct = pStart > 0 ? ((pEnd - pStart) / pStart) * 100 : 0;

            // In USD mode, convert XEQT return using USD/CAD exchange rates at start and end of the 52W window
            if (metric === 'usd') {
                const rStart = (idx > 0 && allHistory && allHistory[idx - 1]) ? allHistory[idx - 1] : (allHistory && allHistory[0]);
                const rEnd = (allHistory && allHistory[idx + 51]) ? allHistory[idx + 51] : (allHistory && allHistory[allHistory.length - 1]);
                const rateStart = (rStart && rStart.totalCAD && rStart.totalUSD) ? (rStart.totalUSD / rStart.totalCAD) : 1;
                const rateEnd = (rEnd && rEnd.totalCAD && rEnd.totalUSD) ? (rEnd.totalUSD / rEnd.totalCAD) : 1;
                const pStartUSD = pStart * rateStart;
                const pEndUSD = pEnd * rateEnd;
                pctUSD = pStartUSD > 0 ? ((pEndUSD - pStartUSD) / pStartUSD) * 100 : pct;
            }
        } else {
            const totalRet = xeqtBenchmark?.returnPct !== undefined ? xeqtBenchmark.returnPct : 43.81;
            pct = totalRet / (Math.max(1, allHistory.length) / 52.14);
            pctUSD = pct;
        }

        let val = pct;
        if (metric === 'cad') val = w.startValCAD * (pct / 100);
        else if (metric === 'usd') val = w.startValUSD * (pctUSD / 100);

        return {
            index: idx,
            pct: Number((metric === 'usd' ? pctUSD : pct).toFixed(2)),
            val: Number(val.toFixed(2))
        };
    });

    const values = series.map(d => d.val);
    const sumVal = values.reduce((a, b) => a + b, 0);
    const avgVal = sumVal / N;
    let minItem = series[0];
    let maxItem = series[0];
    series.forEach(d => {
        if (d.val < minItem.val) minItem = d;
        if (d.val > maxItem.val) maxItem = d;
    });
    const currentItem = series[series.length - 1];

    const xeqtValues = xeqtSeries.map(d => d.val);
    const avgXeqtVal = xeqtValues.length > 0 ? (xeqtValues.reduce((a, b) => a + b, 0) / xeqtValues.length) : 0;

    // Helper formatters
    const signOf = v => v >= 0 ? '+' : '';
    const formatMetricVal = (v) => {
        if (metric === 'pct') return `${signOf(v)}${v.toFixed(1)}%`;
        if (metric === 'cad') return `${signOf(v)}${formatCurrency(v, 'CAD')}`;
        return `${signOf(v)}${formatCurrency(v, 'USD')}`;
    };

    // Update Banner Stats
    const statAvg = document.getElementById('r52-timeline-stat-avg');
    const statPeak = document.getElementById('r52-timeline-stat-peak');
    const statLow = document.getElementById('r52-timeline-stat-low');
    const statCurrent = document.getElementById('r52-timeline-stat-current');
    const statXeqtAvg = document.getElementById('r52-timeline-stat-xeqt-avg');
    const statSpread = document.getElementById('r52-timeline-stat-spread');
    const spreadWrap = document.getElementById('r52-timeline-stat-spread-wrap');

    if (statAvg) statAvg.textContent = formatMetricVal(avgVal);
    if (statPeak) statPeak.textContent = `${formatMetricVal(maxItem.val)} (W${maxItem.endWeek})`;
    if (statLow) statLow.textContent = `${formatMetricVal(minItem.val)} (W${minItem.endWeek})`;
    if (statCurrent) statCurrent.textContent = `${formatMetricVal(currentItem.val)} (W${currentItem.endWeek})`;
    if (statXeqtAvg) statXeqtAvg.textContent = formatMetricVal(avgXeqtVal);

    if (statSpread) {
        const spread = avgVal - avgXeqtVal;
        statSpread.textContent = `${signOf(spread)}${metric === 'pct' ? spread.toFixed(1) + '%' : formatCurrency(spread, metric === 'usd' ? 'USD' : 'CAD')}`;
        if (spreadWrap) {
            spreadWrap.style.color = spread >= 0 ? '#15803d' : '#b91c1c';
            spreadWrap.style.background = spread >= 0 ? '#dcfce7' : '#fee2e2';
        }
    }

    // 2. Chart Dimensions & Scales
    const width = 1000;
    const height = 260;
    const padding = { top: 25, right: 35, bottom: 35, left: metric === 'pct' ? 55 : 75 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const activeVals = rolling52ShowXeqt ? values.concat(xeqtValues) : values;
    const minRaw = Math.min(...activeVals);
    const maxRaw = Math.max(...activeVals);

    let minY, maxY;
    if (metric === 'pct') {
        minY = minRaw < 0 ? Math.floor(minRaw / 10) * 10 : 0;
        maxY = Math.ceil((Math.max(maxRaw, 10) * 1.15) / 10) * 10;
    } else {
        const minDollar = Math.min(0, minRaw);
        const maxDollar = Math.max(0, maxRaw);
        const diff = maxDollar - minDollar || 10000;
        let step = 25000;
        if (diff <= 50000) step = 10000;
        else if (diff <= 100000) step = 20000;
        else if (diff <= 250000) step = 50000;
        else step = 100000;

        minY = minDollar < 0 ? Math.floor(minDollar / step) * step : 0;
        maxY = Math.ceil((Math.max(maxDollar, 10000) * 1.12) / step) * step;
    }

    const rangeY = maxY - minY || 1;
    const getX = (i) => padding.left + (i / (N - 1 || 1)) * plotW;
    const getY = (v) => padding.top + plotH - ((v - minY) / rangeY) * plotH;
    const zeroY = getY(0);
    const clampedZeroY = Math.min(padding.top + plotH, Math.max(padding.top, zeroY));

    // 3. Gridlines
    const ySteps = 5;
    let gridLinesHtml = '';
    for (let i = 0; i <= ySteps; i++) {
        const val = minY + (i / ySteps) * rangeY;
        const y = getY(val);
        const isZero = Math.abs(val) < 0.001;
        const strokeColor = isZero ? '#475569' : '#e2e8f0';
        const strokeWidth = isZero ? '1.5' : '1';
        const strokeDash = isZero ? '' : '3,3';
        let label = '';
        if (metric === 'pct') {
            label = `${val >= 0 ? '+' : ''}${val.toFixed(0)}%`;
        } else {
            const currSymbol = metric === 'usd' ? 'US$' : '$';
            const absK = Math.round(Math.abs(val) / 1000);
            if (Math.abs(val) < 100) {
                label = `${currSymbol}0`;
            } else if (val < 0) {
                label = `-${currSymbol}${absK}k`;
            } else {
                label = `+${currSymbol}${absK}k`;
            }
        }
        gridLinesHtml += `
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDash}" />
            <text x="${padding.left - 10}" y="${y + 4}" fill="${isZero ? '#1e293b' : '#8c959f'}" font-size="11" font-weight="${isZero ? '700' : '400'}" text-anchor="end">${label}</text>
        `;
    }

    // 4. X-Axis Ticks (Sample dates along timeline)
    const tickCount = Math.min(6, N);
    const tickIndices = [];
    for (let i = 0; i < tickCount; i++) {
        tickIndices.push(Math.round((i / (tickCount - 1)) * (N - 1)));
    }
    let xTicksHtml = '';
    const fmt = typeof formatDate === 'function' ? formatDate : (d => d);
    tickIndices.forEach(idx => {
        const item = series[idx];
        const x = getX(idx);
        const dateStr = item.endDate ? fmt(item.endDate) : `W${item.endWeek}`;
        xTicksHtml += `
            <line x1="${x}" y1="${padding.top + plotH}" x2="${x}" y2="${padding.top + plotH + 5}" stroke="#cbd5e1" stroke-width="1" />
            <text x="${x}" y="${height - 10}" fill="#64748b" font-size="11" font-weight="600" text-anchor="middle">${dateStr}</text>
        `;
    });

    // 5. Build Paths (Area & Line) for Portfolio
    const points = series.map(d => `${getX(d.index).toFixed(1)},${getY(d.val).toFixed(1)}`);
    const lineD = 'M ' + points.join(' L ');
    const areaD = `${lineD} L ${getX(N - 1).toFixed(1)},${clampedZeroY.toFixed(1)} L ${getX(0).toFixed(1)},${clampedZeroY.toFixed(1)} Z`;

    // Portfolio Average reference line
    const avgY = getY(avgVal);
    const avgLineHtml = `
        <line x1="${padding.left}" y1="${avgY}" x2="${width - padding.right}" y2="${avgY}" stroke="#0969da" stroke-width="1.75" stroke-dasharray="4,4" />
        <text x="${width - padding.right}" y="${avgY - 6}" fill="#0969da" font-size="11" font-weight="700" text-anchor="end">Portfolio Avg: ${formatMetricVal(avgVal)}</text>
    `;

    // 5b. Build Paths for XEQT Benchmark Overlay
    let xeqtHtml = '';
    if (rolling52ShowXeqt) {
        const xeqtPoints = xeqtSeries.map(d => `${getX(d.index).toFixed(1)},${getY(d.val).toFixed(1)}`);
        const xeqtLineD = 'M ' + xeqtPoints.join(' L ');
        const xeqtAreaD = `${xeqtLineD} L ${getX(N - 1).toFixed(1)},${clampedZeroY.toFixed(1)} L ${getX(0).toFixed(1)},${clampedZeroY.toFixed(1)} Z`;
        const avgXeqtY = getY(avgXeqtVal);

        xeqtHtml = `
            <!-- XEQT Area -->
            <path d="${xeqtAreaD}" fill="url(#r52XeqtGrad)" opacity="0.30" />
            <!-- XEQT Line -->
            <path d="${xeqtLineD}" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-dasharray="5,3" stroke-linecap="round" stroke-linejoin="round" />
            <!-- XEQT Average Reference Line -->
            <line x1="${padding.left}" y1="${avgXeqtY}" x2="${width - padding.right}" y2="${avgXeqtY}" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="3,3" />
            <text x="${padding.left + 8}" y="${avgXeqtY - 5}" fill="#16a34a" font-size="10.5" font-weight="700">XEQT Avg: ${formatMetricVal(avgXeqtVal)}</text>
        `;
    }

    // Peak, Trough & Current Marker Dots
    const peakX = getX(maxItem.index);
    const peakY = getY(maxItem.val);
    const lowX = getX(minItem.index);
    const lowY = getY(minItem.val);
    const curX = getX(currentItem.index);
    const curY = getY(currentItem.val);

    const markersHtml = `
        <!-- Peak Dot -->
        <circle cx="${peakX}" cy="${peakY}" r="5" fill="#16a34a" stroke="#ffffff" stroke-width="2">
            <title>Peak 52W: ${formatMetricVal(maxItem.val)} (Week ${maxItem.endWeek})</title>
        </circle>
        <!-- Lowest Dot -->
        <circle cx="${lowX}" cy="${lowY}" r="5" fill="#cf222e" stroke="#ffffff" stroke-width="2">
            <title>Lowest 52W: ${formatMetricVal(minItem.val)} (Week ${minItem.endWeek})</title>
        </circle>
        <!-- Current Dot -->
        <circle cx="${curX}" cy="${curY}" r="5.5" fill="#0969da" stroke="#ffffff" stroke-width="2.5">
            <title>Current 52W: ${formatMetricVal(currentItem.val)} (Week ${currentItem.endWeek})</title>
        </circle>
    `;

    const svg = `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%; display: block; overflow: visible;" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="r52TimelineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#0969da" stop-opacity="0.30" />
                    <stop offset="100%" stop-color="#0969da" stop-opacity="0.02" />
                </linearGradient>
                <linearGradient id="r52XeqtGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#16a34a" stop-opacity="0.25" />
                    <stop offset="100%" stop-color="#16a34a" stop-opacity="0.02" />
                </linearGradient>
            </defs>

            <!-- Gridlines & Ticks -->
            ${gridLinesHtml}
            ${xTicksHtml}

            <!-- Reference Lines -->
            ${avgLineHtml}

            <!-- XEQT Benchmark Overlay -->
            ${xeqtHtml}

            <!-- Portfolio Area & Line -->
            <path d="${areaD}" fill="url(#r52TimelineGrad)" />
            <path d="${lineD}" fill="none" stroke="#0969da" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

            <!-- Key Markers -->
            ${markersHtml}

            <!-- Crosshair Cursor -->
            <line id="r52-tl-cursor" x1="0" y1="${padding.top}" x2="0" y2="${padding.top + plotH}" stroke="#475569" stroke-width="1.5" stroke-dasharray="3,3" style="display: none; pointer-events: none;" />
            <circle id="r52-tl-dot" r="6" fill="#0969da" stroke="#ffffff" stroke-width="2.5" style="display: none; pointer-events: none;" />
            <circle id="r52-tl-xeqt-dot" r="5" fill="#16a34a" stroke="#ffffff" stroke-width="2" style="display: none; pointer-events: none;" />

            <!-- Mouse Overlay -->
            <rect id="r52-tl-mouse" x="${padding.left}" y="${padding.top}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor: crosshair;" />
        </svg>
    `;

    box.innerHTML = svg;

    // Interactive Hover Tracking
    const svgEl = box.querySelector('svg');
    const overlay = box.querySelector('#r52-tl-mouse');
    const cursor = box.querySelector('#r52-tl-cursor');
    const dot = box.querySelector('#r52-tl-dot');
    const dotXeqt = box.querySelector('#r52-tl-xeqt-dot');

    if (!svgEl || !overlay) return;

    overlay.addEventListener('mousemove', (e) => {
        const ctm = svgEl.getScreenCTM();
        if (!ctm) return;

        const pt = svgEl.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgP = pt.matrixTransform(ctm.inverse());
        const svgX = svgP.x;

        const clampedX = Math.max(padding.left, Math.min(padding.left + plotW, svgX));
        const fraction = (clampedX - padding.left) / plotW;
        const idx = Math.max(0, Math.min(N - 1, Math.round(fraction * (N - 1))));
        const item = series[idx];
        const xeqtItem = xeqtSeries[idx];
        const posX = getX(idx);
        const posY = getY(item.val);
        const posYXeqt = xeqtItem ? getY(xeqtItem.val) : 0;

        if (cursor) {
            cursor.setAttribute('x1', posX);
            cursor.setAttribute('x2', posX);
            cursor.style.display = 'block';
        }
        if (dot) {
            dot.setAttribute('cx', posX);
            dot.setAttribute('cy', posY);
            dot.style.display = 'block';
        }
        if (dotXeqt && rolling52ShowXeqt && xeqtItem) {
            dotXeqt.setAttribute('cx', posX);
            dotXeqt.setAttribute('cy', posYXeqt);
            dotXeqt.style.display = 'block';
        } else if (dotXeqt) {
            dotXeqt.style.display = 'none';
        }

        if (tooltip) {
            const containerRect = container.getBoundingClientRect();
            let left = e.clientX - containerRect.left + 14;
            let top = e.clientY - containerRect.top - 20;

            if (left + 250 > containerRect.width) {
                left = left - 270;
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${Math.max(10, top)}px`;
            tooltip.style.display = 'block';

            const signPct = item.pctCAD >= 0 ? '+' : '';
            const signCad = item.gainCAD >= 0 ? '+' : '';
            const signUsd = item.gainUSD >= 0 ? '+' : '';
            const isPeak = item.endWeek === maxItem.endWeek;
            const isLowest = item.endWeek === minItem.endWeek;
            const isLatest = idx === N - 1;

            let tag = '';
            if (isPeak) tag = '<span style="background: #16a34a; color: white; padding: 1px 6px; border-radius: 4px; font-size: 0.65rem; margin-left: 6px;">PEAK 52W</span>';
            else if (isLowest) tag = '<span style="background: #cf222e; color: white; padding: 1px 6px; border-radius: 4px; font-size: 0.65rem; margin-left: 6px;">LOWEST 52W</span>';
            else if (isLatest) tag = '<span style="background: #0969da; color: white; padding: 1px 6px; border-radius: 4px; font-size: 0.65rem; margin-left: 6px;">CURRENT</span>';

            const diff = xeqtItem ? (item.val - xeqtItem.val) : 0;
            const signDiff = diff >= 0 ? '+' : '';

            const baselineDate = (item.window && item.window.startIndex > 0 && allHistory && allHistory[item.window.startIndex - 1])
                ? allHistory[item.window.startIndex - 1].date
                : item.startDate;

            tooltip.innerHTML = `
                <div style="font-weight: 800; font-size: 0.85rem; margin-bottom: 4px; display: flex; align-items: center;">
                    Week ${item.endWeek} Trailing 52W ${tag}
                </div>
                <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 8px;">
                    ${fmt(baselineDate)} &rarr; ${fmt(item.endDate)}
                </div>
                <div style="background: rgba(255,255,255,0.08); border-radius: 6px; padding: 6px 8px; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                        <span style="color: #60a5fa; font-weight: 700;">● Portfolio:</span>
                        <strong style="color: #60a5fa;">${formatMetricVal(item.val)}</strong>
                    </div>
                    ${rolling52ShowXeqt && xeqtItem ? `
                    <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                        <span style="color: #4ade80; font-weight: 700;">● XEQT:</span>
                        <strong style="color: #4ade80;">${formatMetricVal(xeqtItem.val)}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 3px; font-size: 0.75rem;">
                        <span style="color: #c084fc; font-weight: 700;">Outperformance:</span>
                        <strong style="color: ${diff >= 0 ? '#4ade80' : '#f87171'};">${signDiff}${metric === 'pct' ? diff.toFixed(1) + '%' : formatCurrency(diff, metric === 'usd' ? 'USD' : 'CAD')}</strong>
                    </div>
                    ` : ''}
                </div>
                <div style="background: rgba(255,255,255,0.04); border-radius: 6px; padding: 5px 8px; margin-bottom: 6px; font-size: 0.72rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                        <span style="color: #94a3b8;">Dollar Gain:</span>
                        <span style="color: #e2e8f0;">${signCad}${formatCurrency(item.gainCAD, 'CAD')} (${signUsd}${formatCurrency(item.gainUSD, 'USD')})</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #94a3b8;">Valuation:</span>
                        <span style="color: #e2e8f0;">${formatCurrency(item.startValCAD, 'CAD')} &rarr; ${formatCurrency(item.endValCAD, 'CAD')}</span>
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #94a3b8;">
                    <span>Consistency:</span>
                    <span style="color: #e2e8f0;">${item.upWeeks} up / ${item.downWeeks} down (${item.winRate.toFixed(1)}%)</span>
                </div>
            `;
        }
    });

    overlay.addEventListener('mouseleave', () => {
        if (cursor) cursor.style.display = 'none';
        if (dot) dot.style.display = 'none';
        if (dotXeqt) dotXeqt.style.display = 'none';
        if (tooltip) tooltip.style.display = 'none';
    });
}

function setDrawdownMode(mode) {
    drawdownMode = mode;
    const btnPct = document.getElementById('btn-dd-pct');
    const btnCad = document.getElementById('btn-dd-cad');
    if (mode === 'pct') {
        btnPct.style.background = '#1f2328';
        btnPct.style.color = '#fff';
        btnCad.style.background = '#fff';
        btnCad.style.color = '#24292f';
    } else {
        btnCad.style.background = '#1f2328';
        btnCad.style.color = '#fff';
        btnPct.style.background = '#fff';
        btnPct.style.color = '#24292f';
    }
    renderDrawdownChart();
}

function renderDrawdownChart() {
    const container = document.getElementById('drawdown-chart-container');
    const svgWrap = document.getElementById('drawdown-svg-wrap') || container;
    const tooltip = document.getElementById('drawdown-tooltip');
    if (!container || !svgWrap || !allHistory || allHistory.length === 0) return;
    svgWrap.innerHTML = '';

    // 1. Calculate Drawdown Metrics & Stats
    let maxDDRecord = allHistory[0];
    let maxDDPct = 0;
    let maxDDCAD = 0;

    let longestRecoveryWeeks = 0;
    let longestStart = '';
    let longestEnd = '';
    let currentStreak = 0;
    let currentStreakStart = '';

    allHistory.forEach((r, idx) => {
        const peak = r.runningPeakCAD || r.totalCAD;
        const ddCAD = r.drawdownCAD || (r.totalCAD - peak);
        const ddPct = peak > 0 ? (ddCAD / peak) * 100 : 0;

        if (ddCAD < maxDDCAD) {
            maxDDCAD = ddCAD;
            maxDDPct = ddPct;
            maxDDRecord = r;
        }

        // Recovery streak tracking
        if (ddCAD < 0) {
            if (currentStreak === 0) currentStreakStart = allHistory[Math.max(0, idx - 1)].date;
            currentStreak++;
            if (currentStreak > longestRecoveryWeeks) {
                longestRecoveryWeeks = currentStreak;
                longestStart = currentStreakStart;
                longestEnd = r.date;
            }
        } else {
            currentStreak = 0;
        }
    });

    const latest = allHistory[allHistory.length - 1];
    const currentPeak = latest.runningPeakCAD || latest.totalCAD;
    const currentDDCAD = latest.drawdownCAD || (latest.totalCAD - currentPeak);
    const currentDDPct = currentPeak > 0 ? (currentDDCAD / currentPeak) * 100 : 0;

    // Update Sub-cards
    document.getElementById('dd-stat-max').textContent = `${formatCurrency(maxDDCAD, 'CAD')} (${maxDDPct.toFixed(2)}%)`;
    document.getElementById('dd-stat-max-date').textContent = `Week ${maxDDRecord.week} (${maxDDRecord.date})`;

    const curStatEl = document.getElementById('dd-stat-current');
    const curStatusEl = document.getElementById('dd-stat-current-status');
    if (Math.abs(currentDDCAD) < 1) {
        curStatEl.textContent = '$0.00 (0.0%)';
        curStatEl.style.color = '#16a34a';
        curStatusEl.textContent = '🟢 At All-Time High';
        curStatusEl.style.color = '#15803d';
    } else {
        curStatEl.textContent = `${formatCurrency(currentDDCAD, 'CAD')} (${currentDDPct.toFixed(2)}%)`;
        curStatEl.style.color = '#dc2626';
        curStatusEl.textContent = `🔴 Down ${formatCurrency(Math.abs(currentDDCAD), 'CAD')} from ATH`;
        curStatusEl.style.color = '#b91c1c';
    }

    document.getElementById('dd-stat-longest-duration').textContent = `${longestRecoveryWeeks} weeks`;
    document.getElementById('dd-stat-longest-dates').textContent = longestStart ? `${longestStart} to ${longestEnd}` : 'Fast recoveries';

    // 2. SVG Geometry
    const width = container.clientWidth || 900;
    const height = 230;
    const padding = { top: 25, bottom: 35, left: 65, right: 20 };
    const chartWidth = Math.max(10, width - padding.left - padding.right);
    const chartHeight = height - padding.top - padding.bottom;

    const isPct = drawdownMode === 'pct';
    const minVal = isPct ? Math.min(maxDDPct * 1.15, -1) : Math.min(maxDDCAD * 1.15, -1000);

    function getY(val) {
        const fraction = val / minVal; // 0 to 1
        return padding.top + (fraction * chartHeight);
    }

    function getX(idx) {
        return padding.left + (idx * (chartWidth / (allHistory.length - 1)));
    }

    let svg = `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="display: block; width: 100%; height: 100%; overflow: visible; font-family: inherit;">`;

    // Linear gradient definition
    svg += `
        <defs>
            <linearGradient id="underwaterGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ef4444" stop-opacity="0.12"/>
                <stop offset="100%" stop-color="#b91c1c" stop-opacity="0.55"/>
            </linearGradient>
        </defs>
    `;

    // Horizontal grid lines
    const gridTicks = 4;
    for (let i = 0; i <= gridTicks; i++) {
        const tickVal = (minVal / gridTicks) * i;
        const tickY = getY(tickVal);
        const label = isPct ? `${tickVal.toFixed(1)}%` : formatCurrency(tickVal, 'CAD');
        svg += `
            <line x1="${padding.left}" y1="${tickY}" x2="${width - padding.right}" y2="${tickY}" stroke="#e2e8f0" stroke-width="${i === 0 ? '1.5' : '1'}" stroke-dasharray="${i === 0 ? '' : '3,3'}"/>
            <text x="${padding.left - 8}" y="${tickY + 4}" font-size="11" font-weight="${i === 0 ? '700' : '500'}" fill="${i === 0 ? '#1f2328' : '#64748b'}" text-anchor="end">${label}</text>
        `;
    }

    // Build Path Coordinates
    const points = allHistory.map((r, idx) => {
        const peak = r.runningPeakCAD || r.totalCAD;
        const ddCAD = r.drawdownCAD || (r.totalCAD - peak);
        const ddPct = peak > 0 ? (ddCAD / peak) * 100 : 0;
        const val = isPct ? ddPct : ddCAD;
        return { x: getX(idx), y: getY(val), r, val, ddCAD, ddPct, peak };
    });

    let pathD = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x},${points[i].y}`;
    }

    const areaD = `${pathD} L ${points[points.length - 1].x},${padding.top} L ${points[0].x},${padding.top} Z`;

    // Render Area & Stroke
    svg += `<path d="${areaD}" fill="url(#underwaterGrad)"/>`;
    svg += `<path d="${pathD}" fill="none" stroke="#dc2626" stroke-width="2" stroke-linejoin="round"/>`;

    // Top zero baseline
    svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${width - padding.right}" y2="${padding.top}" stroke="#475569" stroke-width="1.5"/>`;

    // Max Drawdown Point Marker
    const maxPt = points.reduce((min, p) => p.val < min.val ? p : min, points[0]);
    if (maxPt && maxPt.val < 0) {
        svg += `
            <circle cx="${maxPt.x}" cy="${maxPt.y}" r="5" fill="#b91c1c" stroke="#ffffff" stroke-width="2"/>
            <text x="${maxPt.x}" y="${Math.min(height - 10, maxPt.y + 16)}" font-size="10.5" font-weight="800" fill="#b91c1c" text-anchor="middle">
                ${isPct ? maxPt.ddPct.toFixed(1) + '%' : formatCurrency(maxPt.ddCAD, 'CAD')}
            </text>
        `;
    }

    // X-Axis Date Labels (sample 6 evenly spaced dates)
    const step = Math.floor(allHistory.length / 5);
    for (let i = 0; i < allHistory.length; i += step) {
        const pt = points[i];
        if (pt) {
            svg += `<text x="${pt.x}" y="${height - 8}" font-size="10.5" fill="#64748b" text-anchor="middle">${pt.r.date}</text>`;
        }
    }

    // Vertical Cursor line (hidden initially)
    svg += `<line id="dd-cursor-line" x1="0" y1="${padding.top}" x2="0" y2="${height - padding.bottom}" stroke="#475569" stroke-width="1.5" stroke-dasharray="3,3" style="display: none; pointer-events: none;"/>`;

    // Intersection hover dot on the curve
    svg += `<circle id="dd-hover-dot" r="5" fill="#dc2626" stroke="#ffffff" stroke-width="2" style="display: none; pointer-events: none;"/>`;

    // Transparent overlay rect for mouse tracking across the entire chart area
    svg += `<rect id="dd-overlay" x="0" y="0" width="${width}" height="${height}" fill="transparent" style="cursor: crosshair;"/>`;

    svg += `</svg>`;
    svgWrap.innerHTML = svg;

    // Interactive Hover Tracking
    const svgEl = svgWrap.querySelector('svg');
    const overlay = svgWrap.querySelector('#dd-overlay');
    const cursor = svgWrap.querySelector('#dd-cursor-line');
    const hoverDot = svgWrap.querySelector('#dd-hover-dot');

    if (!svgEl || !overlay) return;

    overlay.addEventListener('mousemove', (e) => {
        const ctm = svgEl.getScreenCTM();
        if (!ctm) return;

        // Convert mouse event client coordinates to SVG coordinate system
        const pt = svgEl.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgP = pt.matrixTransform(ctm.inverse());
        const svgX = svgP.x;

        const boundedX = Math.max(padding.left, Math.min(width - padding.right, svgX));

        let nearest = points[0];
        let minDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const dist = Math.abs(p.x - boundedX);
            if (dist < minDist) {
                minDist = dist;
                nearest = p;
            }
        }

        // Align dashed line and dot to the nearest data point
        if (cursor) {
            cursor.setAttribute('x1', nearest.x);
            cursor.setAttribute('x2', nearest.x);
            cursor.style.display = 'block';
        }

        if (hoverDot) {
            hoverDot.setAttribute('cx', nearest.x);
            hoverDot.setAttribute('cy', nearest.y);
            hoverDot.style.display = 'block';
        }

        // Position tooltip in container coordinates
        if (tooltip) {
            const dotPt = svgEl.createSVGPoint();
            dotPt.x = nearest.x;
            dotPt.y = nearest.y;
            const dotScreen = dotPt.matrixTransform(ctm);
            const containerRect = container.getBoundingClientRect();
            const localX = dotScreen.x - containerRect.left;
            const localY = dotScreen.y - containerRect.top;

            const tipWidth = 230;
            let tipLeft = localX - (tipWidth / 2);
            if (tipLeft < 10) tipLeft = 10;
            if (tipLeft + tipWidth > containerRect.width - 10) {
                tipLeft = containerRect.width - tipWidth - 10;
            }

            let tipTop = localY - 80;
            if (tipTop < 10) {
                tipTop = localY + 20;
            }

            tooltip.style.left = `${tipLeft}px`;
            tooltip.style.top = `${tipTop}px`;
            tooltip.style.display = 'block';

            const isPeak = Math.abs(nearest.ddCAD) < 1;
            tooltip.innerHTML = `
                <div style="font-weight: 800; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px; margin-bottom: 4px;">
                    Week ${nearest.r.week} &bull; ${nearest.r.date}
                </div>
                <div>Drawdown: <strong style="color: ${isPeak ? '#4ade80' : '#f87171'}">${isPeak ? '0.0% (At Peak)' : formatCurrency(nearest.ddCAD, 'CAD') + ' (' + nearest.ddPct.toFixed(2) + '%)'}</strong></div>
                <div>Net Worth: <strong>${formatCurrency(nearest.r.totalCAD, 'CAD')}</strong></div>
                <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">Running Peak: ${formatCurrency(nearest.peak, 'CAD')}</div>
            `;
        }
    });

    overlay.addEventListener('mouseleave', () => {
        if (cursor) cursor.style.display = 'none';
        if (hoverDot) hoverDot.style.display = 'none';
        if (tooltip) tooltip.style.display = 'none';
    });
}

function renderAnnualSummary() {
    const yearsMap = {};

    allHistory.forEach(r => {
        if (!r.date) return;
        const year = r.date.split('-')[0];
        if (!yearsMap[year]) {
            yearsMap[year] = { records: [], peak: 0, min: Infinity };
        }
        yearsMap[year].records.push(r);
        if (r.totalCAD > yearsMap[year].peak) yearsMap[year].peak = r.totalCAD;
        if (r.totalCAD < yearsMap[year].min) yearsMap[year].min = r.totalCAD;
    });

    const tbody = document.getElementById('annual-table-body');
    tbody.innerHTML = '';

    const years = Object.keys(yearsMap).sort((a, b) => b.localeCompare(a));

    years.forEach(year => {
        const group = yearsMap[year];
        const recs = group.records;
        const startVal = recs[0].totalCAD - (recs[0].weeklyChangeCAD || 0);
        const endVal = recs[recs.length - 1].totalCAD;
        const changeCAD = endVal - startVal;
        const changePct = startVal > 0 ? (changeCAD / startVal) * 100 : 0;

        let maxDrawdownCAD = 0;
        let maxDrawdownPct = 0;

        recs.forEach(r => {
            const ddCAD = r.drawdownCAD !== undefined && r.drawdownCAD !== null ? r.drawdownCAD : 0;
            const peak = r.runningPeakCAD || (r.totalCAD - ddCAD);
            const ddPct = peak > 0 ? (ddCAD / peak) * 100 : 0;

            if (ddCAD < maxDrawdownCAD) {
                maxDrawdownCAD = ddCAD;
            }
            if (ddPct < maxDrawdownPct) {
                maxDrawdownPct = ddPct;
            }
        });

        const sign = changeCAD >= 0 ? '+' : '';
        const color = changeCAD >= 0 ? '#1a7f37' : '#cf222e';
        const ddColor = maxDrawdownCAD < 0 ? '#cf222e' : '#1a7f37';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${year}</strong> (${recs.length} weeks)</td>
            <td style="text-align: right;">${formatCurrency(startVal, 'CAD')}</td>
            <td style="text-align: right; font-weight: 700;">${formatCurrency(endVal, 'CAD')}</td>
            <td style="text-align: right; font-weight: 700; color: ${color};">${sign}${formatCurrency(changeCAD, 'CAD')}</td>
            <td style="text-align: right; font-weight: 700; color: ${color};">${sign}${changePct.toFixed(2)}%</td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(group.peak, 'CAD')}</td>
            <td style="text-align: right; font-weight: 600; color: ${ddColor};">${formatCurrency(maxDrawdownCAD, 'CAD')}</td>
            <td style="text-align: right; font-weight: 700; color: ${ddColor};">${maxDrawdownPct.toFixed(2)}%</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderRiskAnalytics() {
    if (!allHistory || allHistory.length < 2) return;

    const returns = [];
    for (let i = 1; i < allHistory.length; i++) {
        const prev = allHistory[i - 1].totalCAD;
        const curr = allHistory[i].totalCAD;
        if (prev > 0) {
            returns.push((curr - prev) / prev);
        }
    }

    if (returns.length < 2) return;

    const meanWeeklyRet = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - meanWeeklyRet, 2), 0) / (returns.length - 1);
    const weeklyStdDev = Math.sqrt(variance);
    const annVolatility = weeklyStdDev * Math.sqrt(52);

    const costBasis = calculateHoldingsCostBasis(allHoldings);
    const marketRoi = costBasis.totalBookCostCAD > 0 ? (costBasis.totalMarketGainsCAD / costBasis.totalBookCostCAD) : 0;
    const years = (allHistory.length - 1) / 52;
    const cagr = years > 0 && marketRoi > -1 ? Math.pow(1 + marketRoi, 1 / years) - 1 : 0;

    const rf = 0.025; // 2.5% Canadian risk-free cash rate benchmark
    const sharpe = annVolatility > 0 ? (cagr - rf) / annVolatility : 0;

    const downsideSq = returns.reduce((s, r) => {
        const down = Math.min(0, r);
        return s + (down * down);
    }, 0);
    const downsideWeeklyStd = Math.sqrt(downsideSq / (returns.length - 1));
    const downsideAnnVol = downsideWeeklyStd * Math.sqrt(52);
    const sortino = downsideAnnVol > 0 ? (cagr - rf) / downsideAnnVol : 0;

    let maxDDPct = 0;
    allHistory.forEach(r => {
        const ddCAD = r.drawdownCAD !== undefined && r.drawdownCAD !== null ? r.drawdownCAD : 0;
        const peak = r.runningPeakCAD || (r.totalCAD - ddCAD);
        const pct = peak > 0 ? Math.abs(ddCAD / peak) : 0;
        if (pct > maxDDPct) maxDDPct = pct;
    });
    const calmar = maxDDPct > 0 ? cagr / maxDDPct : 0;

    document.getElementById('stat-risk-volatility').textContent = `${(annVolatility * 100).toFixed(1)}%`;
    document.getElementById('stat-risk-volatility-sub').textContent = `Weekly σ: ${(weeklyStdDev * 100).toFixed(2)}% | Market CAGR: ${(cagr * 100).toFixed(1)}%`;

    document.getElementById('stat-risk-sharpe').textContent = sharpe.toFixed(2);
    document.getElementById('stat-risk-sortino').textContent = sortino.toFixed(2);
    document.getElementById('stat-risk-calmar').textContent = calmar.toFixed(2);
}

function renderCrisisStressTest() {
    const container = document.getElementById('stress-test-cards');
    if (!container) return;
    container.innerHTML = '';

    const latest = allHistory[allHistory.length - 1];
    let totalCAD = latest ? latest.totalCAD : 0;

    let usVal = 0, canVal = 0, intlVal = 0, emVal = 0, fixedVal = 0, goldVal = 0, cryptoVal = 0;
    if (allHoldings && allHoldings.length > 0) {
        totalCAD = allHoldings.reduce((s, h) => s + (h.sum || 0), 0);
        allHoldings.forEach(h => {
            const a = h.allocation || {};
            usVal += a.us || 0;
            canVal += a.canada || 0;
            intlVal += a.developed || 0;
            emVal += a.emerging || 0;
            fixedVal += a.fixedIncome || 0;
            goldVal += a.preciousMetals || 0;
            cryptoVal += a.crypto || 0;
        });
    }

    if (totalCAD <= 0) return;

    const crises = [
        {
            title: '2008 Great Financial Crisis',
            period: '2007 - 2009 Subprime Collapse',
            desc: 'Global equity plunge with safe-haven flight into bonds and gold.',
            shocks: { us: -0.50, can: -0.45, intl: -0.52, em: -0.54, fixed: +0.08, gold: +0.25, crypto: -0.65 },
            recovery: '38 months to recover peak',
            color: '#dc2626'
        },
        {
            title: '2020 COVID Flash Crash',
            period: 'Feb - Mar 2020 Liquidity Shock',
            desc: 'Fastest 30% drop in history followed by rapid stimulus rebound.',
            shocks: { us: -0.34, can: -0.37, intl: -0.32, em: -0.31, fixed: +0.03, gold: +0.04, crypto: -0.45 },
            recovery: '6 months to recover peak',
            color: '#ea580c'
        },
        {
            title: '2022 Inflation & Rate Hike Shock',
            period: 'Jan - Oct 2022 Stagflation',
            desc: 'Simultaneous equity correction and rare bond duration drawdown.',
            shocks: { us: -0.19, can: -0.12, intl: -0.16, em: -0.22, fixed: -0.12, gold: -0.01, crypto: -0.65 },
            recovery: '14 months to recover peak',
            color: '#d97706'
        },
        {
            title: '2000 Dot-Com Tech Bubble',
            period: '2000 - 2002 Tech Deflation',
            desc: 'Severe tech and growth repricing; strong resilience in value and bonds.',
            shocks: { us: -0.45, can: -0.28, intl: -0.38, em: -0.35, fixed: +0.15, gold: +0.12, crypto: -0.50 },
            recovery: '48 months to recover peak',
            color: '#7c3aed'
        }
    ];

    crises.forEach(c => {
        const shockCAD = (
            (usVal * c.shocks.us) +
            (canVal * c.shocks.can) +
            (intlVal * c.shocks.intl) +
            (emVal * c.shocks.em) +
            (fixedVal * c.shocks.fixed) +
            (goldVal * c.shocks.gold) +
            (cryptoVal * c.shocks.crypto)
        );

        const shockPct = totalCAD > 0 ? (shockCAD / totalCAD) * 100 : 0;
        const postCrashCAD = Math.max(0, totalCAD + shockCAD);

        const card = document.createElement('div');
        card.style.background = '#ffffff';
        card.style.border = '1px solid #e2e8f0';
        card.style.borderLeft = `4px solid ${c.color}`;
        card.style.borderRadius = '8px';
        card.style.padding = '14px 16px';
        card.style.boxShadow = '0 2px 6px rgba(0,0,0,0.03)';

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                <div>
                    <strong style="font-size: 0.92rem; color: #1e293b;">${escapeHtml(c.title)}</strong>
                    <div style="font-size: 0.74rem; color: #64748b;">${escapeHtml(c.period)}</div>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 1.15rem; font-weight: 800; color: ${c.color};">${shockPct.toFixed(1)}%</span>
                </div>
            </div>
            <div style="font-size: 0.78rem; color: #475569; margin-bottom: 10px;">${escapeHtml(c.desc)}</div>
            <div style="background: #f8fafc; border-radius: 6px; padding: 8px 10px; font-size: 0.78rem; display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="color: #64748b;">Simulated Portfolio Impact:</span>
                <strong style="color: ${c.color};">${formatCurrency(shockCAD)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: #64748b;">
                <span>Trough Net Worth: <strong>${formatCurrency(postCrashCAD)}</strong></span>
                <span style="color: #0369a1; font-weight: 600;">⏳ ${escapeHtml(c.recovery)}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        initPerformance();
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateWeeklyStreaks,
        calculateLongestStreaksWithoutATH,
        formatStreakDates,
        computeRolling52Windows,
        calculatePurchasingPower,
        buildRolling52OverlaySeries
    };
}

