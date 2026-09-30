/**
 * Holdings View Controller
 */

let allHoldings = [];
let currentFilteredHoldings = [];
let currentPrices = null;
let currentSort = 'value-desc';
let currentSortDir = 'desc';

async function initHoldings() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('main-content');
    const errorEl = document.getElementById('error');

    try {
        const [holdings, prices] = await Promise.all([
            getHoldings(),
            getPrices()
        ]);

        allHoldings = holdings;
        currentPrices = prices;

        // Restore view mode preference
        const savedViewMode = localStorage.getItem('holdingsViewMode') || 'table';
        document.getElementById('view-mode').value = savedViewMode;

        populateFilterDropdowns();
        updateOverviewCards();
        applyFiltersAndSort();

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initHoldings());
            return;
        }
        console.error('Failed to initialize holdings:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error loading portfolio data: ${err.message}`;
    }
}

function updateOverviewCards() {
    const totalCAD = allHoldings.reduce((sum, h) => sum + h.sum, 0);
    const cadUsdRate = currentPrices?.cadUsdRate
        || (typeof window !== 'undefined' && window.cachedPrices?.cadUsdRate)
        || (typeof allBenchmarks !== 'undefined' && allBenchmarks?.fx?.cadUsdRate)
        || (allHistory && allHistory.length > 0 && allHistory[allHistory.length - 1].totalCAD && allHistory[allHistory.length - 1].totalUSD
            ? (allHistory[allHistory.length - 1].totalUSD / allHistory[allHistory.length - 1].totalCAD)
            : 0.7073);
    const totalUSD = totalCAD * cadUsdRate;

    let stocksCAD = 0;
    let fixedCAD = 0;
    let altsCAD = 0;
    allHoldings.forEach(h => {
        fixedCAD += (h.allocation.fixedIncome || 0);
        altsCAD += (h.allocation.preciousMetals || 0) + (h.allocation.crypto || 0);
        stocksCAD += (h.allocation.us || 0) + (h.allocation.canada || 0) + (h.allocation.developed || 0) + (h.allocation.emerging || 0);
    });

    const costBasis = calculateHoldingsCostBasis(allHoldings);
    const totalBookCost = costBasis.totalBookCostCAD;
    const totalGainCAD = costBasis.totalMarketGainsCAD;
    const totalGainPct = costBasis.marketRoiPct;

    const stocksPct = totalCAD > 0 ? (stocksCAD / totalCAD) * 100 : 0;
    const fixedPct = totalCAD > 0 ? (fixedCAD / totalCAD) * 100 : 0;
    const altsPct = totalCAD > 0 ? (altsCAD / totalCAD) * 100 : 0;

    document.getElementById('stat-total-cad').textContent = formatCurrency(totalCAD, 'CAD');
    document.getElementById('stat-total-usd').textContent = `≈ ${formatCurrency(totalUSD, 'USD')} (FX: ${cadUsdRate.toFixed(4)})`;

    document.getElementById('stat-stocks').textContent = formatCurrency(stocksCAD, 'CAD');
    document.getElementById('stat-stocks-pct').textContent = `${stocksPct.toFixed(1)}% of portfolio`;

    document.getElementById('stat-fixed').textContent = formatCurrency(fixedCAD, 'CAD');
    document.getElementById('stat-fixed-pct').textContent = `${fixedPct.toFixed(1)}% of portfolio`;

    document.getElementById('stat-alts').textContent = formatCurrency(altsCAD, 'CAD');
    document.getElementById('stat-alts-pct').textContent = `${altsPct.toFixed(1)}% of portfolio`;

    const gainEl = document.getElementById('stat-unrealized-gain');
    const gainSubEl = document.getElementById('stat-unrealized-sub');
    if (gainEl && totalBookCost > 0) {
        const sign = totalGainCAD >= 0 ? '+' : '';
        gainEl.textContent = `${sign}${formatCurrency(totalGainCAD, 'CAD')}`;
        gainEl.style.color = totalGainCAD >= 0 ? '#166534' : '#cf222e';
        gainSubEl.textContent = `${sign}${totalGainPct.toFixed(2)}% on ${formatCurrency(totalBookCost)} cost`;
    } else if (gainEl) {
        gainEl.textContent = '$0.00';
        gainSubEl.textContent = 'Awaiting cost basis';
    }

    document.getElementById('stat-holdings-count').textContent = allHoldings.length;

    if (currentPrices?.lastUpdated) {
        document.getElementById('stat-last-updated').textContent = `Live quotes (${formatDate(currentPrices.lastUpdated)})`;
    }
}

