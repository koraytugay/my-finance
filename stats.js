/**
 * Financial Stats & Milestones Controller
 */

let holdings = [];
let history = [];

async function initStats() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('stats-content');
    const errorEl = document.getElementById('error');

    try {
        const [h, hist] = await Promise.all([
            getHoldings(),
            getHistory()
        ]);

        holdings = h || [];
        const validHistory = typeof sanitizeHistory === 'function' ? sanitizeHistory(hist) : (hist || []);
        const cadUsdRate = (typeof window !== 'undefined' && window.cachedPrices?.cadUsdRate) || 0.7073;
        history = typeof enrichHistoryWithLiveHoldings === 'function'
            ? enrichHistoryWithLiveHoldings(validHistory, holdings, cadUsdRate)
            : validHistory;

        renderKeyMetrics();
        renderMilestones();
        renderFeeAudit();
        renderTopHoldings();
        renderAnnualTable();
        renderExtremeMoves();

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initStats());
            return;
        }
        console.error('Failed to initialize stats:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error calculating statistics: ${err.message}`;
    }
}

function renderKeyMetrics() {
    const totalCAD = holdings.reduce((s, h) => s + h.sum, 0);

    // Concentration
    const sorted = [...holdings].sort((a, b) => b.sum - a.sum);
    const top3Val = sorted.slice(0, 3).reduce((s, h) => s + h.sum, 0);
    const top5Val = sorted.slice(0, 5).reduce((s, h) => s + h.sum, 0);

    document.getElementById('stat-top3-conc').textContent = `${((top3Val / totalCAD) * 100).toFixed(1)}%`;
    document.getElementById('stat-top5-conc').textContent = `${((top5Val / totalCAD) * 100).toFixed(1)}%`;

    // Average weekly growth
    const growthRates = history.map(r => r.weeklyChangePct).filter(p => !isNaN(p) && p !== 0);
    const avgGrowth = growthRates.length > 0
        ? growthRates.reduce((s, v) => s + v, 0) / growthRates.length
        : 0;
    document.getElementById('stat-avg-growth').textContent = `${avgGrowth >= 0 ? '+' : ''}${avgGrowth.toFixed(2)}%`;
    const avgGrowthSub = document.getElementById('stat-avg-growth-sub');
    if (avgGrowthSub && history) {
        avgGrowthSub.textContent = `Across ${history.length} weeks`;
    }

    // Best & worst week
    let best = history[0];
    let worst = history[0];

    history.forEach(r => {
        if (r.weeklyChangeCAD > best.weeklyChangeCAD) best = r;
        if (r.weeklyChangeCAD < worst.weeklyChangeCAD) worst = r;
    });

    document.getElementById('stat-best-week').textContent = `+${formatCurrency(best.weeklyChangeCAD)}`;
    document.getElementById('stat-best-week-date').textContent = `${formatDate(best.date)} (${formatPercent(best.weeklyChangePct, true)})`;
    document.getElementById('stat-best-week').className = 'stat-number text-positive';

    document.getElementById('stat-worst-week').textContent = formatCurrency(worst.weeklyChangeCAD);
    document.getElementById('stat-worst-week-date').textContent = `${formatDate(worst.date)} (${formatPercent(worst.weeklyChangePct, true)})`;
    document.getElementById('stat-worst-week').className = 'stat-number text-negative';
}

function renderTopHoldings() {
    const container = document.getElementById('top-holdings-grid');
    const totalCAD = holdings.reduce((s, h) => s + h.sum, 0);
    const top5 = [...holdings].sort((a, b) => b.sum - a.sum).slice(0, 5);

    container.innerHTML = top5.map((h, i) => {
        const weight = (h.sum / totalCAD) * 100;
        return `
            <div class="top-holding-card">
                <span class="rank-badge">#${i + 1}</span>
                <div style="font-size: 1.15rem; font-weight: 800; color: #0969da;">${escapeHtml(h.ticker)}</div>
                <div style="font-size: 0.82rem; color: #64748b; margin-bottom: 8px;">${escapeHtml(h.name)}</div>
                <div style="font-size: 1.3rem; font-weight: 800; color: #1f2328; margin-bottom: 4px;">${formatCurrency(h.sum)}</div>
                <div style="font-size: 0.76rem; color: #64748b;">
                    ${weight.toFixed(1)}% weight &bull; ${escapeHtml(h.brokerage)} (${escapeHtml(h.account)})
                </div>
            </div>
        `;
    }).join('');
}

