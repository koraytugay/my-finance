/**
 * Asset Allocation Controller
 */

let holdings = [];
let simpleAllocData = [];
let simpleAllocSort = { col: 'pct', dir: 'desc' };

async function initAllocation() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('alloc-content');
    const errorEl = document.getElementById('error');

    try {
        const [h, prices] = await Promise.all([getHoldings(), getPrices()]);
        holdings = h;
        simpleAllocData = [];

        renderOverviewCards();
        renderBreakdowns();
        renderCurrencyExposure();
        renderSimpleAllocTable();
        renderMatrixTable();

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initAllocation());
            return;
        }
        console.error('Failed to initialize allocation:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error loading allocation data: ${err.message}`;
    }
}

function calculateTotals() {
    let totalCAD = 0;
    let us = 0;
    let canada = 0;
    let developed = 0;
    let emerging = 0;
    let fixed = 0;
    let crypto = 0;
    let metals = 0;

    holdings.forEach(h => {
        totalCAD += h.sum;
        const a = h.allocation || {};
        us += (a.us || 0);
        canada += (a.canada || 0);
        developed += (a.developed || 0);
        emerging += (a.emerging || 0);
        fixed += (a.fixedIncome || 0);
        crypto += (a.crypto || 0);
        metals += (a.preciousMetals || 0);
    });

    return { totalCAD, us, canada, developed, emerging, fixed, crypto, metals };
}

function renderOverviewCards() {
    const totals = calculateTotals();
    const t = totals.totalCAD || 1;

    document.getElementById('alloc-us').textContent = formatCurrency(totals.us);
    document.getElementById('alloc-us-pct').textContent = `${((totals.us / t) * 100).toFixed(1)}% of portfolio`;

    document.getElementById('alloc-canada').textContent = formatCurrency(totals.canada);
    document.getElementById('alloc-canada-pct').textContent = `${((totals.canada / t) * 100).toFixed(1)}% of portfolio`;

    document.getElementById('alloc-dev').textContent = formatCurrency(totals.developed);
    document.getElementById('alloc-dev-pct').textContent = `${((totals.developed / t) * 100).toFixed(1)}% of portfolio`;

    document.getElementById('alloc-em').textContent = formatCurrency(totals.emerging);
    document.getElementById('alloc-em-pct').textContent = `${((totals.emerging / t) * 100).toFixed(1)}% of portfolio`;

    document.getElementById('alloc-fixed').textContent = formatCurrency(totals.fixed);
    document.getElementById('alloc-fixed-pct').textContent = `${((totals.fixed / t) * 100).toFixed(1)}% of portfolio`;

    const altsVal = totals.metals + totals.crypto;
    document.getElementById('alloc-alts').textContent = formatCurrency(altsVal);
    document.getElementById('alloc-alts-pct').textContent = `${((altsVal / t) * 100).toFixed(1)}% of portfolio`;
}

