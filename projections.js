/**
 * FIRE & Wealth Compounding Simulator Controller
 */

let baselineNetWorth = 0;
let inflationMode = 'nominal'; // 'nominal' or 'real'
let chartPoints = [];

async function initProjections() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('main-content');
    const errorEl = document.getElementById('error');

    try {
        const [holdings, history] = await Promise.all([
            getHoldings(),
            getHistory()
        ]);

        if (!holdings || holdings.length === 0) {
            throw new Error('No holdings data available.');
        }

        baselineNetWorth = holdings.reduce((sum, h) => sum + (h.sum || 0), 0);

        // Populate initial input values
        document.getElementById('input-starting-nw').value = Math.round(baselineNetWorth);

        // Estimate monthly contribution from actual net savings added if history & holdings available
        if (history && history.length > 10) {
            const first = history[0];
            const latest = history[history.length - 1];
            const weeks = history.length - 1;
            const costBasis = calculateHoldingsCostBasis(holdings);
            const totalGrowth = latest.totalCAD - first.totalCAD;
            const netSavingsAdded = Math.max(0, totalGrowth - costBasis.totalMarketGainsCAD);
            const actualMonthlySavings = Math.round((netSavingsAdded / weeks) * 4.33);

            if (actualMonthlySavings >= 500 && actualMonthlySavings <= 25000) {
                document.getElementById('input-monthly-save').value = actualMonthlySavings;
            }
        }

        runProjections();

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';

        window.addEventListener('resize', () => {
            renderProjectionChart();
        });
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initProjections());
            return;
        }
        console.error('Failed to init projections:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error loading projection engine: ${err.message}`;
    }
}

function setInflationMode(mode) {
    inflationMode = mode;
    document.getElementById('btn-mode-nominal').classList.toggle('active', mode === 'nominal');
    document.getElementById('btn-mode-real').classList.toggle('active', mode === 'real');

    if (mode === 'nominal') {
        document.getElementById('btn-mode-nominal').style.background = '#1f2328';
        document.getElementById('btn-mode-nominal').style.color = '#fff';
        document.getElementById('btn-mode-real').style.background = '#fff';
        document.getElementById('btn-mode-real').style.color = '#24292f';
    } else {
        document.getElementById('btn-mode-real').style.background = '#1f2328';
        document.getElementById('btn-mode-real').style.color = '#fff';
        document.getElementById('btn-mode-nominal').style.background = '#fff';
        document.getElementById('btn-mode-nominal').style.color = '#24292f';
    }

    runProjections();
}

