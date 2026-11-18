# Phase 11 notes: wallets / UPI Lite and hardening

Written 2026-11-18. Plan: `docs/CLAUDE_CODE_PLAN.md`. Owner samples: `docs/user_sms_fixtures.json`.

**Status in one line:** all automated checks pass (40 suites / 477 tests, lint, Prettier, coverage thresholds, in both `TZ=Asia/Kolkata` and `TZ=UTC`). **No device check (D1–D20) has been run.** Nothing below is verified on a phone or emulator.

## Owner decisions that shaped the work

- Axis Bank, SBI Card and Equitas are the owner's accounts. Equitas was added as a bank.
- IMPS payments to "baja…" are Bajaj Finance loan payments (principal by IMPS, interest auto-debited): category **Loan/EMI**, not a self-transfer.
- Gmail is not needed: feature-flagged off (`EXPO_PUBLIC_ENABLE_GMAIL`, default `false`). Code kept, not developed further.
- The owner must add two category rules in the app (Tools → Category rules), because rules live in user data, not code: `bangalorepalace` → Food and `baja` → Loan/EMI. Tests apply the same rules from `__fixtures__/category_rules.owner.json`.

## What changed

### Part A: wallets and UPI Lite

| ID | Change | Where |
|---|---|---|
| A1 | Wallet accounts: `type: 'Wallet'`, `subType` (UPI Lite / Paytm Wallet / Amazon Pay / FASTag / Other Wallet), `provider`, `linkedBankId`, `aliases`. Backups round-trip them. | `utils/BalanceService.js`, `utils/WalletAccounts.js` |
| A2 | Parser: wallet event classifier (top-up, withdraw, spend, refund; failed/pending ignored), wallet providers, Equitas, last4, available limit, channel, card-payment detection, `ownAccountText` so the payee's bank isn't mistaken for the owner's. | `utils/TransactionParser.js` |
| A3 | Captures resolve to an account **before** saving: matched, or sent to the review queue (pick account / create suggested account / pick wallet). Wallets are created on the first top-up and linked to the paying bank. A card-bill payment seen from the card issuer and the paying bank merges into one transfer. Dedup works per transfer leg across SMS and statements. | `utils/AccountResolver.js`, `utils/TransferPairing.js`, `utils/DeduplicationEngine.js`, `data/TransactionRepo.js` |
| A4.1 | Reconcile a wallet against the balance the UPI app shows: lower → one "Unrecorded wallet spends" expense; higher → "Wallet correction" income or an uncaptured top-up from the linked bank. Confirmed first; atomic; a double tap saves once; deleting it restores the balance. Optional weekly reminder. | `utils/WalletReconcile.js`, `utils/FeatureService.js`, `utils/NotificationService.js` |
| A4.4 | "Add spend" on a wallet opens Expense with the wallet selected. | `screens/WealthScreen.js` |
| A5 | Statement/PDF rows with UPI Lite narration import as transfers (debit = top-up, credit = withdrawal). If no wallet exists, the import asks before creating one. | `utils/TransactionParser.js`, `screens/ImportScreen.js` |
| A6 | Wealth: "Bank accounts" and "Cash & wallets" groups; wallet rows show provider and funding bank, Reconcile, Add spend, and "Below zero - reconcile". Add account: wallet type / provider / funding bank. Tools: review rows explain each capture; Top-up / Withdraw shortcuts. History: transfers show a swap icon and route, marked "not counted in spending". Settings: weekly reconcile reminder. | screens listed |

### Part B: hardening

| ID | Result |
|---|---|
| B1 | Gmail flagged off; Settings and onboarding no longer mention it. |
| B2 | Backup warns if the share sheet is unavailable; records the date; Home warns when there is no backup or it is over 30 days old. |
| B3 | Price fetch failure returns the last cached price marked stale with its age; manual value pauses live updates ("Resume live price" to undo). |
| B4 | Prettier applied in a separate no-logic commit (`bfa276e`), ignored in `git blame`. |
| B5 | One startup gate (`components/Bootstrap.js`); migration errors still show Retry. |
| B6 | `SmsSync` saves through one injected path. |
| B7 | No automatic creation of bank or card accounts; unknown or ambiguous captures go to review and move no balance until resolved. |
| B8 | Statement/PDF row IDs are deterministic (hash of account, date, amount, ref, narration + occurrence index). |
| B9 | Screen smoke tests added (see C6). |
| B10 | README "Privacy" section: SQLite is not encrypted; the app lock hides the UI only. |
| B11 | Home banner when SMS access is revoked while tracking is on, or notifications are blocked; a blocked notification never stops a capture. The existing "failed scan does not advance the sync marker" test still passes. |
| B12 | `npm run test:tz`; CI runs both time zones. |

