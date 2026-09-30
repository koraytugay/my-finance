/**
 * Main Executive Dashboard Controller
 * Displays the 3 exact tables from the Google Sheets "Main" tab:
 * 1. Asset Class (Equities & Non-Equity Classes)
 * 2. Account Type (Non-Registered vs Registered) + Growth & Milestone Metrics
 * 3. Category (High-level asset categories)
 */
let rawHistory = [];
let rawBenchmarks = null;
let currentMainTimeframe = 'last-52';
let currentMainMode = 'single'; // 'single' | 'years'
let currentMainSingleTimeframe = 'last-52'; // 'last-52' | 'all'
let currentMainSelectedYears = new Set(); // Set of active year strings, e.g. Set(['2026', '2025'])
let currentMainCurrency = 'CAD';
let currentMainUnit = 'VAL'; // 'VAL' | 'PCT'
let currentMainOverlayXeqt = false;

async function initMain() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('main-content');
    const errorEl = document.getElementById('error');

    try {
        const [holdings, history, benchmarks] = await Promise.all([
            getHoldings(),
            getHistory(),
            typeof getBenchmarks === 'function' ? getBenchmarks().catch(() => null) : Promise.resolve(null)
        ]);

        rawHistory = history || [];
        rawBenchmarks = benchmarks;

        // Calculate all values dynamically from raw data (Holdings + Carry Over history)
        const mainData = calculateMainData(holdings, history);

        renderMainTopStats(mainData, holdings, history);
        syncMainTimeframeButtons(rawHistory);
        renderMainProgressionChart();
        renderAssetClassTable(mainData, holdings);
        renderAccountTypeTable(mainData, holdings, history);
        renderCategoryTable(mainData, holdings);
        renderPerformanceCards(mainData);

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initMain());
            return;
        }
        console.error('Failed to init Main dashboard:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error loading Main data: ${err.message}`;
    }
}

/**
 * Calculates the entire Main tab data directly from raw data (Holdings & Carry Over)
 * Does NOT require or depend on the Google Sheets "Main" tab.
 */
function calculateMainData(holdings, history) {
    let usStocks = 0, devStocks = 0, canStocks = 0, emStocks = 0;
    let fixed = 0, crypto = 0, metals = 0;
    let nonReg = 0, reg = 0;
    let totalCAD = 0;

    (holdings || []).forEach(h => {
        const sum = Number(h.sum) || 0;
        totalCAD += sum;
        const isReg = h.registered === true || h.registered === 1 || String(h.registered).toLowerCase() === 'true' || (h.account && /TFSA|RRSP|FHSA/i.test(h.account));
        if (isReg) reg += sum;
        else nonReg += sum;

        const a = h.allocation || {};
        usStocks += Number(a.us) || 0;
        devStocks += Number(a.developed) || 0;
        canStocks += Number(a.canada) || 0;
        emStocks += Number(a.emerging) || 0;
        fixed += Number(a.fixedIncome) || 0;
        crypto += Number(a.crypto) || 0;
        metals += Number(a.preciousMetals) || 0;
    });

    const totalStocks = usStocks + devStocks + canStocks + emStocks;

    // 1. Asset Class Breakdown
    const assetClasses = [
        { name: 'US Stocks', value: usStocks, percentage: totalStocks > 0 ? (usStocks / totalStocks * 100).toFixed(2) + '%' : '0.00%' },
        { name: 'Developed Markets', value: devStocks, percentage: totalStocks > 0 ? (devStocks / totalStocks * 100).toFixed(2) + '%' : '0.00%' },
        { name: 'Emerging Markets', value: emStocks, percentage: totalStocks > 0 ? (emStocks / totalStocks * 100).toFixed(2) + '%' : '0.00%' },
        { name: 'Canadian Stocks', value: canStocks, percentage: totalStocks > 0 ? (canStocks / totalStocks * 100).toFixed(2) + '%' : '0.00%' },
        { name: 'Fixed Income', value: fixed, percentage: '' },
        { name: 'Precious Metals', value: metals, percentage: '' },
        { name: 'Crypto', value: crypto, percentage: '' }
    ];

    // 2. Account Type Breakdown
    const accountTypes = [
        { name: 'Non-Registered', value: nonReg, percentage: totalCAD > 0 ? (nonReg / totalCAD * 100).toFixed(2) + '%' : '0.00%' },
        { name: 'Registered', value: reg, percentage: totalCAD > 0 ? (reg / totalCAD * 100).toFixed(2) + '%' : '0.00%' }
    ];

    // 3. Category Breakdown
    const categories = [
        { name: 'Stocks', value: totalStocks, percentage: totalCAD > 0 ? (totalStocks / totalCAD * 100).toFixed(2) + '%' : '0.00%' },
        { name: 'Fixed Income', value: fixed, percentage: totalCAD > 0 ? (fixed / totalCAD * 100).toFixed(2) + '%' : '0.00%' },
        { name: 'Precious Metals', value: metals, percentage: totalCAD > 0 ? (metals / totalCAD * 100).toFixed(2) + '%' : '0.00%' },
        { name: 'Crypto', value: crypto, percentage: totalCAD > 0 ? (crypto / totalCAD * 100).toFixed(2) + '%' : '0.00%' }
    ];

    // 4. 52-Week Performance & Milestone Metrics
    let lastYearVal = totalCAD;
    if (history && history.length > 0) {
        const latestRecord = history[history.length - 1];
        let record52w = null;

        // Match exact week 52 weeks prior
        if (latestRecord.week !== undefined) {
            record52w = history.find(r => r.week === latestRecord.week - 52);
        }

        // Fallback: 52 entries back by index
        if (!record52w && history.length > 52) {
            record52w = history[history.length - 1 - 52];
        }

        // Fallback: earliest recorded week
        if (!record52w) {
            record52w = history[0];
        }

        if (record52w) {
            lastYearVal = record52w.totalCAD || 0;
        }
    }

    let athVal = totalCAD;
    if (history && history.length > 0) {
        history.forEach(r => {
            if (r.totalCAD > athVal) athVal = r.totalCAD;
        });
    }

    const oneYearChangeCAD = totalCAD - lastYearVal;
    const oneYearReturnPct = lastYearVal > 0 ? (oneYearChangeCAD / lastYearVal * 100).toFixed(2) + '%' : '0.00%';
    const monthlyGainCAD = oneYearChangeCAD / 12;

    // Current Week Status (Cell F9 in Google Sheets Main Tab)
    let currentWeekChangeCAD = 0;
    let currentWeekChangePct = 0;
    let currentWeekNumber = '';
    let currentWeekDate = '';

    if (history && history.length > 0) {
        const latest = history[history.length - 1];
        currentWeekNumber = latest.week ? `Week ${latest.week}` : '';
        currentWeekDate = latest.date || '';

        const liveDiff = totalCAD - (latest.totalCAD || totalCAD);
        currentWeekChangeCAD = (latest.weeklyChangeCAD || 0) + liveDiff;
        const weekStartVal = (latest.totalCAD || totalCAD) - (latest.weeklyChangeCAD || 0);
        currentWeekChangePct = weekStartVal > 0 ? (currentWeekChangeCAD / weekStartVal) * 100 : (latest.weeklyChangePct || 0);
    }

    const isWeekUp = currentWeekChangeCAD >= 0;
    const currentWeek = {
        weekNumber: currentWeekNumber,
        date: currentWeekDate,
        changeCAD: currentWeekChangeCAD,
        changePct: currentWeekChangePct,
        isUp: isWeekUp,
        statusText: isWeekUp ? 'Up this week' : 'Down this week'
    };

    const metrics = {
        totalValue: totalCAD,
        lastYearValue: lastYearVal,
        costBasis: lastYearVal,
        oneYearReturnPct,
        gainPct: oneYearReturnPct,
        athValue: athVal,
        athStatus: totalCAD >= athVal ? 'ATH!' : formatCurrency(totalCAD - athVal, 'CAD'),
        oneYearChangeCAD,
        totalGainCAD: oneYearChangeCAD,
        monthlyGainCAD,
        currentWeek
    };

    // 5. Year to Date (YTD) Performance Tracking
    let currentYear = new Date().getFullYear();
    let currentMonth = new Date().getMonth() + 1;
    if (history && history.length > 0) {
        const latest = history[history.length - 1];
        if (latest.date) {
            const parts = latest.date.split('-');
            if (parts.length >= 2) {
                currentYear = parseInt(parts[0], 10);
                currentMonth = parseInt(parts[1], 10);
            }
        }
    }

    let ytdStartVal = totalCAD;
    if (history && history.length > 0) {
        const prevYearRecords = history.filter(r => r.date && r.date.startsWith(String(currentYear - 1)));
        if (prevYearRecords.length > 0) {
            ytdStartVal = prevYearRecords[prevYearRecords.length - 1].totalCAD || 0;
        } else {
            const thisYearRecords = history.filter(r => r.date && r.date.startsWith(String(currentYear)));
            if (thisYearRecords.length > 0) {
                ytdStartVal = thisYearRecords[0].totalCAD || 0;
            } else {
                ytdStartVal = history[0].totalCAD || 0;
            }
        }
    }

    const ytdChangeCAD = totalCAD - ytdStartVal;
    const ytdReturnPct = ytdStartVal > 0 ? (ytdChangeCAD / ytdStartVal * 100).toFixed(2) + '%' : '0.00%';
    const monthsElapsed = Math.max(1, currentMonth);
    const ytdMonthlyGainCAD = ytdChangeCAD / monthsElapsed;

    let ytdPeakVal = totalCAD;
    if (history && history.length > 0) {
        const thisYearRecords = history.filter(r => r.date && r.date.startsWith(String(currentYear)));
        thisYearRecords.forEach(r => {
            if (r.totalCAD > ytdPeakVal) ytdPeakVal = r.totalCAD;
        });
    }

    const ytd = {
        year: currentYear,
        totalValue: totalCAD,
        startValue: ytdStartVal,
        changeCAD: ytdChangeCAD,
        returnPct: ytdReturnPct,
        monthlyGainCAD: ytdMonthlyGainCAD,
        peakValue: ytdPeakVal
    };

    // 6. All-Time Wealth & Total Return Metrics
    const costBasis = calculateHoldingsCostBasis(holdings);
    const totalBookCostCAD = costBasis.totalBookCostCAD;
    const totalMarketGainsCAD = costBasis.totalMarketGainsCAD;
    const marketRoiPct = costBasis.marketRoiPct;
    const firstHist = history && history.length > 0 ? history[0] : null;
    const startingCAD = firstHist ? (firstHist.totalCAD || 0) : totalCAD;
    const totalGrowthCAD = totalCAD - startingCAD;
    const totalGrowthPct = startingCAD > 0 ? (totalGrowthCAD / startingCAD) * 100 : 0;
    const netSavingsCAD = Math.max(0, totalGrowthCAD - totalMarketGainsCAD);

    const allTimeMetrics = {
        totalCAD,
        totalBookCostCAD,
        totalMarketGainsCAD,
        marketRoiPct,
        startingCAD,
        netSavingsCAD,
        totalGrowthCAD,
        totalGrowthPct
    };

    return { assetClasses, accountTypes, categories, metrics, ytd, allTimeMetrics };
}

