/**
 * My Finance - Shared API, Utilities & WebCrypto Decryption Engine
 */

let cachedHoldings = null;
let cachedHistory = null;
let cachedPrices = null;
let isSessionUnlocked = false;
let activeUnlockPromise = null;

/* ================= Web Crypto Decryption ================= */

function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function decryptPayloadWebCrypto(payload, password) {
    if (!payload || !payload.salt || !payload.iv || !payload.tag || !payload.data) {
        throw new Error('Invalid encrypted payload structure');
    }

    const enc = new TextEncoder();
    const passKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    const salt = base64ToUint8Array(payload.salt);
    const iv = base64ToUint8Array(payload.iv);
    const ciphertext = base64ToUint8Array(payload.data);
    const tag = base64ToUint8Array(payload.tag);

    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: payload.iterations || 100000,
            hash: 'SHA-256'
        },
        passKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    // Web Crypto expects ciphertext + auth tag concatenated
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);

    const decryptedBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        combined
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decryptedBuf));
}

/* ================= Data Retrieval with Decryption ================= */

async function getPrices(forceRefresh = false) {
    if (cachedPrices && !forceRefresh) return cachedPrices;
    let cadUsdRate = null;
    let lastUpdated = '';

    // 1. Try to load fresh live FX rate from benchmarks
    if (!cachedBenchmarks) {
        try {
            await getBenchmarks();
        } catch (_) {}
    }

    if (cachedBenchmarks && cachedBenchmarks.fx && cachedBenchmarks.fx.cadUsdRate) {
        cadUsdRate = cachedBenchmarks.fx.cadUsdRate;
        lastUpdated = cachedBenchmarks.fx.updatedAt || cachedBenchmarks.updatedAt || '';
    }

    // 2. If benchmarks FX not found, derive from latest historical snapshot
    if (!cadUsdRate) {
        if (!cachedHistory) {
            try {
                await getHistory();
            } catch (_) {}
        }

        if (cachedHistory && cachedHistory.length > 0) {
            const latest = cachedHistory[cachedHistory.length - 1];
            if (latest.totalCAD && latest.totalUSD) {
                cadUsdRate = Number((latest.totalUSD / latest.totalCAD).toFixed(4));
            }
            if (!lastUpdated) lastUpdated = latest.date;
        }
    }

    // 3. Fallback only if no data available
    if (!cadUsdRate) {
        cadUsdRate = 0.7073;
    }

    cachedPrices = { quotes: {}, cadUsdRate, lastUpdated };
    if (typeof window !== 'undefined') {
        window.cachedPrices = cachedPrices;
        window.baseFXRate = cadUsdRate;
    }
    return cachedPrices;
}

function applyLivePricesToHoldings(holdings) {
    // Holdings already have live market prices applied by the sync pipeline
}

/**
 * Sanitizes portfolio historical records:
 * 1. Excludes placeholder/empty rows (totalCAD <= 0 or missing)
 * 2. Accurately populates running peak, drawdown ($), and drawdown (%) across history
 */
function sanitizeHistory(history) {
    if (!Array.isArray(history)) return [];
    const valid = history.filter(r => {
        if (!r || typeof r !== 'object') return false;
        if (r.week === undefined || r.week === null || isNaN(Number(r.week))) return false;
        if (typeof r.totalCAD !== 'number' || isNaN(r.totalCAD) || r.totalCAD <= 0) return false;
        return true;
    });

    let runningPeak = 0;
    return valid.map(r => {
        const totalCAD = Number(r.totalCAD) || 0;
        if (totalCAD > runningPeak) {
            runningPeak = totalCAD;
        }
        const peak = runningPeak;
        const ddCAD = totalCAD - peak;
        const ddPct = peak > 0 ? (ddCAD / peak) * 100 : 0;
        return {
            ...r,
            runningPeakCAD: peak,
            drawdownCAD: ddCAD,
            drawdownPct: ddPct
        };
    });
}