## Tests added

Baseline before Phase 11: 177 tests. Now: 477 tests in 40 suites.

- **C1 fixtures:** `__tests__/parser/TransactionParser.sms.test.js` loads `__fixtures__/sms/*.json` and checks every expected field. All 13 owner samples pass every field; `KNOWN_FAILING` is empty.
- **Parser units:** extract, wallet and statement tests under `__tests__/parser/`.
- **Balances / pipeline / dedup:** `__tests__/balance`, `__tests__/pipeline` (capture → account resolution → pairing → balances on real SQLite; reconcile), `__tests__/dedup`, `__tests__/backup`.
- **C3 property tests:** `__tests__/property/Money.property.test.js`, fixed seed, covering apply/reverse identity, net worth unchanged by transfers, two-decimal balances, reconcile maths, idempotent re-import, ID determinism, parser never throws.
- **C6 screens:** `__tests__/screens/Smoke.test.js`, covering Wealth (incl. the reconcile flow end to end), Add account, Tools, Home, Import and History.
- **A7 edge cases** with a named test: 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16. **Not covered:** 10 (auto top-up: covered only in effect, by many-top-up tests) and 17 (Hinglish SMS: no samples).

Commands: `npm test`, `npm run test:tz`, `npm run test:coverage`, `npm run lint`, `npm run format:check`.

## Known limitations

- **Only one wallet wording is from a real SMS:** the Axis "UPI LITE … successful top-up". Withdraw, spend, refund and failure wordings, the bank-side card-payment hint (`CARD_PAYMENT_HINT_RE`) and statement "UPI LITE" narration are all marked `UNVERIFIED-SAMPLE` and may not match real messages.
- **UPI Lite spends are mostly invisible.** Most Lite payments send no bank SMS. They show up only through reconcile, a statement import, or the wallet going below zero. Wallet-app history import (A4.3) and notification capture (A4.2) were not built: no real exports were provided, and a notification listener needs explicit owner approval.
- **Old rows are not reclassified.** Transactions stored before Phase 11 (for example a card payment saved as ₹5,770 income) keep their old type until edited.
- **Bank-side Lite settlement** in statements is not handled until a real statement shows how the bank reports it.
- **Not supplied:** real sender IDs, bank-side card-payment SMS, UPI Lite withdraw/payment SMS, real statement layouts.
- **Fixture privacy:** `__fixtures__/sms/owner_real_samples.json` contains third-party names, a VPA and reference numbers. Replace them before pushing the repo anywhere public.

## Dependency findings for the owner (not changed)

`npx expo-doctor` fails 4 checks, all present before Phase 11. CI reports them without blocking.

1. `expo-font` is not a direct dependency (required by `@expo/vector-icons`) and two copies are installed. Expo warns the app may crash outside Expo Go. Suggested fix: `npx expo install expo-font`.
2. `expo` 54.0.34 → ~54.0.37 and `expo-file-system` 19.0.22 → ~19.0.24 (patch releases within SDK 54).
3. `react-native-android-sms-listener` is unmaintained and untested on the New Architecture.
4. `react-native-get-sms-android` has no directory metadata.

Test-only dev dependencies added: `fast-check` 3.23.2, `@testing-library/react-native` 13.2.0, `react-test-renderer` 19.1.0.

## Device checks still pending

**None of D1–D20 has been run.** Record results in `docs/device-test-results.md`. The ones Phase 11 most needs:

- D3–D5: top-up SMS with the app open, repeated, and with the app closed.
- D6: reconcile.
- D7, D8: statement import with a top-up, then re-import.
- D10: delete a wallet transfer.
- D11: backup → reinstall → restore with wallets.
- D13: revoke SMS permission.
- D20: offline price refresh.

The new screens (wallet groups, reconcile dialog, review rows, import wallet prompt, banners) are tested only in Jest renders, never on a device.