function renderMainTopStats(mainData, holdings, history) {
    const totalCAD = mainData.metrics && mainData.metrics.totalValue ? mainData.metrics.totalValue : holdings.reduce((s, h) => s + (h.sum || 0), 0);
    const lastRecord = history && history.length > 0 ? history[history.length - 1] : null;

    const cadUsdRate = (typeof window !== 'undefined' && window.cachedPrices?.cadUsdRate)
        || (typeof rawBenchmarks !== 'undefined' && rawBenchmarks?.fx?.cadUsdRate)
        || (lastRecord && lastRecord.totalCAD && lastRecord.totalUSD
            ? (lastRecord.totalUSD / lastRecord.totalCAD)
            : 0.7073);
    const totalUSD = totalCAD * cadUsdRate;

    document.getElementById('main-stat-total-cad').textContent = formatCurrency(totalCAD, 'CAD');
    document.getElementById('main-stat-total-usd').textContent = `≈ ${formatCurrency(totalUSD, 'USD')}`;

    // Current Week Top Stat Card
    const cw = mainData.metrics?.currentWeek;
    const weekChangeEl = document.getElementById('main-stat-week-change');
    const weekLabelEl = document.getElementById('main-stat-week-label');
    const weekSubEl = document.getElementById('main-stat-week-sub');

    if (weekChangeEl && cw) {
        const sign = cw.changeCAD >= 0 ? '+' : '';
        const color = cw.isUp ? '#16a34a' : '#dc2626';
        const icon = cw.isUp ? '🟢' : '🔴';
        weekChangeEl.textContent = `${sign}${formatCurrency(cw.changeCAD, 'CAD')}`;
        weekChangeEl.style.color = color;
        if (weekLabelEl) {
            weekLabelEl.textContent = cw.weekNumber ? `This Week (${cw.weekNumber})` : 'Current Week';
        }
        if (weekSubEl) {
            weekSubEl.innerHTML = `${sign}${cw.changePct.toFixed(2)}% &bull; <strong style="color: ${color};">${icon} ${cw.statusText}</strong>`;
        }
    }

    const categories = mainData?.categories || [];
    const catStocks = categories.find(c => c.name === 'Stocks') || { value: 0, percentage: '0%' };
    const catFixed = categories.find(c => c.name === 'Fixed Income') || { value: 0, percentage: '0%' };
    const catMetals = categories.find(c => c.name === 'Precious Metals') || { value: 0 };
    const catCrypto = categories.find(c => c.name === 'Crypto') || { value: 0 };
    const altsVal = catMetals.value + catCrypto.value;
    const altsPct = totalCAD > 0 ? (altsVal / totalCAD * 100).toFixed(2) + '%' : '0.00%';

    const stocksEl = document.getElementById('main-stat-stocks');
    const stocksPctEl = document.getElementById('main-stat-stocks-pct');
    if (stocksEl) stocksEl.textContent = formatCurrency(catStocks.value, 'CAD');
    if (stocksPctEl) stocksPctEl.textContent = `${catStocks.percentage} of portfolio`;

    const fixedEl = document.getElementById('main-stat-fixed');
    const fixedPctEl = document.getElementById('main-stat-fixed-pct');
    if (fixedEl) fixedEl.textContent = formatCurrency(catFixed.value, 'CAD');
    if (fixedPctEl) fixedPctEl.textContent = `${catFixed.percentage} of portfolio`;

    const altsEl = document.getElementById('main-stat-alts');
    const altsPctEl = document.getElementById('main-stat-alts-pct');
    if (altsEl) altsEl.textContent = formatCurrency(altsVal, 'CAD');
    if (altsPctEl) altsPctEl.textContent = `${altsPct} of portfolio`;

    const athValue = mainData.metrics?.athValue || 0;
    const diffFromAth = totalCAD - athValue;
    const isAth = diffFromAth >= -1.0;
    const athEl = document.getElementById('main-stat-ath');
    const athLabelEl = document.getElementById('main-stat-ath-label');
    const athValEl = document.getElementById('main-stat-ath-val');

    if (athEl) {
        if (isAth) {
            athEl.textContent = '🟢 ATH!';
            athEl.style.color = '#16a34a';
            if (athLabelEl) athLabelEl.textContent = 'All-Time High Status';
            if (athValEl) athValEl.textContent = `At Peak: ${formatCurrency(athValue, 'CAD')}`;
        } else {
            const diffPct = athValue > 0 ? (diffFromAth / athValue) * 100 : 0;
            athEl.textContent = formatCurrency(diffFromAth, 'CAD');
            athEl.style.color = '#dc2626';
            if (athLabelEl) athLabelEl.textContent = 'Off All-Time High';
            if (athValEl) athValEl.textContent = `${diffPct.toFixed(2)}% \u2022 Peak: ${formatCurrency(athValue, 'CAD')}`;
        }
    }

    // Time Back in Terms of Money (CAD & USD)
    const timeBackCAD = calculateTimeBack(history, totalCAD, 'totalCAD');
    const timeBackUSD = calculateTimeBack(history, totalUSD, 'totalUSD');

    const tbCadEl = document.getElementById('main-stat-timeback-cad');
    const tbCadSubEl = document.getElementById('main-stat-timeback-cad-sub');
    if (tbCadEl) {
        tbCadEl.textContent = timeBackCAD.label;
        tbCadEl.style.color = timeBackCAD.weeks > 0 ? (timeBackCAD.weeks >= 4 ? '#cf222e' : '#d97706') : '#16a34a';
        if (tbCadSubEl) tbCadSubEl.textContent = timeBackCAD.sub;
    }

    const tbUsdEl = document.getElementById('main-stat-timeback-usd');
    const tbUsdSubEl = document.getElementById('main-stat-timeback-usd-sub');
    if (tbUsdEl) {
        tbUsdEl.textContent = timeBackUSD.label;
        tbUsdEl.style.color = timeBackUSD.weeks > 0 ? (timeBackUSD.weeks >= 4 ? '#cf222e' : '#d97706') : '#16a34a';
        if (tbUsdSubEl) tbUsdSubEl.textContent = timeBackUSD.sub;
    }
}

/**
 * Calculates how far back in time the portfolio's current wealth is set back.
 * Finds the earliest consecutive historical week that had a balance >= currentVal.
 */
function calculateTimeBack(history, currentVal, currencyKey) {
    if (!history || history.length === 0 || !currentVal || currentVal <= 0) {
        return { weeks: 0, record: null, isAth: true, label: '0 weeks', sub: '🟢 At All-Time High' };
    }

    let maxVal = -Infinity;
    history.forEach(r => {
        const val = r[currencyKey] || 0;
        if (val > maxVal) maxVal = val;
    });

    if (currentVal >= maxVal - 1.0) {
        return { weeks: 0, record: null, isAth: true, label: '0 weeks', sub: '🟢 At All-Time High' };
    }

    // Walk backwards from latest history to find records >= currentVal
    let i = history.length - 1;
    while (i >= 0 && (history[i][currencyKey] || 0) < currentVal) {
        i--;
    }

    if (i < 0) {
        return { weeks: 0, record: null, isAth: true, label: '0 weeks', sub: '🟢 At All-Time High' };
    }

    // Walk backwards as long as consecutive records are >= currentVal
    let streakStartIdx = i;
    while (streakStartIdx >= 0 && (history[streakStartIdx][currencyKey] || 0) >= currentVal) {
        streakStartIdx--;
    }

    // The baseline historical record where wealth was last at or below currentVal
    const targetIdx = Math.max(0, streakStartIdx);
    const targetRecord = history[targetIdx];
    const latestRecord = history[history.length - 1];

    let weeksDiff = (latestRecord.week && targetRecord.week)
        ? (latestRecord.week - targetRecord.week)
        : (history.length - 1 - targetIdx);

    if (weeksDiff === 0 && (targetRecord[currencyKey] || 0) > currentVal) {
        weeksDiff = 1;
    }

    const weeksStr = weeksDiff === 1 ? '1 week' : `${weeksDiff} weeks`;
    const targetVal = targetRecord[currencyKey] || 0;
    const currency = currencyKey === 'totalUSD' ? 'USD' : 'CAD';
    const prefix = currency === 'USD' ? 'US$' : '$';
    const formattedVal = `${prefix}${(targetVal / 1000).toFixed(0)}k`;
    const dateFn = typeof formatDate === 'function'
        ? formatDate
        : (typeof require !== 'undefined' ? require('./api.js').formatDate : (d => d));
    const dateStr = dateFn ? dateFn(targetRecord.date) : targetRecord.date;

    return {
        weeks: weeksDiff,
        record: targetRecord,
        isAth: false,
        label: weeksStr,
        sub: `Back to ${dateStr} (${formattedVal})`
    };
}

function renderAssetClassTable(mainData, holdings) {
    const tbody = document.getElementById('tbody-asset-class');
    tbody.innerHTML = '';

    const classes = mainData.assetClasses || [];
    const equityItems = classes.slice(0, 4); // US, Developed, Emerging, Canada
    const otherItems = classes.slice(4); // Fixed Income, Metals, Crypto

    let totalEquityVal = 0;
    equityItems.forEach(item => {
        totalEquityVal += item.value;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(item.value, 'CAD')}</td>
            <td style="text-align: right; font-weight: 700; color: #0969da;">${escapeHtml(item.percentage)}</td>
        `;
        tbody.appendChild(tr);
    });

    // Subtotal for Equities
    const eqSubtotalTr = document.createElement('tr');
    eqSubtotalTr.style.background = '#f8fafc';
    eqSubtotalTr.style.borderTop = '1.5px solid #cbd5e1';
    eqSubtotalTr.style.borderBottom = '1.5px solid #cbd5e1';
    eqSubtotalTr.innerHTML = `
        <td><strong>Total Equities</strong></td>
        <td style="text-align: right; font-weight: 800; color: #1f2328;">${formatCurrency(totalEquityVal, 'CAD')}</td>
        <td style="text-align: right; font-weight: 800; color: #1f2328;">100.00%</td>
    `;
    tbody.appendChild(eqSubtotalTr);

    // Other Asset Classes
    otherItems.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(item.value, 'CAD')}</td>
            <td style="text-align: right; color: #64748b;">${item.percentage ? escapeHtml(item.percentage) : '&mdash;'}</td>
        `;
        tbody.appendChild(tr);
    });

    // Grand Total Portfolio Row
    const grandTotal = mainData.metrics && mainData.metrics.totalValue ? mainData.metrics.totalValue : holdings.reduce((s, h) => s + h.sum, 0);
    const totalTr = document.createElement('tr');
    totalTr.style.background = '#f1f5f9';
    totalTr.style.borderTop = '2px solid #0969da';
    totalTr.innerHTML = `
        <td><strong>Total Portfolio</strong></td>
        <td style="text-align: right; font-weight: 800; color: #0969da; font-size: 0.95rem;">${formatCurrency(grandTotal, 'CAD')}</td>
        <td style="text-align: right; font-weight: 800; color: #0969da;">&mdash;</td>
    `;
    tbody.appendChild(totalTr);
}

function renderAccountTypeTable(mainData, holdings, history) {
    const tbody = document.getElementById('tbody-account-type');
    tbody.innerHTML = '';

    const types = mainData.accountTypes || [];
    let totalVal = 0;

    types.forEach(item => {
        totalVal += item.value;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(item.value, 'CAD')}</td>
            <td style="text-align: right; font-weight: 700; color: #0969da;">${escapeHtml(item.percentage)}</td>
        `;
        tbody.appendChild(tr);
    });

    // Total Row
    const totalTr = document.createElement('tr');
    totalTr.style.background = '#f1f5f9';
    totalTr.style.borderTop = '2px solid #0969da';
    totalTr.innerHTML = `
        <td><strong>Total Portfolio</strong></td>
        <td style="text-align: right; font-weight: 800; color: #0969da; font-size: 0.95rem;">${formatCurrency(totalVal, 'CAD')}</td>
        <td style="text-align: right; font-weight: 800; color: #0969da;">100.00%</td>
    `;
    tbody.appendChild(totalTr);
}

function renderCategoryTable(mainData, holdings) {
    const tbody = document.getElementById('tbody-category');
    tbody.innerHTML = '';

    const categories = mainData.categories || [];
    let totalVal = 0;

    const catColors = {
        'Stocks': '#2563eb',
        'Fixed Income': '#16a34a',
        'Precious Metals': '#eab308',
        'Crypto': '#8b5cf6'
    };

    categories.forEach(item => {
        totalVal += item.value;
        const color = catColors[item.name] || '#64748b';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${color}; margin-right: 6px;"></span>
                <strong>${escapeHtml(item.name)}</strong>
            </td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(item.value, 'CAD')}</td>
            <td style="text-align: right; font-weight: 700; color: #0969da;">${escapeHtml(item.percentage)}</td>
        `;
        tbody.appendChild(tr);
    });

    // Total Row
    const totalTr = document.createElement('tr');
    totalTr.style.background = '#f1f5f9';
    totalTr.style.borderTop = '2px solid #0969da';
    totalTr.innerHTML = `
        <td><strong>Total Portfolio</strong></td>
        <td style="text-align: right; font-weight: 800; color: #0969da; font-size: 0.95rem;">${formatCurrency(totalVal, 'CAD')}</td>
        <td style="text-align: right; font-weight: 800; color: #0969da;">100.00%</td>
    `;
    tbody.appendChild(totalTr);

    // Progress Bar & Legend
    document.getElementById('cat-bar-total').textContent = `${formatCurrency(totalVal, 'CAD')}`;
    const barContainer = document.getElementById('cat-progress-bar');
    const legendContainer = document.getElementById('cat-legend');
    barContainer.innerHTML = '';
    legendContainer.innerHTML = '';

    categories.forEach(item => {
        const pctNum = parseFloat(item.percentage) || (totalVal > 0 ? (item.value / totalVal * 100) : 0);
        const color = catColors[item.name] || '#64748b';

        const segment = document.createElement('div');
        segment.style.width = `${pctNum}%`;
        segment.style.background = color;
        segment.style.height = '100%';
        segment.title = `${item.name}: ${item.percentage}`;
        barContainer.appendChild(segment);

        const legendItem = document.createElement('div');
        legendItem.style.display = 'flex';
        legendItem.style.alignItems = 'center';
        legendItem.style.gap = '4px';
        legendItem.innerHTML = `
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color};"></span>
            <span style="color: #475569;">${escapeHtml(item.name)}: <strong>${escapeHtml(item.percentage)}</strong></span>
        `;
        legendContainer.appendChild(legendItem);
    });
}

