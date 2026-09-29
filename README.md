# My Finance 📈

Personal finance, portfolio asset allocation, and net worth tracking website hosted on GitHub Pages.

Running at: `https://koraytugay.github.io/my-finance/`

---

## 🌟 Overview & Architecture

**My Finance** is a lightweight, secure frontend for your Google Sheets portfolio:

- **Google Sheets as Single Source of Truth**: All holdings, share counts, account balances, and historical net worth records are maintained in Google Sheet [`July2026`](https://docs.google.com/spreadsheets/d/1ofMWRVDjxR1DsEkqWkURfTTyvbO23k2l4YBXUpSx4fM/edit) (`ETF Facts`, `Holdings`, and `Carry Over` tabs). Zero manual data entry in this repository.
- **End-to-End Encryption (AES-256-GCM)**: All private financial records are encrypted using AES-256-GCM with PBKDF2 (100,000 SHA-256 iterations). The repository contains only encrypted ciphertext files (`encrypted/*.enc`).
- **No Data Folder Needed**: No unencrypted JSON or CSV data files exist in the repository.
- **Encrypted Google Cloud Service Account Key**: The key used by GitHub Actions to read Google Sheets is itself AES-256-GCM encrypted ([`encrypted/google-key.enc`](encrypted/google-key.enc)).
- **Automated GitHub Actions Pipeline**: Runs every weekday every 2 hours during market hours (10:00 AM, 12:00 PM, 2:00 PM, and 4:00 PM Toronto Time):
  1. Decrypts `encrypted/google-key.enc` in memory using `PORTFOLIO_PASSWORD` secret.
  2. Reads `ETF Facts`, `Holdings`, and `Carry Over` from Google Sheet `July2026`.
  3. Encrypts `encrypted/holdings.enc` and `encrypted/history.enc`.
  4. Commits and pushes back to GitHub, instantly refreshing GitHub Pages.
- **Dynamic Executive Dashboard**: The Main dashboard and all 52-week metrics are calculated dynamically from raw holdings and history in the browser—the Google Sheet does not even require a `Main` tab!
- **Pure Static Frontend (GitHub Pages)**: Built with vanilla HTML5, CSS3, and ES6+ JavaScript. Styled to match the clean design of [`my-board-game-collection`](https://github.com/koraytugay/my-board-game-collection).
- **Client-Side In-Memory Decryption**: Data is decrypted purely in your browser's RAM via the native **Web Crypto API** (`window.crypto.subtle`) when you enter your password. No plaintext financial data ever touches any server.

---

## 🔒 Security & AI Agent Directives

> [!CAUTION]
> **CRITICAL SECURITY REQUIREMENT FOR AI CODING AGENTS & CONTRIBUTORS**
> 1. **NEVER HARDCODE OR COMMIT PASSWORDS**: Never write, hardcode, commit, log, or store the portfolio decryption password (`PORTFOLIO_PASSWORD`) or any user credentials in this repository—neither in code, tests, test fixtures, scripts, commit messages, comments, nor documentation.
> 2. **ENVIRONMENT VARIABLE ONLY**: Any local test or script requiring decryption must strictly receive the password via `process.env.PORTFOLIO_PASSWORD`. If the variable is unset, tests must skip decryption gracefully.
> 3. **NO UNENCRYPTED FINANCIAL DATA**: All financial balances, portfolio holdings, cost bases, and net worth figures must strictly remain encrypted (`encrypted/*.enc`) via AES-256-GCM. Never commit plaintext financial data or snapshots.

---

## 🔗 Key Links & Cloud Resources

- **Google Sheet (Portfolio)**: [July2026 Spreadsheet](https://docs.google.com/spreadsheets/d/1ofMWRVDjxR1DsEkqWkURfTTyvbO23k2l4YBXUpSx4fM/edit)
- **Google Cloud IAM Console**: [Service Account Details & Key Management](https://console.cloud.google.com/iam-admin/serviceaccounts/details/117152471666773814465;edit=true?project=gen-lang-client-0273341539)
- **Service Account Email**: `my-finance-webapp@gen-lang-client-0273341539.iam.gserviceaccount.com`

---

## 🧭 Navigation & Views

1. **Executive Dashboard (`index.html`)**: Real-time portfolio overview, current week status, 52-week wealth creation and performance metrics, and asset class summaries.
2. **Holdings (`holdings.html`)**: Complete portfolio view with interactive search, multi-criteria filtering (Brokerage, Account, Strategy), Table & Card display modes, and holding detail modal.
3. **Net Worth History (`history.html`)**: Historical tracking with interactive SVG area growth chart, tooltips, currency toggle (CAD/USD), and weekly logs.
4. **Asset Allocation (`allocation.html`)**: Geographic equity diversification, asset classes, factor tilts, and dynamic currency scenario simulator.
5. **Accounts & Brokerages (`accounts.html`)**: Institution breakdown and tax wrapper structure (RRSP, TFSA, FHSA, Non-Registered, Cash).
6. **Dividends (`dividends.html`)**: Annual and monthly dividend income projections, portfolio yields, withholding tax breakdown, and calendar schedule.
7. **Financial Stats (`stats.html`)**: Top holdings, asset allocation rankings, and annual performance records.
8. **Performance Analytics (`performance.html`)**: Monthly returns calendar heatmap, interactive weekly gain/loss SVG bar chart, win/loss week ratios, CAGR, and Sharpe ratio.
9. **Projections (`projections.html`)**: Multi-decade compound growth modeling, Monte Carlo simulation percentiles, and financial freedom milestones.
10. **Tax Location (`tax.html`)**: Tax-sheltered vs. taxable wealth distribution, cross-account asset placement matrix, and withholding tax optimizations.

---

## 📖 How-To Guide

For detailed step-by-step instructions, read the [**HOWTO.md**](HOWTO.md) guide.

---

## ⌨️ Command Cheat Sheet

| Command | Description |
| :--- | :--- |
| `npm start` | Starts local web server at [http://localhost:7990/](http://localhost:7990/) |
| `npm test` | Runs unit tests (crypto verification, cost basis, annual calculations) |
| `npm run sync` | Pulls directly from Google Sheets and encrypts |
| `npm run encrypt-key` | Re-encrypts a Google service account key JSON file into `encrypted/google-key.enc` |