function populateFilterDropdowns() {
    const brokerages = [...new Set(allHoldings.map(h => h.brokerage))].sort();
    const accounts = [...new Set(allHoldings.map(h => h.account))].sort();
    const strategies = [...new Set(allHoldings.map(h => h.strategy))].sort();

    const brokSelect = document.getElementById('filter-brokerage');
    brokerages.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        brokSelect.appendChild(opt);
    });

    const acctSelect = document.getElementById('filter-account');
    accounts.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        acctSelect.appendChild(opt);
    });

    const stratSelect = document.getElementById('filter-strategy');
    strategies.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        stratSelect.appendChild(opt);
    });
}

function getBookCost(h) {
    if (typeof h.totalCost === 'number' && h.totalCost > 0) return h.totalCost;
    const avg = Number(h.averageCost || 0);
    const cnt = Number(h.count || 0);
    return avg > 0 && cnt > 0 ? (avg * cnt) : 0;
}

function getGainCAD(h) {
    if (typeof h.unrealizedGainCAD === 'number') {
        return h.unrealizedGainCAD;
    }
    const cost = getBookCost(h);
    return cost > 0 ? (h.sum - cost) : 0;
}

function getGainPct(h) {
    if (typeof h.unrealizedGainPct === 'number') {
        return h.unrealizedGainPct;
    }
    const cost = getBookCost(h);
    return cost > 0 ? ((h.sum - cost) / cost) * 100 : 0;
}

