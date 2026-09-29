/**
 * Tax Location & Asset Placement Controller
 */

let allHoldings = [];

const ASSET_CLASSES = [
    { key: 'us', label: 'US Equity', color: '#0969da' },
    { key: 'canada', label: 'Canadian Equity', color: '#cf222e' },
    { key: 'developed', label: 'Developed Markets', color: '#1a7f37' },
    { key: 'emerging', label: 'Emerging Markets', color: '#9a6700' },
    { key: 'fixedIncome', label: 'Fixed Income & Cash', color: '#8250df' },
    { key: 'preciousMetals', label: 'Precious Metals', color: '#bf8700' },
    { key: 'crypto', label: 'Crypto', color: '#d97706' }
];

async function initTax() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('main-content');
    const errorEl = document.getElementById('error');

    try {
        allHoldings = await getHoldings();

        renderOverviewCards();
        renderTaxMatrix();
        renderTaxInsights();

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initTax());
            return;
        }
        console.error('Failed to init tax:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error loading tax placement data: ${err.message}`;
    }
}

function renderOverviewCards() {
    const totalCAD = allHoldings.reduce((sum, h) => sum + h.sum, 0);

    let registeredCAD = 0;
    let taxableCAD = 0;
    let tfsaCAD = 0;
    let rrspCAD = 0;
    let fhsaCAD = 0;

    allHoldings.forEach(h => {
        const acct = (h.account || '').toUpperCase();
        if (h.registered || acct.includes('TFSA') || acct.includes('RRSP') || acct.includes('FHSA')) {
            registeredCAD += h.sum;
        } else {
            taxableCAD += h.sum;
        }

        if (acct.includes('TFSA')) tfsaCAD += h.sum;
        else if (acct.includes('RRSP')) rrspCAD += h.sum;
        else if (acct.includes('FHSA')) fhsaCAD += h.sum;
    });

    const regPct = totalCAD > 0 ? (registeredCAD / totalCAD) * 100 : 0;
    const taxPct = totalCAD > 0 ? (taxableCAD / totalCAD) * 100 : 0;
    const tfsaPct = totalCAD > 0 ? (tfsaCAD / totalCAD) * 100 : 0;
    const rrspFhsaPct = totalCAD > 0 ? ((rrspCAD + fhsaCAD) / totalCAD) * 100 : 0;

    document.getElementById('stat-registered-cad').textContent = formatCurrency(registeredCAD, 'CAD');
    document.getElementById('stat-registered-pct').textContent = `${regPct.toFixed(1)}% tax-sheltered`;

    document.getElementById('stat-taxable-cad').textContent = formatCurrency(taxableCAD, 'CAD');
    document.getElementById('stat-taxable-pct').textContent = `${taxPct.toFixed(1)}% taxable accounts`;

    document.getElementById('stat-tfsa-cad').textContent = formatCurrency(tfsaCAD, 'CAD');
    document.getElementById('stat-tfsa-pct').textContent = `${tfsaPct.toFixed(1)}% of total wealth`;

    document.getElementById('stat-rrsp-cad').textContent = formatCurrency(rrspCAD + fhsaCAD, 'CAD');
    document.getElementById('stat-rrsp-pct').textContent = `${rrspFhsaPct.toFixed(1)}% of total wealth`;

    document.getElementById('stat-shield-score').textContent = `${regPct.toFixed(0)}%`;
    const statusEl = document.getElementById('stat-shield-status');
    if (regPct >= 70) {
        statusEl.textContent = 'High Tax Shelter';
        statusEl.style.color = '#16a34a';
    } else if (regPct >= 50) {
        statusEl.textContent = 'Balanced Shelter';
        statusEl.style.color = '#d97706';
    } else {
        statusEl.textContent = 'Low Tax Shelter';
        statusEl.style.color = '#dc2626';
    }
}

