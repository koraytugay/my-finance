/**
 * Dividends & Passive Cashflow Controller
 * Full Canadian Tax Intelligence:
 * - Cash / Interest taxed at 30% marginal rate
 * - Eligible Canadian Dividends receive Dividend Tax Credit (~8.9% effective tax)
 * - Foreign / US Dividends taxed as foreign income (30% marginal rate)
 * - Registered accounts (RRSP, TFSA, FHSA) assume 0% immediate tax
 */

let allHoldings = [];
let enrichedHoldings = [];
let cashflowMode = localStorage.getItem('dividendsCashflowMode') || 'net';
let sortCol = 'netAnnual';
let sortDirection = 'desc';

// Default Tax Assumptions (Configured per user specifications)
const DEFAULT_TAX_SETTINGS = {
    cashRatePct: 30.0,          // User specified: any cash must be taxed at 30%
    eligibleDivRatePct: 8.9,    // Canadian Eligible Dividends with Gross-up (38%) & DTC (Ontario benchmark)
    foreignDivRatePct: 30.0,    // Foreign / US dividends taxed as regular income at 30%
    registeredRatePct: 0.0      // User specified: RRSP, TFSA, FHSA assume 0% tax
};

let taxSettings = { ...DEFAULT_TAX_SETTINGS };

// Load user-customized tax settings if previously saved
try {
    const savedSettings = localStorage.getItem('dividendTaxSettings');
    if (savedSettings) {
        taxSettings = { ...DEFAULT_TAX_SETTINGS, ...JSON.parse(savedSettings) };
    }
} catch (e) {
    console.warn('Could not parse stored tax settings, using defaults');
}

// ETF Distribution & Yield Profiles
// Note: Per user specification, all fixed income / cash holdings are assumed to yield 2.0%.
const ETF_PROFILES = {
    'XEI':   { yieldPct: 5.25, freq: 'Monthly', months: [1,2,3,4,5,6,7,8,9,10,11,12] },
    'VIDY':  { yieldPct: 4.80, freq: 'Monthly', months: [1,2,3,4,5,6,7,8,9,10,11,12] },
    'ZLU':   { yieldPct: 4.10, freq: 'Monthly', months: [1,2,3,4,5,6,7,8,9,10,11,12] },
    'XCB':   { yieldPct: 2.00, freq: 'Monthly', months: [1,2,3,4,5,6,7,8,9,10,11,12] },
    'XBB':   { yieldPct: 2.00, freq: 'Monthly', months: [1,2,3,4,5,6,7,8,9,10,11,12] },
    'XTLT':  { yieldPct: 2.00, freq: 'Monthly', months: [1,2,3,4,5,6,7,8,9,10,11,12] },
    'ZAG':   { yieldPct: 2.00, freq: 'Monthly', months: [1,2,3,4,5,6,7,8,9,10,11,12] },
    'VAB':   { yieldPct: 2.00, freq: 'Monthly', months: [1,2,3,4,5,6,7,8,9,10,11,12] },
    'ZRE':   { yieldPct: 4.80, freq: 'Monthly', months: [1,2,3,4,5,6,7,8,9,10,11,12] },
    'XEQT':  { yieldPct: 1.95, freq: 'Quarterly', months: [3,6,9,12] },
    'VEQT':  { yieldPct: 1.85, freq: 'Annual', months: [1] },
    'XUU':   { yieldPct: 1.35, freq: 'Quarterly', months: [3,6,9,12] },
    'VUN':   { yieldPct: 1.35, freq: 'Quarterly', months: [3,6,9,12] },
    'VTI':   { yieldPct: 1.35, freq: 'Quarterly', months: [3,6,9,12] },
    'XEF':   { yieldPct: 2.80, freq: 'Semi-Annual', months: [6,12] },
    'VIU':   { yieldPct: 2.80, freq: 'Semi-Annual', months: [6,12] },
    'VXUS':  { yieldPct: 2.80, freq: 'Quarterly', months: [3,6,9,12] },
    'XEC':   { yieldPct: 2.70, freq: 'Annual', months: [12] },
    'VEE':   { yieldPct: 2.70, freq: 'Annual', months: [12] },
    'CAEM':  { yieldPct: 2.70, freq: 'Annual', months: [12] },
    'CADE':  { yieldPct: 2.10, freq: 'Quarterly', months: [3,6,9,12] },
    'CACE':  { yieldPct: 2.40, freq: 'Quarterly', months: [3,6,9,12] },
    'CAUS':  { yieldPct: 1.80, freq: 'Quarterly', months: [3,6,9,12] },
    'CAUV':  { yieldPct: 1.90, freq: 'Quarterly', months: [3,6,9,12] },
    'CASV':  { yieldPct: 1.45, freq: 'Quarterly', months: [3,6,9,12] },
    'XMC':   { yieldPct: 1.15, freq: 'Semi-Annual', months: [6,12] },
    'XSMC':  { yieldPct: 1.20, freq: 'Semi-Annual', months: [6,12] },
    'XIU':   { yieldPct: 2.90, freq: 'Quarterly', months: [3,6,9,12] },
    'VCN':   { yieldPct: 2.90, freq: 'Quarterly', months: [3,6,9,12] },
    'ZSP':   { yieldPct: 1.25, freq: 'Quarterly', months: [3,6,9,12] },
    'VFV':   { yieldPct: 1.25, freq: 'Quarterly', months: [3,6,9,12] },
    'QQC':   { yieldPct: 0.55, freq: 'Quarterly', months: [3,6,9,12] },
    'QQQ':   { yieldPct: 0.55, freq: 'Quarterly', months: [3,6,9,12] },
    'KILO':  { yieldPct: 0.00, freq: 'None', months: [] },
    'PSLV':  { yieldPct: 0.00, freq: 'None', months: [] },
    'PHYS':  { yieldPct: 0.00, freq: 'None', months: [] },
    'ETC':   { yieldPct: 0.00, freq: 'None', months: [] },
    'BTC':   { yieldPct: 0.00, freq: 'None', months: [] },
    'ETH':   { yieldPct: 0.00, freq: 'None', months: [] }
};