function applyFiltersAndSort() {
    const searchTerm = (document.getElementById('search-input').value || '').trim().toLowerCase();
    const selectedBrokerage = document.getElementById('filter-brokerage').value;
    const selectedAccount = document.getElementById('filter-account').value;
    const selectedStrategy = document.getElementById('filter-strategy').value;
    const sortValue = document.getElementById('sort-select').value;

    let filtered = allHoldings.filter(h => {
        if (selectedBrokerage !== 'all' && h.brokerage !== selectedBrokerage) return false;
        if (selectedAccount !== 'all' && h.account !== selectedAccount) return false;
        if (selectedStrategy !== 'all' && h.strategy !== selectedStrategy) return false;

        if (searchTerm) {
            const haystack = `${h.ticker} ${h.name} ${h.brokerage} ${h.account} ${h.strategy}`.toLowerCase();
            if (!haystack.includes(searchTerm)) return false;
        }

        return true;
    });

    // Sorting
    filtered.sort((a, b) => {
        switch (sortValue) {
            case 'value-desc':
                return b.sum - a.sum;
            case 'value-asc':
                return a.sum - b.sum;
            case 'gain-desc':
                return getGainCAD(b) - getGainCAD(a);
            case 'gain-asc':
                return getGainCAD(a) - getGainCAD(b);
            case 'gain-pct-desc':
                return getGainPct(b) - getGainPct(a);
            case 'gain-pct-asc':
                return getGainPct(a) - getGainPct(b);
            case 'bookcost-desc':
                return getBookCost(b) - getBookCost(a);
            case 'bookcost-asc':
                return getBookCost(a) - getBookCost(b);
            case 'avgcost-desc':
                return (b.averageCost || 0) - (a.averageCost || 0);
            case 'avgcost-asc':
                return (a.averageCost || 0) - (b.averageCost || 0);
            case 'price-desc':
                return (b.unitPrice || 0) - (a.unitPrice || 0);
            case 'price-asc':
                return (a.unitPrice || 0) - (b.unitPrice || 0);
            case 'ticker-asc':
                return (a.ticker || '').localeCompare(b.ticker || '');
            case 'ticker-desc':
                return (b.ticker || '').localeCompare(a.ticker || '');
            case 'name-asc':
                return (a.name || '').localeCompare(b.name || '');
            case 'name-desc':
                return (b.name || '').localeCompare(a.name || '');
            case 'shares-desc':
                return b.count - a.count;
            case 'shares-asc':
                return a.count - b.count;
            case 'brokerage':
                return (a.brokerage || '').localeCompare(b.brokerage || '') || b.sum - a.sum;
            case 'brokerage-desc':
                return (b.brokerage || '').localeCompare(a.brokerage || '') || b.sum - a.sum;
            case 'account':
                return (a.account || '').localeCompare(b.account || '') || b.sum - a.sum;
            case 'account-desc':
                return (b.account || '').localeCompare(a.account || '') || b.sum - a.sum;
            case 'strategy':
                return (a.strategy || '').localeCompare(b.strategy || '') || b.sum - a.sum;
            case 'strategy-desc':
                return (b.strategy || '').localeCompare(a.strategy || '') || b.sum - a.sum;
            default:
                return b.sum - a.sum;
        }
    });

    currentFilteredHoldings = filtered;
    document.getElementById('filtered-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'position' : 'positions'}`;

    const totalPortfolioCAD = allHoldings.reduce((s, h) => s + h.sum, 0);

    renderTable(filtered, totalPortfolioCAD);
    renderCards(filtered, totalPortfolioCAD);
    updateHeaderSortIndicators(sortValue);
}

function renderTable(items, totalCAD) {
    const tbody = document.getElementById('holdings-tbody');

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" class="empty-state">No holdings match your filters.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(h => {
        const weightPct = totalCAD > 0 ? (h.sum / totalCAD) * 100 : 0;
        const safeId = escapeHtml(h.id);
        const safeTicker = escapeHtml(h.ticker);
        const safeName = escapeHtml(h.name);
        const safeBrokerage = escapeHtml(h.brokerage);
        const safeAccount = escapeHtml(h.account);
        const safeStrategy = escapeHtml(h.strategy);

        const isReg = h.registered === true || h.registered === 1 || String(h.registered).toLowerCase() === 'true' || (h.account && /TFSA|RRSP|FHSA/i.test(h.account));
        const accountBadgeClass = isReg ? 'badge badge-account badge-account-registered' : 'badge badge-account';
        const dayChange = h.dayChangePct !== undefined ? `
            <div style="font-size: 0.72rem;" class="${h.dayChangePct >= 0 ? 'text-positive' : 'text-negative'}">
                ${formatPercent(h.dayChangePct, true)}
            </div>
        ` : '';

        const avgCost = h.averageCost || 0;
        const totalCost = h.totalCost || (avgCost > 0 && h.count > 0 ? (avgCost * h.count) : 0);
        const gainCAD = h.unrealizedGainCAD !== undefined ? h.unrealizedGainCAD : (totalCost > 0 ? (h.sum - totalCost) : 0);
        const gainPct = h.unrealizedGainPct !== undefined ? h.unrealizedGainPct : (totalCost > 0 ? (gainCAD / totalCost) * 100 : 0);

        let gainHtml = '<span style="color: #94a3b8;">-</span>';
        if (totalCost > 0 && avgCost > 0) {
            const sign = gainCAD >= 0 ? '+' : '';
            const color = gainCAD >= 0 ? '#166534' : '#cf222e';
            gainHtml = `
                <div style="font-weight: 700; color: ${color};">${sign}${formatCurrency(gainCAD)}</div>
                <div style="font-size: 0.72rem; color: ${color};">${sign}${gainPct.toFixed(2)}%</div>
            `;
        }

        return `
            <tr onclick="showHoldingModal('${safeId}')" title="Click to view details">
                <td>
                    <strong style="color: #0969da;">${safeTicker}</strong>
                </td>
                <td>
                    <div>${safeName}</div>
                </td>
                <td>
                    <span class="badge badge-brokerage">${safeBrokerage}</span>
                </td>
                <td>
                    <span class="${accountBadgeClass}" ${isReg ? 'title="Registered Tax-Advantaged Account"' : ''}>${safeAccount}</span>
                </td>
                <td class="text-right">
                    ${h.count.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td class="text-right" style="color: #475569;">
                    ${avgCost > 0 ? formatCurrency(avgCost) : '<span style="color:#94a3b8;">-</span>'}
                </td>
                <td class="text-right">
                    ${formatCurrency(h.unitPrice)}
                    ${dayChange}
                </td>
                <td class="text-right" style="color: #475569;">
                    ${totalCost > 0 ? formatCurrency(totalCost) : '<span style="color:#94a3b8;">-</span>'}
                </td>
                <td class="text-right font-bold">
                    ${formatCurrency(h.sum)}
                </td>
                <td class="text-right">
                    ${gainHtml}
                </td>
                <td class="text-right">
                    <div>${weightPct.toFixed(2)}%</div>
                    <div class="allocation-bar-wrap" style="height: 4px; margin-top: 4px;" title="Weight in portfolio">
                        <div style="width: ${weightPct}%; background-color: #0969da; height: 100%;"></div>
                    </div>
                </td>
                <td>
                    <span class="badge badge-strategy">${safeStrategy}</span>
                </td>
            </tr>
        `;
    }).join('');
}

