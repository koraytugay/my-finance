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
    const totalUSD = lastRecord ? lastRecord.totalUSD : (totalCAD * 0.7073);

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

    const catStocks = mainData.categories.find(c => c.name === 'Stocks') || { value: 0, percentage: '0%' };
    const catFixed = mainData.categories.find(c => c.name === 'Fixed Income') || { value: 0, percentage: '0%' };
    const catMetals = mainData.categories.find(c => c.name === 'Precious Metals') || { value: 0 };
    const catCrypto = mainData.categories.find(c => c.name === 'Crypto') || { value: 0 };
    const altsVal = catMetals.value + catCrypto.value;
    const altsPct = totalCAD > 0 ? (altsVal / totalCAD * 100).toFixed(2) + '%' : '0.00%';

    document.getElementById('main-stat-stocks').textContent = formatCurrency(catStocks.value, 'CAD');
    document.getElementById('main-stat-stocks-pct').textContent = `${catStocks.percentage} of portfolio`;

    document.getElementById('main-stat-fixed').textContent = formatCurrency(catFixed.value, 'CAD');
    document.getElementById('main-stat-fixed-pct').textContent = `${catFixed.percentage} of portfolio`;

    document.getElementById('main-stat-alts').textContent = formatCurrency(altsVal, 'CAD');
    document.getElementById('main-stat-alts-pct').textContent = `${altsPct} of portfolio`;

    const athValue = mainData.metrics?.athValue || 0;
    const diffFromAth = totalCAD - athValue;
    const isAth = diffFromAth >= -1.0;
    const athEl = document.getElementById('main-stat-ath');
    const athLabelEl = document.getElementById('main-stat-ath-label');
    const athValEl = document.getElementById('main-stat-ath-val');

    if (isAth) {
        athEl.textContent = '🟢 ATH!';
        athEl.style.color = '#16a34a';
        if (athLabelEl) athLabelEl.textContent = 'All-Time High Status';
        athValEl.textContent = `At Peak: ${formatCurrency(athValue, 'CAD')}`;
    } else {
        const diffPct = athValue > 0 ? (diffFromAth / athValue) * 100 : 0;
        athEl.textContent = formatCurrency(diffFromAth, 'CAD');
        athEl.style.color = '#dc2626';
        if (athLabelEl) athLabelEl.textContent = 'Off All-Time High';
        athValEl.textContent = `${diffPct.toFixed(2)}% \u2022 Peak: ${formatCurrency(athValue, 'CAD')}`;
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
}

function syncMainTimeframeButtons(history) {
    const container = document.getElementById('main-timeframe-toggle');
    if (!container || !history || history.length === 0) return;

    const availableYears = [...new Set(
        history.map(r => r.date ? r.date.split('-')[0] : null).filter(y => y && /^\d{4}$/.test(y))
    )].sort().reverse();

    if (availableYears.length === 0) return;

    let html = `
        <button type="button" class="btn-secondary timeframe-pill ${currentMainMode === 'single' && currentMainSingleTimeframe === 'all' ? 'active' : ''}" data-timeframe="all" onclick="setMainTimeframe('all')" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 700; border: none; border-radius: 0; background: ${currentMainMode === 'single' && currentMainSingleTimeframe === 'all' ? '#1f2328' : 'white'}; color: ${currentMainMode === 'single' && currentMainSingleTimeframe === 'all' ? 'white' : '#24292f'};" title="Show All-Time historical graph">All Time</button>
        <button type="button" class="btn-secondary timeframe-pill ${currentMainMode === 'single' && currentMainSingleTimeframe === 'last-52' ? 'active' : ''}" data-timeframe="last-52" onclick="setMainTimeframe('last-52')" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 700; border: none; border-radius: 0; border-left: 1px solid #d0d7de; background: ${currentMainMode === 'single' && currentMainSingleTimeframe === 'last-52' ? '#1f2328' : 'white'}; color: ${currentMainMode === 'single' && currentMainSingleTimeframe === 'last-52' ? 'white' : '#24292f'};" title="Show Last 52 Weeks graph">Last 52W</button>
    `;

    availableYears.forEach(year => {
        const isActive = currentMainMode === 'years' && currentMainSelectedYears.has(year);
        const yrColor = getMainYearColor(year);
        const bg = isActive ? yrColor : 'white';
        const color = isActive ? 'white' : '#24292f';
        html += `
            <button type="button" class="btn-secondary timeframe-pill ${isActive ? 'active' : ''}" data-timeframe="${year}" onclick="setMainTimeframe('${year}')" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 700; border: none; border-radius: 0; border-left: 1px solid #d0d7de; background: ${bg}; color: ${color};" title="Toggle Year ${year} overlay">${year}</button>
        `;
    });

    container.innerHTML = html;
}