function getHoldingProfile(h) {
    const cleanTicker = (h.ticker || h.symbol || '')
        .replace(/^TSE:/i, '')
        .replace(/\.TO$/i, '')
        .toUpperCase()
        .trim();

    // 1. Direct Cash or Fixed Income strategy -> Assumed 2.0% annual per user specification
    const isCashOrFixed = cleanTicker === 'CASH' ||
        h.strategy === 'Fixed Income' ||
        (h.allocationPct && h.allocationPct.fixedIncome >= 0.85);

    if (isCashOrFixed) {
        return {
            yieldPct: 2.00,
            freq: 'Monthly',
            months: [1,2,3,4,5,6,7,8,9,10,11,12],
            isFixedIncomeAssumed: true
        };
    }

    // 2. Known ETF Profile
    if (ETF_PROFILES[cleanTicker]) {
        return { ...ETF_PROFILES[cleanTicker], isFixedIncomeAssumed: false };
    }

    // 3. Fallback based on asset allocation breakdown
    if (h.allocation && h.sum > 0) {
        const alloc = h.allocation;
        const fixedPart = alloc.fixedIncome || 0;
        const zeroPart = (alloc.crypto || 0) + (alloc.preciousMetals || 0);
        const equityPart = Math.max(0, h.sum - fixedPart - zeroPart);

        // Fixed income brings 2.0%, equity defaults to 2.0%, zero yields 0%
        const blendedIncome = (fixedPart * 0.02) + (equityPart * 0.02);
        const blendedYield = (blendedIncome / h.sum) * 100;

        return {
            yieldPct: Number(blendedYield.toFixed(2)),
            freq: 'Quarterly',
            months: [3,6,9,12],
            isFixedIncomeAssumed: fixedPart > 0
        };
    }

    // Generic default
    return {
        yieldPct: 2.00,
        freq: 'Quarterly',
        months: [3,6,9,12],
        isFixedIncomeAssumed: false
    };
}

/**
 * Determine exact Canadian tax treatment for a holding's passive distribution
 */