function renderCards(items, totalCAD) {
    const container = document.getElementById('holdings-cards-container');

    if (items.length === 0) {
        container.innerHTML = `<p class="empty-state">No holdings match your filters.</p>`;
        return;
    }

    container.innerHTML = items.map(h => {
        const weightPct = totalCAD > 0 ? (h.sum / totalCAD) * 100 : 0;
        const safeId = escapeHtml(h.id);
        const safeTicker = escapeHtml(h.ticker);
        const safeName = escapeHtml(h.name);
        const safeBrokerage = escapeHtml(h.brokerage);
        const safeAccount = escapeHtml(h.account);
        const safeStrategy = escapeHtml(h.strategy);

        const isReg = h.registered === true || h.registered === 1 || String(h.registered).toLowerCase() === 'true' || (h.account && /TFSA|RRSP|FHSA/i.test(h.account));
        const accountBadgeClass = isReg ? 'badge badge-account badge-account-registered' : 'badge badge-account';

        const avgCost = h.averageCost || 0;
        const totalCost = h.totalCost || (avgCost > 0 && h.count > 0 ? (avgCost * h.count) : 0);
        const gainCAD = h.unrealizedGainCAD !== undefined ? h.unrealizedGainCAD : (totalCost > 0 ? (h.sum - totalCost) : 0);
        const gainPct = h.unrealizedGainPct !== undefined ? h.unrealizedGainPct : (totalCost > 0 ? (gainCAD / totalCost) * 100 : 0);

        let gainBadge = '';
        if (totalCost > 0 && avgCost > 0) {
            const sign = gainCAD >= 0 ? '+' : '';
            const color = gainCAD >= 0 ? '#166534' : '#cf222e';
            const bg = gainCAD >= 0 ? '#dcfce7' : '#fee2e2';
            gainBadge = `
                <span class="badge" style="background: ${bg}; color: ${color}; font-weight: 700;">
                    ${sign}${formatCurrency(gainCAD)} (${sign}${gainPct.toFixed(1)}%)
                </span>
            `;
        }

        return `
            <div class="holding-card" onclick="showHoldingModal('${safeId}')">
                <div class="card-top">
                    <div>
                        <div class="card-ticker">${safeTicker}</div>
                        <div class="card-name">${safeName}</div>
                    </div>
                    <div>
                        <div class="card-value">${formatCurrency(h.sum)}</div>
                        <div style="font-size: 0.74rem; text-align: right; color: #64748b;">${weightPct.toFixed(2)}% weight</div>
                    </div>
                </div>

                <div class="card-details">
                    <span>${h.count.toLocaleString('en-US', { maximumFractionDigits: 2 })} units @ ${formatCurrency(h.unitPrice)}</span>
                    ${avgCost > 0 ? `<span style="font-size: 0.74rem; color: #64748b;">Avg: ${formatCurrency(avgCost)}</span>` : ''}
                    <span class="${(h.dayChangePct || 0) >= 0 ? 'text-positive' : 'text-negative'}">
                        ${h.dayChangePct !== undefined ? formatPercent(h.dayChangePct, true) : ''}
                    </span>
                </div>

                <div class="card-badges">
                    <span class="badge badge-brokerage">${safeBrokerage}</span>
                    <span class="${accountBadgeClass}" ${isReg ? 'title="Registered Tax-Advantaged Account"' : ''}>${safeAccount}</span>
                    <span class="badge badge-strategy">${safeStrategy}</span>
                    ${gainBadge}
                </div>
            </div>
        `;
    }).join('');
}

function changeViewMode(mode) {
    const tableContainer = document.getElementById('holdings-table-container');
    const cardsContainer = document.getElementById('holdings-cards-container');

    if (mode === 'cards') {
        tableContainer.style.display = 'none';
        cardsContainer.style.display = 'grid';
    } else {
        tableContainer.style.display = 'block';
        cardsContainer.style.display = 'none';
    }

    localStorage.setItem('holdingsViewMode', mode);
}

