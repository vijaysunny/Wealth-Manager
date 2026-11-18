# WealthManager — Claude Code Work Plan

Personal-use Android finance app (Expo SDK 54, React Native 0.81, SQLite). Source is the `WealthManager_phase10` archive. **Do not upgrade Expo SDK.** The SMS bridge libraries pin us to SDK 54.

This plan has four parts:

1. **Part A:** Wallet and UPI Lite support (new feature)
2. **Part B:** Known bugs and hardening found in review
3. **Part C:** Complete testing plan (unit, integration, fixtures, device)
4. **Part D:** Definition of done

---

## 0. Ground rules for Claude Code

- Read before changing: `utils/TransactionParser.js`, `utils/BalanceService.js`, `utils/DeduplicationEngine.js`, `utils/SmsSync.js`, `components/RealSmsReader.js`, `utils/InstantSmsListener.js`, `utils/FeatureService.js`, `data/TransactionRepo.js`, `utils/StatementParser.js`, `screens/ToolsScreen.js`.
- Run `npm ci && npm test -- --runInBand && npm run lint` first. Baseline: **18 suites / 177 tests pass, lint clean.** Never leave the repo worse than that.
- Work in small commits, one per task ID below (A1, A2, …). Every commit must pass tests and lint.
- **Test first for parser and balance logic:** write failing tests from fixtures, then implement.
- Money maths: round to 2 dp via the existing `round2`. Never use floating drift (`0.1 + 0.2`) in assertions; use `toBeCloseTo` or integer paise.
- Do not log full SMS bodies, account numbers or balances in `console.log` in production paths. Bodies contain sensitive data.
- Keep pure logic in pure modules (no React Native imports), as `TransactionParser.js` already does, so it stays unit-testable.
- Do not touch data migration code (`data/Database.js`) except where a task says so.
- Do not claim device behaviour is verified. Mark device checks as pending in `docs/`.

---

# PART A — Wallet and UPI Lite support

## A0. Background and the problem

UPI Lite is an on-device balance inside a UPI app (PhonePe, Paytm, BHIM, Google Pay and others). Money flows like this:

```
Bank account ──top-up──▶ UPI Lite balance ──small payments (no PIN)──▶ merchants
                              ◀──withdraw/refund──▶ Bank account
```

**What the app does today, and why that is wrong:**

| Event | Likely SMS? | Current app behaviour | Problem |
|---|---|---|---|
| Top-up bank → Lite | Bank SMS "debited … UPI Lite top-up" (wording varies) | Parsed as a normal **expense** from the bank | Money did not leave your wealth. It moved to a wallet. Expense is overstated. |
| Payment from Lite | Often **no bank SMS** (balance is on device). The app may show only a push notification or in-app history. | Not captured at all | Spending is invisible. Wallet balance and expenses are wrong. |
| Withdraw/refund Lite → bank | Bank SMS "credited … UPI Lite" | Parsed as **income** | Fake income. |
| Sender like `PHONEPE`, `PAYTM` | Wallet-app SMS | `detectBank` labels it a *bank* (`Paytm Bank`, `PhonePe`), and `applyCapturedToAccounts` auto-creates a **'Bank Account'** | Wrong account type. Wallet and bank are mixed. |
| `detectAccountType()` | n/a | Only returns `Credit Card` or `Bank Account` | No wallet concept in parsing. |
| Captured SMS has "Avl Bal" | Yes | `applyCapturedToAccounts` **sets** the account balance to the SMS balance | For a top-up SMS, that balance is the *bank's*, not the wallet's. Must not be applied to the wallet. |

> ⚠️ **Wording assumption.** The real SMS and notification text for UPI Lite differs by bank and app, and changes over time. Do **not** hardcode guesses as truth. Build the classifier from the user's real redacted samples in `__fixtures__/` (see Part C §C1). Where samples are missing, write the rule behind a clearly named pattern constant and mark the test `// UNVERIFIED-SAMPLE`.
>
> Also do not hardcode UPI Lite limits (per-transaction cap, balance cap). They have been revised by RBI/NPCI. Make them user-editable settings if used at all (e.g. a warning only).

## A1. Data model

Keep existing account `type: 'Wallet'` (already in `SPENDABLE_TYPES`). Add optional metadata on the account record (JSON in `user_wealth_accounts`, no schema migration needed):