function renderBreakdowns() {
    const totals = calculateTotals();
    const t = totals.totalCAD || 1;
    const totalEquities = totals.us + totals.canada + totals.developed + totals.emerging || 1;

    // 1. Global Equity Geography
    const geoItems = [
        { label: 'US Equities', value: totals.us, color: '#2563eb' },
        { label: 'Canadian Equities', value: totals.canada, color: '#dc2626' },
        { label: 'International Developed', value: totals.developed, color: '#059669' },
        { label: 'Emerging Markets', value: totals.emerging, color: '#d97706' }
    ];

    document.getElementById('geo-breakdown-list').innerHTML = geoItems.map(item => {
        const pctOfEquities = (item.value / totalEquities) * 100;
        const pctOfPortfolio = (item.value / t) * 100;
        return `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.84rem; margin-bottom: 3px;">
                    <span><strong style="color: ${item.color};">&bull;</strong> ${item.label}</span>
                    <span><strong>${formatCurrency(item.value)}</strong> (${pctOfEquities.toFixed(1)}% equity)</span>
                </div>
                <div class="allocation-bar-wrap" style="height: 8px;">
                    <div style="width: ${pctOfEquities}%; background-color: ${item.color}; height: 100%;"></div>
                </div>
                <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px; text-align: right;">${pctOfPortfolio.toFixed(1)}% of total portfolio</div>
            </div>
        `;
    }).join('');

    // 2. Asset Class Allocation
    const classItems = [
        { label: 'Equities (Stocks)', value: totalEquities, color: '#2563eb' },
        { label: 'Fixed Income & Cash', value: totals.fixed, color: '#64748b' },
        { label: 'Precious Metals', value: totals.metals, color: '#eab308' },
        { label: 'Cryptocurrency', value: totals.crypto, color: '#8b5cf6' }
    ];

    document.getElementById('class-breakdown-list').innerHTML = classItems.map(item => {
        const pct = (item.value / t) * 100;
        return `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.84rem; margin-bottom: 3px;">
                    <span><strong style="color: ${item.color};">&bull;</strong> ${item.label}</span>
                    <span><strong>${formatCurrency(item.value)}</strong> (${pct.toFixed(1)}%)</span>
                </div>
                <div class="allocation-bar-wrap" style="height: 8px;">
                    <div style="width: ${pct}%; background-color: ${item.color}; height: 100%;"></div>
                </div>
            </div>
        `;
    }).join('');

    // 3. Investment Strategy Tilts
    const strategyTotals = {};
    holdings.forEach(h => {
        strategyTotals[h.strategy] = (strategyTotals[h.strategy] || 0) + h.sum;
    });

    const strategyColors = {
        'Factor': '#7c3aed',
        'Broad Market': '#0284c7',
        'Fixed Income': '#475569',
        'Precious Metals': '#ca8a04',
        'Crypto': '#9333ea'
    };

    const strategyEntries = Object.entries(strategyTotals).sort((a, b) => b[1] - a[1]);

    document.getElementById('strategy-breakdown-list').innerHTML = strategyEntries.map(([strat, val]) => {
        const pct = (val / t) * 100;
        const color = strategyColors[strat] || '#64748b';
        return `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.84rem; margin-bottom: 3px;">
                    <span><strong style="color: ${color};">&bull;</strong> ${strat}</span>
                    <span><strong>${formatCurrency(val)}</strong> (${pct.toFixed(1)}%)</span>
                </div>
                <div class="allocation-bar-wrap" style="height: 8px;">
                    <div style="width: ${pct}%; background-color: ${color}; height: 100%;"></div>
                </div>
            </div>
        `;
    }).join('');
}

function renderMatrixTable() {
    const tbody = document.getElementById('matrix-tbody');
    const tfoot = document.getElementById('matrix-tfoot');
    const sorted = [...holdings].sort((a, b) => b.sum - a.sum);

    document.getElementById('matrix-count').textContent = `${sorted.length} holdings`;

    tbody.innerHTML = sorted.map(h => {
        const a = h.allocation || {};
        const formatCell = (val) => val > 0 ? formatCurrency(val) : '<span style="color: #cbd5e1;">-</span>';

        return `
            <tr>
                <td><strong style="color: #0969da;">${escapeHtml(h.ticker)}</strong></td>
                <td>${escapeHtml(h.name)}</td>
                <td><span class="badge badge-strategy">${escapeHtml(h.strategy)}</span></td>
                <td class="text-right font-bold">${formatCurrency(h.sum)}</td>
                <td class="text-right">${formatCell(a.us)}</td>
                <td class="text-right">${formatCell(a.canada)}</td>
                <td class="text-right">${formatCell(a.developed)}</td>
                <td class="text-right">${formatCell(a.emerging)}</td>
                <td class="text-right">${formatCell(a.fixedIncome)}</td>
                <td class="text-right">${formatCell(a.preciousMetals)}</td>
                <td class="text-right">${formatCell(a.crypto)}</td>
            </tr>
        `;
    }).join('');

    const totals = calculateTotals();
    tfoot.innerHTML = `
        <tr>
            <td colspan="3">PORTFOLIO TOTALS</td>
            <td class="text-right">${formatCurrency(totals.totalCAD)}</td>
            <td class="text-right">${formatCurrency(totals.us)}</td>
            <td class="text-right">${formatCurrency(totals.canada)}</td>
            <td class="text-right">${formatCurrency(totals.developed)}</td>
            <td class="text-right">${formatCurrency(totals.emerging)}</td>
            <td class="text-right">${formatCurrency(totals.fixed)}</td>
            <td class="text-right">${formatCurrency(totals.metals)}</td>
            <td class="text-right">${formatCurrency(totals.crypto)}</td>
        </tr>
    `;
}