function setSort(column) {
    const select = document.getElementById('sort-select');
    if (column === 'sum' || column === 'weight') {
        select.value = select.value === 'value-desc' ? 'value-asc' : 'value-desc';
    } else if (column === 'unrealizedGainCAD' || column === 'gain') {
        select.value = select.value === 'gain-desc' ? 'gain-asc' : 'gain-desc';
    } else if (column === 'unrealizedGainPct') {
        select.value = select.value === 'gain-pct-desc' ? 'gain-pct-asc' : 'gain-pct-desc';
    } else if (column === 'totalCost') {
        select.value = select.value === 'bookcost-desc' ? 'bookcost-asc' : 'bookcost-desc';
    } else if (column === 'averageCost') {
        select.value = select.value === 'avgcost-desc' ? 'avgcost-asc' : 'avgcost-desc';
    } else if (column === 'unitPrice') {
        select.value = select.value === 'price-desc' ? 'price-asc' : 'price-desc';
    } else if (column === 'ticker') {
        select.value = select.value === 'ticker-asc' ? 'ticker-desc' : 'ticker-asc';
    } else if (column === 'name') {
        select.value = select.value === 'name-asc' ? 'name-desc' : 'name-asc';
    } else if (column === 'count') {
        select.value = select.value === 'shares-desc' ? 'shares-asc' : 'shares-desc';
    } else if (column === 'brokerage') {
        select.value = select.value === 'brokerage' ? 'brokerage-desc' : 'brokerage';
    } else if (column === 'account') {
        select.value = select.value === 'account' ? 'account-desc' : 'account';
    } else if (column === 'strategy') {
        select.value = select.value === 'strategy' ? 'strategy-desc' : 'strategy';
    }
    applyFiltersAndSort();
}

function updateHeaderSortIndicators(sortValue) {
    const headers = document.querySelectorAll('.data-table thead th[data-col]');
    headers.forEach(th => {
        const col = th.getAttribute('data-col');
        const raw = th.getAttribute('data-title') || th.textContent;
        const title = raw.replace(/[⬍▲▼]/g, '').trim();
        th.setAttribute('data-title', title);

        let indicator = '⬍';
        if ((col === 'sum' || col === 'weight') && sortValue === 'value-desc') indicator = '▼';
        else if ((col === 'sum' || col === 'weight') && sortValue === 'value-asc') indicator = '▲';
        else if (col === 'unrealizedGainCAD' && (sortValue === 'gain-desc' || sortValue === 'gain-pct-desc')) indicator = '▼';
        else if (col === 'unrealizedGainCAD' && (sortValue === 'gain-asc' || sortValue === 'gain-pct-asc')) indicator = '▲';
        else if (col === 'totalCost' && sortValue === 'bookcost-desc') indicator = '▼';
        else if (col === 'totalCost' && sortValue === 'bookcost-asc') indicator = '▲';
        else if (col === 'averageCost' && sortValue === 'avgcost-desc') indicator = '▼';
        else if (col === 'averageCost' && sortValue === 'avgcost-asc') indicator = '▲';
        else if (col === 'unitPrice' && sortValue === 'price-desc') indicator = '▼';
        else if (col === 'unitPrice' && sortValue === 'price-asc') indicator = '▲';
        else if (col === 'ticker' && sortValue === 'ticker-asc') indicator = '▲';
        else if (col === 'ticker' && sortValue === 'ticker-desc') indicator = '▼';
        else if (col === 'name' && sortValue === 'name-asc') indicator = '▲';
        else if (col === 'name' && sortValue === 'name-desc') indicator = '▼';
        else if (col === 'count' && sortValue === 'shares-desc') indicator = '▼';
        else if (col === 'count' && sortValue === 'shares-asc') indicator = '▲';
        else if (col === 'brokerage' && sortValue === 'brokerage') indicator = '▲';
        else if (col === 'brokerage' && sortValue === 'brokerage-desc') indicator = '▼';
        else if (col === 'account' && sortValue === 'account') indicator = '▲';
        else if (col === 'account' && sortValue === 'account-desc') indicator = '▼';
        else if (col === 'strategy' && sortValue === 'strategy') indicator = '▲';
        else if (col === 'strategy' && sortValue === 'strategy-desc') indicator = '▼';

        th.textContent = `${title} ${indicator}`;
    });
}