```js
{
  id, name: 'PhonePe UPI Lite', type: 'Wallet',
  subType: 'UPI Lite',              // 'UPI Lite' | 'Paytm Wallet' | 'Amazon Pay' | 'FASTag' | 'Other Wallet'
  provider: 'PhonePe',              // app name
  linkedBankId: <id of funding bank account> | null,
  balance: 0,
  aliases: ['phonepe lite','upi lite phonepe']   // lowercase; used to match SMS/statement text
}
```

Add to transaction records (all optional, so old data stays valid):

```js
{
  type: 'transfer',                 // already supported
  accountId, toAccountId,           // existing transfer fields
  transferKind: 'wallet_topup' | 'wallet_withdraw' | 'wallet_other',
  walletProvider: 'PhonePe',
  source: 'sms' | 'gmail' | 'statement' | 'pdf' | 'manual' | 'wallet_reconcile',
  reconciled: true                  // set on wallet_reconcile adjustments
}
```

**Task A1:** add `WALLET_SUBTYPES` and helper `isWallet(account)` to `BalanceService.js`. Extend `validateBackup` / `BACKUP_FIELDS` only if needed. New fields must round-trip through backup, restore and merge-restore.

## A2. Parser changes (`utils/TransactionParser.js`)

Add a **wallet classification layer**, pure and exported:

```js
// returns null for non-wallet messages
classifyWalletEvent(body, { sender }) -> {
  kind: 'wallet_topup' | 'wallet_withdraw' | 'wallet_spend' | 'wallet_credit',
  provider: 'PhonePe' | 'Paytm' | 'Google Pay' | 'BHIM' | 'Amazon Pay' | ... | null,
  subType: 'UPI Lite' | ...,
  balanceBelongsTo: 'bank' | 'wallet' | 'unknown',
} | null
```

Rules:

1. Detect "UPI Lite" / "UPI-Lite" / "UPILite" / "Lite" near "top ?up|add(ed)?|load(ed)?|wallet|balance" (case-insensitive, tolerant of spacing/hyphens). Final patterns must come from real samples.
2. **Top-up** (bank debit + Lite wording) → `type: 'transfer'`, `kind: 'wallet_topup'`. `balanceBelongsTo: 'bank'`.
3. **Withdraw/refund to bank** (bank credit + Lite wording) → `type: 'transfer'`, `kind: 'wallet_withdraw'`.
4. **Spend from wallet** (wallet-app SMS or notification) → `type: 'expense'`, attached to the **wallet account**, not a bank.
5. **Do not** let `IGNORE_RE` swallow these. Check that `'offer'`, `'request received'` and similar words don't drop legitimate Lite messages. Add tests.
6. Fix `detectAccountType()` to return `'Wallet'` when the classifier hits or when the sender/body is a wallet product (Paytm Wallet, Amazon Pay balance, FASTag, Mobikwik wallet). Keep `Credit Card` precedence for card messages.
7. Fix the `BANKS` table: separate **banks** from **wallet/app providers**. `PAYTM` must distinguish *Paytm Payments Bank* from *Paytm Wallet/UPI Lite*. Use body keywords, not sender alone. Add a `WALLET_PROVIDERS` list.
8. Return the new fields from `parseTransactionText`: `walletEvent`, `accountType: 'Wallet'` where relevant, and `balanceBelongsTo`.
9. Extend `extractMerchant`: recognise "paid to X using UPI Lite".
10. `extractRefNo`: confirm UPI ref/RRN extraction works on Lite wording. Add cases.

## A3. Capture pipeline (`RealSmsReader`, `SmsSync`, `InstantSmsListener`, `GmailTracker`)

- `smsToTransaction()` must carry `walletEvent`, `transferKind`, `balanceBelongsTo`.
- **Top-up / withdraw → create a transfer, not an expense/income.**
  - Resolve the **source bank** from the SMS bank name + masked account digits (`XX1234`). Resolve the **wallet** from `provider` + `subType` against account `aliases`.
  - If the wallet account does not exist → create it (type `Wallet`, subType `UPI Lite`, balance 0) *and put the capture in the review queue* so the user can confirm the link. Never silently invent duplicates (`PhonePe` vs `PhonePe UPI Lite`).
  - If the bank account is ambiguous (two accounts of the same bank) → `reviewStatus: 'pending'` with a "pick the account" prompt. Never guess silently.
- **Balance application rules** in `applyCapturedToAccounts`:
  - If `balanceBelongsTo === 'bank'` → set only the **bank** balance from `extractedBalance`; apply the transfer delta to the wallet.
  - If `'wallet'` → set the wallet balance.
  - If `'unknown'` → apply plain deltas to both. Do **not** overwrite either balance.
  - The transfer must never change net worth (assert in tests).