function renderTaxMatrix() {
    // Identify standard account categories: TFSA, RRSP, FHSA, Non-Registered, Cash
    const categories = [
        { key: 'TFSA', label: 'TFSA (Tax-Free)', isSheltered: true },
        { key: 'RRSP', label: 'RRSP (Deferred)', isSheltered: true },
        { key: 'FHSA', label: 'FHSA (Tax-Free)', isSheltered: true },
        { key: 'NON-REG', label: 'Non-Registered', isSheltered: false },
        { key: 'CASH', label: 'Cash / Other', isSheltered: false }
    ];

    function mapAccountToCategory(accountStr, registered) {
        const upper = (accountStr || '').toUpperCase();
        if (upper.includes('TFSA')) return 'TFSA';
        if (upper.includes('RRSP')) return 'RRSP';
        if (upper.includes('FHSA')) return 'FHSA';
        if (upper.includes('NON-REG') || upper.includes('MARGIN') || upper.includes('TAXABLE')) return 'NON-REG';
        if (registered) return 'TFSA';
        return 'NON-REG';
    }

    // Build cross-tab grid: AssetClass -> Category -> CAD
    const matrix = {};
    ASSET_CLASSES.forEach(ac => {
        matrix[ac.key] = { TFSA: 0, RRSP: 0, FHSA: 0, 'NON-REG': 0, CASH: 0, total: 0, sheltered: 0 };
    });

    const categoryTotals = { TFSA: 0, RRSP: 0, FHSA: 0, 'NON-REG': 0, CASH: 0, total: 0, sheltered: 0 };

    allHoldings.forEach(h => {
        const cat = mapAccountToCategory(h.account, h.registered);
        const isSheltered = (cat === 'TFSA' || cat === 'RRSP' || cat === 'FHSA' || h.registered);

        if (h.allocation) {
            ASSET_CLASSES.forEach(ac => {
                const amt = h.allocation[ac.key] || 0;
                matrix[ac.key][cat] += amt;
                matrix[ac.key].total += amt;
                if (isSheltered) matrix[ac.key].sheltered += amt;

                categoryTotals[cat] += amt;
                categoryTotals.total += amt;
                if (isSheltered) categoryTotals.sheltered += amt;
            });
        }
    });

    // Render Table Header
    const headerRow = document.getElementById('tax-matrix-header');
    headerRow.innerHTML = `
        <th>Asset Class</th>
        <th style="text-align: right;">TFSA</th>
        <th style="text-align: right;">RRSP</th>
        <th style="text-align: right;">FHSA</th>
        <th style="text-align: right;">Non-Registered</th>
        <th style="text-align: right;">Total CAD</th>
        <th style="text-align: center;">% Sheltered</th>
    `;

    // Render Table Body
    const tbody = document.getElementById('tax-matrix-body');
    tbody.innerHTML = '';

    ASSET_CLASSES.forEach(ac => {
        const row = matrix[ac.key];
        if (row.total <= 0) return;

        const shelteredPct = row.total > 0 ? (row.sheltered / row.total) * 100 : 0;
        let badgeColor = '#16a34a';
        let badgeBg = '#dcfce7';
        if (shelteredPct < 40) {
            badgeColor = '#dc2626';
            badgeBg = '#fee2e2';
        } else if (shelteredPct < 70) {
            badgeColor = '#d97706';
            badgeBg = '#fef3c7';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="width: 10px; height: 10px; border-radius: 50%; background: ${ac.color}; display: inline-block;"></span>
                    <strong>${ac.label}</strong>
                </div>
            </td>
            <td style="text-align: right;">${row.TFSA > 0 ? formatCurrency(row.TFSA, 'CAD') : '-'}</td>
            <td style="text-align: right;">${row.RRSP > 0 ? formatCurrency(row.RRSP, 'CAD') : '-'}</td>
            <td style="text-align: right;">${row.FHSA > 0 ? formatCurrency(row.FHSA, 'CAD') : '-'}</td>
            <td style="text-align: right;">${row['NON-REG'] > 0 ? formatCurrency(row['NON-REG'], 'CAD') : '-'}</td>
            <td style="text-align: right; font-weight: 700;">${formatCurrency(row.total, 'CAD')}</td>
            <td style="text-align: center;">
                <span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; font-weight: 700;">
                    ${shelteredPct.toFixed(1)}%
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Render Table Footer
    const tfoot = document.getElementById('tax-matrix-footer');
    const totalShelteredPct = categoryTotals.total > 0 ? (categoryTotals.sheltered / categoryTotals.total) * 100 : 0;
    tfoot.innerHTML = `
        <tr>
            <td>Total</td>
            <td style="text-align: right;">${formatCurrency(categoryTotals.TFSA, 'CAD')}</td>
            <td style="text-align: right;">${formatCurrency(categoryTotals.RRSP, 'CAD')}</td>
            <td style="text-align: right;">${formatCurrency(categoryTotals.FHSA, 'CAD')}</td>
            <td style="text-align: right;">${formatCurrency(categoryTotals['NON-REG'], 'CAD')}</td>
            <td style="text-align: right;">${formatCurrency(categoryTotals.total, 'CAD')}</td>
            <td style="text-align: center; color: #16a34a;">${totalShelteredPct.toFixed(1)}%</td>
        </tr>
    `;
}

function renderTaxInsights() {
    const container = document.getElementById('tax-insights-container');
    container.innerHTML = '';

    const insights = [
        {
            icon: '🛡️',
            title: 'TFSA: Maximize Long-Term Growth Assets',
            text: 'Because TFSA withdrawals are 100% tax-free for life and never affect income-tested benefits, high-expected-return equity ETFs (like broad market and factor tilts) benefit most from compounding inside your TFSA.'
        },
        {
            icon: '🇺🇸',
            title: 'US Securities in RRSP: 0% Withholding Tax',
            text: 'Under the US-Canada Tax Treaty, US-listed ETFs held directly inside an RRSP are exempt from the standard 15% US dividend withholding tax. Holding US dividend payers inside an RRSP maximizes net dividend yield.'
        },
        {
            icon: '🇨🇦',
            title: 'Canadian Dividends in Taxable Accounts',
            text: 'Canadian dividend-paying equities qualify for the federal and provincial Dividend Tax Credit (DTC) in non-registered accounts, making them significantly more tax-efficient than interest income if registered room is filled.'
        },
        {
            icon: '💰',
            title: 'Fixed Income & Cash Shelter Priority',
            text: 'Interest from savings, bonds, and high-interest cash is taxed at 100% of your top marginal income tax rate (unlike capital gains which have a 50% inclusion rate). Sheltering fixed income inside registered accounts protects you from high annual tax drag.'
        }
    ];

    insights.forEach(item => {
        const card = document.createElement('div');
        card.style.cssText = 'background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);';
        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="font-size: 1.2rem;">${item.icon}</span>
                <strong style="font-size: 0.92rem; color: #1f2328;">${item.title}</strong>
            </div>
            <p style="margin: 0; font-size: 0.83rem; color: #64748b; line-height: 1.45;">
                ${item.text}
            </p>
        `;
        container.appendChild(card);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTax();
});
