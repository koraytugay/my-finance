/**
 * Accounts & Brokerages Controller
 */

let holdings = [];

async function initAccounts() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('accounts-content');
    const errorEl = document.getElementById('error');

    try {
        holdings = await getHoldings();

        updateStatCards();
        renderGroupedViews();

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initAccounts());
            return;
        }
        console.error('Failed to initialize accounts:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error loading account data: ${err.message}`;
    }
}

function updateStatCards() {
    const totalCAD = holdings.reduce((s, h) => s + h.sum, 0);

    let registeredCAD = 0;
    let nonRegisteredCAD = 0;
    let cashCAD = 0;
    const brokerageTotals = {};

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

        brokerageTotals[h.brokerage] = (brokerageTotals[h.brokerage] || 0) + h.sum;
    });

    const regPct = totalCAD > 0 ? (registeredCAD / totalCAD) * 100 : 0;
    const nonRegPct = totalCAD > 0 ? (nonRegisteredCAD / totalCAD) * 100 : 0;
    const cashPct = totalCAD > 0 ? (cashCAD / totalCAD) * 100 : 0;

    document.getElementById('stat-registered').textContent = formatCurrency(registeredCAD);
    document.getElementById('stat-registered-pct').textContent = `${regPct.toFixed(1)}% of portfolio`;

    document.getElementById('stat-nonregistered').textContent = formatCurrency(nonRegisteredCAD);
    document.getElementById('stat-nonregistered-pct').textContent = `${nonRegPct.toFixed(1)}% of portfolio`;

    document.getElementById('stat-cash-total').textContent = formatCurrency(cashCAD);
    document.getElementById('stat-cash-pct').textContent = `${cashPct.toFixed(1)}% of portfolio`;

    // Find top brokerage
    let topBrok = '-';
    let topVal = 0;
    Object.entries(brokerageTotals).forEach(([b, v]) => {
        if (v > topVal) {
            topVal = v;
            topBrok = b;
        }
    });

    document.getElementById('stat-top-brokerage').textContent = topBrok;
    document.getElementById('stat-top-brokerage-val').textContent = `${formatCurrency(topVal)} (${((topVal / totalCAD) * 100).toFixed(1)}%)`;
}