function renderCurrencyExposure() {
    const totals = calculateTotals();
    const totalCAD = totals.totalCAD || 1;

    // Direct quoted currency
    const directUSD_CAD = holdings.filter(h => h.currency === 'USD').reduce((s, h) => s + h.sum, 0);
    const directCAD_CAD = holdings.filter(h => h.currency !== 'USD').reduce((s, h) => s + h.sum, 0);
    const directUSDPct = (directUSD_CAD / totalCAD) * 100;
    const directCADPct = (directCAD_CAD / totalCAD) * 100;

    const dirCadVal = document.getElementById('fx-direct-cad-val');
    const dirCadBar = document.getElementById('fx-direct-cad-bar');
    const dirUsdVal = document.getElementById('fx-direct-usd-val');
    const dirUsdBar = document.getElementById('fx-direct-usd-bar');

    if (dirCadVal) dirCadVal.textContent = `${formatCurrency(directCAD_CAD)} (${directCADPct.toFixed(1)}%)`;
    if (dirCadBar) dirCadBar.style.width = `${directCADPct}%`;
    if (dirUsdVal) dirUsdVal.textContent = `${formatCurrency(directUSD_CAD)} (${directUSDPct.toFixed(1)}%)`;
    if (dirUsdBar) dirUsdBar.style.width = `${directUSDPct}%`;

    // Look-through economic currency exposure
    const usEconCAD = totals.us;
    const cadEconCAD = totals.canada + totals.fixed;
    const intlEconCAD = totals.developed + totals.emerging + totals.metals + totals.crypto;

    const usEconPct = (usEconCAD / totalCAD) * 100;
    const cadEconPct = (cadEconCAD / totalCAD) * 100;
    const intlEconPct = (intlEconCAD / totalCAD) * 100;

    const econUsdVal = document.getElementById('fx-econ-usd-val');
    const econUsdBar = document.getElementById('fx-econ-usd-bar');
    const econCadVal = document.getElementById('fx-econ-cad-val');
    const econCadBar = document.getElementById('fx-econ-cad-bar');
    const econIntlVal = document.getElementById('fx-econ-intl-val');
    const econIntlBar = document.getElementById('fx-econ-intl-bar');

    if (econUsdVal) econUsdVal.textContent = `${formatCurrency(usEconCAD)} (${usEconPct.toFixed(1)}%)`;
    if (econUsdBar) econUsdBar.style.width = `${usEconPct}%`;
    if (econCadVal) econCadVal.textContent = `${formatCurrency(cadEconCAD)} (${cadEconPct.toFixed(1)}%)`;
    if (econCadBar) econCadBar.style.width = `${cadEconPct}%`;
    if (econIntlVal) econIntlVal.textContent = `${formatCurrency(intlEconCAD)} (${intlEconPct.toFixed(1)}%)`;
    if (econIntlBar) econIntlBar.style.width = `${intlEconPct}%`;

    const shieldPctEl = document.getElementById('sim-fx-shield-pct');
    if (shieldPctEl) {
        shieldPctEl.textContent = `${usEconPct.toFixed(1)}% US Shield`;
    }

    // Cache values for interactive slider dynamically
    const liveRate = (window.cachedPrices && window.cachedPrices.cadUsdRate) ? window.cachedPrices.cadUsdRate : (window.baseFXRate || 0.7073);
    window.baseFXRate = liveRate;
    window.baseTotalCAD = totalCAD;
    window.baseUSEconCAD = usEconCAD;

    const slider = document.getElementById('fx-slider');
    if (slider) {
        slider.value = liveRate;
    }

    onFXSliderChange(liveRate);
}

function onFXSliderChange(newRateStr) {
    const newRate = parseFloat(newRateStr);
    const baseRate = window.baseFXRate || 0.7073;
    const baseCAD = window.baseTotalCAD || 0;
    const usCAD = window.baseUSEconCAD || 0;

    // US dollar worth of US assets = usCAD * baseRate
    // At newRate (USD per CAD), converted back to CAD = (usCAD * baseRate) / newRate
    const newUsCAD = (usCAD * baseRate) / newRate;
    const deltaCAD = newUsCAD - usCAD;
    const simTotalCAD = baseCAD + deltaCAD;
    const simTotalUSD = simTotalCAD * newRate;
    const deltaPct = baseCAD > 0 ? (deltaCAD / baseCAD) * 100 : 0;

    const usdCadRate = (1 / newRate).toFixed(3);
    const rateDisplay = document.getElementById('slider-rate-display');
    if (rateDisplay) {
        rateDisplay.textContent = `1 CAD = ${newRate.toFixed(3)} USD (USD/CAD ${usdCadRate})`;
    }

    const simNwCad = document.getElementById('sim-nw-cad');
    const simNwUsd = document.getElementById('sim-nw-usd');
    const impactEl = document.getElementById('sim-impact-cad');
    const impactDesc = document.getElementById('sim-impact-desc');

    if (simNwCad) simNwCad.textContent = `${formatCurrency(simTotalCAD, 'CAD')}`;
    if (simNwUsd) simNwUsd.textContent = `≈ ${formatCurrency(simTotalUSD, 'USD')}`;

    if (impactEl) {
        const sign = deltaCAD >= 0 ? '+' : '';
        impactEl.textContent = `${sign}${formatCurrency(deltaCAD, 'CAD')} (${sign}${deltaPct.toFixed(2)}%)`;
        if (deltaCAD > 50) {
            impactEl.style.color = '#16a34a';
            if (impactDesc) impactDesc.textContent = 'CAD depreciation boosted the purchasing power of your US assets';
        } else if (deltaCAD < -50) {
            impactEl.style.color = '#cf222e';
            if (impactDesc) impactDesc.textContent = 'CAD appreciation slightly reduced converted CAD value of US assets';
        } else {
            impactEl.style.color = '#0969da';
            if (impactDesc) impactDesc.textContent = 'Holding unhedged US assets buffers currency swings';
        }
    }
}

