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