async function unlockWithPassword(password, forceRefresh = false) {
    if (!password) {
        throw new Error('Password required');
    }
    if (cachedHoldings && cachedHistory && !forceRefresh) {
        return { holdings: cachedHoldings, history: cachedHistory };
    }
    if (activeUnlockPromise) {
        return activeUnlockPromise;
    }

    activeUnlockPromise = (async () => {
        const t = Date.now();
        const [holdingsRes, historyRes] = await Promise.all([
            fetch(`encrypted/holdings.enc?_=${t}`, { cache: 'no-cache' }),
            fetch(`encrypted/history.enc?_=${t}`, { cache: 'no-cache' })
        ]);

        if (!holdingsRes.ok) {
            throw new Error('Could not find encrypted/holdings.enc');
        }

        const encHoldings = await holdingsRes.json();
        const holdings = await decryptPayloadWebCrypto(encHoldings, password);

        let history = [];
        if (historyRes.ok) {
            try {
                const encHistory = await historyRes.json();
                history = await decryptPayloadWebCrypto(encHistory, password);
            } catch (e) {
                console.warn('History decrypt warning:', e.message);
            }
        }

        cachedHoldings = holdings;
        cachedHistory = sanitizeHistory(history);
        isSessionUnlocked = true;

        await getPrices(true);
        sessionStorage.setItem('portfolio_password', password);

        return { holdings: cachedHoldings, history: cachedHistory };
    })();

    try {
        return await activeUnlockPromise;
    } finally {
        activeUnlockPromise = null;
    }
}

async function getHoldings(forceRefresh = false) {
    if (cachedHoldings && !forceRefresh) return cachedHoldings;

    const savedPassword = sessionStorage.getItem('portfolio_password');
    if (savedPassword) {
        try {
            await unlockWithPassword(savedPassword, forceRefresh);
            if (cachedHoldings) return cachedHoldings;
        } catch (e) {
            sessionStorage.removeItem('portfolio_password');
        }
    }

    throw new Error('LOCKED');
}

async function getHistory(forceRefresh = false) {
    if (cachedHistory && !forceRefresh) return cachedHistory;

    const savedPassword = sessionStorage.getItem('portfolio_password');
    if (savedPassword) {
        try {
            await unlockWithPassword(savedPassword, forceRefresh);
            if (cachedHistory) return cachedHistory;
        } catch (e) {
            sessionStorage.removeItem('portfolio_password');
        }
    }

    throw new Error('LOCKED');
}

async function getMainData(forceRefresh = false) {
    const [holdings, history] = await Promise.all([
        getHoldings(forceRefresh),
        getHistory(forceRefresh)
    ]);
    if (typeof calculateMainData === 'function') {
        return calculateMainData(holdings, history);
    }
    return { holdings, history };
}

let cachedBenchmarks = null;

async function getBenchmarks(forceRefresh = false) {
    if (cachedBenchmarks && !forceRefresh) return cachedBenchmarks;
    try {
        const res = await fetch(`data/benchmarks.json?t=${Date.now()}`);
        if (res.ok) {
            cachedBenchmarks = await res.json();
            if (cachedBenchmarks.fx?.cadUsdRate) {
                if (cachedPrices) {
                    cachedPrices.cadUsdRate = cachedBenchmarks.fx.cadUsdRate;
                }
                if (typeof window !== 'undefined') {
                    if (!window.cachedPrices) window.cachedPrices = {};
                    window.cachedPrices.cadUsdRate = cachedBenchmarks.fx.cadUsdRate;
                    window.baseFXRate = cachedBenchmarks.fx.cadUsdRate;
                }
            }
            return cachedBenchmarks;
        }
    } catch (e) {
        console.warn('Could not load data/benchmarks.json:', e);
    }
    return null;
}

function lockPortfolio() {
    cachedHoldings = null;
    cachedHistory = null;
    isSessionUnlocked = false;
    sessionStorage.removeItem('portfolio_password');
    location.reload();
}

/* ================= Password Modal UI ================= */

let unlockSuccessCallback = null;