- **Dedup** (`DeduplicationEngine`): `bucketKey` includes `type`. A top-up appears as an SMS `transfer`, a bank statement `expense` row, and possibly a wallet-app export. Add a **normalisation step**: a statement row whose narration/ref matches an existing wallet transfer (same amount, same day, compatible bank, same ref or "UPI LITE" text) must dedupe against it. Tests required.
- `rejectCapture` must also cover wallet transfers (re-scan must not resurrect them).
- All new captures go through the existing review queue (`reviewStatus: 'pending'`). Wallet transfers get a distinct row UI: "Top-up: HDFC ••1234 → PhonePe UPI Lite ₹500".

## A4. The "spends inside the wallet are invisible" problem

Most Lite payments produce no bank SMS, so the app must give the user practical ways to stay accurate. Implement in this order of priority.

**A4.1 Wallet balance reconciliation (most important, cheap, robust).**
Add a "Reconcile wallet" action on the wallet account (Wealth screen and Tools):

1. The user types the current balance shown in the UPI app.
2. The app computes `diff = trackedBalance − enteredBalance`.
3. If `diff > 0` → create an `expense` named "Unrecorded wallet spends" (category `General`, tag `Reconciled`, `source: 'wallet_reconcile'`, `reconciled: true`) for `diff`, on the wallet account, and set the balance to the entered value.
4. If `diff < 0` → create an `income`/"Wallet correction" (or a transfer if the user says it was a top-up not captured). Ask first via a confirmation dialog.
5. Show the diff and confirm before saving. Allow the user to attach a category.
6. Provide an optional reminder (weekly) to reconcile. Reuse `NotificationService`.
7. The action must be atomic (one `atomic()` transaction), idempotent on double-tap, and fully reversible via delete.

**A4.2 Wallet-app notification/SMS capture.** If the real samples show the UPI app sends an SMS for Lite payments, use it (A2/A3). Do not add a notification-listener permission without the user's explicit approval. It is a big privacy surface.

**A4.3 Import from the UPI app history/export.** Extend `ImportScreen` / `StatementParser` with a "Wallet" import that targets a chosen wallet account. Parse using real exports (PhonePe/Paytm/GPay). Rows are matched against existing items by ref number and deduped.

**A4.4 Quick-add.** One-tap "Wallet spend" entry pre-filled to the wallet account (reuse `ExpenseScreen` with the account preselected).

## A5. Statement and PDF import (`StatementParser`, `parseStatementRows`, `parsePdfText`)

- Bank statement rows with "UPI LITE" / "UPILITE" / "LITE TOPUP" narration → classify as transfer to the wallet, not expense (`guessType`/`guessCategory` currently give `UPI Transfer` + expense).
- If no wallet account exists → add to the import preview with a "Create wallet account?" prompt. Never auto-create silently.
- Also handle **aggregated** statement entries if the real statement shows them (a bank may settle Lite spends as a lump sum). Treat per sample. Do not assume.
- Credit-card statement lines paid via UPI Lite are impossible. Ensure none are mislabelled.

## A6. UI

- Wealth screen: wallets grouped under "Cash & wallets", showing subType and the linked bank, plus a **Reconcile** button.
- Add-account flow (`AddAssetScreen`): choose "Wallet → UPI Lite / Paytm Wallet / Amazon Pay / FASTag / Other", provider picker, optional linked bank.
- Transfer screen (`ToolsScreen`): "Top-up wallet" and "Withdraw to bank" shortcuts. Transfers already exclude reports.
- Review queue: wallet transfer row type, with a "Pick bank" action when ambiguous.
- History: filter by account must handle wallets; transfers appear with an arrow icon and are excluded from expense totals (`isReportable` already does this; add regression tests).
- Settings: optional "Wallet reconcile reminder" toggle.

## A7. Edge cases that must be handled and tested

