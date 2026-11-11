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
                <span class="kt-chip">
                    ${escapeHtml(sg.title)}:
                    <strong>${formatCurrency(sg.total)}</strong>
                    <span class="kt-chip__meta">(${sgPct.toFixed(1)}%)</span>
                </span>
            `;
        }).join('');

        // Build table rows with sub-group headers, holdings, and subtotal rows
        const tableBodyHtml = sortedSubGroups.map(sg => {
            const sgPctOfGroup = group.total > 0 ? (sg.total / group.total) * 100 : 0;
            const sortedHoldings = [...sg.holdings].sort((a, b) => b.sum - a.sum);

            const isSubReg = sg.isReg || (sg.title && /TFSA|RRSP|FHSA/i.test(sg.title));
            const subBadge = (groupBy === 'brokerage' || groupBy === 'registered-status')
                ? (isSubReg 
                    ? '<span class="kt-badge kt-badge--soft-warning" style="margin-left: 6px;">Registered</span>' 
                    : '<span class="kt-badge" style="margin-left: 6px;">Non-Registered / Taxable</span>')
                : '';

            // 1. Sub-group Section Header Row
            const headerRow = `
                <tr class="subgroup-header-row">
                    <td colspan="7">
                        <strong class="kt-text-primary kt-fs-base">📁 ${escapeHtml(sg.title)}</strong>
                        ${subBadge}
                        <span class="kt-text-muted kt-fs-xs" style="margin-left: 8px;">(${sg.holdings.length} ${sg.holdings.length === 1 ? 'position' : 'positions'})</span>
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
                        <td style="padding-left: 24px;"><strong>${escapeHtml(h.ticker)}</strong></td>
                        <td>${escapeHtml(h.name)}</td>
                        <td><span class="kt-badge">${escapeHtml(thirdColValue)}</span></td>
                        <td class="kt-align-right">${h.count.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                        <td class="kt-align-right">${formatCurrency(h.unitPrice)}</td>
                        <td class="kt-align-right kt-fw-bold">${formatCurrency(h.sum)}</td>
                        <td class="kt-align-right">
                            <span class="kt-fw-semibold kt-text-primary">${hWeightSub.toFixed(1)}%</span>
                            <span class="kt-text-muted kt-fs-xs" style="margin-left: 4px;">(${hWeightGroup.toFixed(1)}%)</span>
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
            const gainText = hasCost ? `<span class="kt-fs-xs kt-fw-semibold" style="color: ${gainColor}; margin-left: 6px;">(${gainSign}${formatCurrency(sgGain)} / ${gainSign}${sgGainPct.toFixed(1)}%)</span>` : '';

            const subtotalRow = `
                <tr class="subgroup-subtotal-row">
                    <td class="kt-align-right kt-fw-bold" colspan="5" style="padding-right: 14px;">
                        Subtotal &bull; ${escapeHtml(sg.title)} (${sg.holdings.length} ${sg.holdings.length === 1 ? 'position' : 'positions'}):
                        ${gainText}
                    </td>
                    <td class="kt-align-right kt-fw-heavy kt-text-primary">
                        ${formatCurrency(sg.total)}
                    </td>
                    <td class="kt-align-right kt-fw-bold">
                        ${sgPctOfGroup.toFixed(1)}%
                    </td>
                </tr>
            `;

            return headerRow + rows + subtotalRow;
        }).join('');

        // 4. Brokerage / Group Grand Total Row
        const groupTotalRow = `
            <tr class="group-total-row">
                <td class="kt-align-right" colspan="5" style="padding-right: 14px;">
                    Total ${escapeHtml(group.title)} (${group.holdings.length} positions across ${sortedSubGroups.length} ${sortedSubGroups.length === 1 ? 'account' : 'accounts'}):
                </td>
                <td class="kt-align-right kt-fw-heavy">
                    ${formatCurrency(group.total)}
                </td>
                <td class="kt-align-right kt-fw-heavy">
                    100.0%
                </td>
            </tr>
        `;

        const thirdColHeader = (groupBy === 'registered-status') ? 'Brokerage' : 'Strategy';
        const subGroupTypeLabel = (groupBy === 'brokerage') ? 'accounts' : (groupBy === 'account-type' ? 'institutions' : 'categories');

        return `
            <div class="kt-card kt-card--padded kt-mb-6">
                <div class="kt-split kt-mb-3">
                    <div>
                        <h2 class="kt-m-0">${escapeHtml(group.title)}</h2>
                        <span class="kt-fs-xs kt-text-muted">${group.holdings.length} ${group.holdings.length === 1 ? 'position' : 'positions'} across ${sortedSubGroups.length} ${subGroupTypeLabel}</span>
                    </div>
                    <div class="kt-align-right">
                        <div class="kt-fs-lg kt-fw-heavy">${formatCurrency(group.total)}</div>
                        <div class="kt-fs-xs kt-fw-semibold">${groupPct.toFixed(2)}% of total portfolio</div>
                    </div>
                </div>

                <div class="kt-progress kt-mb-3" style="--kt-progress-h: 6px;">
                    <div class="kt-progress__bar" style="width: ${groupPct}%;"></div>
                </div>

                <div class="kt-cluster kt-mb-4">
                    ${pillsHtml}
                </div>

                <div class="kt-table-wrap">
                    <table class="kt-table kt-table--hover">
                        <thead>
                            <tr>
                                <th>Ticker</th>
                                <th>Fund / Asset</th>
                                <th>${escapeHtml(thirdColHeader)}</th>
                                <th class="kt-align-right">Shares</th>
                                <th class="kt-align-right">Price</th>
                                <th class="kt-align-right">Total CAD</th>
                                <th class="kt-align-right">% of Subgroup (of Total)</th>
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
