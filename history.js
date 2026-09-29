/**
 * Net Worth History Controller
 */

let allHistory = [];
let allHoldings = [];
let filteredHistory = [];
let allBenchmarks = null;
let showHistXeqtOverlay = false;

async function initHistory() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('history-content');
    const errorEl = document.getElementById('error');

    try {
        const [hist, h, benchmarks] = await Promise.all([
            getHistory(),
            getHoldings(),
            typeof getBenchmarks === 'function' ? getBenchmarks().catch(() => null) : Promise.resolve(null)
        ]);
        allHistory = hist || [];
        allHoldings = h || [];
        allBenchmarks = benchmarks;

        updateStatCards();
        applyHistoryFilter();

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initHistory());
            return;
        }
        console.error('Failed to initialize history:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error loading history records: ${err.message}`;
    }
}

function updateStatCards() {
    if (!allHistory || allHistory.length === 0) return;

    const latest = allHistory[allHistory.length - 1];
    const initial = allHistory[0];

    // Find peak
    let peakVal = 0;
    let peakDate = '';
    allHistory.forEach(r => {
        if (r.totalCAD >= peakVal) {
            peakVal = r.totalCAD;
            peakDate = r.date;
        }
    });

    const drawdownCAD = latest.totalCAD - peakVal;
    const drawdownPct = peakVal > 0 ? (drawdownCAD / peakVal) * 100 : 0;

    // Total Net Worth Growth
    // Compute current, baseline, unrealized gains, and contributions & realized growth
    const costBasis = calculateHoldingsCostBasis(allHoldings);
    const totalMarketGainsCAD = costBasis.totalMarketGainsCAD;
    const startingCAD = initial.totalCAD || 0;
    const currentCAD = (allHoldings && allHoldings.length > 0) ? costBasis.totalMarketCAD : latest.totalCAD;

    const totalGrowthCAD = currentCAD - startingCAD;
    const totalGrowthPct = startingCAD > 0 ? (totalGrowthCAD / startingCAD) * 100 : 0;
    const myContributionsCAD = Math.max(0, totalGrowthCAD - totalMarketGainsCAD);

    // 1. Current Net Worth
    document.getElementById('hist-current-cad').textContent = formatCurrency(currentCAD, 'CAD');
    document.getElementById('hist-current-usd').textContent = `≈ ${formatCurrency(latest.totalUSD, 'USD')}`;

    // 2. Starting Baseline
    const startEl = document.getElementById('hist-starting-cad');
    const startSubEl = document.getElementById('hist-starting-sub');
    if (startEl) {
        startEl.textContent = formatCurrency(startingCAD, 'CAD');
        const startPct = currentCAD > 0 ? (startingCAD / currentCAD) * 100 : 0;
        if (startSubEl) startSubEl.textContent = `Week 1 • ${startPct.toFixed(1)}% of NW`;
    }

    // 3. My Contributions
    const totalContribEl = document.getElementById('hist-total-contributions');
    const totalContribSubEl = document.getElementById('hist-total-contributions-sub');
    if (totalContribEl) {
        const cSign = myContributionsCAD >= 0 ? '+' : '';
        totalContribEl.textContent = `${cSign}${formatCurrency(myContributionsCAD, 'CAD')}`;
        const contribPct = currentCAD > 0 ? (myContributionsCAD / currentCAD) * 100 : 0;
        if (totalContribSubEl) {
            totalContribSubEl.textContent = `Added since W1 • ${contribPct.toFixed(1)}%`;
        }
    }

    // 4. Current Unrealized Gains
    const actualReturnEl = document.getElementById('hist-actual-return');
    const actualReturnPctEl = document.getElementById('hist-actual-return-pct');
    if (actualReturnEl) {
        const rSign = totalMarketGainsCAD >= 0 ? '+' : '';
        actualReturnEl.textContent = `${rSign}${formatCurrency(totalMarketGainsCAD, 'CAD')}`;
        actualReturnEl.style.color = totalMarketGainsCAD >= 0 ? '#16a34a' : '#cf222e';
        const gainPctOfNW = currentCAD > 0 ? (totalMarketGainsCAD / currentCAD) * 100 : 0;
        if (actualReturnPctEl) {
            actualReturnPctEl.textContent = `Open positions • ${gainPctOfNW.toFixed(1)}% of NW`;
        }
    }

    // 5. Total Net Worth Growth
    const totalGainEl = document.getElementById('hist-total-gain');
    const totalGainPctEl = document.getElementById('hist-total-gain-pct');
    if (totalGainEl) {
        const gSign = totalGrowthCAD >= 0 ? '+' : '';
        totalGainEl.textContent = `${gSign}${formatCurrency(totalGrowthCAD, 'CAD')}`;
        totalGainEl.style.color = totalGrowthCAD >= 0 ? '#0969da' : '#cf222e';
        if (totalGainPctEl) {
            totalGainPctEl.textContent = `${formatPercent(totalGrowthPct, true)} Growth (contributions + gains)`;
        }
    }

    // 6. Peak
    document.getElementById('hist-peak-cad').textContent = formatCurrency(peakVal, 'CAD');
    document.getElementById('hist-peak-date').textContent = `Peak on ${formatDate(peakDate)}`;

    // 7. Drawdown
    document.getElementById('hist-drawdown-cad').textContent = formatCurrency(drawdownCAD, 'CAD');
    document.getElementById('hist-drawdown-pct').textContent = `${drawdownPct.toFixed(2)}% from peak`;
    if (drawdownCAD < 0) {
        document.getElementById('hist-drawdown-cad').className = 'stat-number text-negative';
    } else {
        document.getElementById('hist-drawdown-cad').className = 'stat-number text-positive';
    }

    // 8. Total Weeks
    document.getElementById('hist-total-weeks').textContent = allHistory.length;
    document.getElementById('hist-start-date').textContent = `Since ${formatDate(initial.date)}`;

    // 9. Capital Decomposition Banner
    renderHistoryDecomposition(startingCAD, myContributionsCAD, totalMarketGainsCAD, currentCAD);

    // 10. Savings Velocity & Resilience (Features 2 & 7)
    renderSavingsVelocity(allHistory, startingCAD, currentCAD);
    renderResilienceMetrics(allHistory, currentCAD);
}