function renderAnnualTable() {
    const tbody = document.getElementById('annual-tbody');
    const years = [...new Set(history.map(r => r.date ? r.date.split('-')[0] : null).filter(Boolean))].sort();

    const rows = years.map(yr => {
        const yearRecords = history.filter(r => r.date.startsWith(yr));
        if (yearRecords.length === 0) return null;

        const startRec = yearRecords[0];
        const endRec = yearRecords[yearRecords.length - 1];
        const startVal = startRec.totalCAD - (startRec.weeklyChangeCAD || 0);
        const netChange = endRec.totalCAD - startVal;
        const retPct = startVal > 0 ? (netChange / startVal) * 100 : 0;

        return {
            year: yr,
            start: startVal,
            end: endRec.totalCAD,
            netChange,
            retPct,
            count: yearRecords.length
        };
    }).filter(Boolean);

    tbody.innerHTML = rows.map(r => {
        const isPos = r.netChange >= 0;
        return `
            <tr>
                <td><strong>${r.year}</strong> <span style="font-size: 0.74rem; color: #64748b;">(${r.count} wks)</span></td>
                <td class="text-right">${formatCurrency(r.start)}</td>
                <td class="text-right font-bold">${formatCurrency(r.end)}</td>
                <td class="text-right font-bold ${isPos ? 'text-positive' : 'text-negative'}">
                    ${isPos ? '+' : ''}${formatCurrency(r.netChange)}
                </td>
                <td class="text-right font-bold ${isPos ? 'text-positive' : 'text-negative'}">
                    ${isPos ? '+' : ''}${r.retPct.toFixed(2)}%
                </td>
            </tr>
        `;
    }).join('');
}

function renderExtremeMoves() {
    const tbody = document.getElementById('extreme-tbody');

    // Sort by weeklyChangeCAD descending and get top 3 and bottom 3
    const sorted = [...history].sort((a, b) => b.weeklyChangeCAD - a.weeklyChangeCAD);
    const top3 = sorted.slice(0, 3);
    const bottom3 = sorted.slice(-3).reverse();

    const all = [...top3, ...bottom3];

    tbody.innerHTML = all.map(r => {
        const isPos = r.weeklyChangeCAD >= 0;
        return `
            <tr>
                <td>${formatDate(r.date)}</td>
                <td>Week ${r.week}</td>
                <td class="text-right font-bold ${isPos ? 'text-positive' : 'text-negative'}">
                    ${isPos ? '+' : ''}${formatCurrency(r.weeklyChangeCAD)}
                </td>
                <td class="text-right font-bold ${isPos ? 'text-positive' : 'text-negative'}">
                    ${isPos ? '+' : ''}${r.weeklyChangePct.toFixed(2)}%
                </td>
            </tr>
        `;
    }).join('');
}