function getHoldingTaxProfile(h, grossIncome) {
    const acct = (h.account || '').toUpperCase();
    const isReg = h.registered === true || h.registered === 1 || String(h.registered).toLowerCase() === 'true' ||
                  acct.includes('TFSA') || acct.includes('FHSA') || acct.includes('RRSP') || acct.includes('LIRA') || acct.includes('RRIF');

    // 1. Registered Accounts (RRSP, TFSA, FHSA) -> 0% Tax (Per user prompt)
    if (isReg) {
        const isDeferred = acct.includes('RRSP') || acct.includes('LIRA') || acct.includes('RRIF');
        const type = isDeferred ? 'deferred' : 'taxfree';
        const label = isDeferred ? '0.0% (RRSP Deferred)' : '0.0% (Tax-Free)';
        const badgeClass = isDeferred ? 'pill-tax-deferred' : 'pill-tax-free';

        return {
            isSheltered: true,
            type,
            label,
            badgeClass,
            taxRatePct: taxSettings.registeredRatePct, // 0.0%
            taxDragCAD: 0,
            netIncomeCAD: grossIncome,
            explanation: isDeferred
                ? '0% immediate tax drag. RRSP distributions compound 100% gross until future retirement withdrawal.'
                : '100% Tax-Free. All distributions and growth in TFSA/FHSA are protected from CRA taxation.'
        };
    }

    // 2. Non-Registered Accounts:
    const cleanTicker = (h.ticker || h.symbol || '').replace(/^TSE:/i, '').replace(/\.TO$/i, '').toUpperCase().trim();
    const isCashOrFixed = cleanTicker === 'CASH' ||
                          h.strategy === 'Fixed Income' ||
                          (h.allocationPct && h.allocationPct.fixedIncome >= 0.85);

    // 2a. Cash / Fixed Income -> 30% tax (Per user prompt: any cash must be taxed at 30%)
    if (isCashOrFixed) {
        const rate = taxSettings.cashRatePct;
        const taxDrag = grossIncome * (rate / 100);
        return {
            isSheltered: false,
            type: 'cash',
            label: `${rate.toFixed(1)}% (Cash/Interest)`,
            badgeClass: 'pill-cash-tax',
            taxRatePct: rate,
            taxDragCAD: taxDrag,
            netIncomeCAD: Math.max(0, grossIncome - taxDrag),
            explanation: `Taxed as 100% ordinary interest income at ${rate.toFixed(1)}% marginal rate.`
        };
    }

    // 2b. Canadian REIT Distributions (e.g. ZRE)
    if (cleanTicker === 'ZRE') {
        const rate = 18.0; // Blended capital gains, ROC, other income
        const taxDrag = grossIncome * (rate / 100);
        return {
            isSheltered: false,
            type: 'reit',
            label: `~${rate.toFixed(1)}% (REIT Dist.)`,
            badgeClass: 'pill-blended',
            taxRatePct: rate,
            taxDragCAD: taxDrag,
            netIncomeCAD: Math.max(0, grossIncome - taxDrag),
            explanation: 'Blended return of capital (tax-deferred), capital gains (50% taxable), and other income.'
        };
    }

    // Allocation breakdown
    const alloc = h.allocation || {};
    const sum = h.sum || 1;
    const cadPart = (alloc.canada || 0) / sum;
    const fixedPart = (alloc.fixedIncome || 0) / sum;
    const foreignPart = Math.max(0, 1 - cadPart - fixedPart);

    // 2c. Pure Canadian Equity Dividend ETFs (e.g. XEI, VIDY, XIU, VCN)
    if (cadPart >= 0.95) {
        const rate = taxSettings.eligibleDivRatePct;
        const taxDrag = grossIncome * (rate / 100);
        return {
            isSheltered: false,
            type: 'eligible',
            label: `${rate.toFixed(1)}% (Eligible Div + DTC)`,
            badgeClass: 'pill-eligible-div',
            taxRatePct: rate,
            taxDragCAD: taxDrag,
            netIncomeCAD: Math.max(0, grossIncome - taxDrag),
            explanation: `Eligible Canadian Dividend. Subject to 38% CRA gross-up and Dividend Tax Credit (~${rate.toFixed(1)}% effective rate).`
        };
    }

    // 2d. Pure Foreign / US Equities (e.g. XUU, VTI, VXUS, XEF, XEC, ZLU, XMC, XSMC)
    if (foreignPart >= 0.95) {
        const rate = taxSettings.foreignDivRatePct;
        const taxDrag = grossIncome * (rate / 100);
        return {
            isSheltered: false,
            type: 'foreign',
            label: `${rate.toFixed(1)}% (Foreign Div)`,
            badgeClass: 'pill-foreign-div',
            taxRatePct: rate,
            taxDragCAD: taxDrag,
            netIncomeCAD: Math.max(0, grossIncome - taxDrag),
            explanation: `Foreign non-business income. Fully taxed at ${rate.toFixed(1)}% marginal rate without Canadian dividend tax credit.`
        };
    }

    // 2e. Blended Multi-Asset ETF (e.g. XEQT: 25% Canada, 75% Foreign)
    const blendedRate = (cadPart * taxSettings.eligibleDivRatePct) +
                        (foreignPart * taxSettings.foreignDivRatePct) +
                        (fixedPart * taxSettings.cashRatePct);
    const taxDrag = grossIncome * (blendedRate / 100);

    return {
        isSheltered: false,
        type: 'blended',
        label: `${blendedRate.toFixed(1)}% (Blended)`,
        badgeClass: 'pill-blended',
        taxRatePct: Number(blendedRate.toFixed(1)),
        taxDragCAD: taxDrag,
        netIncomeCAD: Math.max(0, grossIncome - taxDrag),
        explanation: `Weighted blend: ${(cadPart * 100).toFixed(0)}% Canadian eligible div (${taxSettings.eligibleDivRatePct}%), ${(foreignPart * 100).toFixed(0)}% Foreign (${taxSettings.foreignDivRatePct}%).`
    };
}

async function initDividends() {
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('main-content');
    const errorEl = document.getElementById('error');

    try {
        allHoldings = await getHoldings();

        if (!allHoldings || allHoldings.length === 0) {
            throw new Error('No holdings data available.');
        }

        recomputeHoldings();

        // Restore view preference
        syncViewToggleUI();
        syncTaxSettingsInputs();

        populateFilters();
        renderOverviewCards();
        renderTaxBreakdown();
        renderCalendar();
        applyTableFilters();

        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    } catch (err) {
        if (err.message === 'LOCKED') {
            loadingEl.style.display = 'none';
            showUnlockModal(() => initDividends());
            return;
        }
        console.error('Failed to init dividends:', err);
        loadingEl.style.display = 'none';
        errorEl.style.display = 'block';
        errorEl.textContent = `Error loading dividend data: ${err.message}`;
    }
}