function runProjections() {
    const startingNW = parseFloat(document.getElementById('input-starting-nw').value) || 0;
    const monthlySave = parseFloat(document.getElementById('input-monthly-save').value) || 0;
    const nomReturnRate = parseFloat(document.getElementById('input-return-rate').value) / 100;
    const inflationRate = parseFloat(document.getElementById('input-inflation-rate').value) / 100;
    const swrRate = parseFloat(document.getElementById('input-swr-rate').value) / 100;
    const targetSpend = parseFloat(document.getElementById('input-target-spend').value) || 60000;

    // Update labels
    document.getElementById('label-monthly-save').textContent = formatCurrency(monthlySave);
    document.getElementById('label-return-rate').textContent = `${(nomReturnRate * 100).toFixed(2)}%`;
    document.getElementById('label-inflation-rate').textContent = `${(inflationRate * 100).toFixed(2)}%`;
    document.getElementById('label-swr-rate').textContent = `${(swrRate * 100).toFixed(1)}%`;

    // Effective return based on mode
    let effectiveReturn = nomReturnRate;
    if (inflationMode === 'real') {
        effectiveReturn = (1 + nomReturnRate) / (1 + inflationRate) - 1;
    }

    const fireTarget = targetSpend / swrRate;
    const currentSafeAnnual = startingNW * swrRate;
    const currentSafeMonthly = currentSafeAnnual / 12;

    // Stat Cards
    document.getElementById('stat-current-nw').textContent = formatCurrency(startingNW);
    document.getElementById('stat-safe-annual').textContent = `${formatCurrency(currentSafeAnnual)} / yr`;
    document.getElementById('stat-safe-monthly').textContent = `${formatCurrency(currentSafeMonthly)} / mo`;
    document.getElementById('stat-fire-target').textContent = formatCurrency(fireTarget);

    const fireProgressPct = fireTarget > 0 ? Math.min(100, (startingNW / fireTarget) * 100) : 100;
    document.getElementById('stat-fire-progress').textContent = `${fireProgressPct.toFixed(1)}% of freedom goal reached`;

    // Coast FIRE in 20 years ($0 additions)
    const coast20 = startingNW * Math.pow(1 + effectiveReturn, 20);
    document.getElementById('stat-coast-20yr').textContent = formatCurrency(coast20);

    // Milestones Calculation
    const milestones = [
        { label: '$750,000', target: 750000 },
        { label: '$1,000,000', target: 1000000 },
        { label: '$1,500,000', target: 1500000 },
        { label: '$2,000,000', target: 2000000 },
        { label: `FIRE Goal (${formatCurrency(fireTarget)})`, target: fireTarget, isFire: true }
    ];

    // Remove duplicates if fireTarget is close to one of the presets
    const uniqueMilestones = milestones.filter((m, idx, arr) => {
        if (!m.isFire) return true;
        const existsClose = arr.some((other, oIdx) => !other.isFire && Math.abs(other.target - m.target) < 25000);
        return !existsClose;
    });

    renderMilestones(uniqueMilestones, startingNW, monthlySave, effectiveReturn);

    // 30-Year Table & Chart Data
    const tableData = [];
    chartPoints = [];

    let currentExpected = startingNW;
    let currentOptimistic = startingNW;
    let currentConservative = startingNW;
    let totalInvested = startingNW;

    const optRate = effectiveReturn + 0.02;
    const consRate = Math.max(0, effectiveReturn - 0.02);

    const curDate = new Date();
    const curYear = curDate.getFullYear();

    // Year 0 baseline point
    chartPoints.push({
        year: 0,
        timelineYear: curYear,
        expected: startingNW,
        optimistic: startingNW,
        conservative: startingNW,
        invested: startingNW
    });

    for (let yr = 1; yr <= 30; yr++) {
        const annualContribution = monthlySave * 12;
        totalInvested += annualContribution;

        // Month-by-month compound within the year for accuracy
        let startYearBal = currentExpected;
        const mRateExp = Math.pow(1 + effectiveReturn, 1/12) - 1;
        const mRateOpt = Math.pow(1 + optRate, 1/12) - 1;
        const mRateCons = Math.pow(1 + consRate, 1/12) - 1;

        for (let m = 0; m < 12; m++) {
            currentExpected = (currentExpected + monthlySave) * (1 + mRateExp);
            currentOptimistic = (currentOptimistic + monthlySave) * (1 + mRateOpt);
            currentConservative = (currentConservative + monthlySave) * (1 + mRateCons);
        }

        const growthThisYear = currentExpected - startYearBal - annualContribution;
        const safeAnnualSpend = currentExpected * swrRate;
        const safeMonthlySpend = safeAnnualSpend / 12;

        tableData.push({
            year: yr,
            timeline: curYear + yr,
            startBalance: startYearBal,
            annualContribution,
            growth: growthThisYear,
            endBalance: currentExpected,
            safeAnnualSpend,
            safeMonthlySpend
        });

        chartPoints.push({
            year: yr,
            timelineYear: curYear + yr,
            expected: currentExpected,
            optimistic: currentOptimistic,
            conservative: currentConservative,
            invested: totalInvested
        });
    }

    renderTable(tableData);
    renderProjectionChart();
}