function renderGroupedViews() {
    const groupBy = document.getElementById('group-by-select').value;
    const container = document.getElementById('groups-container');
    const totalCAD = holdings.reduce((s, h) => s + h.sum, 0);

    const groups = {};

    holdings.forEach(h => {
        let outerKey = '';
        let innerKey = '';

        const isReg = h.registered === true || h.registered === 1 || String(h.registered).toLowerCase() === 'true' || (h.account && /TFSA|RRSP|FHSA/i.test(h.account));

        if (groupBy === 'brokerage') {
            outerKey = h.brokerage;
            innerKey = h.account;
        } else if (groupBy === 'account-type') {
            outerKey = h.account;
            innerKey = h.brokerage;
        } else if (groupBy === 'registered-status') {
            outerKey = isReg ? 'Registered (Tax-Advantaged)' : 'Non-Registered / Taxable';
            innerKey = h.account;
        }

        if (!groups[outerKey]) {
            groups[outerKey] = {
                title: outerKey,
                total: 0,
                holdings: [],
                subGroups: {}
            };
        }

        groups[outerKey].total += h.sum;
        groups[outerKey].holdings.push(h);

        if (!groups[outerKey].subGroups[innerKey]) {
            groups[outerKey].subGroups[innerKey] = {
                title: innerKey,
                total: 0,
                isReg,
                holdings: []
            };
        }

        groups[outerKey].subGroups[innerKey].total += h.sum;
        groups[outerKey].subGroups[innerKey].holdings.push(h);
    });

    // Sort outer groups by total value descending
    const sortedOuter = Object.values(groups).sort((a, b) => b.total - a.total);

    container.innerHTML = sortedOuter.map(group => {
        const groupPct = totalCAD > 0 ? (group.total / totalCAD) * 100 : 0;
        const sortedSubGroups = Object.values(group.subGroups).sort((a, b) => b.total - a.total);

        // Sub-group summary pills at top of card
        const pillsHtml = sortedSubGroups.map(sg => {
            const sgPct = group.total > 0 ? (sg.total / group.total) * 100 : 0;
            return `
                <div class="account-summary-pill">
                    <span style="font-weight: 600; color: #334155;">${escapeHtml(sg.title)}:</span>
                    <strong style="color: #0969da;">${formatCurrency(sg.total)}</strong>
                    <span style="color: #64748b; font-size: 0.76rem;">(${sgPct.toFixed(1)}%)</span>
                </div>
            `;
        }).join('');

        // Build table rows with sub-group headers, holdings, and subtotal rows
        const tableBodyHtml = sortedSubGroups.map(sg => {
            const sgPctOfGroup = group.total > 0 ? (sg.total / group.total) * 100 : 0;
            const sortedHoldings = [...sg.holdings].sort((a, b) => b.sum - a.sum);

            const isSubReg = sg.isReg || (sg.title && /TFSA|RRSP|FHSA/i.test(sg.title));
            const subBadge = (groupBy === 'brokerage' || groupBy === 'registered-status')
                ? (isSubReg 
                    ? '<span class="badge badge-registered" style="margin-left: 6px;">Registered</span>' 
                    : '<span class="badge badge-strategy" style="margin-left: 6px;">Non-Registered / Taxable</span>')
                : '';

            // 1. Sub-group Section Header Row
            const headerRow = `
                <tr class="subgroup-header-row">
                    <td colspan="7">
                        <strong style="color: #0f172a; font-size: 0.95rem;">📁 ${escapeHtml(sg.title)}</strong>
                        ${subBadge}
                        <span style="color: #64748b; font-size: 0.78rem; margin-left: 8px;">(${sg.holdings.length} ${sg.holdings.length === 1 ? 'position' : 'positions'})</span>
                    </td>
                </tr>
            `;

            // 2. Holdings Data Rows
            const rows = sortedHoldings.map(h => {
                const hWeightSub = sg.total > 0 ? (h.sum / sg.total) * 100 : 0;
                const hWeightGroup = group.total > 0 ? (h.sum / group.total) * 100 : 0;
                const thirdColValue = (groupBy === 'registered-status') ? h.brokerage : (h.strategy || 'Broad Market');

                return `
                    <tr>
                        <td style="padding-left: 24px;"><strong style="color: #0969da;">${escapeHtml(h.ticker)}</strong></td>
                        <td>${escapeHtml(h.name)}</td>
                        <td><span class="badge badge-strategy">${escapeHtml(thirdColValue)}</span></td>
                        <td class="text-right">${h.count.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                        <td class="text-right">${formatCurrency(h.unitPrice)}</td>
                        <td class="text-right font-bold">${formatCurrency(h.sum)}</td>
                        <td class="text-right">
                            <span style="font-weight: 600; color: #1f2328;">${hWeightSub.toFixed(1)}%</span>
                            <span style="color: #94a3b8; font-size: 0.74rem; margin-left: 4px;">(${hWeightGroup.toFixed(1)}%)</span>
                        </td>
                    </tr>
                `;
            }).join('');

            // 3. Sub-group Subtotal Row
            const sgCost = sg.holdings.reduce((s, h) => s + (h.totalCost || (h.averageCost > 0 ? h.averageCost * h.count : h.sum)), 0);
            const sgGain = sg.total - sgCost;
            const sgGainPct = sgCost > 0 ? (sgGain / sgCost) * 100 : 0;
            const hasCost = sg.holdings.some(h => (h.averageCost || 0) > 0);
            const gainSign = sgGain >= 0 ? '+' : '';
            const gainColor = sgGain >= 0 ? '#166534' : '#cf222e';
            const gainText = hasCost ? `<span style="font-size: 0.78rem; color: ${gainColor}; font-weight: 600; margin-left: 6px;">(${gainSign}${formatCurrency(sgGain)} / ${gainSign}${sgGainPct.toFixed(1)}%)</span>` : '';

            const subtotalRow = `
                <tr class="subgroup-subtotal-row">
                    <td colspan="5" style="text-align: right; padding-right: 14px; font-weight: 700;">
                        Subtotal &bull; ${escapeHtml(sg.title)} (${sg.holdings.length} ${sg.holdings.length === 1 ? 'position' : 'positions'}):
                        ${gainText}
                    </td>
                    <td class="text-right" style="font-weight: 800; color: #1e293b;">
                        ${formatCurrency(sg.total)}
                    </td>
                    <td class="text-right" style="font-weight: 700; color: #0969da;">
                        ${sgPctOfGroup.toFixed(1)}%
                    </td>
                </tr>
            `;

            return headerRow + rows + subtotalRow;
        }).join('');

        // 4. Brokerage / Group Grand Total Row
        const groupTotalRow = `
            <tr class="group-total-row">
                <td colspan="5" style="text-align: right; padding-right: 14px;">
                    Total ${escapeHtml(group.title)} (${group.holdings.length} positions across ${sortedSubGroups.length} ${sortedSubGroups.length === 1 ? 'account' : 'accounts'}):
                </td>
                <td class="text-right" style="font-weight: 800;">
                    ${formatCurrency(group.total)}
                </td>
                <td class="text-right" style="font-weight: 800;">
                    100.0%
                </td>
            </tr>
        `;

        const thirdColHeader = (groupBy === 'registered-status') ? 'Brokerage' : 'Strategy';
        const subGroupTypeLabel = (groupBy === 'brokerage') ? 'accounts' : (groupBy === 'account-type' ? 'institutions' : 'categories');

        return `
            <div class="group-card">
                <div class="group-header">
                    <div>
                        <h2 style="font-size: 1.3rem; font-weight: 800; margin: 0; color: #1f2328;">${escapeHtml(group.title)}</h2>
                        <span style="font-size: 0.8rem; color: #64748b;">${group.holdings.length} ${group.holdings.length === 1 ? 'position' : 'positions'} across ${sortedSubGroups.length} ${subGroupTypeLabel}</span>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 1.4rem; font-weight: 800; color: #1f2328;">${formatCurrency(group.total)}</div>
                        <div style="font-size: 0.8rem; color: #0969da; font-weight: 600;">${groupPct.toFixed(2)}% of total portfolio</div>
                    </div>
                </div>

                <div class="allocation-bar-wrap" style="height: 6px; margin-bottom: 12px;">
                    <div style="width: ${groupPct}%; background-color: #0969da; height: 100%;"></div>
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px;">
                    ${pillsHtml}
                </div>

                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Ticker</th>
                                <th>Fund / Asset</th>
                                <th>${escapeHtml(thirdColHeader)}</th>
                                <th class="text-right">Shares</th>
                                <th class="text-right">Price</th>
                                <th class="text-right">Total CAD</th>
                                <th class="text-right">% of Subgroup (of Total)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableBodyHtml}
                            ${groupTotalRow}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');
}

document.addEventListener('DOMContentLoaded', initAccounts);