function resetFXSlider() {
    const slider = document.getElementById('fx-slider');
    const defaultRate = window.baseFXRate || 0.7073;
    if (slider) {
        slider.value = defaultRate;
        onFXSliderChange(defaultRate);
    }
}

/* ================= Aggregated ETF & Cash Allocation ================= */

function isCashHolding(h) {
    if (!h) return false;
    const ticker = String(h.ticker || '').trim().toLowerCase();
    const symbol = String(h.symbol || '').trim().toLowerCase();
    const account = String(h.account || '').trim().toUpperCase();
    return ticker === 'cash' || symbol === 'cash' || account === 'CASH';
}

function getHoldingAssetKey(h) {
    if (isCashHolding(h)) return 'CASH';
    const raw = String(h.ticker || h.symbol || h.name || '').trim();
    return raw
        .replace(/^TSE:/i, '')
        .replace(/\.TO$/i, '')
        .toUpperCase()
        .trim();
}

function computeSimpleAllocation(holdingsList) {
    const list = holdingsList || [];
    const totalCAD = list.reduce((s, h) => s + (Number(h.sum) || 0), 0) || 1;
    const map = {};

    list.forEach(h => {
        const asset = getHoldingAssetKey(h);
        if (!asset) return;

        if (!map[asset]) {
            map[asset] = {
                asset: asset,
                sum: 0,
                pct: 0
            };
        }
        map[asset].sum += (Number(h.sum) || 0);
    });

    const result = Object.values(map).map(item => {
        item.pct = (item.sum / totalCAD) * 100;
        return item;
    });

    result.sort((a, b) => (b.sum - a.sum) || a.asset.localeCompare(b.asset));
    return result;
}

