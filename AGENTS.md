# AI Agent Guidelines & Security Policy

## Strict Confidentiality & Credential Policy

1. **NO PASSWORD COMMITS**:
   - The user's portfolio decryption password (`PORTFOLIO_PASSWORD`) must NEVER be hardcoded, logged, written to files, or committed to git under any circumstances.
   - Do not add fallback strings or default values containing the user's password in test files, scripts, or documentation.

2. **DECRYPTION IN TESTS & SCRIPTS**:
   - Tests requiring decryption must strictly use `process.env.PORTFOLIO_PASSWORD`.
   - If `process.env.PORTFOLIO_PASSWORD` is not set, tests MUST skip decryption gracefully (using `t.skip()`).

3. **END-TO-END ENCRYPTION (AES-256-GCM)**:
   - All financial data on disk (`encrypted/*.enc`) must remain encrypted.
   - Never commit plaintext JSON, CSV, or markdown files containing actual portfolio values, share counts, or financial snapshots.

## AI Testing Strategy & Architecture Guidelines

1. **TESTING PURE FUNCTIONS ONLY**:
   - Unit tests are strictly reserved for pure functions, mathematical financial calculations (drawdowns, high-water marks, rolling 52-week trailing returns, FX conversions, asset allocations), data sanitization, and encryption/decryption.
   - **NO MOCK-DOM TESTS**: Do NOT create fake DOM objects (`global.document = { ... }`, `mockBox`, simulated `mousemove` events) to test SVGs, cards, buttons, or hover states. Mocked DOM tests give a false sense of security and fail to catch real browser runtime bugs.
   - Visual and interactive UI features must be verified directly in the browser or via real browser automation, never through synthetic Node.js DOM mocks.

2. **GOOGLE SHEETS IS THE SINGLE SOURCE OF TRUTH**:
   - The rows in Google Sheets define the historical timeline.
   - The latest row in history is ALWAYS the active "THIS week" reporting cycle and is dynamically enriched with live holdings valuation and weekly changes relative to the prior row.
   - Never fabricate, guess, or append synthetic in-progress rows (`history.push(...)`) based on calendar dates or elapsed days. New rows are only created when explicitly recorded in Google Sheets.