function renderPerformanceCards(mainData) {
    const m = mainData.metrics || {};
    const y = mainData.ytd || {};

    // --- 1. 52-Week Performance Tracking Card ---
    const totalVal52 = m.totalValue !== undefined ? m.totalValue : 0;
    const totalValEl52 = document.getElementById('metric-total-val');
    if (totalValEl52) totalValEl52.textContent = formatCurrency(totalVal52, 'CAD');

    const lastYearVal = m.lastYearValue !== undefined ? m.lastYearValue : (m.costBasis || 0);
    const lastYearEl = document.getElementById('metric-cost-basis');
    if (lastYearEl) lastYearEl.textContent = formatCurrency(lastYearVal, 'CAD');

    const changeVal52 = m.oneYearChangeCAD !== undefined ? m.oneYearChangeCAD : (m.totalGainCAD || 0);
    const sign52 = changeVal52 >= 0 ? '+' : '';
    const color52 = changeVal52 >= 0 ? '#16a34a' : '#dc2626';

    const gainEl52 = document.getElementById('metric-total-gain');
    if (gainEl52) {
        gainEl52.textContent = `${sign52}${formatCurrency(changeVal52, 'CAD')}`;
        gainEl52.style.color = color52;
    }

    const returnPct52 = m.oneYearReturnPct || m.gainPct || '0.00%';
    const hasSign52 = returnPct52.startsWith('+') || returnPct52.startsWith('-');
    const pctEl52 = document.getElementById('metric-gain-pct');
    if (pctEl52) {
        pctEl52.textContent = `${!hasSign52 ? sign52 : ''}${returnPct52}`;
        pctEl52.style.color = color52;
    }

    const monthlyEl52 = document.getElementById('metric-monthly-rate');
    const monthlyGain52 = m.monthlyGainCAD || 0;
    const monthlySign52 = monthlyGain52 >= 0 ? '+' : '';
    if (monthlyEl52) {
        monthlyEl52.textContent = `${monthlySign52}${formatCurrency(monthlyGain52, 'CAD')} / mo`;
        monthlyEl52.style.color = monthlyGain52 >= 0 ? '#16a34a' : '#dc2626';
    }

    const athEl52 = document.getElementById('metric-ath-val');
    if (athEl52) athEl52.textContent = formatCurrency(m.athValue || 0, 'CAD');

    // --- 2. Year to Date (YTD) Tracking Card ---
    const ytdSubtitleEl = document.getElementById('ytd-card-subtitle');
    if (ytdSubtitleEl && y.year) {
        ytdSubtitleEl.textContent = `Calendar Year ${y.year} Performance & Net Wealth Growth`;
    }

    const ytdTotalVal = y.totalValue !== undefined ? y.totalValue : totalVal52;
    const ytdTotalValEl = document.getElementById('ytd-total-val');
    if (ytdTotalValEl) ytdTotalValEl.textContent = formatCurrency(ytdTotalVal, 'CAD');

    const ytdStartVal = y.startValue !== undefined ? y.startValue : 0;
    const ytdStartValEl = document.getElementById('ytd-start-val');
    if (ytdStartValEl) ytdStartValEl.textContent = formatCurrency(ytdStartVal, 'CAD');

    const ytdChangeVal = y.changeCAD !== undefined ? y.changeCAD : 0;
    const ytdSign = ytdChangeVal >= 0 ? '+' : '';
    const ytdColor = ytdChangeVal >= 0 ? '#16a34a' : '#dc2626';

    const ytdGainEl = document.getElementById('ytd-total-gain');
    if (ytdGainEl) {
        ytdGainEl.textContent = `${ytdSign}${formatCurrency(ytdChangeVal, 'CAD')}`;
        ytdGainEl.style.color = ytdColor;
    }

    const ytdReturnPct = y.returnPct || '0.00%';
    const ytdHasSign = ytdReturnPct.startsWith('+') || ytdReturnPct.startsWith('-');
    const ytdPctEl = document.getElementById('ytd-gain-pct');
    if (ytdPctEl) {
        ytdPctEl.textContent = `${!ytdHasSign ? ytdSign : ''}${ytdReturnPct}`;
        ytdPctEl.style.color = ytdColor;
    }

    const ytdMonthlyEl = document.getElementById('ytd-monthly-rate');
    const ytdMonthlyGain = y.monthlyGainCAD || 0;
    const ytdMonthlySign = ytdMonthlyGain >= 0 ? '+' : '';
    if (ytdMonthlyEl) {
        ytdMonthlyEl.textContent = `${ytdMonthlySign}${formatCurrency(ytdMonthlyGain, 'CAD')} / mo`;
        ytdMonthlyEl.style.color = ytdMonthlyGain >= 0 ? '#16a34a' : '#dc2626';
    }

    const ytdPeakEl = document.getElementById('ytd-peak-val');
    if (ytdPeakEl) ytdPeakEl.textContent = formatCurrency(y.peakValue !== undefined ? y.peakValue : (m.athValue || 0), 'CAD');

    // --- 3. All-Time Wealth & Growth Decomposition Card ---
    const atm = mainData.allTimeMetrics || {};
    const atTotalEl = document.getElementById('alltime-net-worth');
    if (atTotalEl) atTotalEl.textContent = formatCurrency(atm.totalCAD !== undefined ? atm.totalCAD : totalVal52, 'CAD');

    const atBaselineEl = document.getElementById('alltime-baseline-val');
    if (atBaselineEl) atBaselineEl.textContent = formatCurrency(atm.startingCAD || 0, 'CAD');

    const atContribEl = document.getElementById('alltime-contributions-val');
    if (atContribEl) {
        atContribEl.textContent = `+${formatCurrency(atm.netSavingsCAD || 0, 'CAD')}`;
    }

    const atEtfEl = document.getElementById('alltime-etf-gain-val');
    if (atEtfEl) {
        const sign = (atm.totalMarketGainsCAD || 0) >= 0 ? '+' : '';
        atEtfEl.textContent = `${sign}${formatCurrency(atm.totalMarketGainsCAD || 0, 'CAD')}`;
        atEtfEl.style.color = (atm.totalMarketGainsCAD || 0) >= 0 ? '#16a34a' : '#dc2626';
    }

    const atGrowthEl = document.getElementById('alltime-growth-val');
    if (atGrowthEl) {
        const sign = (atm.totalGrowthCAD || 0) >= 0 ? '+' : '';
        atGrowthEl.textContent = `${sign}${formatCurrency(atm.totalGrowthCAD || 0, 'CAD')}`;
        atGrowthEl.style.color = (atm.totalGrowthCAD || 0) >= 0 ? '#0969da' : '#dc2626';
    }

    const atRoiEl = document.getElementById('alltime-roi-pct');
    if (atRoiEl) {
        const sign = (atm.totalGrowthPct || 0) >= 0 ? '+' : '';
        atRoiEl.textContent = `${sign}${(atm.totalGrowthPct || 0).toFixed(1)}% Growth since Week 1`;
        atRoiEl.style.color = (atm.totalGrowthCAD || 0) >= 0 ? '#0969da' : '#dc2626';
    }
}

/* ================= Net Worth Progression SVG Chart ================= */

const MAIN_YEAR_COLORS = {
    '2026': '#0969da', // Vibrant Blue
    '2025': '#8250df', // Elegant Purple
    '2024': '#d97706', // Amber / Gold
    '2023': '#0891b2', // Teal / Cyan
    '2027': '#e11d48', // Rose
    '2028': '#16a34a'  // Emerald
};

function getMainYearColor(year) {
    if (MAIN_YEAR_COLORS[year]) return MAIN_YEAR_COLORS[year];
    const palette = ['#0969da', '#8250df', '#d97706', '#0891b2', '#e11d48', '#4f46e5', '#059669'];
    const num = parseInt(year, 10);
    if (!isNaN(num)) {
        return palette[Math.abs(num) % palette.length];
    }
    return '#0969da';
}

/**
 * Calculates normalized progress of a calendar date within its year [0, 1].
 * Jan 1 = 0.0, Dec 31 = 1.0.
 */
function getDayOfYearFraction(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return 0;
    const parts = dateStr.split('-');
    if (parts.length < 3) return 0;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);

    const target = new Date(Date.UTC(y, m, d, 12, 0, 0));
    const startOfYear = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
    const endOfYear = new Date(Date.UTC(y, 11, 31, 23, 59, 59));

    const fraction = (target - startOfYear) / (endOfYear - startOfYear);
    return Math.max(0, Math.min(1, fraction));
}

function updateMainTimeframeButtonsUI() {
    if (typeof document === 'undefined') return;
    const buttons = document.querySelectorAll('.timeframe-pill');
    buttons.forEach(btn => {
        const tf = btn.getAttribute('data-timeframe');
        if (tf === 'all') {
            const isActive = currentMainMode === 'single' && currentMainSingleTimeframe === 'all';
            btn.classList.toggle('active', isActive);
            btn.style.background = isActive ? '#1f2328' : 'white';
            btn.style.color = isActive ? 'white' : '#24292f';
        } else if (tf === 'last-52') {
            const isActive = currentMainMode === 'single' && currentMainSingleTimeframe === 'last-52';
            btn.classList.toggle('active', isActive);
            btn.style.background = isActive ? '#1f2328' : 'white';
            btn.style.color = isActive ? 'white' : '#24292f';
        } else if (/^\d{4}$/.test(tf)) {
            const isActive = currentMainMode === 'years' && currentMainSelectedYears.has(tf);
            btn.classList.toggle('active', isActive);
            const yrColor = getMainYearColor(tf);
            btn.style.background = isActive ? yrColor : 'white';
            btn.style.color = isActive ? 'white' : '#24292f';
            btn.title = isActive ? `Year ${tf} (Active - click to hide)` : `Year ${tf} (Click to overlay)`;
        }
    });

    const xeqtInput = document.getElementById('main-overlay-xeqt');
    if (xeqtInput) {
        const xeqtLabel = xeqtInput.closest('label');
        const isMultiYear = currentMainMode === 'years' && currentMainSelectedYears.size > 1;
        if (isMultiYear) {
            if (xeqtLabel) {
                xeqtLabel.style.opacity = '0.4';
                xeqtLabel.style.cursor = 'not-allowed';
                xeqtLabel.title = 'XEQT benchmark overlay is available when viewing a single year, Last 52W, or All Time';
            }
            xeqtInput.disabled = true;
        } else {
            if (xeqtLabel) {
                xeqtLabel.style.opacity = '1';
                xeqtLabel.style.cursor = 'pointer';
                xeqtLabel.title = currentMainMode === 'years'
                    ? 'Compare your portfolio growth with holding 100% XEQT over the selected year'
                    : 'Compare your portfolio growth with holding 100% XEQT over the selected timeframe';
            }
            xeqtInput.disabled = false;
        }
        xeqtInput.checked = currentMainOverlayXeqt;
    }
}

function syncMainTimeframeButtons(history) {
    const container = document.getElementById('main-timeframe-toggle');
    if (!container || !history || history.length === 0) return;

    // Chronological order: 2024, 2025, 2026...
    const availableYears = [...new Set(
        history.map(r => r.date ? r.date.split('-')[0] : null).filter(y => y && /^\d{4}$/.test(y))
    )].sort();

    if (availableYears.length === 0) return;

    let html = '';

    availableYears.forEach((year, idx) => {
        const isActive = currentMainMode === 'years' && currentMainSelectedYears.has(year);
        const yrColor = getMainYearColor(year);
        const bg = isActive ? yrColor : 'white';
        const color = isActive ? 'white' : '#24292f';
        const borderLeft = idx > 0 ? 'border-left: 1px solid #d0d7de;' : '';
        html += `
            <button type="button" class="btn-secondary timeframe-pill ${isActive ? 'active' : ''}" data-timeframe="${year}" onclick="setMainTimeframe('${year}')" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 700; border: none; border-radius: 0; ${borderLeft} background: ${bg}; color: ${color};" title="Toggle Year ${year} overlay">${year}</button>
        `;
    });

    const isLast52Active = currentMainMode === 'single' && currentMainSingleTimeframe === 'last-52';
    const isAllActive = currentMainMode === 'single' && currentMainSingleTimeframe === 'all';

    html += `
        <button type="button" class="btn-secondary timeframe-pill ${isLast52Active ? 'active' : ''}" data-timeframe="last-52" onclick="setMainTimeframe('last-52')" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 700; border: none; border-radius: 0; border-left: 1px solid #d0d7de; background: ${isLast52Active ? '#1f2328' : 'white'}; color: ${isLast52Active ? 'white' : '#24292f'};" title="Show Last 52 Weeks graph">Last 52W</button>
        <button type="button" class="btn-secondary timeframe-pill ${isAllActive ? 'active' : ''}" data-timeframe="all" onclick="setMainTimeframe('all')" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 700; border: none; border-radius: 0; border-left: 1px solid #d0d7de; background: ${isAllActive ? '#1f2328' : 'white'}; color: ${isAllActive ? 'white' : '#24292f'};" title="Show All-Time historical graph">All Time</button>
    `;

    container.innerHTML = html;
}