function recomputeHoldings() {
    const totalCAD = allHoldings.reduce((sum, h) => sum + (h.sum || 0), 0);

    enrichedHoldings = allHoldings.map(h => {
        const profile = getHoldingProfile(h);
        const grossAnnualIncome = Number((h.sum * (profile.yieldPct / 100)).toFixed(2));
        const tax = getHoldingTaxProfile(h, grossAnnualIncome);
        const netAnnualIncome = Number(tax.netIncomeCAD.toFixed(2));
        const taxDragCAD = Number(tax.taxDragCAD.toFixed(2));

        const grossMonthlyIncome = Number((grossAnnualIncome / 12).toFixed(2));
        const netMonthlyIncome = Number((netAnnualIncome / 12).toFixed(2));
        const pctOfPortfolio = totalCAD > 0 ? (h.sum / totalCAD) * 100 : 0;

        const avgCost = h.averageCost || 0;
        const totalCost = h.totalCost || (avgCost > 0 && h.count > 0 ? (avgCost * h.count) : 0);

        const grossYoCPct = totalCost > 0 ? (grossAnnualIncome / totalCost) * 100 : profile.yieldPct;
        const netYoCPct = totalCost > 0 ? (netAnnualIncome / totalCost) * 100 : (netAnnualIncome / h.sum) * 100;

        return {
            ...h,
            yieldPct: profile.yieldPct,
            grossYoCPct: Number(grossYoCPct.toFixed(2)),
            netYoCPct: Number(netYoCPct.toFixed(2)),
            avgCost,
            totalCost,
            freq: profile.freq,
            months: profile.months,
            isFixedIncomeAssumed: profile.isFixedIncomeAssumed,
            tax,
            grossAnnualIncome,
            netAnnualIncome,
            taxDragCAD,
            grossMonthlyIncome,
            netMonthlyIncome,
            pctOfPortfolio
        };
    });
}

function setCashflowMode(mode) {
    cashflowMode = mode;
    localStorage.setItem('dividendsCashflowMode', mode);
    syncViewToggleUI();
    renderOverviewCards();
    renderCalendar();
    applyTableFilters();
}

function syncViewToggleUI() {
    const btnNet = document.getElementById('btn-mode-net');
    const btnGross = document.getElementById('btn-mode-gross');
    if (cashflowMode === 'net') {
        btnNet.classList.add('active');
        btnGross.classList.remove('active');
    } else {
        btnGross.classList.add('active');
        btnNet.classList.remove('active');
    }
}

function toggleTaxSettings() {
    const panel = document.getElementById('tax-settings-panel');
    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';
}

function syncTaxSettingsInputs() {
    const cashInput = document.getElementById('setting-cash-rate');
    const eligibleInput = document.getElementById('setting-eligible-rate');
    const foreignInput = document.getElementById('setting-foreign-rate');

    if (cashInput) cashInput.value = taxSettings.cashRatePct;
    if (eligibleInput) eligibleInput.value = taxSettings.eligibleDivRatePct;
    if (foreignInput) foreignInput.value = taxSettings.foreignDivRatePct;
}

function updateTaxSetting(key, val) {
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0 && num <= 100) {
        taxSettings[key] = num;
        localStorage.setItem('dividendTaxSettings', JSON.stringify(taxSettings));
        recomputeHoldings();
        renderOverviewCards();
        renderTaxBreakdown();
        renderCalendar();
        applyTableFilters();
    }
}

function resetTaxSettings() {
    taxSettings = { ...DEFAULT_TAX_SETTINGS };
    localStorage.removeItem('dividendTaxSettings');
    syncTaxSettingsInputs();
    recomputeHoldings();
    renderOverviewCards();
    renderTaxBreakdown();
    renderCalendar();
    applyTableFilters();
}