function renderMilestones() {
    const totalCAD = holdings.reduce((s, h) => s + h.sum, 0) || (history.length > 0 ? history[history.length - 1].totalCAD : 0);
    if (!totalCAD) return;

    const currPill = document.getElementById('milestone-current-pill');
    if (currPill) currPill.textContent = `Current: ${formatCurrency(totalCAD, 'CAD')}`;

    let weeklyVel = 3030;
    if (history.length > 1) {
        const startCAD = history[0].totalCAD;
        weeklyVel = Math.max(100, (totalCAD - startCAD) / history.length);
    }

    const milestones = [
        { target: 750000, idPrefix: 'm1' },
        { target: 800000, idPrefix: 'm2' },
        { target: 1000000, idPrefix: 'm3' }
    ];

    milestones.forEach(m => {
        const pct = Math.min(100, (totalCAD / m.target) * 100);
        const rem = Math.max(0, m.target - totalCAD);
        const wks = Math.ceil(rem / weeklyVel);
        const yrs = (wks / 52).toFixed(1);

        const pctEl = document.getElementById(`${m.idPrefix}-pct`);
        const remEl = document.getElementById(`${m.idPrefix}-rem`);
        const timeEl = document.getElementById(`${m.idPrefix}-time`);
        const barEl = document.getElementById(`${m.idPrefix}-bar`);

        if (pctEl) pctEl.textContent = `${pct.toFixed(1)}%`;
        if (remEl) remEl.textContent = rem > 0 ? `-${formatCurrency(rem, 'CAD')} to go` : '✅ Milestone Achieved!';
        if (timeEl) {
            if (rem > 0) {
                timeEl.textContent = wks <= 52 
                    ? `Est. ~${wks} weeks at current velocity`
                    : `Est. ~${wks} weeks (~${yrs} yrs)`;
            } else {
                timeEl.textContent = 'Target reached';
            }
        }
        if (barEl) barEl.style.width = `${pct}%`;
    });

    const expectedReturnRate = 0.07;
    const annualPassiveReturn = totalCAD * expectedReturnRate;
    const monthlyPassiveReturn = annualPassiveReturn / 12;

    const annualSavingsPace = weeklyVel * 52;
    const crossoverPct = Math.min(100, (annualPassiveReturn / annualSavingsPace) * 100);

    const crossPctEl = document.getElementById('crossover-pct');
    const crossAnnualEl = document.getElementById('crossover-annual');
    const crossBarEl = document.getElementById('crossover-bar');
    const crossDescEl = document.getElementById('crossover-desc');

    if (crossPctEl) crossPctEl.textContent = `${crossoverPct.toFixed(1)}% Replaced`;
    if (crossAnnualEl) {
        crossAnnualEl.textContent = `+${formatCurrency(annualPassiveReturn, 'CAD')} / yr (${formatCurrency(monthlyPassiveReturn, 'CAD')} / mo)`;
    }
    if (crossBarEl) crossBarEl.style.width = `${crossoverPct}%`;
    if (crossDescEl) {
        const fullCrossoverTarget = annualSavingsPace / expectedReturnRate;
        crossDescEl.innerHTML = `At an expected 7.0% annual compounding rate, your portfolio produces <strong>+${formatCurrency(annualPassiveReturn, 'CAD')}/year (${formatCurrency(monthlyPassiveReturn, 'CAD')}/month)</strong> completely passively. This already replaces <strong>${crossoverPct.toFixed(1)}%</strong> of your active annual wealth accumulation pace (${formatCurrency(annualSavingsPace, 'CAD')}/yr). Full Crossover (100% self-funding) will occur at ~${formatCurrency(fullCrossoverTarget, 'CAD')}.`;
    }
}

function renderFeeAudit() {
    const totalCAD = holdings.reduce((s, h) => s + h.sum, 0) || (history.length > 0 ? history[history.length - 1].totalCAD : 0);
    if (!totalCAD) return;

    const portfolioMER = 0.0016;
    const mutualFundMER = 0.0195;

    const myAnnualFee = totalCAD * portfolioMER;
    const bankAnnualFee = totalCAD * mutualFundMER;
    const annualSaved = bankAnnualFee - myAnnualFee;

    const r = 0.07;
    const n = 10;
    const compoundingSaved10Yr = annualSaved * ((Math.pow(1 + r, n) - 1) / r);

    const pillEl = document.getElementById('mer-savings-pill');
    const myCostEl = document.getElementById('mer-annual-cost');
    const bankCostEl = document.getElementById('mer-bank-cost');
    const savedEl = document.getElementById('mer-annual-saved');
    const edgeEl = document.getElementById('mer-10yr-edge');

    const positionCount = (holdings || []).filter(h => h.ticker !== 'Cash' && h.symbol !== 'CASH').length || (holdings || []).length;
    if (pillEl) pillEl.textContent = `DIY Advantage: +${formatCurrency(annualSaved, 'CAD')} / year saved`;
    if (myCostEl) myCostEl.textContent = `Cost: ${formatCurrency(myAnnualFee, 'CAD')} / year across ${positionCount} ETFs`;
    if (bankCostEl) bankCostEl.textContent = `${formatCurrency(bankAnnualFee, 'CAD')} / year`;
    if (savedEl) savedEl.textContent = `+${formatCurrency(annualSaved, 'CAD')} / yr`;
    if (edgeEl) edgeEl.textContent = `+${formatCurrency(compoundingSaved10Yr, 'CAD')}`;
}

document.addEventListener('DOMContentLoaded', initStats);