function setMainTimeframe(tf) {
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

    updateMainTimeframeButtonsUI();
    renderMainProgressionChart();
}

function setMainCurrency(curr) {
    currentMainCurrency = curr;
    if (typeof document !== 'undefined') {
        const btnCad = document.getElementById('btn-main-cur-cad');
        const btnUsd = document.getElementById('btn-main-cur-usd');
        if (btnCad && btnUsd) {
            if (curr === 'CAD') {
                btnCad.classList.add('active');
                btnCad.style.background = '#1f2328';
                btnCad.style.color = 'white';
                btnUsd.classList.remove('active');
                btnUsd.style.background = 'white';
                btnUsd.style.color = '#24292f';
            } else {
                btnUsd.classList.add('active');
                btnUsd.style.background = '#1f2328';
                btnUsd.style.color = 'white';
                btnCad.classList.remove('active');
                btnCad.style.background = 'white';
                btnCad.style.color = '#24292f';
            }
        }
    }
    renderMainProgressionChart();
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
 * Renders the single-curve progression chart ("All Time" or "Last 52 Weeks").
 */
function renderMainSingleChart(box, tooltip, valKey, currency, width, height, padding, plotW, plotH, titleEl) {
    const timeframe = currentMainSingleTimeframe || 'last-52';

    if (titleEl) {
        titleEl.textContent = timeframe === 'all'
            ? '📈 Net Worth Progression (All Time)'
            : '📈 Net Worth Progression (Last 52 Weeks)';
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

    const allChartVals = records.map(r => r[valKey]);
    if (showXeqt && xeqtSeries.length > 0) {
        allChartVals.push(...xeqtSeries.map(x => x.val));
    }

    let minVal = Math.min(...allChartVals);
    let maxVal = Math.max(...allChartVals);
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
        const label = currency === 'USD' ? `US$${(val / 1000).toFixed(0)}k` : `$${(val / 1000).toFixed(0)}k`;
        gridLinesHtml += `
            <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="3 3" />
            <text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}" fill="#8c959f" font-size="11" text-anchor="end">${label}</text>
        `;
    }

    // X Date ticks
    let xTicksHtml = '';
    const numTicks = Math.min(records.length, 7);
    for (let i = 0; i < numTicks; i++) {
        const idx = Math.round((i / (numTicks - 1 || 1)) * (records.length - 1));
        const rec = records[idx];
        const x = getX(idx);
        const label = formatDate(rec.date);
        xTicksHtml += `
            <line x1="${x.toFixed(1)}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${padding.top + plotH}" stroke="#f1f5f9" stroke-width="1" />
            <text x="${x.toFixed(1)}" y="${height - 8}" fill="#8c959f" font-size="11" text-anchor="middle">${label}</text>
        `;
    }

    // Portfolio line and area
    const points = records.map((r, i) => `${getX(i).toFixed(1)},${getY(r[valKey]).toFixed(1)}`);
    const linePathD = 'M ' + points.join(' L ');
    const areaPathD = `${linePathD} L ${getX(records.length - 1).toFixed(1)},${padding.top + plotH} L ${getX(0).toFixed(1)},${padding.top + plotH} Z`;

    const hoverPointsHtml = records.map((r, i) => {
        const cx = getX(i).toFixed(1);
        const cy = getY(r[valKey]).toFixed(1);
        return `
            <circle class="main-chart-point" data-idx="${i}" cx="${cx}" cy="${cy}" r="3.5" fill="#0969da" stroke="#ffffff" stroke-width="2" style="cursor: pointer;" />
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
                <circle class="main-xeqt-point" data-idx="${i}" cx="${cx}" cy="${cy}" r="3.2" fill="#ffffff" stroke="#16a34a" stroke-width="1.8" style="cursor: pointer;" />
            `;
        }).join('');
    }

    const svg = `
        <svg viewBox="0 0 ${width} ${height}" class="svg-chart" id="main-networth-svg" style="width: 100%; max-height: 220px; display: block;">
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
        </svg>
    `;

    box.innerHTML = svg;

    // Update legend
    const legendEl = document.getElementById('main-chart-legend');
    if (legendEl) {
        if (showXeqt && xeqtSeries.length > 0) {
            const startVal = records[0][valKey];
            const lastItem = xeqtSeries[xeqtSeries.length - 1];
            const spreadSign = lastItem.spreadVal >= 0 ? '+' : '';
            const spreadColor = lastItem.spreadVal >= 0 ? '#16a34a' : '#cf222e';
            const spreadBg = lastItem.spreadVal >= 0 ? 'rgba(22, 163, 74, 0.1)' : 'rgba(207, 34, 46, 0.1)';
            legendEl.innerHTML = `
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 12px; height: 3px; background: #0969da; border-radius: 2px;"></span>
                    <strong style="color: #1f2328;">Portfolio Net Worth</strong>
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
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span class="legend-dot" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #0969da;"></span> Total Net Worth &bull; Hover any data point to inspect breakdown
                </div>
            `;
        }
    }

    const container = document.getElementById('main-chart-container');
    const allInteractivePoints = box.querySelectorAll('.main-chart-point, .main-xeqt-point');
    allInteractivePoints.forEach(circle => {
        circle.addEventListener('mouseenter', (e) => {
            const idx = parseInt(e.target.getAttribute('data-idx'), 10);
            const r = records[idx];

            const portPoint = box.querySelector(`.main-chart-point[data-idx="${idx}"]`);
            const xeqtPoint = box.querySelector(`.main-xeqt-point[data-idx="${idx}"]`);

            if (portPoint) {
                portPoint.setAttribute('r', '6');
                portPoint.setAttribute('fill', '#054da7');
            }
            if (xeqtPoint) {
                xeqtPoint.setAttribute('r', '5.5');
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
                <div style="font-size: 1.05rem; font-weight: 800; color: #58a6ff;">${totalVal}</div>
                <div style="margin-top: 3px; font-size: 0.78rem; color: ${changeColor};">Weekly: ${weeklyChangeStr}</div>
                ${xeqtHtml}
                <div style="font-size: 0.74rem; color: #cbd5e1; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 4px;">
                    Stocks: ${formatCurrency(r.stocks)} &bull; Fixed: ${formatCurrency(r.fixed)}<br>
                    Metals: ${formatCurrency(r.preciousMetals)} &bull; Crypto: ${formatCurrency(r.crypto)}
                </div>
            `;
            tooltip.style.display = 'block';

            const parentRect = container.getBoundingClientRect();
            const targetCircle = portPoint || xeqtPoint || circle;
            const circleRect = targetCircle.getBoundingClientRect();
            let left = circleRect.left - parentRect.left + 10;
            let top = circleRect.top - parentRect.top - 65;

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
            const portPoint = box.querySelector(`.main-chart-point[data-idx="${idx}"]`);
            const xeqtPoint = box.querySelector(`.main-xeqt-point[data-idx="${idx}"]`);

            if (portPoint) {
                portPoint.setAttribute('r', '3.5');
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

/**
 * Processes and groups history records by calendar year with full-year progression fractions.
 */
function buildMainYearOverlaySeries(history, selectedYears, currency = 'CAD') {
    const valKey = currency === 'USD' ? 'totalUSD' : 'totalCAD';
    const selectedYearsList = Array.from(selectedYears || []).sort();
    const yearSeries = [];

    selectedYearsList.forEach(year => {
        const recs = (history || []).filter(r => r.date && r.date.startsWith(year));
        if (recs.length > 0) {
            yearSeries.push({
                year,
                records: recs,
                color: getMainYearColor(year),
                points: recs.map((r, i) => ({
                    date: r.date,
                    fraction: getDayOfYearFraction(r.date),
                    val: r[valKey],
                    weeklyChangeCAD: r.weeklyChangeCAD || 0,
                    weeklyChangePct: r.weeklyChangePct || 0,
                    idx: i,
                    rec: r
                }))
            });
        }
    });

    const allVals = [];
    yearSeries.forEach(s => {
        s.records.forEach(r => {
            const v = r[valKey];
            if (typeof v === 'number' && Number.isFinite(v)) allVals.push(v);
        });
    });

    let minVal = allVals.length > 0 ? Math.min(...allVals) : 0;
    let maxVal = allVals.length > 0 ? Math.max(...allVals) : 0;
    const range = maxVal - minVal || 10000;
    const paddedMin = Math.floor(Math.max(0, minVal - range * 0.08) / 10000) * 10000;
    const paddedMax = Math.ceil((maxVal + range * 0.08) / 10000) * 10000;

    return {
        yearSeries,
        allVals,
        minVal,
        maxVal,
        paddedMin,
        paddedMax
    };
}

/**
 * Renders the multi-year overlay progression chart where the X-axis spans the full calendar year (Jan–Dec).
 */
function renderMainYearOverlayChart(box, tooltip, valKey, currency, width, height, padding, plotW, plotH, titleEl) {
    const selectedYearsList = Array.from(currentMainSelectedYears).sort();

    if (titleEl) {
        const sortedDesc = [...selectedYearsList].reverse();
        titleEl.textContent = sortedDesc.length > 1
            ? `📈 Net Worth Progression (Overlay: ${sortedDesc.join(' vs ')})`
            : `📈 Net Worth Progression (Year ${sortedDesc[0]})`;
    }

    const overlayData = buildMainYearOverlaySeries(rawHistory, currentMainSelectedYears, currency);
    const { yearSeries, paddedMin: minVal, paddedMax: maxVal } = overlayData;

    if (yearSeries.length === 0) {
        box.innerHTML = '<p class="empty-state" style="padding: 24px; text-align: center; color: #64748b;">No data available for the selected years.</p>';
        return;
    }

    const getY = (val) => padding.top + plotH - ((val - minVal) / (maxVal - minVal)) * plotH;
    const getX = (dateStr) => padding.left + getDayOfYearFraction(dateStr) * plotW;

    // Y Gridlines (4 steps)
    const ySteps = 4;
    let yGridHtml = '';
    for (let i = 0; i <= ySteps; i++) {
        const val = minVal + (i / ySteps) * (maxVal - minVal);
        const y = getY(val);
        const label = currency === 'USD' ? `US$${(val / 1000).toFixed(0)}k` : `$${(val / 1000).toFixed(0)}k`;
        yGridHtml += `
            <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(width - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="3 3" />
            <text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}" fill="#8c959f" font-size="11" text-anchor="end">${label}</text>
        `;
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
        const pts = s.records.map((r, i) => ({
            x: getX(r.date),
            y: getY(r[valKey]),
            rec: r,
            idx: i
        }));

        if (pts.length === 0) return;

        const linePathD = 'M ' + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ');

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

        pointsHtml += pts.map(p => `
            <circle class="main-overlay-point" data-year="${s.year}" data-idx="${p.idx}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="${s.color}" stroke="#ffffff" stroke-width="1.8" style="cursor: pointer;" />
        `).join('');
    });

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
            ${pointsHtml}
            ${crosshairHtml}
        </svg>
    `;

    box.innerHTML = svg;

    // Interactive mouse tracking across calendar year X-axis
    const captureRect = box.querySelector('#main-overlay-mouse-capture');
    const cursorLine = box.querySelector('#main-overlay-cursor');
    const hoverDotsGroup = box.querySelector('#main-overlay-hover-dots');
    const svgEl = box.querySelector('#main-networth-svg');

    if (captureRect && cursorLine && hoverDotsGroup && svgEl) {
        captureRect.addEventListener('mousemove', (e) => {
            const rect = svgEl.getBoundingClientRect();
            const scaleX = width / rect.width;
            const mouseSvgX = (e.clientX - rect.left) * scaleX;
            const clampedX = Math.max(padding.left, Math.min(width - padding.right, mouseSvgX));
            const frac = (clampedX - padding.left) / plotW;

            cursorLine.setAttribute('x1', clampedX.toFixed(1));
            cursorLine.setAttribute('x2', clampedX.toFixed(1));
            cursorLine.style.display = 'block';

            let hoverDotsHtml = '';
            const activeYearDetails = [];

            yearSeries.forEach(s => {
                let closest = s.records[0];
                let closestDist = Infinity;
                s.records.forEach(r => {
                    const rFrac = getDayOfYearFraction(r.date);
                    const dist = Math.abs(rFrac - frac);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closest = r;
                    }
                });

                if (closest) {
                    const cx = (padding.left + getDayOfYearFraction(closest.date) * plotW).toFixed(1);
                    const cy = getY(closest[valKey]).toFixed(1);
                    hoverDotsHtml += `
                        <circle cx="${cx}" cy="${cy}" r="5.5" fill="${s.color}" stroke="#ffffff" stroke-width="2" />
                    `;
                    activeYearDetails.push({
                        year: s.year,
                        color: s.color,
                        rec: closest,
                        cx,
                        cy
                    });
                }
            });

            hoverDotsGroup.innerHTML = hoverDotsHtml;

            const approxMonthIdx = Math.max(0, Math.min(11, Math.floor(frac * 12)));
            let tipHtml = `
                <div style="font-weight: 800; font-size: 0.82rem; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px;">
                    🗓️ ${monthNames[approxMonthIdx]} &bull; Day ~${Math.round(frac * 365)}
                </div>
            `;

            activeYearDetails.sort((a, b) => parseInt(b.year, 10) - parseInt(a.year, 10));

            activeYearDetails.forEach(d => {
                const sign = d.rec.weeklyChangeCAD >= 0 ? '+' : '';
                const changeColor = d.rec.weeklyChangeCAD >= 0 ? '#4ade80' : '#f87171';
                tipHtml += `
                    <div style="margin-bottom: 5px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                            <span style="display: flex; align-items: center; gap: 5px; font-weight: 700;">
                                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${d.color};"></span>
                                <strong style="color: ${d.color};">${d.year}:</strong>
                                <span style="color: #cbd5e1; font-size: 0.73rem; font-weight: normal;">(${formatDate(d.rec.date)})</span>
                            </span>
                            <strong style="color: #ffffff; font-size: 0.84rem;">${formatCurrency(d.rec[valKey], currency)}</strong>
                        </div>
                        <div style="font-size: 0.72rem; color: ${changeColor}; padding-left: 13px;">
                            Weekly: ${sign}${formatCurrency(d.rec.weeklyChangeCAD, 'CAD')} (${sign}${d.rec.weeklyChangePct.toFixed(2)}%)
                        </div>
                    </div>
                `;
            });

            if (activeYearDetails.length >= 2) {
                const newest = activeYearDetails[0];
                const prior = activeYearDetails[1];
                const spreadVal = newest.rec[valKey] - prior.rec[valKey];
                const spreadPct = prior.rec[valKey] > 0 ? (spreadVal / prior.rec[valKey] * 100) : 0;
                const spSign = spreadVal >= 0 ? '+' : '';
                const spColor = spreadVal >= 0 ? '#4ade80' : '#f87171';
                tipHtml += `
                    <div style="margin-top: 6px; padding-top: 5px; border-top: 1px solid rgba(255,255,255,0.15); font-size: 0.74rem; display: flex; justify-content: space-between; align-items: center;">
                        <span>YoY Spread (${newest.year} vs ${prior.year}):</span>
                        <strong style="color: ${spColor};">${spSign}${formatCurrency(spreadVal, currency)} (${spSign}${spreadPct.toFixed(2)}%)</strong>
                    </div>
                `;
            }

            tooltip.innerHTML = tipHtml;
            tooltip.style.display = 'block';

            const container = document.getElementById('main-chart-container');
            const parentRect = container.getBoundingClientRect();
            let left = e.clientX - parentRect.left + 15;
            let top = e.clientY - parentRect.top - 80;

            if (left + 240 > parentRect.width) {
                left -= 255;
            }
            if (top < 0) {
                top = e.clientY - parentRect.top + 20;
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        });

        captureRect.addEventListener('mouseleave', () => {
            cursorLine.style.display = 'none';
            hoverDotsGroup.innerHTML = '';
            tooltip.style.display = 'none';
        });
    }

    // Legend
    const legendEl = document.getElementById('main-chart-legend');
    if (legendEl) {
        let itemsHtml = yearSeries.map(s => {
            const latest = s.records[s.records.length - 1];
            return `
                <div class="legend-item" style="display: inline-flex; align-items: center; gap: 6px;">
                    <span style="display: inline-block; width: 12px; height: 3px; background: ${s.color}; border-radius: 2px;"></span>
                    <strong style="color: ${s.color};">${s.year}</strong>: ${formatCurrency(latest[valKey], currency)}
                </div>
            `;
        }).join('');

        if (yearSeries.length >= 2) {
            const sortedDesc = [...yearSeries].sort((a, b) => parseInt(b.year, 10) - parseInt(a.year, 10));
            const newest = sortedDesc[0].records[sortedDesc[0].records.length - 1];
            const prior = sortedDesc[1].records[sortedDesc[1].records.length - 1];
            const spreadVal = newest[valKey] - prior[valKey];
            const spreadPct = prior[valKey] > 0 ? (spreadVal / prior[valKey] * 100) : 0;
            const sign = spreadVal >= 0 ? '+' : '';
            const color = spreadVal >= 0 ? '#16a34a' : '#cf222e';
            const bg = spreadVal >= 0 ? 'rgba(22, 163, 74, 0.1)' : 'rgba(207, 34, 46, 0.1)';

            itemsHtml += `
                <div style="font-size: 0.75rem; font-weight: 700; color: ${color}; background: ${bg}; padding: 2px 8px; border-radius: 4px; border: 1px solid ${color}30;">
                    ${sortedDesc[0].year} vs ${sortedDesc[1].year}: ${sign}${formatCurrency(spreadVal, currency)} (${sign}${spreadPct.toFixed(2)}%)
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
        toggleMainXeqtOverlay,
        calculateTimeBack,
        setMainTimeframe,
        setMainCurrency,
        getDayOfYearFraction,
        getMainYearColor,
        syncMainTimeframeButtons,
        buildMainYearOverlaySeries,
        getMainChartState: () => ({
            currentMainMode,
            currentMainSingleTimeframe,
            currentMainSelectedYears: new Set(currentMainSelectedYears),
            currentMainTimeframe,
            currentMainCurrency
        }),
        resetMainChartState: () => {
            currentMainMode = 'single';
            currentMainSingleTimeframe = 'last-52';
            currentMainSelectedYears.clear();
            currentMainTimeframe = 'last-52';
            currentMainCurrency = 'CAD';
        }
    };
}