1. Top-up SMS arrives **before** the wallet account exists.
2. Top-up SMS arrives twice (listener + inbox scan) → one transfer.
3. Top-up SMS + bank statement import for the same top-up → one transfer.
4. Two bank accounts with the same bank → no silent guess.
5. Same-amount top-ups on the same day (₹500 twice) → two transfers (distinct refs/times). Statement import with two identical rows must not collapse them (occurrence counting).
6. Wallet withdraw/refund after merchant refund to Lite (credit with a merchant name, not a bank transfer).
7. Failed/pending/reversed top-ups ("failed", "reversed", "will be credited") → ignored or pending, never applied.
8. Reversal of a top-up: debit then credit-back for the same ref → net zero.
9. Wallet balance would go negative → allow, but flag it in the review queue (reconcile prompt). Never throw.
10. Auto top-up (if the user enabled it): many small top-ups, all transfers.
11. Deleting or editing a wallet transfer reverses both legs (`reverseOnAccounts`). Editing = delete + recreate (existing behaviour).
12. Backup → factory reset → restore: wallet accounts, `aliases`, transfers all intact. Merge-restore must not double-apply (`balanceMode: 'none'`).
13. Net worth identical before and after a top-up (assert).
14. Monthly budget and analytics ignore transfers and wallet top-ups, but include wallet **spends**.
15. Other wallets (Paytm Wallet, Amazon Pay, Mobikwik, FASTag) go through the same path.
16. RuPay credit card on UPI: spends are credit-card expenses, not wallet. Make sure the classifier does not mislabel them.
17. Non-English or Hinglish SMS (if the user has any). Handle per samples.

---

# PART B — Known issues and hardening found in review

| ID | Item | Action |
|---|---|---|
| B1 | **Gmail** needs a Google client ID and custom-scheme redirect that Google restricts. | Decision needed from the owner. Default plan: **feature-flag Gmail off** (hide Settings entries, keep code behind `ENABLE_GMAIL=false`) and rely on SMS + statements. Don't delete code unless told. Tests must still pass. |
| B2 | **Backup location.** `SettingsScreen.backupData` writes to `documentDirectory`. | Verify it is shared via the share sheet (`expo-sharing`) so the file lands outside the app sandbox. If not, add it. Add a "last backup date" on Home and a warning if > 30 days. |
| B3 | **Yahoo Finance** unofficial endpoint (`InvestmentApi.fetchStockPrice`). | Add graceful failure (show the last cached price with age), manual price override, and a visible "price may be stale" label. |
| B4 | **Dense, minified-style files** (`AppLock.js`, `FeatureService.js`, `Database.js`, `Bootstrap` in `App.js`). | Run a formatter (Prettier) as a *separate commit with no logic change*. Tests must pass before and after. Add `.prettierrc`. |
| B5 | **Duplicated bootstrap** in `App.js` (`Bootstrap` and `AppContent` both call `getDatabase()` and set `ready`). | Consolidate to one path. Test that migration errors still show the retry screen. |
| B6 | **`SmsSync.run`** has a non-`AsyncStorage` branch that bypasses `saveWithDedup`. | Make it use one code path (dependency-inject the repo instead). Keep tests green. |
| B7 | **Account auto-creation** in `applyCapturedToAccounts` creates a `Bank Account` for any unknown name. | Route through the review queue; avoid junk accounts (e.g. a merchant name). Add a guard list and tests. |
| B8 | **`Math.random()` in IDs** for statement rows (`stmt_…`, `pdf_…`). | Use deterministic IDs (hash of date+amount+ref+narration+occurrence index) so re-imports dedupe deterministically. |
| B9 | **Screens untested.** | Add React Native Testing Library smoke tests for the main screens (render without crash with empty data and with fixture data). |
| B10 | **Privacy.** App lock does not encrypt SQLite. | Document it in README. Optional later: SQLCipher is out of scope for now. |
| B11 | Notification permission denied path, SMS permission revoked mid-use. | Verify a graceful UI message, no crash, no marker advance (`LAST_SYNC_KEY`). |
| B12 | **Time zones / DST** in `dayKey` and recurring engine. | Add tests with `TZ=Asia/Kolkata` and `TZ=UTC` in CI. |

---

# PART C — Complete testing plan

## C0. Test layout and commands

```
__fixtures__/
  sms/            *.json    one file per bank/app: [{ id, sender, date, body, expected }]
  statements/     *.csv, *.xlsx (tiny synthetic or redacted)   + expected/*.json
  pdf/            *.txt     extracted-text of PDFs (what PDF.js outputs, one row per line)
__tests__/
  parser/         TransactionParser.sms.test.js, .wallet.test.js, .statement.test.js, .pdf.test.js
  balance/        BalanceService.wallet.test.js, invariants.test.js
  dedup/          DeduplicationEngine.wallet.test.js, crosssource.test.js
  pipeline/       SmsSync.wallet.test.js, ReconcileWallet.test.js, ReviewQueue.wallet.test.js
  backup/         Backup.wallet.test.js
  ui/             screens.smoke.test.js (RNTL)
```