function renderOverviewCards() {
    const totalCAD = enrichedHoldings.reduce((sum, h) => sum + h.sum, 0);
    const totalGrossAnnual = enrichedHoldings.reduce((sum, h) => sum + h.grossAnnualIncome, 0);
    const totalTaxDrag = enrichedHoldings.reduce((sum, h) => sum + h.taxDragCAD, 0);
    const totalNetAnnual = Math.max(0, totalGrossAnnual - totalTaxDrag);

    const totalGrossMonthly = totalGrossAnnual / 12;
    const totalNetMonthly = totalNetAnnual / 12;

    const effectiveTaxRate = totalGrossAnnual > 0 ? (totalTaxDrag / totalGrossAnnual) * 100 : 0;
    const netYieldPct = totalCAD > 0 ? (totalNetAnnual / totalCAD) * 100 : 0;
    const grossYieldPct = totalCAD > 0 ? (totalGrossAnnual / totalCAD) * 100 : 0;

    let shelteredAnnual = 0;
    let topNetHolding = enrichedHoldings[0];
    let topGrossHolding = enrichedHoldings[0];

    enrichedHoldings.forEach(h => {
        if (h.tax.isSheltered) {
            shelteredAnnual += h.grossAnnualIncome;
        }
        if (!topNetHolding || h.netAnnualIncome > topNetHolding.netAnnualIncome) {
            topNetHolding = h;
        }
        if (!topGrossHolding || h.grossAnnualIncome > topGrossHolding.grossAnnualIncome) {
            topGrossHolding = h;
        }
    });

    const shelteredPct = totalGrossAnnual > 0 ? (shelteredAnnual / totalGrossAnnual) * 100 : 0;

    const annualEl = document.getElementById('stat-annual-income');
    const annualLabelEl = document.getElementById('label-annual-income');
    const annualSubEl = document.getElementById('stat-annual-sub');

    const monthlyEl = document.getElementById('stat-monthly-income');
    const monthlyLabelEl = document.getElementById('label-monthly-income');
    const monthlySubEl = document.getElementById('stat-monthly-sub');

    const topPayerLabel = document.getElementById('label-top-payer');
    const topPayerName = document.getElementById('stat-top-payer-name');
    const topPayerVal = document.getElementById('stat-top-payer-val');

    if (cashflowMode === 'net') {
        annualEl.textContent = formatCurrency(totalNetAnnual);
        annualLabelEl.textContent = 'Projected Net Annual Income';
        annualSubEl.textContent = `Gross: ${formatCurrency(totalGrossAnnual)} | Tax Drag: -${formatCurrency(totalTaxDrag)} (${effectiveTaxRate.toFixed(1)}%)`;

        monthlyEl.textContent = formatCurrency(totalNetMonthly);
        monthlyLabelEl.textContent = 'Monthly In-Pocket Cashflow';
        monthlySubEl.textContent = `${netYieldPct.toFixed(2)}% net portfolio yield (${formatCurrency(totalNetAnnual / 365)}/day)`;

        if (topNetHolding && topNetHolding.netAnnualIncome > 0) {
            const topClean = (topNetHolding.ticker || topNetHolding.symbol || 'Cash').replace(/^TSE:/i, '');
            topPayerLabel.textContent = 'Top Net Contributor';
            topPayerName.textContent = `${topClean} (${topNetHolding.account})`;
            topPayerVal.textContent = `${formatCurrency(topNetHolding.netAnnualIncome)}/yr in-pocket`;
        }
    } else {
        annualEl.textContent = formatCurrency(totalGrossAnnual);
        annualLabelEl.textContent = 'Projected Gross Annual Income';
        annualSubEl.textContent = `${grossYieldPct.toFixed(2)}% weighted gross yield before tax`;

        monthlyEl.textContent = formatCurrency(totalGrossMonthly);
        monthlyLabelEl.textContent = 'Monthly Gross Cashflow';
        monthlySubEl.textContent = `Average gross per month (${formatCurrency(totalGrossAnnual / 365)}/day)`;

        if (topGrossHolding && topGrossHolding.grossAnnualIncome > 0) {
            const topClean = (topGrossHolding.ticker || topGrossHolding.symbol || 'Cash').replace(/^TSE:/i, '');
            topPayerLabel.textContent = 'Top Gross Contributor';
            topPayerName.textContent = `${topClean} (${topGrossHolding.account})`;
            topPayerVal.textContent = `${formatCurrency(topGrossHolding.grossAnnualIncome)}/yr (${topGrossHolding.yieldPct.toFixed(2)}%)`;
        }
    }

    // Always-visible tax metrics
    document.getElementById('stat-tax-drag').textContent = `-${formatCurrency(totalTaxDrag)}`;
    document.getElementById('stat-tax-drag-sub').textContent = `${effectiveTaxRate.toFixed(1)}% effective tax on passive income`;

    document.getElementById('stat-sheltered-pct').textContent = `${shelteredPct.toFixed(1)}%`;
    document.getElementById('stat-sheltered-sub').textContent = `${formatCurrency(shelteredAnnual)}/yr in TFSA, RRSP & FHSA`;
}