/* ================= Holding Detail Modal ================= */
function showHoldingModal(id) {
    const holding = allHoldings.find(h => h.id === id);
    if (!holding) return;

    const totalPortfolioCAD = allHoldings.reduce((s, h) => s + h.sum, 0);
    const weightPct = totalPortfolioCAD > 0 ? (holding.sum / totalPortfolioCAD) * 100 : 0;
    const modalBody = document.getElementById('modal-body');

    const avgCost = holding.averageCost || 0;
    const totalCost = holding.totalCost || (avgCost > 0 && holding.count > 0 ? (avgCost * holding.count) : 0);
    const gainCAD = holding.unrealizedGainCAD !== undefined ? holding.unrealizedGainCAD : (totalCost > 0 ? (holding.sum - totalCost) : 0);
    const gainPct = holding.unrealizedGainPct !== undefined ? holding.unrealizedGainPct : (totalCost > 0 ? (gainCAD / totalCost) * 100 : 0);

    const sign = gainCAD >= 0 ? '+' : '';
    const gainColor = gainCAD >= 0 ? '#166534' : '#cf222e';

    // Breakdown segments
    const alloc = holding.allocation || {};
    const categories = [
        { label: 'US Equities', value: alloc.us || 0, color: '#2563eb' },
        { label: 'Canadian Equities', value: alloc.canada || 0, color: '#dc2626' },
        { label: 'International Developed', value: alloc.developed || 0, color: '#059669' },
        { label: 'Emerging Markets', value: alloc.emerging || 0, color: '#d97706' },
        { label: 'Fixed Income / Cash', value: alloc.fixedIncome || 0, color: '#64748b' },
        { label: 'Precious Metals', value: alloc.preciousMetals || 0, color: '#eab308' },
        { label: 'Cryptocurrency', value: alloc.crypto || 0, color: '#8b5cf6' }
    ].filter(c => c.value > 0);

    const breakdownHtml = categories.map(cat => {
        const pct = holding.sum > 0 ? (cat.value / holding.sum) * 100 : 0;
        return `
            <div style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 3px;">
                    <span><strong style="color: ${cat.color};">&bull;</strong> ${cat.label}</span>
                    <span><strong>${formatCurrency(cat.value)}</strong> (${pct.toFixed(1)}%)</span>
                </div>
                <div class="allocation-bar-wrap" style="height: 6px;">
                    <div style="width: ${pct}%; background-color: ${cat.color}; height: 100%;"></div>
                </div>
            </div>
        `;
    }).join('');

    const yahooUrl = holding.symbol && holding.symbol !== 'CASH'
        ? `https://finance.yahoo.com/quote/${encodeURIComponent(holding.symbol)}`
        : null;

    const isReg = holding.registered === true || holding.registered === 1 || String(holding.registered).toLowerCase() === 'true' || (holding.account && /TFSA|RRSP|FHSA/i.test(holding.account));
    const modalAccountClass = isReg ? 'badge badge-account badge-account-registered' : 'badge badge-account';

    modalBody.innerHTML = `
        <div style="margin-bottom: 16px;">
            <div style="display: flex; align-items: baseline; gap: 8px;">
                <h2 style="font-size: 1.5rem; color: #0969da; margin: 0;">${escapeHtml(holding.ticker)}</h2>
                <span class="badge badge-strategy">${escapeHtml(holding.strategy)}</span>
            </div>
            <div style="font-size: 0.95rem; color: #64748b; margin-top: 2px;">${escapeHtml(holding.name)}</div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px;">
            <div class="stat-card-box" style="padding: 10px; align-items: flex-start; text-align: left;">
                <span class="stat-label">Market Value</span>
                <span style="font-size: 1.25rem; font-weight: 800; color: #1f2328;">${formatCurrency(holding.sum)}</span>
                <span style="font-size: 0.74rem; color: #64748b;">${weightPct.toFixed(2)}% of portfolio</span>
            </div>
            <div class="stat-card-box" style="padding: 10px; align-items: flex-start; text-align: left;">
                <span class="stat-label">Book Cost</span>
                <span style="font-size: 1.25rem; font-weight: 800; color: #1f2328;">${totalCost > 0 ? formatCurrency(totalCost) : '-'}</span>
                <span style="font-size: 0.74rem; color: #64748b;">${avgCost > 0 ? `Avg: ${formatCurrency(avgCost)}` : 'No cost basis'}</span>
            </div>
            <div class="stat-card-box" style="padding: 10px; align-items: flex-start; text-align: left;">
                <span class="stat-label">Current Unit Price</span>
                <span style="font-size: 1.25rem; font-weight: 800; color: #1f2328;">${formatCurrency(holding.unitPrice)}</span>
                <span style="font-size: 0.74rem; color: #64748b;">${holding.count.toLocaleString('en-US', { maximumFractionDigits: 2 })} shares</span>
            </div>
            <div class="stat-card-box" style="padding: 10px; align-items: flex-start; text-align: left;">
                <span class="stat-label">Unrealized Gain</span>
                <span style="font-size: 1.25rem; font-weight: 800; color: ${totalCost > 0 ? gainColor : '#64748b'};">${totalCost > 0 ? `${sign}${formatCurrency(gainCAD)}` : '-'}</span>
                <span style="font-size: 0.74rem; color: ${totalCost > 0 ? gainColor : '#64748b'};">${totalCost > 0 ? `${sign}${gainPct.toFixed(2)}% all-time` : 'Awaiting cost'}</span>
            </div>
        </div>

        <div style="margin-bottom: 20px;">
            <h4 style="font-size: 0.85rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; margin-bottom: 8px;">Account Details</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.84rem;">
                <span class="badge badge-brokerage">Brokerage: ${escapeHtml(holding.brokerage)}</span>
                <span class="${modalAccountClass}" ${isReg ? 'title="Registered Tax-Advantaged Account"' : ''}>Account: ${escapeHtml(holding.account)}</span>
                <span class="badge badge-strategy">Strategy: ${escapeHtml(holding.strategy || 'Broad Market')}</span>
            </div>
        </div>

        <div style="margin-bottom: 20px;">
            <h4 style="font-size: 0.85rem; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; margin-bottom: 12px;">Asset Allocation Breakdown</h4>
            ${breakdownHtml || '<p style="color: #64748b; font-size: 0.84rem;">Single asset allocation.</p>'}
        </div>

        ${yahooUrl ? `
            <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #edf2f7; display: flex; justify-content: flex-end;">
                <a href="${yahooUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="text-decoration: none;">
                    View on Yahoo Finance &rarr;
                </a>
            </div>
        ` : ''}
    `;

    document.getElementById('holding-modal').classList.add('active');
}