async function setMainTimeframe(tf) {
    if (tf === 'all' || tf === 'last-52') {
        currentMainMode = 'single';
        currentMainSingleTimeframe = tf;
        currentMainSelectedYears.clear();
        currentMainTimeframe = tf;
    } else if (/^\d{4}$/.test(tf)) {
        if (currentMainMode === 'single') {
            currentMainMode = 'years';
            currentMainSingleTimeframe = null;
            currentMainSelectedYears.clear();
            currentMainSelectedYears.add(tf);
            currentMainUnit = 'PCT'; // Automatically switch to % when entering year overlay mode
            updateMainUnitButtonsUI();
        } else {
            if (currentMainSelectedYears.has(tf)) {
                if (currentMainSelectedYears.size > 1) {
                    currentMainSelectedYears.delete(tf);
                } else {
                    currentMainMode = 'single';
                    currentMainSingleTimeframe = 'last-52';
                    currentMainSelectedYears.clear();
                    currentMainTimeframe = 'last-52';
                }
            } else {
                currentMainSelectedYears.add(tf);
            }
        }
        if (currentMainMode === 'years') {
            currentMainTimeframe = Array.from(currentMainSelectedYears).sort().join(',');
        }
    }

    if (currentMainOverlayXeqt && (!rawBenchmarks || !rawBenchmarks.benchmarks) && typeof getBenchmarks === 'function') {
        try {
            rawBenchmarks = await getBenchmarks();
        } catch (e) {
            console.warn('Could not load benchmarks:', e);
        }
    }

    updateMainTimeframeButtonsUI();
    renderMainProgressionChart();
}

function setMainUnit(unit) {
    if (unit === 'CAD' || unit === 'USD') {
        currentMainCurrency = unit;
        currentMainUnit = 'VAL';
    } else if (unit === 'PCT' || unit === '%') {
        currentMainUnit = 'PCT';
    } else if (unit === 'VAL' || unit === '$') {
        currentMainUnit = 'VAL';
    }
    updateMainUnitButtonsUI();
    renderMainProgressionChart();
}

function setMainCurrency(curr) {
    if (curr === 'CAD' || curr === 'USD') {
        currentMainCurrency = curr;
    }
    updateMainUnitButtonsUI();
    renderMainProgressionChart();
}

function updateMainUnitButtonsUI() {
    if (typeof document === 'undefined') return;
    const btnCad = document.getElementById('btn-main-cur-cad');
    const btnUsd = document.getElementById('btn-main-cur-usd');
    const btnVal = document.getElementById('btn-main-unit-val');
    const btnPct = document.getElementById('btn-main-unit-pct');

    if (btnCad) {
        const isActive = currentMainCurrency === 'CAD';
        btnCad.classList.toggle('active', isActive);
        btnCad.style.background = isActive ? '#1f2328' : 'white';
        btnCad.style.color = isActive ? 'white' : '#24292f';
    }
    if (btnUsd) {
        const isActive = currentMainCurrency === 'USD';
        btnUsd.classList.toggle('active', isActive);
        btnUsd.style.background = isActive ? '#1f2328' : 'white';
        btnUsd.style.color = isActive ? 'white' : '#24292f';
    }

    const isPct = currentMainUnit === 'PCT';
    if (btnVal) {
        const isActive = !isPct;
        btnVal.classList.toggle('active', isActive);
        btnVal.style.background = isActive ? '#1f2328' : 'white';
        btnVal.style.color = isActive ? 'white' : '#24292f';
    }
    if (btnPct) {
        const isActive = isPct;
        btnPct.classList.toggle('active', isActive);
        btnPct.style.background = isActive ? '#1f2328' : 'white';
        btnPct.style.color = isActive ? 'white' : '#24292f';
    }
}

async function toggleMainXeqtOverlay(checked) {
    currentMainOverlayXeqt = !!checked;
    if (currentMainOverlayXeqt && (!rawBenchmarks || !rawBenchmarks.benchmarks)) {
        try {
            if (typeof getBenchmarks === 'function') {
                rawBenchmarks = await getBenchmarks();
            }
        } catch (e) {
            console.warn('Could not load benchmarks:', e);
        }
    }
    renderMainProgressionChart();
}