function renderTaxBreakdown() {
    let taxFreeAnnual = 0;
    let deferredAnnual = 0;
    let eligibleGross = 0;
    let eligibleNet = 0;
    let foreignGross = 0;
    let foreignNet = 0;
    let cashGross = 0;
    let cashNet = 0;

    let totalGross = 0;
    let totalTaxDrag = 0;

    enrichedHoldings.forEach(h => {
        totalGross += h.grossAnnualIncome;
        totalTaxDrag += h.taxDragCAD;

        if (h.tax.type === 'taxfree') {
            taxFreeAnnual += h.grossAnnualIncome;
        } else if (h.tax.type === 'deferred') {
            deferredAnnual += h.grossAnnualIncome;
        } else if (h.tax.type === 'eligible') {
            eligibleGross += h.grossAnnualIncome;
            eligibleNet += h.netAnnualIncome;
        } else if (h.tax.type === 'foreign') {
            foreignGross += h.grossAnnualIncome;
            foreignNet += h.netAnnualIncome;
        } else if (h.tax.type === 'cash') {
            cashGross += h.grossAnnualIncome;
            cashNet += h.netAnnualIncome;
        } else if (h.tax.type === 'blended') {
            // Distribute blended (e.g. XEQT) into Canadian vs Foreign buckets for card reporting
            const alloc = h.allocation || {};
            const sum = h.sum || 1;
            const cadPct = (alloc.canada || 0) / sum;
            const forPct = 1 - cadPct;

            eligibleGross += h.grossAnnualIncome * cadPct;
            eligibleNet += (h.grossAnnualIncome * cadPct) * (1 - taxSettings.eligibleDivRatePct / 100);

            foreignGross += h.grossAnnualIncome * forPct;
            foreignNet += (h.grossAnnualIncome * forPct) * (1 - taxSettings.foreignDivRatePct / 100);
        }
    });

    const totalNet = Math.max(0, totalGross - totalTaxDrag);
    const takeHomePct = totalGross > 0 ? (totalNet / totalGross) * 100 : 100;
    const dragPct = totalGross > 0 ? (totalTaxDrag / totalGross) * 100 : 0;

    document.getElementById('tax-card-taxfree').textContent = `${formatCurrency(taxFreeAnnual)} / yr`;
    document.getElementById('tax-card-taxfree-sub').textContent = `100% in-pocket (${formatCurrency(taxFreeAnnual / 12)}/mo)`;

    document.getElementById('tax-card-deferred').textContent = `${formatCurrency(deferredAnnual)} / yr`;
    document.getElementById('tax-card-deferred-sub').textContent = `0% current tax (compounds gross)`;

    document.getElementById('tax-card-eligible').textContent = `${formatCurrency(eligibleNet)} / yr`;
    document.getElementById('tax-card-eligible-sub').textContent = `Gross: ${formatCurrency(eligibleGross)} (DTC saved ~${(30 - taxSettings.eligibleDivRatePct).toFixed(1)}%)`;

    document.getElementById('tax-card-foreign').textContent = `${formatCurrency(foreignNet)} / yr`;
    document.getElementById('tax-card-foreign-sub').textContent = `Gross: ${formatCurrency(foreignGross)} (Drag: -${formatCurrency(foreignGross - foreignNet)})`;

    document.getElementById('tax-card-cash').textContent = `${formatCurrency(cashNet)} / yr`;
    document.getElementById('tax-card-cash-sub').textContent = `Gross: ${formatCurrency(cashGross)} (Drag: -${formatCurrency(cashGross - cashNet)})`;

    // Visual Comparison Bar
    document.getElementById('tax-bar-net').style.width = `${takeHomePct}%`;
    document.getElementById('tax-bar-drag').style.width = `${dragPct}%`;

    document.getElementById('bar-label-net').textContent = `■ Real In-Pocket Cashflow: ${formatCurrency(totalNet)} (${takeHomePct.toFixed(1)}%)`;
    document.getElementById('bar-label-drag').textContent = `■ Estimated CRA Tax Drag: -${formatCurrency(totalTaxDrag)} (${dragPct.toFixed(1)}%)`;

    document.getElementById('tax-efficiency-summary').textContent = `Total Portfolio Take-Home: ${takeHomePct.toFixed(1)}%`;
}