function closeHoldingModal() {
    document.getElementById('holding-modal').classList.remove('active');
}

function closeModalOnOverlay(e) {
    if (e.target.id === 'holding-modal') {
        closeHoldingModal();
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeHoldingModal();
    }
});

/* ================= CSV Export Function ================= */
function exportDataCSV() {
    const header = ['Brokerage', 'Ticker', 'Account', 'Registered?', 'Count', 'Average Cost', 'Book Cost', 'Unit Price', 'Market Value', 'Unrealized Gain CAD', 'Unrealized Gain %', 'US', 'Canada', 'Developed', 'Emerging', 'Fixed Income', 'Crypto', 'Precious Metals', 'Strategy'];
    const targetHoldings = (currentFilteredHoldings && currentFilteredHoldings.length > 0) ? currentFilteredHoldings : allHoldings;
    const rows = targetHoldings.map(h => [
        `"${h.brokerage}"`,
        `"${h.ticker}"`,
        `"${h.account}"`,
        h.registered ? 1 : 0,
        h.count,
        h.averageCost || 0,
        h.totalCost || 0,
        h.unitPrice.toFixed(2),
        `"${h.sum.toFixed(2)}"`,
        h.unrealizedGainCAD !== undefined ? h.unrealizedGainCAD.toFixed(2) : 0,
        h.unrealizedGainPct !== undefined ? h.unrealizedGainPct.toFixed(2) : 0,
        h.allocation.us.toFixed(2),
        h.allocation.canada.toFixed(2),
        h.allocation.developed.toFixed(2),
        h.allocation.emerging.toFixed(2),
        h.allocation.fixedIncome.toFixed(2),
        h.allocation.crypto.toFixed(2),
        h.allocation.preciousMetals.toFixed(2),
        `"${h.strategy}"`
    ]);

    const csvContent = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Portfolio-Holdings-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

document.addEventListener('DOMContentLoaded', initHoldings);