Commands:

```bash
npm test -- --runInBand
npm test -- --coverage --runInBand
TZ=Asia/Kolkata npm test -- --runInBand
TZ=UTC npm test -- --runInBand
npm run lint
```

Coverage targets: **≥ 90% lines** for `TransactionParser`, `BalanceService`, `DeduplicationEngine`, `SmsSync`, `FeatureService`, `BackupService`; **≥ 80%** overall for `utils/` and `data/`. Add coverage thresholds in `package.json` `jest.coverageThreshold` and enforce in `.github/workflows/check.yml`.

## C1. Fixture-driven parser tests (needs the user's real samples)

Every fixture entry looks like:

```json
{
  "id": "hdfc-upilite-topup-01",
  "sender": "AX-HDFCBK",
  "date": "2026-10-12T10:15:00+05:30",
  "body": "<REDACTED real SMS text>",
  "expected": {
    "parsed": true,
    "amount": 500,
    "type": "transfer",
    "kind": "wallet_topup",
    "bank": "HDFC Bank",
    "accountDigits": "1234",
    "balance": 12345.67,
    "balanceBelongsTo": "bank",
    "refNo": "123456789012"
  }
}
```

A single data-driven test iterates all fixtures and asserts each `expected` field. Adding a new SMS to the suite = adding a JSON entry only.

**Fixture categories required (the more real samples, the better):**

1. Bank debit / credit SMS: every bank you use (SBI, HDFC, ICICI, etc.).
2. UPI pay / receive SMS for the same banks.
3. **UPI Lite top-up** SMS for each bank you top up from.
4. **UPI Lite withdraw / refund** SMS (if you have any).
5. Wallet-app SMS (PhonePe/Paytm/etc.) and any UPI Lite payment notification text.
6. Credit-card spend, refund, payment-received, bill/due/reminder SMS (the last must be ignored).
7. ATM, EMI, NACH/mandate, salary, interest, FD maturity, SIP.
8. Negative cases: OTP, promo, "failed", "will be debited", balance-only alerts, personal chats.

## C2. Statement and PDF tests

- CSV/XLSX: one fixture per bank layout (header variations, Dr/Cr column vs separate debit/credit vs amount+type, date formats `DD/MM/YY`, `DD-Mon-YYYY`, Excel serials).
- PDF text: fixtures of the text lines that PDF.js produces from each bank's statement and each credit-card statement (multi-line narrations, page headers/footers repeated, opening balance row, totals rows that must **not** import).
- Assertions: row count, sum of debits and credits equal the statement's printed totals, direction correctness via the running-balance rule, UPI Lite/top-up rows classified as transfers, deterministic IDs (B8).
- **Re-import test:** import the same file twice → 0 added the second time. Import overlapping date ranges → only new rows added.
- **Conservation test:** for each statement fixture, `opening + Σcredits − Σdebits == closing`.

## C3. Balance and invariant tests (property-style)

Use `fast-check` (add as a dev dependency) or a seeded random generator:

1. **Net-worth conservation:** for any sequence of transfers (bank↔wallet, bank↔card), `computeNetWorth` is unchanged.
2. **Apply then reverse = identity** for every transaction type, including wallet transfers.
3. **Edit = reverse + apply** equals recomputing from scratch.
4. **Order independence** for captured batches: `applyCapturedToAccounts` sorted oldest→newest gives the same result regardless of input order.
5. **Idempotency:** syncing the same SMS list N times yields the same state as syncing once.
6. **Recompute check:** a helper `recomputeBalances(openingBalances, allTransactions)` must equal stored balances when all transactions have `balanceMode` applied. Use it as a debug "audit balances" tool in Settings too.
7. Credit-card sign convention (debt positive) holds across transfers (card payment reduces debt).

## C4. Dedup tests

Matrix: `{SMS, Gmail, statement, PDF, manual, recurring, wallet export} × {same ref, no ref, same amount different ref, same amount same day twice}`. Include the wallet top-up SMS ↔ bank statement case (A3), plus occurrence-counting cases.

## C5. Pipeline / integration tests (real SQLite adapter already used in `TransactionRepo.test.js`)