function showUnlockModal(onSuccess) {
    unlockSuccessCallback = onSuccess;
    let overlay = document.getElementById('unlock-modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'unlock-modal-overlay';
        overlay.className = 'modal-overlay active';
        overlay.style.zIndex = '2000';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 420px; text-align: center; padding: 32px 24px;">
                <div style="font-size: 2.8rem; margin-bottom: 12px;">🔒</div>
                <h2 style="font-size: 1.45rem; font-weight: 800; margin-bottom: 6px; color: #1f2328;">My Finance is Encrypted</h2>
                <p style="font-size: 0.85rem; color: #64748b; margin-bottom: 20px;">
                    Enter your password to decrypt your portfolio holdings and history.
                </p>
                <form id="unlock-form" onsubmit="event.preventDefault(); submitUnlock();">
                    <div style="margin-bottom: 14px;">
                        <input type="password" id="unlock-password" placeholder="Enter password..." autocomplete="current-password"
                            style="width: 100%; height: 40px; padding: 0 14px; font-size: 0.95rem; border: 1.5px solid #d0d7de; border-radius: 8px; box-sizing: border-box; text-align: center;">
                    </div>
                    <div id="unlock-error" style="color: #cf222e; font-size: 0.82rem; margin-bottom: 12px; display: none;"></div>
                    <button type="submit" id="unlock-btn" class="btn-secondary" style="width: 100%; height: 40px; font-size: 0.95rem; font-weight: 700; background: #0969da; color: #fff; border-color: #0969da;">
                        Unlock Portfolio
                    </button>
                </form>
            </div>
        `;
        document.body.appendChild(overlay);

        window.submitUnlock = async function() {
            const pwdInput = document.getElementById('unlock-password');
            const errEl = document.getElementById('unlock-error');
            const btn = document.getElementById('unlock-btn');
            const pwd = pwdInput.value;

            if (!pwd) {
                errEl.textContent = 'Please enter a password';
                errEl.style.display = 'block';
                return;
            }

            btn.disabled = true;
            btn.textContent = 'Decrypting...';
            errEl.style.display = 'none';

            try {
                await unlockWithPassword(pwd);
                const currentOverlay = document.getElementById('unlock-modal-overlay');
                if (currentOverlay) {
                    currentOverlay.remove();
                }
                if (typeof unlockSuccessCallback === 'function') {
                    unlockSuccessCallback();
                } else {
                    location.reload();
                }
            } catch (err) {
                errEl.textContent = 'Incorrect password or corrupted encrypted data.';
                errEl.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Unlock Portfolio';
                pwdInput.select();
            }
        };
    } else {
        overlay.classList.add('active');
    }

    setTimeout(() => {
        const input = document.getElementById('unlock-password');
        if (input) input.focus();
    }, 100);
}

/* ================= Formatters & Shared Helpers ================= */

function formatCurrency(val, currency = 'CAD') {
    const num = Number(val || 0);
    const prefix = currency === 'USD' ? 'US$' : '$';
    const absStr = Math.abs(num).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return num < 0 ? `-${prefix}${absStr}` : `${prefix}${absStr}`;
}

function formatPercent(val, showSign = false) {
    const num = Number(val || 0);
    const sign = showSign && num > 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatMonthShort(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 2) return dateStr;
    const monthIdx = parseInt(parts[1], 10) - 1;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthNames[monthIdx] || dateStr;
}

function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Calculates portfolio cost basis and actual market gains from holdings.
 * Standardizes calculation across holdings, history, performance, main, and projections.
 */
function calculateHoldingsCostBasis(holdings) {
    let totalMarketCAD = 0;
    let totalBookCostCAD = 0;
    let totalMarketGainsCAD = 0;

    (holdings || []).forEach(h => {
        const sum = Number(h.sum) || 0;
        totalMarketCAD += sum;

        let cost = 0;
        if (h.totalCost !== undefined && h.totalCost !== null && Number(h.totalCost) > 0) {
            cost = Number(h.totalCost);
        } else if (Number(h.averageCost || 0) > 0 && Number(h.count || 0) > 0) {
            cost = Number(h.averageCost) * Number(h.count);
        } else if (h.ticker === 'Cash' || h.strategy === 'Fixed Income') {
            cost = sum;
        } else {
            cost = sum;
        }

        totalBookCostCAD += cost;
        totalMarketGainsCAD += (sum - cost);
    });

    const marketRoiPct = totalBookCostCAD > 0 ? (totalMarketGainsCAD / totalBookCostCAD) * 100 : 0;

    return {
        totalMarketCAD: Number(totalMarketCAD.toFixed(2)),
        totalBookCostCAD: Number(totalBookCostCAD.toFixed(2)),
        totalMarketGainsCAD: Number(totalMarketGainsCAD.toFixed(2)),
        marketRoiPct: Number(marketRoiPct.toFixed(2))
    };
}

/**
 * Computes an overlay simulation of XEQT performance for any filtered historical records timeframe.
 * Scales XEQT from the portfolio starting capital at the beginning of the timeframe,
 * allowing direct dollar-for-dollar and percentage return comparison against the user's net worth.
 * 
 * @param {Array} records Filtered history records for the current timeframe (e.g. 2025, last-52, all)
 * @param {Array} fullHistory The full unfiltered history records (used for week-index matching)
 * @param {Array} xeqtWeeklyPrices Array of weekly closing prices for XEQT
 * @param {string} currency 'CAD' or 'USD'
 * @returns {Array} Array of overlay data points matching each record in records
 */
function computeXeqtProgressionOverlay(records, fullHistory, xeqtWeeklyPrices, currency = 'CAD', currentBenchmarkPrice = null) {
    if (!records || records.length === 0 || !xeqtWeeklyPrices) {
        return [];
    }

    const prices = Array.isArray(xeqtWeeklyPrices) ? xeqtWeeklyPrices : (xeqtWeeklyPrices.weeklyPrices || []);
    if (prices.length === 0) {
        return [];
    }

    const livePrice = (currentBenchmarkPrice != null && Number.isFinite(Number(currentBenchmarkPrice)))
        ? Number(currentBenchmarkPrice)
        : (!Array.isArray(xeqtWeeklyPrices) && xeqtWeeklyPrices.currentPrice ? xeqtWeeklyPrices.currentPrice : null);

    const valKey = currency === 'USD' ? 'totalUSD' : 'totalCAD';
    const startPortfolioVal = records[0][valKey] || 0;

    const latestHistoryRec = (Array.isArray(fullHistory) && fullHistory.length > 0)
        ? fullHistory[fullHistory.length - 1]
        : records[records.length - 1];

    function getXeqtPrice(r, i) {
        let idx = -1;
        if (r.week !== undefined && r.week !== null && Number.isFinite(Number(r.week))) {
            idx = Number(r.week) - 1;
        } else if (Array.isArray(fullHistory)) {
            idx = fullHistory.findIndex(h => h.date === r.date);
        }
        if (idx < 0) idx = 0;

        // If this is the latest chronological record and a live price is available
        const isLatestRecord = (r === latestHistoryRec) || (latestHistoryRec && r.date === latestHistoryRec.date);
        if (isLatestRecord && livePrice != null && livePrice > 0) {
            if (idx >= prices.length - 1 || (records[i - 1] && records[i - 1].date !== r.date)) {
                return livePrice;
            }
        }

        const clampedIdx = Math.min(Math.max(0, idx), prices.length - 1);
        return prices[clampedIdx] || prices[prices.length - 1] || 0;
    }

    const startP = getXeqtPrice(records[0], 0);
    const rate0 = (records[0].totalCAD && records[0].totalUSD) ? (records[0].totalUSD / records[0].totalCAD) : 1;
    const startPrice = currency === 'USD' ? (startP * rate0) : startP;

    return records.map((r, i) => {
        const curP = getXeqtPrice(r, i);
        const curRate = (r.totalCAD && r.totalUSD) ? (r.totalUSD / r.totalCAD) : 1;
        const curPrice = currency === 'USD' ? (curP * curRate) : curP;

        const val = startPrice > 0 ? (startPortfolioVal * (curPrice / startPrice)) : startPortfolioVal;
        const returnPct = startPrice > 0 ? (((curPrice - startPrice) / startPrice) * 100) : 0;
        const gain = val - startPortfolioVal;

        const portVal = r[valKey] || 0;
        const portGain = portVal - startPortfolioVal;
        const portReturnPct = startPortfolioVal > 0 ? ((portGain / startPortfolioVal) * 100) : 0;

        const spreadVal = portVal - val;
        const spreadPct = portReturnPct - returnPct;

        return {
            index: i,
            date: r.date,
            week: r.week,
            price: Number(curPrice.toFixed(2)),
            val: Number(val.toFixed(2)) || 0,
            returnPct: Number(returnPct.toFixed(2)) || 0,
            gain: Number(gain.toFixed(2)) || 0,
            portfolioVal: portVal,
            portfolioGain: Number(portGain.toFixed(2)) || 0,
            portfolioReturnPct: Number(portReturnPct.toFixed(2)) || 0,
            spreadVal: Number(spreadVal.toFixed(2)) || 0,
            spreadPct: Number(spreadPct.toFixed(2)) || 0
        };
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatCurrency,
        formatPercent,
        formatDate,
        formatMonthShort,
        escapeHtml,
        calculateHoldingsCostBasis,
        computeXeqtProgressionOverlay,
        sanitizeHistory
    };
}