function renderCalendar() {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyGross = Array(12).fill(0);
    const monthlyNet = Array(12).fill(0);
    const monthlyTax = Array(12).fill(0);

    enrichedHoldings.forEach(h => {
        if (!h.grossAnnualIncome || h.grossAnnualIncome <= 0 || !h.months || h.months.length === 0) return;
        const perGross = h.grossAnnualIncome / h.months.length;
        const perNet = h.netAnnualIncome / h.months.length;
        const perTax = h.taxDragCAD / h.months.length;

        h.months.forEach(m => {
            const idx = m - 1;
            if (idx >= 0 && idx < 12) {
                monthlyGross[idx] += perGross;
                monthlyNet[idx] += perNet;
                monthlyTax[idx] += perTax;
            }
        });
    });

    const compareArray = cashflowMode === 'net' ? monthlyNet : monthlyGross;
    const maxVal = Math.max(...monthlyGross, 100);
    const wrap = document.getElementById('calendar-bars-wrap');
    wrap.innerHTML = '';

    monthlyGross.forEach((gross, idx) => {
        const net = monthlyNet[idx];
        const tax = monthlyTax[idx];

        const totalHeightPct = Math.max(6, Math.min(100, (gross / maxVal) * 100));
        const netHeightPct = gross > 0 ? (net / gross) * 100 : 100;
        const taxHeightPct = gross > 0 ? (tax / gross) * 100 : 0;

        const isPeak = compareArray[idx] >= Math.max(...compareArray) * 0.95;
        const displayVal = cashflowMode === 'net' ? net : gross;

        const barEl = document.createElement('div');
        barEl.className = 'month-bar';
        barEl.title = `${monthNames[idx]}: In-Pocket Net ${formatCurrency(net)} | Tax Drag: -${formatCurrency(tax)} | Gross ${formatCurrency(gross)}`;

        barEl.innerHTML = `
            <div class="month-val">${formatCurrency(displayVal)}</div>
            <div class="month-col ${isPeak ? 'peak' : ''}" style="height: ${totalHeightPct}%;">
                <div class="month-net-part ${isPeak ? 'peak' : ''}" style="height: ${netHeightPct}%;"></div>
                ${taxHeightPct > 0 ? `<div class="month-tax-part" style="height: ${taxHeightPct}%;"></div>` : ''}
            </div>
            <div class="month-label">${monthNames[idx]}</div>
        `;
        wrap.appendChild(barEl);
    });
}

function populateFilters() {
    const acctSelect = document.getElementById('filter-account');
    const accounts = [...new Set(enrichedHoldings.map(h => `${h.account} (${h.brokerage})`))].sort();

    accounts.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        acctSelect.appendChild(opt);
    });
}