- `SmsSync` with injected `scan`: capture top-up, spend, withdraw, duplicate delivery, permission loss, scan failure (marker not advanced), 90-day lookback clamp.
- Review queue: confirm / edit / undo for wallet transfers; undo keeps rejected marker; ambiguous bank → prompt state.
- `ReconcileWallet`: diff positive/negative/zero, double-tap idempotency, atomic rollback if the write fails midway, undo.
- Concurrent writes: SMS sync and a manual add at the same time → no lost update (existing concurrency test pattern).
- Backup/restore: standard + encrypted + merge restore with wallet accounts and transfers; tampered file fails; wrong passphrase fails; schema from the previous app version restores.
- Migration: AsyncStorage → SQLite with wallet-free legacy data still works.

## C6. UI smoke tests (React Native Testing Library)

Add `@testing-library/react-native`. For each screen: renders with empty data, renders with fixture data, no uncaught errors, key buttons exist (Reconcile, Top-up, Withdraw). Snapshot tests are optional. Prefer behavioural assertions.

## C7. Device and emulator test script (manual; record results in `docs/device-test-results.md`)

Use an Android emulator for SMS injection:

```bash
adb emu sms send AX-HDFCBK "<paste fixture body>"
```

Also use a real phone for the final pass (emulator is not enough for biometrics/notifications/background).

| # | Scenario | Expected |
|---|---|---|
| D1 | Fresh install, onboarding, grant SMS + notification | No crash; permission rationale shown |
| D2 | Migrate a **copy** of real data | Counts and balances equal pre-migration; backup retained |
| D3 | Inject top-up SMS with app open | One transfer in the review queue; bank −X, wallet +X; net worth unchanged; not in expenses |
| D4 | Inject same SMS again / force re-scan | Still one |
| D5 | Inject with app **closed**, then open | Appears once after catch-up |
| D6 | Reconcile wallet with a lower balance | One "Unrecorded wallet spends" expense; wallet balance matches the app |
| D7 | Import real bank statement containing a top-up | Top-up deduped against the SMS transfer; no extra expense |
| D8 | Re-import the same statement | 0 added |
| D9 | Import real credit-card PDF **in airplane mode** | Rows parsed; totals match statement |
| D10 | Delete a wallet transfer | Both balances restored |
| D11 | Backup → uninstall → reinstall → restore | Everything identical, including wallets |
| D12 | Encrypted backup with wrong passphrase | Clear error, no data change |
| D13 | Revoke SMS permission, reopen | Graceful message; no crash; sync marker unchanged |
| D14 | Biometric lock: cancel, fail, background/foreground, cold start | Locked until success; privacy screen in app switcher |
| D15 | Budget alerts at 80% and 100% from SMS-captured spend | Notification once per threshold |
| D16 | Dark mode on every screen | Text readable; no white-on-white |
| D17 | Card reminder notification | Arrives (may be delayed); fires for each month |
| D18 | Phone reboot, then receive SMS | Capture still works (boot receiver) |
| D19 | Battery saver / app killed | Catch-up on next open recovers everything |
| D20 | Stock/MF price refresh offline | Cached price + stale label, no crash |

## C8. CI

Update `.github/workflows/check.yml`: Node 24.12, `npm ci`, lint, tests with coverage threshold, run once with `TZ=Asia/Kolkata` and once with `TZ=UTC`. Add an `expo-doctor` step. Optionally add an EAS preview build trigger on tags.

---

# PART D — Definition of done

- [ ] All tests pass (existing 177 + new), lint clean, coverage thresholds met in both time zones.
- [ ] Every real fixture the owner provided is in `__fixtures__/` and has an `expected` block.
- [ ] A UPI Lite top-up, withdraw, spend (via reconcile) and re-import produce correct balances, **zero net-worth change on transfers**, and correct report totals.
- [ ] No auto-created junk accounts; ambiguous cases go to the review queue.
- [ ] Gmail feature-flagged off (or configured, per owner decision).
- [ ] Backup is shareable outside the sandbox; backup/restore round-trips wallets.
- [ ] `docs/phase11-notes.md` written: changes, new tests, **and an explicit list of device checks still pending**. Do not claim device verification that did not happen.
- [ ] `README.md` updated: wallet/UPI Lite behaviour, known limitation that Lite spends are only visible through reconcile/import/notification, and new test commands.

## Suggested task order

1. Baseline run + commit hooks (Prettier commit, B4)
2. Fixture harness (C0/C1) with existing SMS cases migrated into JSON
3. A1 → A2 (parser) → A3 (pipeline and dedup) with tests
4. A4.1 reconcile + A6 UI
5. A5 statement/PDF wallet rows
6. A4.3 wallet import (needs real export samples)
7. Part B items B5–B8, B11–B12
8. C3 property tests, C6 UI smoke tests
9. CI, docs, device test script