function renderMainProgressionChart() {
    if (typeof document === 'undefined') return;
    const box = document.getElementById('main-chart-svg-box');
    const tooltip = document.getElementById('main-chart-tooltip');
    if (!box || !rawHistory || rawHistory.length === 0) return;

    const currency = currentMainCurrency;
    const valKey = currency === 'USD' ? 'totalUSD' : 'totalCAD';
    const width = 1000;
    const height = 220;
    const padding = { top: 18, right: 25, bottom: 32, left: 65 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const titleEl = document.getElementById('main-chart-title');

    if (currentMainMode === 'years' && currentMainSelectedYears.size > 0) {
        renderMainYearOverlayChart(box, tooltip, valKey, currency, width, height, padding, plotW, plotH, titleEl);
    } else {
        renderMainSingleChart(box, tooltip, valKey, currency, width, height, padding, plotW, plotH, titleEl);
    }
}

/**
 * Safely renders inspection card HTML to #main-chart-info-card
 */
function renderMainChartInfoCard(html, isActive = false) {
    if (typeof document === 'undefined') return;
    const card = document.getElementById('main-chart-info-card');
    if (!card) return;
    card.innerHTML = html;
    if (isActive) card.classList.add('active');
    else card.classList.remove('active');
}

/**
 * Renders the single-curve progression chart ("All Time" or "Last 52 Weeks").
 */
function renderMainSingleChart(box, tooltip, valKey, currency, width, height, padding, plotW, plotH, titleEl) {
    const timeframe = currentMainSingleTimeframe || 'last-52';
    const isPct = currentMainUnit === 'PCT';

    if (titleEl) {
        const curLabel = currency === 'USD' ? 'USD' : 'CAD';
        if (isPct) {
            titleEl.textContent = timeframe === 'all'
                ? `📈 Net Worth Progression (% Return - All Time - ${curLabel})`
                : `📈 Net Worth Progression (% Return - Last 52 Weeks - ${curLabel})`;
        } else {
            titleEl.textContent = timeframe === 'all'
                ? `📈 Net Worth Progression (All Time - ${curLabel})`
                : `📈 Net Worth Progression (Last 52 Weeks - ${curLabel})`;
        }
    }

    let records = [...rawHistory];
    if (timeframe === 'last-52') {
        records = records.length > 52 ? records.slice(-53) : records;
    }

    if (records.length === 0) {
        box.innerHTML = '<p class="empty-state" style="padding: 24px; text-align: center; color: #64748b;">No data available for this timeframe.</p>';
        return;
    }

    const xeqtBenchmark = rawBenchmarks?.benchmarks?.XEQT;
    const xeqtPrices = xeqtBenchmark?.weeklyPrices || [];
    const currentXeqtPrice = xeqtBenchmark?.currentPrice;
    const showXeqt = currentMainOverlayXeqt && xeqtPrices.length > 0;
    let xeqtSeries = [];
    if (showXeqt && typeof computeXeqtProgressionOverlay === 'function') {
        xeqtSeries = computeXeqtProgressionOverlay(records, rawHistory, xeqtPrices, currency, currentXeqtPrice);
    }

    const baseVal = records[0][valKey] || 1;
    const portPoints = records.map((r, i) => {
        const val = r[valKey] || 0;
        const pct = baseVal > 0 ? ((val - baseVal) / baseVal) * 100 : 0;
        return {
            val: val,
            pct: pct,
            rec: r,
            idx: i
        };
    });

    let minVal, maxVal, step;
    let getY;

    if (isPct) {
        const allChartPcts = [0, ...portPoints.map(p => p.pct)];
        if (showXeqt && xeqtSeries.length > 0) {
            allChartPcts.push(...xeqtSeries.map(x => x.returnPct));
        }

        const minPct = Math.min(...allChartPcts);
        const maxPct = Math.max(...allChartPcts);
        const span = maxPct - minPct;
        const pad = span > 0 ? Math.max(1, span * 0.1) : 4;

        step = 5;
        if (span + 2 * pad > 40) step = 10;
        else if (span + 2 * pad <= 14) step = 2;
        else if (span + 2 * pad <= 6) step = 1;

        minVal = Math.floor((minPct - pad) / step) * step;
        maxVal = Math.ceil((maxPct + pad) / step) * step;

        getY = (pct) => padding.top + plotH - ((pct - minVal) / (maxVal - minVal)) * plotH;
    } else {
        const allChartVals = portPoints.map(p => p.val);
        if (showXeqt && xeqtSeries.length > 0) {
            allChartVals.push(...xeqtSeries.map(x => x.val));
        }

        minVal = Math.min(...allChartVals);
        maxVal = Math.max(...allChartVals);
        const range = maxVal - minVal || 10000;
        minVal = Math.floor(Math.max(0, minVal - range * 0.08) / 10000) * 10000;
        maxVal = Math.ceil((maxVal + range * 0.08) / 10000) * 10000;

        getY = (val) => padding.top + plotH - ((val - minVal) / (maxVal - minVal)) * plotH;
    }

    const getX = (idx) => padding.left + (idx / (records.length - 1 || 1)) * plotW;

    portPoints.forEach(p => {
        p.x = getX(p.idx);
        p.y = getY(isPct ? p.pct : p.val);
    });

    // Y Gridlines
    let gridLinesHtml = '';
    if (isPct) {
        const tickCount = Math.round((maxVal - minVal) / step);
        for (let i = 0; i <= tickCount; i++) {
            const p = Math.round((minVal + i * step) * 10) / 10;
            const y = getY(p);
            const sign = p > 0 ? '+' : '';
            const label = `${sign}${p}%`;
            const isZero = Math.abs(p) < 0.001;
            const strokeColor = isZero ? '#94a3b8' : '#e2e8f0';
            const strokeDash = isZero ? '' : 'stroke-dasharray="3 3"';
            const strokeWidth = isZero ? '1.5' : '1';
            const fontColor = isZero ? '#1e293b' : '#8c959f';
            const fontWeight = isZero ? '700' : 'normal';

            gridLinesHtml += `
                <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} />
                <text x="${padding.left - 8}" y="${(y + 4).toFixed(1)}" fill="${fontColor}" font-weight="${fontWeight}" font-size="11" text-anchor="end">${label}</text>
            `;
        }
    } else {
        const ySteps = 4;
        for (let i = 0; i <= ySteps; i++) {
            const val = minVal + (i / ySteps) * (maxVal - minVal);
            const y = getY(val);
            const label = currency === 'USD' ? `US$${(val / 1000).toFixed(0)}k` : `$${(val / 1000).toFixed(0)}k`;
            gridLinesHtml += `
                <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="3 3" />
                <text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}" fill="#8c959f" font-size="11" text-anchor="end">${label}</text>
            `;
        }
    }

    // X Date ticks
    let xTicksHtml = '';
    const numTicks = Math.min(records.length, 7);
    for (let i = 0; i < numTicks; i++) {
        const idx = Math.round((i / (numTicks - 1 || 1)) * (records.length - 1));
        const rec = records[idx];
        const x = getX(idx);
        const label = typeof formatMonthShort === 'function' ? formatMonthShort(rec.date) : formatDate(rec.date);
        xTicksHtml += `
            <line x1="${x.toFixed(1)}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${padding.top + plotH}" stroke="#f1f5f9" stroke-width="1" />
            <text x="${x.toFixed(1)}" y="${height - 8}" fill="#8c959f" font-size="11" text-anchor="middle">${label}</text>
        `;
    }

    // Portfolio line and area
    const pointsStr = portPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    const linePathD = 'M ' + pointsStr.join(' L ');
    const areaPathD = `${linePathD} L ${getX(records.length - 1).toFixed(1)},${padding.top + plotH} L ${getX(0).toFixed(1)},${padding.top + plotH} Z`;

    const hoverPointsHtml = portPoints.map((p, i) => `
        <circle class="main-chart-point" data-idx="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#0969da" stroke="#ffffff" stroke-width="2" style="cursor: pointer;" />
    `).join('');

    // XEQT Benchmark line and points
    let xeqtPathHtml = '';
    let xeqtPointsHtml = '';
    if (showXeqt && xeqtSeries.length > 0) {
        const xeqtPoints = xeqtSeries.map((x, i) => {
            const plotVal = isPct ? x.returnPct : x.val;
            return {
                x: getX(i),
                y: getY(plotVal),
                item: x,
                idx: i
            };
        });
        const xeqtLineD = 'M ' + xeqtPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ');
        xeqtPathHtml = `
            <path d="${xeqtLineD}" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" />
        `;
        xeqtPointsHtml = xeqtPoints.map((p, i) => `
            <circle class="main-xeqt-point" data-idx="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="#ffffff" stroke="#16a34a" stroke-width="1.8" style="cursor: pointer;" />
        `).join('');
    }

    const svg = `
        <svg viewBox="0 0 ${width} ${height}" class="svg-chart" id="main-networth-svg" style="width: 100%; max-height: 220px; display: block; overflow: visible;">
            <defs>
                <linearGradient id="mainAreaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#0969da" stop-opacity="0.25" />
                    <stop offset="100%" stop-color="#0969da" stop-opacity="0.0" />
                </linearGradient>
            </defs>
            ${gridLinesHtml}
            ${xTicksHtml}
            <path d="${areaPathD}" fill="url(#mainAreaGradient)" />
            <path d="${linePathD}" fill="none" stroke="#0969da" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
            ${xeqtPathHtml}
            ${hoverPointsHtml}
            ${xeqtPointsHtml}
            <!-- Vertical Crosshair Line -->
            <line id="main-single-cursor-line" x1="0" y1="${padding.top}" x2="0" y2="${padding.top + plotH}" stroke="#475569" stroke-width="1.5" stroke-dasharray="3,3" style="display: none; pointer-events: none;" />
            <!-- Active Hover Dots -->
            <circle id="main-single-port-dot" r="6" fill="#0969da" stroke="#ffffff" stroke-width="2" style="display: none; pointer-events: none;" />
            <circle id="main-single-xeqt-dot" r="5.5" fill="#16a34a" stroke="#ffffff" stroke-width="2" style="display: none; pointer-events: none;" />
            <!-- Full Tracking Overlay Rect -->
            <rect id="main-single-overlay" x="${padding.left}" y="${padding.top}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor: crosshair; pointer-events: all;" />
        </svg>
    `;

    box.innerHTML = svg;

    // Update legend
    const legendEl = document.getElementById('main-chart-legend');
    if (legendEl) {
        const lastPort = portPoints[portPoints.length - 1];
        const portSign = lastPort.pct >= 0 ? '+' : '';

        if (showXeqt && xeqtSeries.length > 0) {
            const lastItem = xeqtSeries[xeqtSeries.length - 1];
            const spreadSign = lastItem.spreadVal >= 0 ? '+' : '';
            const spreadColor = lastItem.spreadVal >= 0 ? '#16a34a' : '#cf222e';
            const spreadBg = lastItem.spreadVal >= 0 ? 'rgba(22, 163, 74, 0.1)' : 'rgba(207, 34, 46, 0.1)';
            const xeqtSign = lastItem.returnPct >= 0 ? '+' : '';

            legendEl.innerHTML = `
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 12px; height: 3px; background: #0969da; border-radius: 2px;"></span>
                    <strong style="color: #1f2328;">Portfolio</strong>: ${isPct ? `${portSign}${lastPort.pct.toFixed(2)}% (${formatCurrency(lastPort.val, currency)})` : `${formatCurrency(lastPort.val, currency)} (${portSign}${lastPort.pct.toFixed(2)}%)`}
                </div>
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 16px; height: 0; border-top: 2.5px dashed #16a34a;"></span>
                    <strong style="color: #16a34a;">XEQT Benchmark (${currency})</strong>: ${isPct ? `${xeqtSign}${lastItem.returnPct.toFixed(2)}%` : `${formatCurrency(lastItem.val, currency)} (${xeqtSign}${lastItem.returnPct.toFixed(2)}%)`}
                </div>
                <div style="font-size: 0.75rem; font-weight: 700; color: ${spreadColor}; background: ${spreadBg}; padding: 2px 8px; border-radius: 4px; border: 1px solid ${spreadColor}30;">
                    Spread: ${spreadSign}${lastItem.spreadPct.toFixed(2)}% pts (${spreadSign}${formatCurrency(lastItem.spreadVal, currency)})
                </div>
            `;
        } else {
            legendEl.innerHTML = `
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span class="legend-dot" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #0969da;"></span>
                    Total Net Worth: <strong>${isPct ? `${portSign}${lastPort.pct.toFixed(2)}% (${formatCurrency(lastPort.val, currency)})` : formatCurrency(lastPort.val, currency)}</strong> &bull; Hover any data point to inspect breakdown
                </div>
            `;
        }
    }

    if (tooltip) {
        tooltip.style.display = 'none';
    }

    function buildSingleCardHtml(idx, isHover = true) {
        const r = records[idx];
        const pt = portPoints[idx];
        if (!r || !pt) return '';
        const dateStr = formatDate(r.date);
        const totalVal = formatCurrency(r[valKey], currency);
        const pctSign = pt.pct >= 0 ? '+' : '';
        const pctColor = pt.pct >= 0 ? '#16a34a' : '#cf222e';
        const isUSD = currency === 'USD';
        const recRate = (r.totalCAD && r.totalUSD)
            ? (r.totalUSD / r.totalCAD)
            : ((typeof window !== 'undefined' && window.cachedPrices?.cadUsdRate) || (typeof rawBenchmarks !== 'undefined' && rawBenchmarks?.fx?.cadUsdRate) || 0.7073);
        const weeklyChangeVal = isUSD
            ? (r.weeklyChangeUSD !== undefined
                ? r.weeklyChangeUSD
                : (idx > 0 && records[idx - 1].totalUSD !== undefined
                    ? (r.totalUSD - records[idx - 1].totalUSD)
                    : (r.weeklyChangeCAD !== undefined ? r.weeklyChangeCAD * recRate : 0)))
            : (r.weeklyChangeCAD || 0);
        const weeklyPct = isUSD && idx > 0 && records[idx - 1].totalUSD > 0
            ? ((r.totalUSD - records[idx - 1].totalUSD) / records[idx - 1].totalUSD) * 100
            : (r.weeklyChangePct || 0);

        const weeklyChangeSign = weeklyChangeVal >= 0 ? '+' : '';
        const weeklyPctSign = weeklyPct >= 0 ? '+' : '';
        const weeklyChangeStr = `${weeklyChangeSign}${formatCurrency(weeklyChangeVal, currency)} (${weeklyPctSign}${weeklyPct.toFixed(2)}%)`;
        const changeColor = weeklyChangeVal >= 0 ? '#16a34a' : '#cf222e';

        let xeqtSection = '';
        if (showXeqt && xeqtSeries[idx]) {
            const x = xeqtSeries[idx];
            const xeqtValStr = formatCurrency(x.val, currency);
            const xeqtRetStr = `${x.returnPct >= 0 ? '+' : ''}${x.returnPct.toFixed(2)}%`;
            const portRetStr = `${pt.pct >= 0 ? '+' : ''}${pt.pct.toFixed(2)}%`;
            const spreadSign = x.spreadVal >= 0 ? '+' : '';
            const spreadColor = x.spreadVal >= 0 ? '#16a34a' : '#cf222e';
            const spreadValStr = `${spreadSign}${formatCurrency(x.spreadVal, currency)}`;
            const spreadPctStr = `${x.spreadPct >= 0 ? '+' : ''}${x.spreadPct.toFixed(2)}% pts`;

            xeqtSection = `
                <div class="chart-card-section-divider">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                        <span style="color: #16a34a; font-weight: 700;">🟢 XEQT Benchmark:</span>
                        <strong style="color: #16a34a;">${isPct ? xeqtRetStr : xeqtValStr}</strong>
                    </div>
                    <div class="chart-card-row" style="color: #64748b;">
                        <span>Return:</span>
                        <span>Port: <strong style="color: #0969da;">${portRetStr}</strong> | XEQT: <strong style="color: #16a34a;">${xeqtRetStr}</strong></span>
                    </div>
                    <div class="chart-card-row" style="margin-top: 2px; font-weight: 700; color: ${spreadColor};">
                        <span>Spread:</span>
                        <span>${isPct ? spreadPctStr : `${spreadValStr} (${spreadPctStr})`}</span>
                    </div>
                </div>
            `;
        }

        const sVal = isUSD ? (r.stocks * recRate) : r.stocks;
        const fVal = isUSD ? (r.fixed * recRate) : r.fixed;
        const mVal = isUSD ? (r.preciousMetals * recRate) : r.preciousMetals;
        const cVal = isUSD ? (r.crypto * recRate) : r.crypto;

        const badgeHtml = isHover
            ? `<span class="chart-card-badge" style="background: #e0f2fe; color: #0284c7;">INSPECTING</span>`
            : `<span class="chart-card-badge" style="background: #f1f5f9; color: #475569;">LATEST</span>`;

        return `
            <div class="chart-card-header">
                <span class="chart-card-date">Week ${r.week} &bull; ${dateStr}</span>
                ${badgeHtml}
            </div>
            <div class="chart-card-primary-val">
                ${isPct ? `${pctSign}${pt.pct.toFixed(2)}%` : totalVal}
            </div>
            <div class="chart-card-sub-val" style="color: #64748b;">
                ${isPct ? `Net Worth: <strong>${totalVal}</strong>` : `Return: <strong style="color: ${pctColor}">${pctSign}${pt.pct.toFixed(2)}%</strong>`}
                &bull; <span style="color: ${changeColor}; font-weight: 600;">${weeklyChangeStr}</span>
            </div>
            ${xeqtSection}
            <div class="chart-card-section-divider">
                <div style="font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">Asset Breakdown</div>
                <div class="chart-card-row">
                    <span>Stocks:</span>
                    <strong>${formatCurrency(sVal, currency)}</strong>
                </div>
                <div class="chart-card-row">
                    <span>Fixed Income:</span>
                    <strong>${formatCurrency(fVal, currency)}</strong>
                </div>
                <div class="chart-card-row">
                    <span>Precious Metals:</span>
                    <strong>${formatCurrency(mVal, currency)}</strong>
                </div>
                <div class="chart-card-row">
                    <span>Crypto:</span>
                    <strong>${formatCurrency(cVal, currency)}</strong>
                </div>
            </div>
            <div class="chart-card-footer">
                💡 Hover over graph to inspect historical weeks
            </div>
        `;
    }

    const svgEl = box.querySelector('#main-networth-svg');
    const overlay = box.querySelector('#main-single-overlay');
    const cursorLine = box.querySelector('#main-single-cursor-line');
    const portDot = box.querySelector('#main-single-port-dot');
    const xeqtDot = box.querySelector('#main-single-xeqt-dot');

    function setActivePoint(idx) {
        if (idx < 0 || idx >= records.length) return;
        const pt = portPoints[idx];
        if (cursorLine) {
            cursorLine.setAttribute('x1', pt.x.toFixed(1));
            cursorLine.setAttribute('x2', pt.x.toFixed(1));
            cursorLine.style.display = 'block';
        }
        if (portDot) {
            portDot.setAttribute('cx', pt.x.toFixed(1));
            portDot.setAttribute('cy', pt.y.toFixed(1));
            portDot.style.display = 'block';
        }
        if (xeqtDot && showXeqt && xeqtPoints[idx]) {
            xeqtDot.setAttribute('cx', xeqtPoints[idx].x.toFixed(1));
            xeqtDot.setAttribute('cy', xeqtPoints[idx].y.toFixed(1));
            xeqtDot.style.display = 'block';
        } else if (xeqtDot) {
            xeqtDot.style.display = 'none';
        }
        renderMainChartInfoCard(buildSingleCardHtml(idx, true), true);
    }

    function clearActivePoint() {
        if (cursorLine) cursorLine.style.display = 'none';
        if (portDot) portDot.style.display = 'none';
        if (xeqtDot) xeqtDot.style.display = 'none';
        renderMainChartInfoCard(buildSingleCardHtml(records.length - 1, false), false);
    }

    if (overlay && svgEl) {
        overlay.addEventListener('mousemove', (e) => {
            let svgX = padding.left;
            if (typeof svgEl.getScreenCTM === 'function') {
                const ctm = svgEl.getScreenCTM();
                if (ctm) {
                    const pt = svgEl.createSVGPoint();
                    pt.x = e.clientX;
                    pt.y = e.clientY;
                    const svgP = pt.matrixTransform(ctm.inverse());
                    svgX = svgP.x;
                }
            } else {
                const rect = svgEl.getBoundingClientRect ? svgEl.getBoundingClientRect() : { left: 0, width: 1000 };
                svgX = (e.clientX - (rect.left || 0)) * (width / (rect.width || 1));
            }
            const clampedX = Math.max(padding.left, Math.min(padding.left + plotW, svgX));
            const frac = (clampedX - padding.left) / plotW;
            const idx = Math.max(0, Math.min(records.length - 1, Math.round(frac * (records.length - 1))));
            setActivePoint(idx);
        });

        overlay.addEventListener('mouseleave', () => {
            clearActivePoint();
        });
    }

    // Set initial card state
    if (records.length > 0) {
        renderMainChartInfoCard(buildSingleCardHtml(records.length - 1, false), false);
    }
}

/**
 * Processes and groups history records by calendar year with full-year progression fractions and percentage return.
 */
function buildMainYearOverlaySeries(history, selectedYears, currency = 'CAD', unit = 'PCT') {
    const valKey = currency === 'USD' ? 'totalUSD' : 'totalCAD';
    const weeklyChgKey = currency === 'USD' ? 'weeklyChangeUSD' : 'weeklyChangeCAD';
    const selectedYearsList = Array.from(selectedYears || []).sort();
    const yearSeries = [];

    const sortedHistory = [...(history || [])].sort((a, b) => new Date(a.date) - new Date(b.date));

    // If 2024 is selected alongside other years (overlay active), we process other years first
    // so 2024 can dynamically find the lowest overlay node for its starting week.
    const is2024Overlay = selectedYearsList.includes('2024') && selectedYearsList.length > 1;
    const processOrder = is2024Overlay
        ? [...selectedYearsList.filter(y => y !== '2024'), '2024']
        : selectedYearsList;

    const activeFxRate = (typeof window !== 'undefined' && window.cachedPrices?.cadUsdRate)
        || (typeof rawBenchmarks !== 'undefined' && rawBenchmarks?.fx?.cadUsdRate)
        || 0.7073;

    processOrder.forEach(year => {
        const recs = sortedHistory.filter(r => r.date && r.date.startsWith(year));
        if (recs.length === 0) return;

        // Special handling for 2024 when overlaid with other years:
        if (year === '2024' && is2024Overlay && yearSeries.length > 0) {
            const firstRec = recs[0];
            const firstFrac = getDayOfYearFraction(firstRec.date);
            const isCurrencyUnit = unit !== 'PCT';
            const firstFx = (firstRec.totalCAD && firstRec.totalUSD)
                ? (firstRec.totalUSD / firstRec.totalCAD)
                : activeFxRate;

            // Find candidate nodes across all other overlaid years near 2024's start week
            const candidateNodes = [];
            yearSeries.forEach(s => {
                const validPoints = s.points.filter(p => !p.isAnchor);
                if (validPoints.length === 0) return;

                let closest = validPoints[0];
                let closestDist = Math.abs(closest.fraction - firstFrac);
                for (let i = 1; i < validPoints.length; i++) {
                    const d = Math.abs(validPoints[i].fraction - firstFrac);
                    if (d < closestDist) {
                        closestDist = d;
                        closest = validPoints[i];
                    }
                }

                // Accept if within a reasonable window of that week (~21 days / 0.06 fraction)
                if (closestDist <= 0.06) {
                    candidateNodes.push({
                        year: s.year,
                        point: closest,
                        pct: closest.pct,
                        val: closest.val,
                        fraction: closest.fraction,
                        date: closest.date
                    });
                }
            });

            if (candidateNodes.length > 0) {
                // "whatever for that week is lowest"
                const lowestNode = candidateNodes.reduce((min, cand) => {
                    if (isCurrencyUnit) {
                        return cand.val < min.val ? cand : min;
                    } else {
                        return cand.pct < min.pct ? cand : min;
                    }
                });

                const rawBaseVal = firstRec[valKey] || 1;
                const startPct = lowestNode.pct;
                const startVal = lowestNode.val;
                const impliedBaseVal = (startPct > -100 && Number.isFinite(startPct))
                    ? rawBaseVal / (1 + startPct / 100)
                    : rawBaseVal;

                const points = [];

                // 2024 starts directly from that node (no Jan 1 flat anchor line)
                points.push({
                    date: firstRec.date,
                    fraction: lowestNode.fraction, // Aligns perfectly on the X-axis with the lowest node
                    val: startVal,
                    pct: startPct,
                    weeklyChangeCAD: 0,
                    weeklyChangeUSD: 0,
                    weeklyChangePct: 0,
                    idx: 0,
                    isAnchor: false,
                    isOverlayStart: true,
                    overlayFromYear: lowestNode.year,
                    overlayFromDate: lowestNode.date,
                    rec: {
                        ...firstRec,
                        totalCAD: currency === 'CAD' ? startVal : (startVal / firstFx),
                        totalUSD: currency === 'USD' ? startVal : (startVal * firstFx),
                        weeklyChangeCAD: 0,
                        weeklyChangeUSD: 0,
                        weeklyChangePct: 0
                    }
                });

                // Subsequent points progress onwards from that node
                for (let idx = 1; idx < recs.length; idx++) {
                    const r = recs[idx];
                    const rVal = r[valKey] || 0;
                    const growthRatio = rawBaseVal > 0 ? rVal / rawBaseVal : 1.0;

                    const pct = ((1 + startPct / 100) * growthRatio - 1) * 100;
                    const val = startVal * growthRatio;
                    const prevVal = points[idx - 1].val;
                    const weeklyChg = val - prevVal;
                    const rFx = (r.totalCAD && r.totalUSD) ? (r.totalUSD / r.totalCAD) : firstFx;
                    const chgCAD = currency === 'CAD' ? weeklyChg : (weeklyChg / rFx);
                    const chgUSD = currency === 'USD' ? weeklyChg : (weeklyChg * rFx);

                    points.push({
                        date: r.date,
                        fraction: getDayOfYearFraction(r.date),
                        val: val,
                        pct: pct,
                        weeklyChangeCAD: chgCAD,
                        weeklyChangeUSD: chgUSD,
                        weeklyChangePct: r.weeklyChangePct || 0,
                        idx: idx,
                        isAnchor: false,
                        rec: {
                            ...r,
                            totalCAD: currency === 'CAD' ? val : (val / rFx),
                            totalUSD: currency === 'USD' ? val : (val * rFx),
                            weeklyChangeCAD: chgCAD,
                            weeklyChangeUSD: chgUSD
                        }
                    });
                }

                yearSeries.push({
                    year: '2024',
                    baseVal: impliedBaseVal,
                    color: getMainYearColor('2024'),
                    records: recs,
                    points: points,
                    chainedFromYear: lowestNode.year,
                    chainedStartPct: startPct,
                    chainedStartVal: startVal
                });

                return; // 2024 handled!
            }
        }

        // Standard year progression (Jan 1 anchor at 0.00%):
        // Determine baseline value entering the year (close of previous year or starting value)
        const priorRecs = sortedHistory.filter(r => r.date && r.date < `${year}-01-01`);
        let baseVal = 0;
        if (priorRecs.length > 0) {
            const lastPrior = priorRecs[priorRecs.length - 1];
            baseVal = lastPrior[valKey] || 0;
        }

        if (baseVal <= 0 && recs.length > 0) {
            const firstRec = recs[0];
            const chg = typeof firstRec[weeklyChgKey] === 'number' ? firstRec[weeklyChgKey] : 0;
            baseVal = (firstRec[valKey] || 0) - chg;
        }

        if (baseVal <= 0 && recs.length > 0) {
            baseVal = recs[0][valKey] || 1;
        }

        const anchorFx = (recs[0] && recs[0].totalCAD && recs[0].totalUSD)
            ? (recs[0].totalUSD / recs[0].totalCAD)
            : activeFxRate;

        const points = [];

        // Anchor at Jan 1 (0.00%)
        points.push({
            date: `${year}-01-01`,
            fraction: 0.0,
            val: baseVal,
            pct: 0.0,
            weeklyChangeCAD: 0,
            weeklyChangeUSD: 0,
            weeklyChangePct: 0,
            isAnchor: true,
            rec: {
                date: `${year}-01-01`,
                totalCAD: currency === 'CAD' ? baseVal : (baseVal / anchorFx),
                totalUSD: currency === 'USD' ? baseVal : (baseVal * anchorFx),
                weeklyChangeCAD: 0,
                weeklyChangeUSD: 0,
                weeklyChangePct: 0
            }
        });

        recs.forEach((r, idx) => {
            const val = r[valKey] || 0;
            const pct = baseVal > 0 ? ((val - baseVal) / baseVal) * 100 : 0;
            const prevVal = idx > 0 ? (recs[idx - 1][valKey] || val) : (baseVal || val);
            const weeklyChg = val - prevVal;
            const rFx = (r.totalCAD && r.totalUSD) ? (r.totalUSD / r.totalCAD) : activeFxRate;
            const chgCAD = r.weeklyChangeCAD !== undefined ? r.weeklyChangeCAD : (currency === 'CAD' ? weeklyChg : weeklyChg / rFx);
            const chgUSD = r.weeklyChangeUSD !== undefined ? r.weeklyChangeUSD : (currency === 'USD' ? weeklyChg : weeklyChg * rFx);

            points.push({
                date: r.date,
                fraction: getDayOfYearFraction(r.date),
                val: val,
                pct: pct,
                weeklyChangeCAD: chgCAD,
                weeklyChangeUSD: chgUSD,
                weeklyChangePct: r.weeklyChangePct || 0,
                idx: idx,
                isAnchor: false,
                rec: {
                    ...r,
                    weeklyChangeCAD: chgCAD,
                    weeklyChangeUSD: chgUSD
                }
            });
        });

        yearSeries.push({
            year,
            baseVal,
            color: getMainYearColor(year),
            records: recs,
            points: points
        });
    });

    // Ensure chronological order in yearSeries
    yearSeries.sort((a, b) => parseInt(a.year, 10) - parseInt(b.year, 10));

    const allPcts = [0];
    const allVals = [];
    yearSeries.forEach(s => {
        s.points.forEach(p => {
            if (typeof p.pct === 'number' && Number.isFinite(p.pct)) {
                allPcts.push(p.pct);
            }
            if (typeof p.val === 'number' && Number.isFinite(p.val)) {
                allVals.push(p.val);
            }
        });
    });

    let minPct = Math.min(...allPcts);
    let maxPct = Math.max(...allPcts);
    let minVal = allVals.length > 0 ? Math.min(...allVals) : 0;
    let maxVal = allVals.length > 0 ? Math.max(...allVals) : 0;

    // Dynamic padding & neat step intervals for % Y-axis
    const span = maxPct - minPct;
    const pad = span > 0 ? Math.max(1, span * 0.1) : 4;
    let step = 5;
    if (span + 2 * pad > 40) step = 10;
    else if (span + 2 * pad <= 14) step = 2;
    else if (span + 2 * pad <= 6) step = 1;

    const paddedMin = Math.floor((minPct - pad) / step) * step;
    const paddedMax = Math.ceil((maxPct + pad) / step) * step;

    // Dollar bounds for $ Y-axis
    const dollarRange = maxVal - minVal || 10000;
    const paddedDollarMin = Math.floor(Math.max(0, minVal - dollarRange * 0.08) / 10000) * 10000;
    const paddedDollarMax = Math.ceil((maxVal + dollarRange * 0.08) / 10000) * 10000;

    return {
        yearSeries,
        allPcts,
        allVals,
        minPct,
        maxPct,
        minVal,
        maxVal,
        paddedMin,
        paddedMax,
        paddedDollarMin,
        paddedDollarMax,
        step
    };
}

/**
 * Renders the multi-year overlay progression chart where the X-axis spans the full calendar year (Jan–Dec).
 * Supports both percentage (%) and currency ($) modes depending on currentMainUnit.
 */
function renderMainYearOverlayChart(box, tooltip, valKey, currency, width, height, padding, plotW, plotH, titleEl) {
    const selectedYearsList = Array.from(currentMainSelectedYears).sort();
    const isPct = currentMainUnit === 'PCT';

    const curLabel = currency === 'USD' ? 'USD' : 'CAD';
    if (titleEl) {
        const sortedDesc = [...selectedYearsList].reverse();
        if (isPct) {
            titleEl.textContent = sortedDesc.length > 1
                ? `📈 Net Worth Progression (% Overlay: ${sortedDesc.join(' vs ')})`
                : `📈 Net Worth Progression (% Year ${sortedDesc[0]} - ${curLabel})`;
        } else {
            titleEl.textContent = sortedDesc.length > 1
                ? `📈 Net Worth Progression (${curLabel} Overlay: ${sortedDesc.join(' vs ')})`
                : `📈 Net Worth Progression (${curLabel} - Year ${sortedDesc[0]})`;
        }
    }

    const overlayData = buildMainYearOverlaySeries(rawHistory, currentMainSelectedYears, currency, currentMainUnit);
    let { yearSeries, paddedMin, paddedMax, paddedDollarMin, paddedDollarMax, step } = overlayData;

    if (yearSeries.length === 0) {
        box.innerHTML = '<p class="empty-state" style="padding: 24px; text-align: center; color: #64748b;">No data available for the selected years.</p>';
        return;
    }

    const isSingleYear = selectedYearsList.length === 1;
    const xeqtBenchmark = rawBenchmarks?.benchmarks?.XEQT;
    const xeqtPrices = xeqtBenchmark?.weeklyPrices || [];
    const currentXeqtPrice = xeqtBenchmark?.currentPrice;
    const showXeqt = isSingleYear && currentMainOverlayXeqt && xeqtPrices.length > 0;
    let xeqtPoints = [];

    if (showXeqt && typeof computeXeqtProgressionOverlay === 'function') {
        const s0 = yearSeries[0];
        const recs = s0.records || [];
        if (recs.length > 0) {
            const xeqtOverlayData = computeXeqtProgressionOverlay(recs, rawHistory, xeqtPrices, currency, currentXeqtPrice);

            // Jan 1 Anchor if portfolio series has an anchor
            if (s0.points.length > 0 && s0.points[0].isAnchor) {
                xeqtPoints.push({
                    date: s0.points[0].date,
                    fraction: 0.0,
                    pct: 0.0,
                    val: s0.points[0].val,
                    isAnchor: true,
                    data: null
                });
            }

            xeqtOverlayData.forEach((item, idx) => {
                xeqtPoints.push({
                    date: item.date,
                    fraction: getDayOfYearFraction(item.date),
                    pct: item.returnPct,
                    val: item.val,
                    isAnchor: false,
                    data: item,
                    idx: idx
                });
            });

            // Adjust min/max bounds so XEQT is fully visible and not clipped
            const allPcts = [...overlayData.allPcts, ...xeqtPoints.map(p => p.pct)];
            const allVals = [...overlayData.allVals, ...xeqtPoints.map(p => p.val)];

            if (isPct) {
                const minPct = Math.min(...allPcts);
                const maxPct = Math.max(...allPcts);
                const span = maxPct - minPct;
                const pad = span > 0 ? Math.max(1, span * 0.1) : 4;

                step = 5;
                if (span + 2 * pad > 40) step = 10;
                else if (span + 2 * pad <= 14) step = 2;
                else if (span + 2 * pad <= 6) step = 1;

                paddedMin = Math.floor((minPct - pad) / step) * step;
                paddedMax = Math.ceil((maxPct + pad) / step) * step;
            } else {
                const minVal = Math.min(...allVals);
                const maxVal = Math.max(...allVals);
                const dollarRange = maxVal - minVal || 10000;
                paddedDollarMin = Math.floor(Math.max(0, minVal - dollarRange * 0.08) / 10000) * 10000;
                paddedDollarMax = Math.ceil((maxVal + dollarRange * 0.08) / 10000) * 10000;
            }
        }
    }

    let getY;
    if (isPct) {
        getY = (pct) => padding.top + plotH - ((pct - paddedMin) / (paddedMax - paddedMin)) * plotH;
    } else {
        getY = (val) => padding.top + plotH - ((val - paddedDollarMin) / (paddedDollarMax - paddedDollarMin)) * plotH;
    }

    // Y Gridlines
    let yGridHtml = '';
    if (isPct) {
        const tickCount = Math.round((paddedMax - paddedMin) / step);
        for (let i = 0; i <= tickCount; i++) {
            const p = Math.round((paddedMin + i * step) * 10) / 10;
            const y = getY(p);
            const sign = p > 0 ? '+' : '';
            const label = `${sign}${p}%`;
            const isZero = Math.abs(p) < 0.001;
            const strokeColor = isZero ? '#94a3b8' : '#e2e8f0';
            const strokeDash = isZero ? '' : 'stroke-dasharray="3 3"';
            const strokeWidth = isZero ? '1.5' : '1';
            const fontColor = isZero ? '#1e293b' : '#8c959f';
            const fontWeight = isZero ? '700' : 'normal';

            yGridHtml += `
                <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} />
                <text x="${padding.left - 8}" y="${(y + 4).toFixed(1)}" fill="${fontColor}" font-weight="${fontWeight}" font-size="11" text-anchor="end">${label}</text>
            `;
        }
    } else {
        const ySteps = 4;
        for (let i = 0; i <= ySteps; i++) {
            const val = paddedDollarMin + (i / ySteps) * (paddedDollarMax - paddedDollarMin);
            const y = getY(val);
            const label = currency === 'USD' ? `US$${(val / 1000).toFixed(0)}k` : `$${(val / 1000).toFixed(0)}k`;
            yGridHtml += `
                <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="3 3" />
                <text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}" fill="#8c959f" font-size="11" text-anchor="end">${label}</text>
            `;
        }
    }

    // X-Axis (Full Year: 12 Month columns Jan - Dec)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthDayStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const monthDaysCount = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    let xGridHtml = '';
    for (let m = 0; m < 12; m++) {
        const startFrac = monthDayStarts[m] / 365;
        const midFrac = (monthDayStarts[m] + monthDaysCount[m] / 2) / 365;
        const startX = padding.left + startFrac * plotW;
        const midX = padding.left + midFrac * plotW;

        if (m > 0) {
            xGridHtml += `
                <line x1="${startX.toFixed(1)}" y1="${padding.top}" x2="${startX.toFixed(1)}" y2="${padding.top + plotH}" stroke="#f1f5f9" stroke-width="1" />
            `;
        }
        xGridHtml += `
            <text x="${midX.toFixed(1)}" y="${height - 8}" fill="#8c959f" font-size="11" text-anchor="middle">${monthNames[m]}</text>
        `;
    }

    // SVG paths and point markers
    let defsHtml = '';
    let pathsHtml = '';
    let pointsHtml = '';

    yearSeries.forEach(s => {
        const pts = s.points.map((p, i) => ({
            x: padding.left + p.fraction * plotW,
            y: getY(isPct ? p.pct : p.val),
            p,
            idx: i
        }));

        if (pts.length === 0) return;

        const linePathD = 'M ' + pts.map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' L ');

        if (yearSeries.length === 1) {
            const areaPathD = `${linePathD} L ${pts[pts.length - 1].x.toFixed(1)},${padding.top + plotH} L ${pts[0].x.toFixed(1)},${padding.top + plotH} Z`;
            defsHtml += `
                <linearGradient id="mainAreaGrad_${s.year}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${s.color}" stop-opacity="0.22" />
                    <stop offset="100%" stop-color="${s.color}" stop-opacity="0.0" />
                </linearGradient>
            `;
            pathsHtml += `
                <path d="${areaPathD}" fill="url(#mainAreaGrad_${s.year})" />
            `;
        }

        pathsHtml += `
            <path d="${linePathD}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        `;

        pointsHtml += pts.filter(pt => !pt.p.isAnchor).map(pt => {
            const isStart = pt.p.isOverlayStart;
            const r = isStart ? '4.5' : '3.2';
            const strokeW = isStart ? '2.4' : '1.8';
            const fill = isStart ? '#ffffff' : s.color;
            const stroke = isStart ? s.color : '#ffffff';
            return `
                <circle class="main-overlay-point" data-year="${s.year}" data-idx="${pt.idx}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />
            `;
        }).join('');
    });

    let xeqtPathHtml = '';
    let xeqtPointsHtml = '';
    let xeqtPlotPoints = [];

    if (showXeqt && xeqtPoints.length > 0) {
        xeqtPlotPoints = xeqtPoints.map((p, i) => ({
            x: padding.left + p.fraction * plotW,
            y: getY(isPct ? p.pct : p.val),
            p,
            idx: i
        }));

        const xeqtLinePathD = 'M ' + xeqtPlotPoints.map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' L ');
        xeqtPathHtml = `
            <path d="${xeqtLinePathD}" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-dasharray="4,4" stroke-linecap="round" stroke-linejoin="round" />
        `;

        xeqtPointsHtml = xeqtPlotPoints.filter(pt => !pt.p.isAnchor).map(pt => `
            <circle class="main-year-xeqt-point" data-idx="${pt.idx}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.2" fill="#ffffff" stroke="#16a34a" stroke-width="1.8" />
        `).join('');
    }

    const crosshairHtml = `
        <line id="main-overlay-cursor" x1="0" y1="${padding.top}" x2="0" y2="${padding.top + plotH}" stroke="#475569" stroke-width="1.5" stroke-dasharray="3,3" style="display: none; pointer-events: none;" />
        <g id="main-overlay-hover-dots" style="pointer-events: none;"></g>
        <rect id="main-overlay-mouse-capture" x="${padding.left}" y="${padding.top}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor: crosshair;" />
    `;

    const svg = `
        <svg viewBox="0 0 ${width} ${height}" class="svg-chart" id="main-networth-svg" style="width: 100%; max-height: 220px; display: block; overflow: visible;">
            <defs>
                ${defsHtml}
            </defs>
            ${yGridHtml}
            ${xGridHtml}
            ${pathsHtml}
            ${xeqtPathHtml}
            ${pointsHtml}
            ${xeqtPointsHtml}
            ${crosshairHtml}
        </svg>
    `;

    box.innerHTML = svg;

    // Interactive mouse tracking across calendar year X-axis
    const captureRect = box.querySelector('#main-overlay-mouse-capture');
    const cursorLine = box.querySelector('#main-overlay-cursor');
    const hoverDotsGroup = box.querySelector('#main-overlay-hover-dots');
    const svgEl = box.querySelector('#main-networth-svg');

    if (tooltip) {
        tooltip.style.display = 'none';
    }

    function buildYearOverlayDefaultCardHtml() {
        let yearRows = yearSeries.map(s => {
            const last = s.points[s.points.length - 1];
            const sign = last.pct >= 0 ? '+' : '';
            const color = last.pct >= 0 ? '#16a34a' : '#cf222e';
            return `
                <div class="chart-card-row">
                    <span style="display: flex; align-items: center; gap: 6px;">
                        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${s.color}; display: inline-block;"></span>
                        <strong style="color: ${s.color}">${s.year}</strong>:
                    </span>
                    <span>
                        <strong style="color: ${color}">${isPct ? `${sign}${last.pct.toFixed(2)}%` : formatCurrency(last.val, currency)}</strong>
                        <span style="color: #64748b; font-size: 0.72rem;">(${isPct ? formatCurrency(last.val, currency) : `${sign}${last.pct.toFixed(2)}%`})</span>
                    </span>
                </div>
            `;
        }).join('');

        return `
            <div class="chart-card-header">
                <span class="chart-card-date">Multi-Year Trajectory</span>
                <span class="chart-card-badge">OVERLAY</span>
            </div>
            <div class="chart-card-sub-val" style="color: #64748b; margin-bottom: 8px;">
                ${yearSeries.map(s => s.year).join(' vs ')} across calendar days
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
                ${yearRows}
            </div>
            <div class="chart-card-footer">
                💡 Hover across calendar months to compare trajectories
            </div>
        `;
    }

    if (captureRect && cursorLine && hoverDotsGroup && svgEl) {
        captureRect.addEventListener('mousemove', (e) => {
            let mouseSvgX = padding.left;
            if (typeof svgEl.getScreenCTM === 'function') {
                const ctm = svgEl.getScreenCTM();
                if (ctm) {
                    const pt = svgEl.createSVGPoint();
                    pt.x = e.clientX;
                    pt.y = e.clientY;
                    const svgP = pt.matrixTransform(ctm.inverse());
                    mouseSvgX = svgP.x;
                }
            } else {
                const rect = svgEl.getBoundingClientRect ? svgEl.getBoundingClientRect() : { left: 0, width: 1000 };
                mouseSvgX = (e.clientX - (rect.left || 0)) * (width / (rect.width || 1));
            }

            const clampedX = Math.max(padding.left, Math.min(width - padding.right, mouseSvgX));
            const frac = (clampedX - padding.left) / plotW;

            cursorLine.setAttribute('x1', clampedX.toFixed(1));
            cursorLine.setAttribute('x2', clampedX.toFixed(1));
            cursorLine.style.display = 'block';

            let hoverDotsHtml = '';
            const activeYearDetails = [];

            yearSeries.forEach(s => {
                const startFrac = s.points[0] ? s.points[0].fraction : 0;
                if (frac < startFrac - 0.02) {
                    return;
                }

                let closest = s.points[0];
                let closestDist = Infinity;
                s.points.forEach(p => {
                    const dist = Math.abs(p.fraction - frac);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closest = p;
                    }
                });

                if (closest && closestDist <= 0.05) {
                    const cx = (padding.left + closest.fraction * plotW).toFixed(1);
                    const cy = getY(isPct ? closest.pct : closest.val).toFixed(1);
                    hoverDotsHtml += `
                        <circle cx="${cx}" cy="${cy}" r="5.5" fill="${s.color}" stroke="#ffffff" stroke-width="2" />
                    `;
                    activeYearDetails.push({
                        year: s.year,
                        color: s.color,
                        point: closest,
                        cx,
                        cy
                    });
                }
            });

            let closestXeqt = null;
            if (showXeqt && xeqtPlotPoints.length > 0) {
                let closestXeqtDist = Infinity;
                xeqtPlotPoints.forEach(pt => {
                    const dist = Math.abs(pt.p.fraction - frac);
                    if (dist < closestXeqtDist) {
                        closestXeqtDist = dist;
                        closestXeqt = pt;
                    }
                });

                if (closestXeqt && closestXeqtDist <= 0.05) {
                    hoverDotsHtml += `
                        <circle cx="${closestXeqt.x.toFixed(1)}" cy="${closestXeqt.y.toFixed(1)}" r="5.5" fill="#16a34a" stroke="#ffffff" stroke-width="2" />
                    `;
                }
            }

            hoverDotsGroup.innerHTML = hoverDotsHtml;

            const approxMonthIdx = Math.max(0, Math.min(11, Math.floor(frac * 12)));
            activeYearDetails.sort((a, b) => parseInt(b.year, 10) - parseInt(a.year, 10));

            let yearRows = activeYearDetails.map(d => {
                const p = d.point;
                const pctSign = p.pct >= 0 ? '+' : '';
                const pctColor = p.pct >= 0 ? '#16a34a' : '#cf222e';
                const weeklyChgVal = currency === 'USD'
                    ? (p.weeklyChangeUSD !== undefined ? p.weeklyChangeUSD : (p.rec?.weeklyChangeUSD || 0))
                    : (p.weeklyChangeCAD !== undefined ? p.weeklyChangeCAD : (p.rec?.weeklyChangeCAD || 0));
                const weeklySign = weeklyChgVal >= 0 ? '+' : '';
                const weeklyColor = weeklyChgVal >= 0 ? '#16a34a' : '#cf222e';
                const weeklyPctSign = p.weeklyChangePct >= 0 ? '+' : '';

                return `
                    <div style="margin-bottom: 6px;">
                        <div class="chart-card-row">
                            <span style="display: flex; align-items: center; gap: 5px;">
                                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${d.color};"></span>
                                <strong style="color: ${d.color}; font-size: 0.82rem;">${d.year}</strong>
                                <span style="color: #64748b; font-size: 0.72rem;">(${formatDate(p.date)})</span>
                            </span>
                            <span>
                                <strong style="color: #1e293b;">${formatCurrency(p.val, currency)}</strong>
                                <span style="color: ${pctColor}; font-weight: 700; font-size: 0.76rem;">(${pctSign}${p.pct.toFixed(2)}%)</span>
                            </span>
                        </div>
                        ${p.isOverlayStart ? `
                            <div style="font-size: 0.71rem; color: #d97706; padding-left: 13px; font-weight: 600;">
                                ↳ Starts from ${p.overlayFromYear} node (${formatDate(p.overlayFromDate)})
                            </div>
                        ` : (!p.isAnchor ? `
                            <div style="font-size: 0.71rem; color: ${weeklyColor}; padding-left: 13px;">
                                Weekly: ${weeklySign}${formatCurrency(weeklyChgVal, currency)} (${weeklyPctSign}${p.weeklyChangePct.toFixed(2)}%)
                            </div>
                        ` : `
                            <div style="font-size: 0.71rem; color: #94a3b8; padding-left: 13px; font-style: italic;">
                                Baseline (Jan 1, 0.00%)
                            </div>
                        `)}
                    </div>
                `;
            }).join('');

            let xeqtCardHtml = '';
            if (showXeqt && closestXeqt && closestXeqt.p.data) {
                const xPct = closestXeqt.p.pct;
                const xVal = closestXeqt.p.val;
                const xSign = xPct >= 0 ? '+' : '';
                const xColor = xPct >= 0 ? '#16a34a' : '#cf222e';
                const xValStr = formatCurrency(xVal, currency);
                const xRetStr = `${xSign}${xPct.toFixed(2)}%`;

                const portPoint = activeYearDetails[0]?.point;
                const portPct = portPoint ? portPoint.pct : 0;
                const portVal = portPoint ? portPoint.val : 0;
                const spreadPct = portPct - xPct;
                const spreadVal = portVal - xVal;
                const spreadSign = spreadPct >= 0 ? '+' : '';
                const spreadColor = spreadPct >= 0 ? '#16a34a' : '#cf222e';

                xeqtCardHtml = `
                    <div class="chart-card-section-divider">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                            <span style="color: #16a34a; font-weight: 700;">🟢 XEQT Benchmark:</span>
                            <strong style="color: #16a34a;">${isPct ? xRetStr : xValStr}</strong>
                        </div>
                        <div class="chart-card-row" style="color: #64748b;">
                            <span>Spread:</span>
                            <strong style="color: ${spreadColor};">${spreadSign}${spreadPct.toFixed(2)}% pts (${spreadSign}${formatCurrency(spreadVal, currency)})</strong>
                        </div>
                    </div>
                `;
            }

            let compCardHtml = '';
            if (activeYearDetails.length >= 2) {
                const newest = activeYearDetails[0];
                const prior = activeYearDetails[1];
                const pctDiff = newest.point.pct - prior.point.pct;
                const spSign = pctDiff >= 0 ? '+' : '';
                const spColor = pctDiff >= 0 ? '#16a34a' : '#cf222e';
                const valDiff = newest.point.val - prior.point.val;
                const valSign = valDiff >= 0 ? '+' : '';

                compCardHtml = `
                    <div class="chart-card-section-divider">
                        <div class="chart-card-row">
                            <span>Diff (${newest.year} vs ${prior.year}):</span>
                            <strong style="color: ${spColor};">${spSign}${pctDiff.toFixed(2)}% pts</strong>
                        </div>
                        <div class="chart-card-row" style="color: #64748b;">
                            <span>Net Worth Gap:</span>
                            <span>${valSign}${formatCurrency(valDiff, currency)}</span>
                        </div>
                    </div>
                `;
            }

            const cardContent = `
                <div class="chart-card-header">
                    <span class="chart-card-date">🗓️ ${monthNames[approxMonthIdx]} &bull; Day ~${Math.round(frac * 365)}</span>
                    <span class="chart-card-badge" style="background: #e0f2fe; color: #0284c7;">INSPECTING</span>
                </div>
                <div>${yearRows}</div>
                ${xeqtCardHtml}
                ${compCardHtml}
                <div class="chart-card-footer">
                    💡 Hover across calendar months to compare trajectories
                </div>
            `;

            renderMainChartInfoCard(cardContent, true);
        });

        captureRect.addEventListener('mouseleave', () => {
            cursorLine.style.display = 'none';
            hoverDotsGroup.innerHTML = '';
            renderMainChartInfoCard(buildYearOverlayDefaultCardHtml(), false);
        });
    }

    // Set initial card state for overlay
    renderMainChartInfoCard(buildYearOverlayDefaultCardHtml(), false);

    // Legend
    const legendEl = document.getElementById('main-chart-legend');
    if (legendEl) {
        let itemsHtml = yearSeries.map(s => {
            const last = s.points[s.points.length - 1];
            const sign = last.pct >= 0 ? '+' : '';
            const color = last.pct >= 0 ? '#16a34a' : '#cf222e';
            const chainedBadge = s.chainedFromYear
                ? `<span style="font-size: 0.68rem; color: #d97706; background: rgba(217, 119, 6, 0.12); padding: 1px 5px; border-radius: 3px; margin-left: 3px;" title="Starts onwards from lowest overlay node (${s.chainedFromYear} @ ${s.chainedStartPct >= 0 ? '+' : ''}${s.chainedStartPct.toFixed(1)}%)">from ${s.chainedFromYear} (${s.chainedStartPct >= 0 ? '+' : ''}${s.chainedStartPct.toFixed(1)}%)</span>`
                : '';
            return `
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 12px; height: 3px; background: ${s.color}; border-radius: 2px;"></span>
                    <strong style="color: ${s.color};">${s.year}</strong>${chainedBadge}:
                    <span style="font-weight: 700; color: ${color};">${isPct ? `${sign}${last.pct.toFixed(2)}%` : formatCurrency(last.val, currency)}</span>
                    <span style="color: #64748b; font-size: 0.74rem;">(${isPct ? formatCurrency(last.val, currency) : `${sign}${last.pct.toFixed(2)}%`})</span>
                </div>
            `;
        }).join('');

        if (yearSeries.length >= 2) {
            const sortedDesc = [...yearSeries].sort((a, b) => parseInt(b.year, 10) - parseInt(a.year, 10));
            const newest = sortedDesc[0].points[sortedDesc[0].points.length - 1];
            const prior = sortedDesc[1].points[sortedDesc[1].points.length - 1];
            const diff = newest.pct - prior.pct;
            const valDiff = newest.val - prior.val;
            const sign = diff >= 0 ? '+' : '';
            const valSign = valDiff >= 0 ? '+' : '';
            const color = diff >= 0 ? '#16a34a' : '#cf222e';
            const bg = diff >= 0 ? 'rgba(22, 163, 74, 0.1)' : 'rgba(207, 34, 46, 0.1)';

            itemsHtml += `
                <div style="font-size: 0.75rem; font-weight: 700; color: ${color}; background: ${bg}; padding: 2px 8px; border-radius: 4px; border: 1px solid ${color}30;">
                    ${sortedDesc[0].year} vs ${sortedDesc[1].year}: ${isPct ? `${sign}${diff.toFixed(2)}% pts` : `${valSign}${formatCurrency(valDiff, currency)} (${sign}${diff.toFixed(2)}% pts)`}
                </div>
            `;
        }

        if (showXeqt && xeqtPlotPoints.length > 0) {
            const lastXeqt = xeqtPlotPoints[xeqtPlotPoints.length - 1].p;
            const lastPort = yearSeries[0].points[yearSeries[0].points.length - 1];
            const xeqtSign = lastXeqt.pct >= 0 ? '+' : '';
            const xeqtColor = lastXeqt.pct >= 0 ? '#16a34a' : '#cf222e';
            const spreadPct = lastPort.pct - lastXeqt.pct;
            const spreadVal = lastPort.val - lastXeqt.val;
            const spreadSign = spreadPct >= 0 ? '+' : '';
            const spreadColor = spreadPct >= 0 ? '#16a34a' : '#cf222e';
            const spreadBg = spreadPct >= 0 ? 'rgba(22, 163, 74, 0.1)' : 'rgba(207, 34, 46, 0.1)';

            itemsHtml += `
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 16px; height: 0; border-top: 2.5px dashed #16a34a;"></span>
                    <strong style="color: #16a34a;">XEQT Benchmark (${currency})</strong>:
                    <span style="font-weight: 700; color: ${xeqtColor};">${isPct ? `${xeqtSign}${lastXeqt.pct.toFixed(2)}%` : formatCurrency(lastXeqt.val, currency)}</span>
                    <span style="color: #64748b; font-size: 0.74rem;">(${isPct ? formatCurrency(lastXeqt.val, currency) : `${xeqtSign}${lastXeqt.pct.toFixed(2)}%`})</span>
                </div>
                <div style="font-size: 0.75rem; font-weight: 700; color: ${spreadColor}; background: ${spreadBg}; padding: 2px 8px; border-radius: 4px; border: 1px solid ${spreadColor}30;">
                    Spread: ${spreadSign}${spreadPct.toFixed(2)}% pts (${spreadSign}${formatCurrency(spreadVal, currency)})
                </div>
            `;
        }

        legendEl.innerHTML = itemsHtml;
    }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', () => {
        if (rawHistory && rawHistory.length > 0) {
            renderMainProgressionChart();
        }
    });
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
        initMain();
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        renderMainProgressionChart,
        renderMainYearOverlayChart,
        renderMainTopStats,
        toggleMainXeqtOverlay,
        calculateTimeBack,
        setMainTimeframe,
        setMainCurrency,
        setMainUnit,
        getDayOfYearFraction,
        getMainYearColor,
        syncMainTimeframeButtons,
        buildMainYearOverlaySeries,
        getMainChartState: () => ({
            currentMainMode,
            currentMainSingleTimeframe,
            currentMainSelectedYears: new Set(currentMainSelectedYears),
            currentMainTimeframe,
            currentMainCurrency,
            currentMainUnit
        }),
        resetMainChartState: () => {
            currentMainMode = 'single';
            currentMainSingleTimeframe = 'last-52';
            currentMainSelectedYears.clear();
            currentMainTimeframe = 'last-52';
            currentMainCurrency = 'CAD';
            currentMainUnit = 'VAL';
            currentMainOverlayXeqt = false;
        },
        setMainChartData: (history, benchmarks) => {
            rawHistory = history || [];
            rawBenchmarks = benchmarks;
        }
    };
}
