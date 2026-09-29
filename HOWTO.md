# 📖 How-To Guide: My Finance

Welcome to your personal finance dashboard!

This web project is a **direct frontend for your Google Sheet (`July2026`)**. All data, calculations, ETF facts, holdings, and net worth history come directly from your Google Sheet, end-to-end encrypted with **AES-256-GCM**, and hosted on GitHub Pages.

---

## 🔗 Key Links & Cloud Resources

| Resource | Description | Link |
| :--- | :--- | :--- |
| **Google Sheet (Portfolio)** | Your live portfolio spreadsheet (`July2026`) | [Open Google Sheet](https://docs.google.com/spreadsheets/d/1ofMWRVDjxR1DsEkqWkURfTTyvbO23k2l4YBXUpSx4fM/edit) |
| **Google Cloud IAM Console** | Service Account details & key management | [Open Service Account Console](https://console.cloud.google.com/iam-admin/serviceaccounts/details/117152471666773814465;edit=true?project=gen-lang-client-0273341539) |
| **Service Account Email** | OAuth2 identity for Sheets API read access | `my-finance-webapp@gen-lang-client-0273341539.iam.gserviceaccount.com` |
| **GitHub Actions Sync** | Automation workflow & on-demand runs | [GitHub Actions Workflows](https://github.com/koraytugay/my-finance/actions) |
| **Live Web App** | Portfolio website (GitHub Pages) | `https://koraytugay.github.io/my-finance/` |

---

## 🌟 The Automated Workflow (No Manual Data Entry Here!)

```
  ┌──────────────────────────────────────────────────────────────┐
  │ Google Sheets: "July2026"                                    │
  │ (Your single source of truth - modify here anytime!)         │
  │ - Tabs: 'Holdings', 'Carry Over', 'ETF Facts'                │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ GitHub Actions Workflow (daily-pipeline.yml)                 │
  │ Runs weekdays every 2 hrs (10am, 12pm, 2pm, 4pm) / On Demand │
  │                                                              │
  │  1. Decrypts `encrypted/google-key.enc` in RAM (password)    │
  │  2. Reads 'Holdings', 'Carry Over', and 'ETF Facts'          │
  │  3. Encrypts portfolio & history -> `encrypted/*.enc`        │
  │  4. Commits and pushes back to GitHub                        │
  └──────────────────────────────┬───────────────────────────────┘
                                 │
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ GitHub Pages Website                                         │
  │ Enter your password in browser                               │
  │ (Decrypted only in client memory via Web Crypto API)         │
  └──────────────────────────────────────────────────────────────┘
```

You **never** have to manually edit CSV, JSON, or code files in this repository. All updates are made exclusively in your **Google Sheet (`July2026`)**.

---

## 🛒 What to Do When Buying a New ETF (e.g. `XEI`)

If you start buying a new ETF (for example, `TSE:XEI` in your brokerage account):

1. **Open your Google Sheet (`July2026`)**:
   - [July2026 Spreadsheet Link](https://docs.google.com/spreadsheets/d/1ofMWRVDjxR1DsEkqWkURfTTyvbO23k2l4YBXUpSx4fM/edit)

2. **Add the ETF profile in `ETF Facts` tab**:
   - Add a row for `TSE:XEI`:
     - **Ticker**: `TSE:XEI` *(use `TSE:` prefix for TSX stocks, or plain ticker for US stocks like `VTI`)*
     - **Unit Price**: Price per share
     - **Asset Allocation %**: e.g., Canada: `1` (100%), other columns: `0`
     - **Strategy**: e.g., `Dividend`, `Broad Market`, or `Factor`

3. **Add the holding row in `Holdings` tab**:
   - **Brokerage**: Your brokerage name
   - **Ticker**: `TSE:XEI`
   - **Account**: `TFSA` (or `RRSP`, `FHSA`, `Non-Registered`)
   - **Registered?**: `1` (for registered tax-free) or `0` (for taxable)
   - **Count**: Number of shares held (e.g., `100`)
   - **Sum**: Total value

4. **That's all!**:
   - Next time GitHub Actions runs (or immediately if you click **Run workflow** in GitHub Actions), the new holding will be encrypted and appear on your website!

---

## 🧭 Dashboard Suite & Feature Guide

| Page | File | Purpose & Key Features |
| :--- | :--- | :--- |
| **Main** | `index.html` | High-level executive dashboard, total net worth, 52-week & YTD stats, and direct links. |
| **Holdings** | `holdings.html` | Searchable, sortable holdings table and card view with asset class breakdown. |
| **Net Worth History** | `history.html` | Comprehensive weekly history log, interactive SVG timeline chart, and milestone markers. |
| **Asset Allocation** | `allocation.html` | Geographic diversification (US, Canada, Developed, Emerging) and factor tilt analysis. |
| **Accounts & Brokerages** | `accounts.html` | Grouping by institution with clean sub-grouping by Account (TFSA, RRSP, Non-Reg, Cash). |
| **Dividends & Cashflow** | `dividends.html` | Annual, monthly & daily passive income projections, tax-sheltered cashflow, 12-month schedule & 2% fixed income rule. |
| **Financial Stats** | `stats.html` | Asset concentration, diversification scores, and portfolio records. |
| **Performance** | `performance.html` | Monthly returns calendar heatmap, drawdown underwater chart, annualized volatility (σ), Sharpe/Sortino ratios & historical crisis stress testing. |
| **Projections** | `projections.html` | Interactive 30-year FIRE & wealth compounding simulator, milestone countdowns, and Safe Withdrawal Rate (SWR) planner. |
| **Tax Location** | `tax.html` | Tax-efficiency matrix: asset placement across Tax-Free, Tax-Deferred, and Taxable wrappers. |

---

## ✏️ What to Do When Changing Share Counts or Cash Balances

1. Open your Google Sheet (`July2026`).
2. Go to the **`Holdings`** tab.
3. Simply change the number in the **`Count`** column for that holding or cash row.
4. Save (Google Sheets saves automatically).
5. Trigger the sync in GitHub Actions (or wait for the daily run).

---

## 🔐 Security & Encryption Architecture

- **Public Repository Safe**: All your private holdings, quantities, share counts, account names, and net worth history are encrypted using **AES-256-GCM** with **PBKDF2** key derivation (100,000 SHA-256 iterations).
- **Zero Plaintext Files**: There are no plaintext CSV or JSON data files in the repository.
- **Google Service Account Key**: Encrypted into `encrypted/google-key.enc` using your secret password. Only the encrypted file is committed to GitHub. The plaintext `.json` key is strictly gitignored.
- **Session-Based RAM Security**: The decryption password and decrypted data exist only in browser memory (`sessionStorage` and RAM) for the active session. Closing the tab or browser immediately wipes decrypted memory and restores the lock screen. You can also execute `lockPortfolio()` in the browser console at any time.

---

## ⚙️ Setting Up GitHub Actions Secret

For GitHub Actions to run automatically:

1. In your GitHub repository: Go to **Settings** ➔ **Secrets and variables** ➔ **Actions**.
2. Click **New repository secret**.
3. Name: `PORTFOLIO_PASSWORD`
4. Value: `<YOUR_PORTFOLIO_PASSWORD>`
5. Click **Add secret**.

---

## ⚡ Running Locally

If you want to sync or view the website locally on your Mac:

### 1. View the Website
```bash
npm start
```
Open **[http://localhost:7990/](http://localhost:7990/)** and enter your password.

### 2. Sync from Google Sheets
```bash
PORTFOLIO_PASSWORD="<YOUR_PASSWORD>" npm run sync
# or pass as argument:
node sync.js "<YOUR_PASSWORD>"
```

### 3. Re-encrypt Google Service Account Key (If You Ever Rotate Keys)
If you generate a new key in the [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts/details/117152471666773814465;edit=true?project=gen-lang-client-0273341539):
```bash
node scripts/encrypt-google-key.js <path-to-downloaded-key.json> "<YOUR_PASSWORD>"
```