function renderSavingsVelocity(history, startingCAD, currentCAD) {
    const grid = document.getElementById('velocity-grid');
    const pill = document.getElementById('velocity-overall-pill');
    if (!grid || !history || history.length === 0) return;

    const years = [...new Set(history.map(r => r.date ? r.date.split('-')[0] : null).filter(Boolean))].sort();
    const currentYear = history[history.length - 1]?.date ? history[history.length - 1].date.split('-')[0] : new Date().getFullYear().toString();
    const yearData = [];

    const totalWeeks = history.length;
    const totalNetChange = currentCAD - startingCAD;
    const avgWeeklyNet = totalWeeks > 0 ? (totalNetChange / totalWeeks) : 0;
    const avgMonthlyNet = avgWeeklyNet * 4.3333;

    if (pill) {
        pill.textContent = `Average Velocity: +${formatCurrency(avgWeeklyNet, 'CAD')} / week (${formatCurrency(avgMonthlyNet, 'CAD')} / month)`;
    }

    let prevYearEndVal = startingCAD;

    years.forEach(yr => {
        const yrRecords = history.filter(r => r.date && r.date.startsWith(yr));
        if (yrRecords.length === 0) return;

        const weeksInYr = yrRecords.length;
        const yrStartVal = prevYearEndVal;
        const isCurrentYr = yr === currentYear;
        const yrEndVal = (isCurrentYr && currentCAD > 0) ? currentCAD : yrRecords[yrRecords.length - 1].totalCAD;
        const yrChange = yrEndVal - yrStartVal;
        const weeklyVel = weeksInYr > 0 ? (yrChange / weeksInYr) : 0;
        const monthlyVel = weeklyVel * 4.3333;
        const changePct = yrStartVal > 0 ? (yrChange / yrStartVal) * 100 : 0;

        prevYearEndVal = yrEndVal;

        const label = isCurrentYr ? `${yr} (YTD - ${weeksInYr} wks)` : `${yr} (${weeksInYr} wks)`;
        const sign = yrChange >= 0 ? '+' : '';
        const palette = ['#8250df', '#0969da', '#16a34a', '#d97706', '#dc2626'];
        const cardColor = palette[years.indexOf(yr) % palette.length];

        yearData.push({
            year: yr,
            label,
            change: yrChange,
            changePct,
            weeklyVel,
            monthlyVel,
            weeks: weeksInYr,
            sign,
            color: cardColor,
            endVal: yrEndVal
        });
    });

    grid.innerHTML = yearData.map(yd => `
        <div style="background: white; border-radius: 10px; padding: 16px 18px; border: 1px solid #edf2f7; border-top: 4px solid ${yd.color}; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 0.85rem; font-weight: 800; color: #1f2328;">${yd.label}</span>
                <span style="font-size: 0.75rem; font-weight: 700; color: ${yd.color}; background: ${yd.color}15; padding: 2px 8px; border-radius: 12px;">
                    ${yd.sign}${yd.changePct.toFixed(1)}%
                </span>
            </div>
            <div style="font-size: 1.35rem; font-weight: 800; color: ${yd.color}; margin-bottom: 4px;">
                ${yd.sign}${formatCurrency(yd.change, 'CAD')}
            </div>
            <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 12px;">
                Portfolio grew to ${formatCurrency(yd.endVal, 'CAD')}
            </div>
            <div style="border-top: 1px solid #f1f5f9; padding-top: 10px; display: flex; justify-content: space-between; font-size: 0.78rem;">
                <div>
                    <div style="color: #64748b; font-size: 0.7rem; text-transform: uppercase; font-weight: 700;">Weekly Pace</div>
                    <div style="font-weight: 700; color: #1f2328;">+${formatCurrency(yd.weeklyVel, 'CAD')}/wk</div>
                </div>
                <div style="text-align: right;">
                    <div style="color: #64748b; font-size: 0.7rem; text-transform: uppercase; font-weight: 700;">Monthly Pace</div>
                    <div style="font-weight: 700; color: #1f2328;">+${formatCurrency(yd.monthlyVel, 'CAD')}/mo</div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderResilienceMetrics(history, currentCAD) {
    if (!history || history.length === 0) return;

    let peak = 0;
    let peakIdx = 0;
    let maxDrawdownCAD = 0;
    let maxDrawdownPct = 0;
    let maxDrawdownDate = '';
    let longestTroughWeeks = 0;

    let currentPullbackStartIdx = -1;

    history.forEach((rec, idx) => {
        const val = rec.totalCAD;
        if (val >= peak) {
            if (currentPullbackStartIdx !== -1) {
                const duration = idx - currentPullbackStartIdx;
                if (duration > longestTroughWeeks) {
                    longestTroughWeeks = duration;
                }
                currentPullbackStartIdx = -1;
            }
            peak = val;
            peakIdx = idx;
        } else {
            if (currentPullbackStartIdx === -1) {
                currentPullbackStartIdx = peakIdx;
            }
            const dd = val - peak;
            const ddPct = (dd / peak) * 100;
            if (ddPct < maxDrawdownPct) {
                maxDrawdownPct = ddPct;
                maxDrawdownCAD = dd;
                maxDrawdownDate = rec.date;
            }
        }
    });

    const latest = history[history.length - 1];
    const liveVal = currentCAD > 0 ? currentCAD : latest.totalCAD;
    const currentDD = liveVal - peak;
    const currentDDPct = peak > 0 ? (currentDD / peak) * 100 : 0;

    const athPill = document.getElementById('resilience-ath-pill');
    const currDDEl = document.getElementById('resilience-current-dd');
    const currDDSubEl = document.getElementById('resilience-current-dd-sub');
    const maxDDEl = document.getElementById('resilience-max-dd');
    const maxDDSubEl = document.getElementById('resilience-max-dd-sub');
    const recoveryEl = document.getElementById('resilience-recovery-wks');

    if (currDDEl) {
        if (currentDDPct >= -0.01) {
            currDDEl.textContent = '0.00%';
            currDDEl.style.color = '#16a34a';
            if (currDDSubEl) {
                currDDSubEl.textContent = `At all-time high (${formatCurrency(peak, 'CAD')})`;
            }
            if (athPill) {
                athPill.innerHTML = '🟢 Sitting at All-Time Peak (0.00% Drawdown)';
                athPill.style.color = '#16a34a';
            }
        } else {
            currDDEl.textContent = `${currentDDPct.toFixed(2)}%`;
            currDDEl.style.color = '#cf222e';
            if (currDDSubEl) {
                currDDSubEl.textContent = `${formatCurrency(currentDD, 'CAD')} below ATH (${formatCurrency(peak, 'CAD')})`;
            }
            if (athPill) {
                athPill.innerHTML = `⚠️ ${currentDDPct.toFixed(2)}% below All-Time High`;
                athPill.style.color = '#cf222e';
            }
        }
    }

    if (maxDDEl) {
        maxDDEl.textContent = `${maxDrawdownPct.toFixed(2)}%`;
    }
    if (maxDDSubEl) {
        maxDDSubEl.textContent = `${formatCurrency(maxDrawdownCAD, 'CAD')} on ${formatDate(maxDrawdownDate)}`;
    }
    if (recoveryEl) {
        recoveryEl.textContent = `${longestTroughWeeks} weeks`;
    }
}

function renderHistoryDecomposition(startingCAD, savingsCAD, gainsCAD, currentCAD) {
    if (!currentCAD || currentCAD <= 0) return;

    const startingPct = Math.max(0, (startingCAD / currentCAD) * 100);
    const savingsPct = Math.max(0, (savingsCAD / currentCAD) * 100);
    const gainsPct = Math.max(0, (gainsCAD / currentCAD) * 100);

    const sumEl = document.getElementById('hist-decomp-summary');
    if (sumEl) {
        const sign = gainsCAD >= 0 ? '+' : '';
        sumEl.textContent = `Current Unrealized Gains: ${sign}${formatCurrency(gainsCAD, 'CAD')} (${gainsPct.toFixed(1)}% of net worth)`;
    }

    const startLbl = document.getElementById('hist-bar-label-starting');
    const saveLbl = document.getElementById('hist-bar-label-savings');
    const gainLbl = document.getElementById('hist-bar-label-gains');

    if (startLbl) startLbl.textContent = `■ Starting Baseline: ${formatCurrency(startingCAD, 'CAD')} (${startingPct.toFixed(1)}%)`;
    if (saveLbl) saveLbl.textContent = `■ Contributions & Realized: +${formatCurrency(savingsCAD, 'CAD')} (${savingsPct.toFixed(1)}%)`;
    if (gainLbl) gainLbl.textContent = `■ Current Unrealized Gains: +${formatCurrency(gainsCAD, 'CAD')} (${gainsPct.toFixed(1)}%)`;

    const startBar = document.getElementById('hist-bar-starting');
    const saveBar = document.getElementById('hist-bar-savings');
    const gainBar = document.getElementById('hist-bar-gains');

    if (startBar) startBar.style.width = `${startingPct}%`;
    if (saveBar) saveBar.style.width = `${savingsPct}%`;
    if (gainBar) gainBar.style.width = `${gainsPct}%`;
}

let currentChartRecords = [];

function applyHistoryFilter() {
    const timeframe = document.getElementById('timeframe-select').value;
    const currency = document.getElementById('currency-toggle').value;

    let records = [...allHistory];
    let chartRecords = [...allHistory];

    const latestRec = allHistory[allHistory.length - 1];
    const currentYear = latestRec?.date ? latestRec.date.split('-')[0] : new Date().getFullYear().toString();
    const effectiveTimeframe = timeframe === 'ytd' ? currentYear : timeframe;

    if (/^\d{4}$/.test(effectiveTimeframe)) {
        records = records.filter(r => r.date && r.date.startsWith(effectiveTimeframe));
        const firstIdx = allHistory.findIndex(r => r.date && r.date.startsWith(effectiveTimeframe));
        const lastIdx = allHistory.reduce((acc, r, i) => (r.date && r.date.startsWith(effectiveTimeframe)) ? i : acc, -1);
        if (firstIdx !== -1 && lastIdx !== -1) {
            const startIdx = firstIdx > 0 ? firstIdx - 1 : 0;
            chartRecords = allHistory.slice(startIdx, lastIdx + 1);
        } else {
            chartRecords = records;
        }
    } else if (timeframe === 'last-52') {
        records = records.length > 52 ? records.slice(-53) : records;
        chartRecords = records;
    } else if (timeframe === 'last-26') {
        records = records.length > 26 ? records.slice(-27) : records;
        chartRecords = records;
    }

    filteredHistory = records;
    currentChartRecords = chartRecords;

    const subtitleEl = document.getElementById('chart-subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = `${chartRecords.length} data points`;
    }
    const countEl = document.getElementById('record-count');
    if (countEl) {
        countEl.textContent = `${records.length} entries`;
    }

    renderChart(chartRecords, currency);
    renderTable(records);
}

async function toggleHistXeqtOverlay(checked) {
    showHistXeqtOverlay = !!checked;
    if (showHistXeqtOverlay && (!allBenchmarks || !allBenchmarks.benchmarks)) {
        try {
            if (typeof getBenchmarks === 'function') {
                allBenchmarks = await getBenchmarks();
            }
        } catch (e) {
            console.warn('Could not load benchmarks:', e);
        }
    }
    const currency = document.getElementById('currency-toggle')?.value || 'CAD';
    renderChart(currentChartRecords && currentChartRecords.length > 0 ? currentChartRecords : filteredHistory, currency);
}

/* ================= Dynamic SVG Chart Renderer ================= */
function renderChart(records, currency = 'CAD') {
    const box = document.getElementById('chart-svg-box');
    const tooltip = document.getElementById('chart-tooltip');

    if (!records || records.length === 0) {
        box.innerHTML = '<p class="empty-state">No data available for this timeframe.</p>';
        return;
    }

    const xeqtBenchmark = allBenchmarks?.benchmarks?.XEQT;
    const xeqtPrices = xeqtBenchmark?.weeklyPrices || [];
    const currentXeqtPrice = xeqtBenchmark?.currentPrice;
    const showXeqt = showHistXeqtOverlay && xeqtPrices.length > 0;
    let xeqtSeries = [];
    if (showXeqt && typeof computeXeqtProgressionOverlay === 'function') {
        xeqtSeries = computeXeqtProgressionOverlay(records, allHistory, xeqtPrices, currency, currentXeqtPrice);
    }

    const width = 1000;
    const height = 230;
    const padding = { top: 18, right: 25, bottom: 35, left: 65 };

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const valKey = currency === 'USD' ? 'totalUSD' : 'totalCAD';

    const allChartVals = records.map(r => r[valKey]);
    if (showXeqt && xeqtSeries.length > 0) {
        allChartVals.push(...xeqtSeries.map(x => x.val));
    }

    // Min & Max Y
    let minVal = Math.min(...allChartVals);
    let maxVal = Math.max(...allChartVals);

    // Add 8% top and bottom padding on Y axis
    const range = maxVal - minVal || 10000;
    minVal = Math.floor(Math.max(0, minVal - range * 0.08) / 10000) * 10000;
    maxVal = Math.ceil((maxVal + range * 0.08) / 10000) * 10000;

    const getX = (idx) => padding.left + (idx / (records.length - 1 || 1)) * plotW;
    const getY = (val) => padding.top + plotH - ((val - minVal) / (maxVal - minVal)) * plotH;

    // Y Gridlines (4 steps)
    const ySteps = 4;
    let gridLinesHtml = '';
    for (let i = 0; i <= ySteps; i++) {
        const val = minVal + (i / ySteps) * (maxVal - minVal);
        const y = getY(val);
        const label = `$${(val / 1000).toFixed(0)}k`;
        gridLinesHtml += `
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="3 3" />
            <text x="${padding.left - 10}" y="${y + 4}" fill="#8c959f" font-size="11" text-anchor="end">${label}</text>
        `;
    }

    // X Date ticks (up to 7 evenly spaced ticks)
    let xTicksHtml = '';
    const numTicks = Math.min(records.length, 7);
    for (let i = 0; i < numTicks; i++) {
        const idx = Math.round((i / (numTicks - 1 || 1)) * (records.length - 1));
        const rec = records[idx];
        const x = getX(idx);
        const label = formatDate(rec.date);
        xTicksHtml += `
            <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${padding.top + plotH}" stroke="#f1f5f9" stroke-width="1" />
            <text x="${x}" y="${height - 10}" fill="#8c959f" font-size="11" text-anchor="middle">${label}</text>
        `;
    }

    // Main line path & area path
    const points = records.map((r, i) => `${getX(i).toFixed(1)},${getY(r[valKey]).toFixed(1)}`);
    const linePathD = 'M ' + points.join(' L ');
    const areaPathD = `${linePathD} L ${getX(records.length - 1).toFixed(1)},${padding.top + plotH} L ${getX(0).toFixed(1)},${padding.top + plotH} Z`;

    // Interactive hover points
    const hoverPointsHtml = records.map((r, i) => {
        const cx = getX(i).toFixed(1);
        const cy = getY(r[valKey]).toFixed(1);
        return `
            <circle class="chart-point" data-idx="${i}" cx="${cx}" cy="${cy}" r="4" fill="#0969da" stroke="#ffffff" stroke-width="2" style="cursor: pointer;" />
        `;
    }).join('');

    // XEQT Benchmark line and points
    let xeqtPathHtml = '';
    let xeqtPointsHtml = '';
    if (showXeqt && xeqtSeries.length > 0) {
        const xeqtPoints = xeqtSeries.map((x, i) => `${getX(i).toFixed(1)},${getY(x.val).toFixed(1)}`);
        const xeqtLineD = 'M ' + xeqtPoints.join(' L ');
        xeqtPathHtml = `
            <path d="${xeqtLineD}" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" />
        `;
        xeqtPointsHtml = xeqtSeries.map((x, i) => {
            const cx = getX(i).toFixed(1);
            const cy = getY(x.val).toFixed(1);
            return `
                <circle class="hist-xeqt-point" data-idx="${i}" cx="${cx}" cy="${cy}" r="3.2" fill="#ffffff" stroke="#16a34a" stroke-width="1.8" style="cursor: pointer;" />
            `;
        }).join('');
    }

    const svg = `
        <svg viewBox="0 0 ${width} ${height}" class="svg-chart" id="networth-svg" style="width: 100%; max-height: 250px; display: block;">
            <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#0969da" stop-opacity="0.28" />
                    <stop offset="100%" stop-color="#0969da" stop-opacity="0.0" />
                </linearGradient>
            </defs>

            <!-- Grid & Ticks -->
            ${gridLinesHtml}
            ${xTicksHtml}

            <!-- Area & Line -->
            <path d="${areaPathD}" fill="url(#areaGradient)" />
            <path d="${linePathD}" fill="none" stroke="#0969da" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            ${xeqtPathHtml}

            <!-- Hover Interaction Points -->
            ${hoverPointsHtml}
            ${xeqtPointsHtml}
        </svg>
    `;

    box.innerHTML = svg;

    // Update legend
    const legendEl = document.getElementById('chart-legend');
    if (legendEl) {
        if (showXeqt && xeqtSeries.length > 0) {
            const startVal = records[0][valKey];
            const lastItem = xeqtSeries[xeqtSeries.length - 1];
            const spreadSign = lastItem.spreadVal >= 0 ? '+' : '';
            const spreadColor = lastItem.spreadVal >= 0 ? '#16a34a' : '#cf222e';
            const spreadBg = lastItem.spreadVal >= 0 ? 'rgba(22, 163, 74, 0.1)' : 'rgba(207, 34, 46, 0.1)';
            legendEl.innerHTML = `
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span class="legend-dot" style="display: inline-block; width: 12px; height: 3px; background: #0969da; border-radius: 2px;"></span>
                    <strong style="color: #1f2328;">Total Net Worth (Portfolio)</strong>
                </div>
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 16px; height: 0; border-top: 2.5px dashed #16a34a;"></span>
                    <strong style="color: #16a34a;">XEQT Benchmark</strong> (Simulated from ${formatCurrency(startVal, currency)})
                </div>
                <div style="font-size: 0.75rem; font-weight: 700; color: ${spreadColor}; background: ${spreadBg}; padding: 2px 8px; border-radius: 4px; border: 1px solid ${spreadColor}30;">
                    Spread: ${spreadSign}${formatCurrency(lastItem.spreadVal, currency)} (${spreadSign}${lastItem.spreadPct.toFixed(2)}%)
                </div>
            `;
        } else {
            legendEl.innerHTML = `
                <div class="legend-item"><span class="legend-dot" style="background: #0969da;"></span> Total Net Worth &bull; Hover any data point to inspect exact asset breakdown</div>
            `;
        }
    }

    // Attach hover listeners to circles
    const allInteractivePoints = box.querySelectorAll('.chart-point, .hist-xeqt-point');
    allInteractivePoints.forEach(circle => {
        circle.addEventListener('mouseenter', (e) => {
            const idx = parseInt(e.target.getAttribute('data-idx'), 10);
            const r = records[idx];

            const portPoint = box.querySelector(`.chart-point[data-idx="${idx}"]`);
            const xeqtPoint = box.querySelector(`.hist-xeqt-point[data-idx="${idx}"]`);

            if (portPoint) {
                portPoint.setAttribute('r', '7');
                portPoint.setAttribute('fill', '#054da7');
            }
            if (xeqtPoint) {
                xeqtPoint.setAttribute('r', '6');
                xeqtPoint.setAttribute('fill', '#16a34a');
                xeqtPoint.setAttribute('stroke', '#ffffff');
            }

            const dateStr = formatDate(r.date);
            const totalVal = formatCurrency(r[valKey], currency);
            const weeklyChangeStr = `${r.weeklyChangeCAD >= 0 ? '+' : ''}${formatCurrency(r.weeklyChangeCAD, 'CAD')} (${r.weeklyChangePct >= 0 ? '+' : ''}${r.weeklyChangePct.toFixed(2)}%)`;
            const changeColor = r.weeklyChangeCAD >= 0 ? '#3fb950' : '#f85149';

            let xeqtHtml = '';
            if (showXeqt && xeqtSeries[idx]) {
                const x = xeqtSeries[idx];
                const xeqtValStr = formatCurrency(x.val, currency);
                const xeqtRetStr = `${x.returnPct >= 0 ? '+' : ''}${x.returnPct.toFixed(2)}%`;
                const portRetStr = `${x.portfolioReturnPct >= 0 ? '+' : ''}${x.portfolioReturnPct.toFixed(2)}%`;
                const spreadSign = x.spreadVal >= 0 ? '+' : '';
                const spreadColor = x.spreadVal >= 0 ? '#3fb950' : '#f85149';
                const spreadValStr = `${spreadSign}${formatCurrency(x.spreadVal, currency)}`;
                const spreadPctStr = `${x.spreadPct >= 0 ? '+' : ''}${x.spreadPct.toFixed(2)}%`;

                xeqtHtml = `
                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.15);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                            <span style="color: #4ade80; font-weight: 700;">🟢 XEQT Benchmark:</span>
                            <strong style="color: #4ade80;">${xeqtValStr}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.74rem; color: #94a3b8; margin-bottom: 4px;">
                            <span>Return from Start:</span>
                            <span>Port: <strong style="color: #58a6ff;">${portRetStr}</strong> vs XEQT: <strong style="color: #4ade80;">${xeqtRetStr}</strong></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.76rem; font-weight: 700; color: ${spreadColor}; background: rgba(255,255,255,0.06); padding: 3px 6px; border-radius: 4px;">
                            <span>Outperformance Spread:</span>
                            <span>${spreadValStr} (${spreadPctStr})</span>
                        </div>
                    </div>
                `;
            }

            tooltip.innerHTML = `
                <div style="font-weight: 700; margin-bottom: 4px;">Week ${r.week} &bull; ${dateStr}</div>
                <div style="font-size: 1.1rem; font-weight: 800; color: #58a6ff;">${totalVal}</div>
                <div style="margin-top: 3px; font-size: 0.78rem; color: ${changeColor};">Weekly: ${weeklyChangeStr}</div>
                ${xeqtHtml}
                <div style="font-size: 0.74rem; color: #cbd5e1; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 4px;">
                    Stocks: ${formatCurrency(r.stocks)} &bull; Fixed: ${formatCurrency(r.fixed)}<br>
                    Metals: ${formatCurrency(r.preciousMetals)} &bull; Crypto: ${formatCurrency(r.crypto)}
                </div>
            `;
            tooltip.style.display = 'block';

            // Positioning
            const parentRect = document.getElementById('chart-container').getBoundingClientRect();
            const targetCircle = portPoint || xeqtPoint || circle;
            const circleRect = targetCircle.getBoundingClientRect();
            let left = circleRect.left - parentRect.left + 12;
            let top = circleRect.top - parentRect.top - 70;

            if (left + 220 > parentRect.width) {
                left -= 230;
            }
            if (top < 0) {
                top = circleRect.bottom - parentRect.top + 10;
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        });

        circle.addEventListener('mouseleave', (e) => {
            const idx = parseInt(e.target.getAttribute('data-idx'), 10);
            const portPoint = box.querySelector(`.chart-point[data-idx="${idx}"]`);
            const xeqtPoint = box.querySelector(`.hist-xeqt-point[data-idx="${idx}"]`);

            if (portPoint) {
                portPoint.setAttribute('r', '4');
                portPoint.setAttribute('fill', '#0969da');
            }
            if (xeqtPoint) {
                xeqtPoint.setAttribute('r', '3.2');
                xeqtPoint.setAttribute('fill', '#ffffff');
                xeqtPoint.setAttribute('stroke', '#16a34a');
            }
            tooltip.style.display = 'none';
        });
    });
}

function renderTable(records) {
    const tbody = document.getElementById('history-tbody');

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" class="empty-state">No records match your selection.</td></tr>`;
        return;
    }

    // Default newest to oldest
    const sorted = [...records].reverse();

    tbody.innerHTML = sorted.map(r => {
        const weeklyClass = r.weeklyChangeCAD >= 0 ? 'text-positive' : 'text-negative';
        const weeklySign = r.weeklyChangeCAD > 0 ? '+' : '';
        const drawdownClass = r.drawdownCAD < 0 ? 'text-negative' : '';

        return `
            <tr>
                <td class="text-center font-bold">${r.week}</td>
                <td>${formatDate(r.date)}</td>
                <td class="text-right">${formatCurrency(r.stocks)}</td>
                <td class="text-right">${formatCurrency(r.fixed)}</td>
                <td class="text-right">${formatCurrency(r.preciousMetals)}</td>
                <td class="text-right">${formatCurrency(r.crypto)}</td>
                <td class="text-right font-bold" style="color: #0969da;">${formatCurrency(r.totalCAD)}</td>
                <td class="text-right">${formatCurrency(r.totalUSD, 'USD')}</td>
                <td class="text-right font-bold ${weeklyClass}">
                    ${weeklySign}${formatCurrency(r.weeklyChangeCAD)}
                </td>
                <td class="text-right font-bold ${weeklyClass}">
                    ${weeklySign}${r.weeklyChangePct.toFixed(2)}%
                </td>
                <td class="text-right">${formatCurrency(r.runningPeakCAD)}</td>
                <td class="text-right ${drawdownClass}">
                    ${formatCurrency(r.drawdownCAD)}
                </td>
            </tr>
        `;
    }).join('');
}

function exportHistoryCSV() {
    const header = ['Weeks', 'Date', 'Stocks', 'Fixed', 'Precious Metals', 'Crypto', 'Total CAD', 'Total USD', 'Weekly', 'Percentage', 'Running Peak CAD', 'Drawdown CAD'];
    const rows = filteredHistory.map(r => [
        r.week,
        r.date,
        `"${r.stocks.toFixed(2)}"`,
        `"${r.fixed.toFixed(2)}"`,
        `"${r.preciousMetals.toFixed(2)}"`,
        `"${r.crypto.toFixed(2)}"`,
        `"${r.totalCAD.toFixed(2)}"`,
        `"${r.totalUSD.toFixed(2)}"`,
        `"${r.weeklyChangeCAD.toFixed(2)}"`,
        r.weeklyChangePct.toFixed(2),
        `"${r.runningPeakCAD.toFixed(2)}"`,
        `"${r.drawdownCAD.toFixed(2)}"`
    ]);

    const csvContent = [header.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Net-Worth-History-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', initHistory);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        renderChart,
        toggleHistXeqtOverlay
    };
}