function renderMilestones(milestones, startingNW, monthlySave, rate) {
    const container = document.getElementById('milestones-container');
    container.innerHTML = '';

    const monthlyRate = Math.pow(1 + rate, 1/12) - 1;
    const curDate = new Date();
    let fireTimeStr = '-';
    let fireDateStr = '-';

    milestones.forEach(m => {
        let months = 0;
        let bal = startingNW;
        let reached = bal >= m.target;

        if (!reached) {
            while (bal < m.target && months < 600) { // max 50 yrs
                months++;
                bal = (bal + monthlySave) * (1 + monthlyRate);
            }
        }

        const yearsRem = (months / 12).toFixed(1);
        const targetDate = new Date(curDate.getFullYear(), curDate.getMonth() + months);
        const monthYearStr = targetDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

        if (m.isFire) {
            if (reached) {
                fireTimeStr = 'Reached!';
                fireDateStr = 'Financial Freedom Achieved';
            } else if (months >= 600) {
                fireTimeStr = '> 50 yrs';
                fireDateStr = 'Increase savings or returns';
            } else {
                fireTimeStr = `${yearsRem} yrs`;
                fireDateStr = `Projected ${monthYearStr} (${months} mos)`;
            }
        }

        const card = document.createElement('div');
        card.className = `milestone-card ${reached ? 'reached' : ''}`;

        const progressPct = Math.min(100, Math.max(0, (startingNW / m.target) * 100));

        let statusBadge = '';
        let timeDesc = '';

        if (reached) {
            statusBadge = '<span class="milestone-badge badge-reached">Achieved</span>';
            timeDesc = `<div style="font-size: 0.85rem; font-weight: 700; color: #166534; margin-top: 6px;">Passed (+${formatCurrency(startingNW - m.target)})</div>`;
        } else if (months >= 600) {
            statusBadge = '<span class="milestone-badge badge-pending">Long-term</span>';
            timeDesc = `<div style="font-size: 0.85rem; font-weight: 700; color: #64748b; margin-top: 6px;">&gt; 50 years</div>`;
        } else {
            statusBadge = '<span class="milestone-badge badge-pending">In Progress</span>';
            timeDesc = `
                <div style="font-size: 0.88rem; font-weight: 800; color: #0969da; margin-top: 4px;">
                    ${monthYearStr} <span style="font-size: 0.78rem; font-weight: 600; color: #64748b;">(${yearsRem} yrs / ${months} mos)</span>
                </div>
            `;
        }

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 0.85rem; font-weight: 700; color: #475569;">${escapeHtml(m.label)}</div>
                ${statusBadge}
            </div>
            ${timeDesc}
            <div class="progress-bar-wrap">
                <div class="progress-bar-fill ${reached ? 'complete' : ''}" style="width: ${progressPct}%;"></div>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.72rem; color: #64748b;">
                <span>${progressPct.toFixed(1)}% funded</span>
                <span>${reached ? '$0 left' : `${formatCurrency(m.target - startingNW)} left`}</span>
            </div>
        `;

        container.appendChild(card);
    });

    document.getElementById('stat-time-to-fire').textContent = fireTimeStr;
    document.getElementById('stat-fire-date').textContent = fireDateStr;
}

function renderTable(tableData) {
    const tbody = document.getElementById('projections-table-body');
    tbody.innerHTML = '';

    tableData.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 700;">Year ${row.year}</td>
            <td style="color: #64748b;">${row.timeline}</td>
            <td style="text-align: right;">${formatCurrency(row.startBalance)}</td>
            <td style="text-align: right; color: #0969da;">+${formatCurrency(row.annualContribution)}</td>
            <td style="text-align: right; color: #166534; font-weight: 600;">+${formatCurrency(row.growth)}</td>
            <td style="text-align: right; font-weight: 800;">${formatCurrency(row.endBalance)}</td>
            <td style="text-align: right; font-weight: 700; color: #166534;">${formatCurrency(row.safeAnnualSpend)}</td>
            <td style="text-align: right; font-weight: 600; color: #0969da;">${formatCurrency(row.safeMonthlySpend)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderProjectionChart() {
    const wrap = document.getElementById('projection-svg-wrap');
    if (!wrap || chartPoints.length === 0) return;

    const width = wrap.clientWidth || 800;
    const height = wrap.clientHeight || 260;
    const padL = 65;
    const padR = 25;
    const padT = 20;
    const padB = 30;

    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    let maxVal = Math.max(...chartPoints.map(p => Math.max(p.optimistic, p.expected, p.conservative, p.invested)));
    maxVal = Math.ceil(maxVal * 1.1);

    function getX(yr) {
        return padL + (yr / 30) * plotW;
    }

    function getY(val) {
        return padT + plotH - (val / maxVal) * plotH;
    }

    // Grid lines & Y-axis labels
    const ySteps = 5;
    let gridSvg = '';
    for (let i = 0; i <= ySteps; i++) {
        const yVal = (maxVal / ySteps) * i;
        const yPos = getY(yVal);
        gridSvg += `
            <line x1="${padL}" y1="${yPos}" x2="${width - padR}" y2="${yPos}" stroke="#f1f5f9" stroke-width="1" />
            <text x="${padL - 8}" y="${yPos + 4}" font-size="10" fill="#94a3b8" text-anchor="end" font-family="inherit">
                ${formatCurrencyShort(yVal)}
            </text>
        `;
    }

    // X-axis labels (Every 5 years)
    let xLabelsSvg = '';
    for (let yr = 0; yr <= 30; yr += 5) {
        const xPos = getX(yr);
        const point = chartPoints[yr] || {};
        xLabelsSvg += `
            <line x1="${xPos}" y1="${height - padB}" x2="${xPos}" y2="${height - padB + 4}" stroke="#cbd5e1" stroke-width="1" />
            <text x="${xPos}" y="${height - padB + 16}" font-size="10" fill="#64748b" text-anchor="middle" font-family="inherit">
                Yr ${yr} (${point.timelineYear || ''})
            </text>
        `;
    }

    function makePath(key) {
        return chartPoints.map((p, idx) => {
            const x = getX(p.year);
            const y = getY(p[key]);
            return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        }).join(' ');
    }

    const pathOpt = makePath('optimistic');
    const pathExp = makePath('expected');
    const pathCons = makePath('conservative');
    const pathInv = makePath('invested');

    // Shaded area under expected curve
    const areaExp = `${pathExp} L ${getX(30)} ${getY(0)} L ${getX(0)} ${getY(0)} Z`;

    const svg = `
        <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" style="overflow: visible; display: block;" id="svg-element">
            <defs>
                <linearGradient id="expGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#0969da" stop-opacity="0.16"/>
                    <stop offset="100%" stop-color="#0969da" stop-opacity="0.01"/>
                </linearGradient>
            </defs>

            ${gridSvg}
            ${xLabelsSvg}

            <!-- Shaded fill under expected -->
            <path d="${areaExp}" fill="url(#expGradient)" />

            <!-- Trajectory lines -->
            <path d="${pathInv}" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="4 3" />
            <path d="${pathCons}" fill="none" stroke="#d97706" stroke-width="2" />
            <path d="${pathOpt}" fill="none" stroke="#16a34a" stroke-width="2" stroke-dasharray="3 2" />
            <path d="${pathExp}" fill="none" stroke="#0969da" stroke-width="3" />

            <!-- Interactive Crosshair & Point Markers -->
            <line id="crosshair-x" x1="0" y1="${padT}" x2="0" y2="${height - padB}" stroke="#475569" stroke-width="1.5" stroke-dasharray="3 3" style="display: none; pointer-events: none;" />
            <circle id="dot-exp" r="5" fill="#0969da" stroke="#ffffff" stroke-width="2" style="display: none; pointer-events: none;" />
            <circle id="dot-opt" r="4.2" fill="#16a34a" stroke="#ffffff" stroke-width="1.5" style="display: none; pointer-events: none;" />
            <circle id="dot-cons" r="4.2" fill="#d97706" stroke="#ffffff" stroke-width="1.5" style="display: none; pointer-events: none;" />
            <circle id="dot-inv" r="3.8" fill="#94a3b8" stroke="#ffffff" stroke-width="1.5" style="display: none; pointer-events: none;" />

            <!-- Full Tracking Overlay Rect -->
            <rect id="projection-overlay" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor: crosshair; pointer-events: all;" />
        </svg>
    `;

    wrap.innerHTML = svg;
    attachChartTooltip(wrap, padL, padT, padB, plotW, plotH, width, height, maxVal);
}

function renderProjectionInfoCard(html, isActive = false) {
    const card = document.getElementById('projections-info-card');
    if (!card) return;
    card.innerHTML = html;
    if (isActive) {
        card.classList.add('active');
    } else {
        card.classList.remove('active');
    }
}

function buildProjectionCardHtml(point, isHover = false) {
    if (!point) return '';
    const swrInput = document.getElementById('input-swr-rate');
    const swrRate = (swrInput ? parseFloat(swrInput.value) : 4.0) / 100;
    const swrPctStr = (swrRate * 100).toFixed(1);
    const annualSWR = point.expected * swrRate;
    const monthlySWR = annualSWR / 12;

    const badgeHtml = isHover
        ? `<span class="chart-card-badge" style="background: #e0f2fe; color: #0284c7;">INSPECTING</span>`
        : `<span class="chart-card-badge" style="background: #f1f5f9; color: #475569;">${point.year === 0 ? 'START (YR 0)' : `YEAR ${point.year}`}</span>`;

    return `
        <div class="chart-card-header">
            <span class="chart-card-date">Year ${point.year} &bull; ${point.timelineYear}</span>
            ${badgeHtml}
        </div>
        <div class="chart-card-primary-val" style="color: #0969da;">
            ${formatCurrency(point.expected)}
        </div>
        <div class="chart-card-sub-val" style="color: #64748b;">
            Expected Return Trajectory
        </div>
        <div class="chart-card-section-divider">
            <div style="font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">Scenario Projections</div>
            <div class="chart-card-row">
                <span style="color: #16a34a; font-weight: 600;">● Optimistic (+2%):</span>
                <strong>${formatCurrency(point.optimistic)}</strong>
            </div>
            <div class="chart-card-row">
                <span style="color: #0969da; font-weight: 600;">● Expected:</span>
                <strong>${formatCurrency(point.expected)}</strong>
            </div>
            <div class="chart-card-row">
                <span style="color: #d97706; font-weight: 600;">● Conservative (-2%):</span>
                <strong>${formatCurrency(point.conservative)}</strong>
            </div>
            <div class="chart-card-row">
                <span style="color: #64748b; font-weight: 600;">● Capital Invested:</span>
                <strong>${formatCurrency(point.invested)}</strong>
            </div>
        </div>
        <div class="chart-card-section-divider">
            <div style="font-size: 0.72rem; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">Safe Withdrawal (${swrPctStr}%)</div>
            <div class="chart-card-row">
                <span>Safe Annual Spend:</span>
                <strong style="color: #166534;">${formatCurrency(annualSWR)} / yr</strong>
            </div>
            <div class="chart-card-row">
                <span>Safe Monthly Spend:</span>
                <strong style="color: #0969da;">${formatCurrency(monthlySWR)} / mo</strong>
            </div>
        </div>
        <div class="chart-card-footer">
            💡 Hover over graph to inspect any year
        </div>
    `;
}

function attachChartTooltip(wrap, padL, padT, padB, plotW, plotH, width, height, maxVal) {
    const svgEl = document.getElementById('svg-element');
    const overlay = document.getElementById('projection-overlay');
    const crosshair = document.getElementById('crosshair-x');
    const dotExp = document.getElementById('dot-exp');
    const dotOpt = document.getElementById('dot-opt');
    const dotCons = document.getElementById('dot-cons');
    const dotInv = document.getElementById('dot-inv');

    if (!svgEl) return;

    function getX(yr) {
        return padL + (yr / 30) * plotW;
    }
    function getY(val) {
        return padT + plotH - (val / maxVal) * plotH;
    }

    function setActiveYear(yearIndex) {
        const point = chartPoints[yearIndex];
        if (!point) return;

        const xPos = getX(yearIndex);

        if (crosshair) {
            crosshair.setAttribute('x1', xPos.toFixed(1));
            crosshair.setAttribute('x2', xPos.toFixed(1));
            crosshair.style.display = 'block';
        }
        if (dotExp) {
            dotExp.setAttribute('cx', xPos.toFixed(1));
            dotExp.setAttribute('cy', getY(point.expected).toFixed(1));
            dotExp.style.display = 'block';
        }
        if (dotOpt) {
            dotOpt.setAttribute('cx', xPos.toFixed(1));
            dotOpt.setAttribute('cy', getY(point.optimistic).toFixed(1));
            dotOpt.style.display = 'block';
        }
        if (dotCons) {
            dotCons.setAttribute('cx', xPos.toFixed(1));
            dotCons.setAttribute('cy', getY(point.conservative).toFixed(1));
            dotCons.style.display = 'block';
        }
        if (dotInv) {
            dotInv.setAttribute('cx', xPos.toFixed(1));
            dotInv.setAttribute('cy', getY(point.invested).toFixed(1));
            dotInv.style.display = 'block';
        }

        renderProjectionInfoCard(buildProjectionCardHtml(point, true), true);
    }

    function clearActive() {
        if (crosshair) crosshair.style.display = 'none';
        if (dotExp) dotExp.style.display = 'none';
        if (dotOpt) dotOpt.style.display = 'none';
        if (dotCons) dotCons.style.display = 'none';
        if (dotInv) dotInv.style.display = 'none';

        const defaultPt = chartPoints[chartPoints.length - 1];
        if (defaultPt) {
            renderProjectionInfoCard(buildProjectionCardHtml(defaultPt, false), false);
        }
    }

    const targetEl = overlay || svgEl;

    targetEl.addEventListener('mousemove', (e) => {
        let svgMouseX = padL;
        if (typeof svgEl.getScreenCTM === 'function') {
            const ctm = svgEl.getScreenCTM();
            if (ctm) {
                const pt = svgEl.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const svgP = pt.matrixTransform(ctm.inverse());
                svgMouseX = svgP.x;
            }
        } else {
            const rect = svgEl.getBoundingClientRect();
            svgMouseX = (e.clientX - rect.left) * (width / (rect.width || 1));
        }

        if (svgMouseX < padL || svgMouseX > padL + plotW) {
            clearActive();
            return;
        }

        const pct = (svgMouseX - padL) / plotW;
        const yearIndex = Math.min(30, Math.max(0, Math.round(pct * 30)));
        setActiveYear(yearIndex);
    });

    targetEl.addEventListener('mouseleave', () => {
        clearActive();
    });

    // Default to 30-year end state
    const defaultPt = chartPoints[chartPoints.length - 1];
    if (defaultPt) {
        renderProjectionInfoCard(buildProjectionCardHtml(defaultPt, false), false);
    }
}

function formatCurrencyShort(val) {
    if (val >= 1000000) {
        return `$${(val / 1000000).toFixed(1)}M`;
    } else if (val >= 1000) {
        return `$${(val / 1000).toFixed(0)}k`;
    }
    return `$${val.toFixed(0)}`;
}

document.addEventListener('DOMContentLoaded', initProjections);