function applyTableFilters() {
    const search = (document.getElementById('filter-search').value || '').toLowerCase().trim();
    const acctFilter = document.getElementById('filter-account').value;
    const taxFilter = document.getElementById('filter-tax').value;

    let filtered = enrichedHoldings.filter(h => {
        if (search) {
            const matchTicker = (h.ticker || '').toLowerCase().includes(search);
            const matchSymbol = (h.symbol || '').toLowerCase().includes(search);
            const matchBrok = (h.brokerage || '').toLowerCase().includes(search);
            const matchAcct = (h.account || '').toLowerCase().includes(search);
            if (!matchTicker && !matchSymbol && !matchBrok && !matchAcct) return false;
        }

        if (acctFilter !== 'ALL') {
            const fullAcctStr = `${h.account} (${h.brokerage})`;
            if (fullAcctStr !== acctFilter) return false;
        }

        if (taxFilter !== 'ALL') {
            if (h.tax.type !== taxFilter) return false;
        }

        return true;
    });

    // Sorting
    filtered.sort((a, b) => {
        let valA, valB;
        if (sortCol === 'ticker') {
            valA = a.ticker || a.symbol || '';
            valB = b.ticker || b.symbol || '';
            return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (sortCol === 'account') {
            valA = `${a.account} ${a.brokerage}`;
            valB = `${b.account} ${b.brokerage}`;
            return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (sortCol === 'sum') {
            valA = a.sum || 0;
            valB = b.sum || 0;
        } else if (sortCol === 'yield') {
            valA = a.yieldPct || 0;
            valB = b.yieldPct || 0;
        } else if (sortCol === 'yoc') {
            valA = cashflowMode === 'net' ? (a.netYoCPct || 0) : (a.grossYoCPct || 0);
            valB = cashflowMode === 'net' ? (b.netYoCPct || 0) : (b.grossYoCPct || 0);
        } else if (sortCol === 'gross') {
            valA = a.grossAnnualIncome || 0;
            valB = b.grossAnnualIncome || 0;
        } else if (sortCol === 'taxRate') {
            valA = a.tax.taxRatePct || 0;
            valB = b.tax.taxRatePct || 0;
        } else if (sortCol === 'taxDrag') {
            valA = a.taxDragCAD || 0;
            valB = b.taxDragCAD || 0;
        } else if (sortCol === 'netMonthly') {
            valA = a.netMonthlyIncome || 0;
            valB = b.netMonthlyIncome || 0;
        } else {
            // netAnnual (default)
            valA = a.netAnnualIncome || 0;
            valB = b.netAnnualIncome || 0;
        }

        return sortDirection === 'asc' ? valA - valB : valB - valA;
    });

    renderTableRows(filtered);
}

function renderTableRows(items) {
    const tbody = document.getElementById('dividend-table-body');
    tbody.innerHTML = '';

    document.getElementById('filtered-count').textContent = `${items.length} ${items.length === 1 ? 'position' : 'positions'}`;

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 24px; color: #64748b;">No holdings match your search and filter criteria.</td></tr>`;
        return;
    }

    let sumVal = 0;
    let sumCost = 0;
    let sumGrossAnnual = 0;
    let sumTaxDrag = 0;
    let sumNetAnnual = 0;
    let sumNetMonthly = 0;

    items.forEach(h => {
        sumVal += h.sum;
        sumCost += (h.totalCost || h.sum);
        sumGrossAnnual += h.grossAnnualIncome;
        sumTaxDrag += h.taxDragCAD;
        sumNetAnnual += h.netAnnualIncome;
        sumNetMonthly += h.netMonthlyIncome;

        const tr = document.createElement('tr');

        let freqClass = 'pill-quarterly';
        if (h.freq === 'Monthly') freqClass = 'pill-monthly';
        else if (h.freq === 'Annual') freqClass = 'pill-annual';
        else if (h.freq === 'Semi-Annual') freqClass = 'pill-semiannual';

        const tickerBadge = h.isFixedIncomeAssumed ? '<span class="income-pill pill-fixed" title="Assumed 2.0% Fixed Income rule" style="margin-left:5px;">2% Fixed</span>' : '';
        const yocDisplay = cashflowMode === 'net' ? h.netYoCPct : h.grossYoCPct;

        tr.innerHTML = `
            <td>
                <strong>${escapeHtml(h.ticker || h.symbol)}</strong>
                ${tickerBadge}
            </td>
            <td>
                <span>${escapeHtml(h.account)}</span>
                <span style="font-size: 0.74rem; color: #64748b; margin-left: 4px;">(${escapeHtml(h.brokerage)})</span>
            </td>
            <td><span class="badge badge-strategy">${escapeHtml(h.strategy || 'Broad Market')}</span></td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(h.sum)}</td>
            <td style="text-align: right; font-weight: 700; color: ${h.yieldPct > 0 ? '#166534' : '#64748b'};">${h.yieldPct.toFixed(2)}%</td>
            <td style="text-align: right; font-weight: 700; color: ${yocDisplay > h.yieldPct ? '#166534' : (yocDisplay > 0 ? '#475569' : '#94a3b8')};">${yocDisplay > 0 ? `${yocDisplay.toFixed(2)}%` : '-'}</td>
            <td style="text-align: right; color: #475569;">${formatCurrency(h.grossAnnualIncome)}</td>
            <td style="text-align: center;">
                <span class="income-pill ${h.tax.badgeClass}" title="${escapeHtml(h.tax.explanation)}">
                    ${escapeHtml(h.tax.label)}
                </span>
            </td>
            <td style="text-align: right; font-weight: 700; color: ${h.taxDragCAD > 0 ? '#dc2626' : '#94a3b8'};">
                ${h.taxDragCAD > 0 ? `-${formatCurrency(h.taxDragCAD)}` : '$0.00'}
            </td>
            <td style="text-align: right; font-weight: 800; color: #166534;">${formatCurrency(h.netAnnualIncome)}</td>
            <td style="text-align: right; font-weight: 600; color: #0969da;">${formatCurrency(h.netMonthlyIncome)}</td>
            <td style="text-align: center;"><span class="income-pill ${freqClass}">${escapeHtml(h.freq)}</span></td>
        `;
        tbody.appendChild(tr);
    });

    const totalPortfolioCAD = allHoldings.reduce((s, h) => s + h.sum, 0);
    const yieldBase = sumVal > 0 ? sumVal : totalPortfolioCAD;
    const overallGrossYield = yieldBase > 0 ? (sumGrossAnnual / yieldBase) * 100 : 0;
    const overallNetYield = yieldBase > 0 ? (sumNetAnnual / yieldBase) * 100 : 0;
    const overallYoC = sumCost > 0 ? ((cashflowMode === 'net' ? sumNetAnnual : sumGrossAnnual) / sumCost) * 100 : overallNetYield;
    const overallTaxRate = sumGrossAnnual > 0 ? (sumTaxDrag / sumGrossAnnual) * 100 : 0;

    document.getElementById('tfoot-total-val').textContent = formatCurrency(sumVal);
    document.getElementById('tfoot-total-yield').textContent = `${(cashflowMode === 'net' ? overallNetYield : overallGrossYield).toFixed(2)}%`;
    document.getElementById('tfoot-total-yoc').textContent = `${overallYoC.toFixed(2)}%`;
    document.getElementById('tfoot-total-gross').textContent = formatCurrency(sumGrossAnnual);
    document.getElementById('tfoot-total-rate').textContent = `${overallTaxRate.toFixed(1)}% Eff.`;
    document.getElementById('tfoot-total-drag').textContent = `-${formatCurrency(sumTaxDrag)}`;
    document.getElementById('tfoot-total-net').textContent = formatCurrency(sumNetAnnual);
    document.getElementById('tfoot-total-monthly').textContent = formatCurrency(sumNetMonthly);
}

function sortTable(col) {
    if (sortCol === col) {
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
    } else {
        sortCol = col;
        sortDirection = 'desc';
    }
    applyTableFilters();
}

document.addEventListener('DOMContentLoaded', initDividends);