function renderSimpleAllocTable() {
    const tbody = document.getElementById('simple-alloc-tbody');
    const tfoot = document.getElementById('simple-alloc-tfoot');
    const countEl = document.getElementById('simple-alloc-count');
    if (!tbody) return;

    if (!simpleAllocData || simpleAllocData.length === 0) {
        simpleAllocData = computeSimpleAllocation(holdings);
    }

    if (countEl) {
        countEl.textContent = `${simpleAllocData.length} ${simpleAllocData.length === 1 ? 'asset' : 'assets'}`;
    }

    if (simpleAllocData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="empty-state" style="text-align: center; color: #64748b; padding: 16px;">No allocation data available.</td></tr>`;
        if (tfoot) tfoot.innerHTML = '';
        return;
    }

    // Sort according to current state
    const sorted = [...simpleAllocData].sort((a, b) => {
        let diff = 0;
        if (simpleAllocSort.col === 'asset') {
            diff = a.asset.localeCompare(b.asset);
        } else if (simpleAllocSort.col === 'pct') {
            diff = a.pct - b.pct;
        } else {
            diff = a.sum - b.sum;
        }
        return simpleAllocSort.dir === 'desc' ? -diff : diff;
    });

    tbody.innerHTML = sorted.map(item => `
        <tr>
            <td><strong style="color: #0969da;">${escapeHtml(item.asset)}</strong></td>
            <td class="text-right font-bold">${item.pct.toFixed(2)}%</td>
            <td class="text-right font-bold">${formatCurrency(item.sum)}</td>
        </tr>
    `).join('');

    const totalCAD = holdings.reduce((s, h) => s + (Number(h.sum) || 0), 0);
    if (tfoot) {
        tfoot.innerHTML = `
            <tr>
                <td>PORTFOLIO TOTAL</td>
                <td class="text-right">100.00%</td>
                <td class="text-right font-bold">${formatCurrency(totalCAD)}</td>
            </tr>
        `;
    }

    // Update sort icons
    const cols = ['asset', 'pct', 'sum'];
    cols.forEach(c => {
        const iconEl = document.getElementById(`sort-icon-${c}`);
        if (!iconEl) return;
        if (c === simpleAllocSort.col) {
            iconEl.textContent = simpleAllocSort.dir === 'desc' ? '▼' : '▲';
            iconEl.style.color = '#0969da';
        } else {
            iconEl.textContent = '⬍';
            iconEl.style.color = '#94a3b8';
        }
    });
}

function sortSimpleAlloc(col) {
    if (simpleAllocSort.col === col) {
        simpleAllocSort.dir = simpleAllocSort.dir === 'desc' ? 'asc' : 'desc';
    } else {
        simpleAllocSort.col = col;
        simpleAllocSort.dir = col === 'asset' ? 'asc' : 'desc';
    }
    renderSimpleAllocTable();
}

function copySimpleAllocationTable(format = 'tsv') {
    if (!simpleAllocData || simpleAllocData.length === 0) {
        simpleAllocData = computeSimpleAllocation(holdings);
    }
    if (!simpleAllocData || simpleAllocData.length === 0) return;

    // Use current table sort order for copy
    const sorted = [...simpleAllocData].sort((a, b) => {
        let diff = 0;
        if (simpleAllocSort.col === 'asset') {
            diff = a.asset.localeCompare(b.asset);
        } else if (simpleAllocSort.col === 'pct') {
            diff = a.pct - b.pct;
        } else {
            diff = a.sum - b.sum;
        }
        return simpleAllocSort.dir === 'desc' ? -diff : diff;
    });

    const totalCAD = holdings.reduce((s, h) => s + (Number(h.sum) || 0), 0);
    let textContent = '';
    let htmlContent = '';

    if (format === 'text') {
        const lines = sorted.map(item => `${item.pct.toFixed(2)}% ${item.asset} (${formatCurrency(item.sum)})`);
        lines.push(`Total: 100.00% (${formatCurrency(totalCAD)})`);
        textContent = lines.join('\n');
    } else {
        // Tab-separated values (TSV)
        const lines = [];
        lines.push(['Asset', 'Allocation', 'Value (CAD)'].join('\t'));
        sorted.forEach(item => {
            lines.push([item.asset, `${item.pct.toFixed(2)}%`, formatCurrency(item.sum)].join('\t'));
        });
        lines.push(['Total', '100.00%', formatCurrency(totalCAD)].join('\t'));
        textContent = lines.join('\n');

        const htmlRows = sorted.map(item =>
            `<tr><td>${escapeHtml(item.asset)}</td><td style="text-align:right;">${item.pct.toFixed(2)}%</td><td style="text-align:right;">${formatCurrency(item.sum)}</td></tr>`
        ).join('');
        htmlContent = `<table><thead><tr><th>Asset</th><th>Allocation</th><th>Value (CAD)</th></tr></thead><tbody>${htmlRows}</tbody><tfoot><tr><td>Total</td><td style="text-align:right;">100.00%</td><td style="text-align:right;">${formatCurrency(totalCAD)}</td></tr></tfoot></table>`;
    }

    const btnId = format === 'text' ? 'btn-copy-alloc-text' : 'btn-copy-alloc-tsv';
    const btn = document.getElementById(btnId);

    const setSuccess = () => {
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = '✓ Copied!';
            btn.style.color = '#16a34a';
            btn.style.borderColor = '#16a34a';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.color = '';
                btn.style.borderColor = '';
            }, 2000);
        }
    };

    if (htmlContent && navigator.clipboard && window.ClipboardItem) {
        const textBlob = new Blob([textContent], { type: 'text/plain' });
        const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
        navigator.clipboard.write([
            new ClipboardItem({
                'text/plain': textBlob,
                'text/html': htmlBlob
            })
        ]).then(setSuccess).catch(() => {
            if (navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textContent).then(setSuccess).catch(() => {
                    fallbackCopyText(textContent, setSuccess);
                });
            } else {
                fallbackCopyText(textContent, setSuccess);
            }
        });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textContent).then(setSuccess).catch(() => {
            fallbackCopyText(textContent, setSuccess);
        });
    } else {
        fallbackCopyText(textContent, setSuccess);
    }
}

function fallbackCopyText(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        if (cb) cb();
    } catch (e) {
        console.warn('Copy fallback failed:', e);
    }
    document.body.removeChild(ta);
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initAllocation);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateTotals,
        isCashHolding,
        getHoldingAssetKey,
        computeSimpleAllocation
    };
}
