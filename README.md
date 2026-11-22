# WealthManager — source phases 7–12

Phase 12 (bug fixes, redesign, files on transactions, tags, investments) follows docs/PHASE12_PLAN.md; see "Phase 12" below. Phase 11 (wallets / UPI Lite and hardening) is summarised in docs/phase11-notes.md. Device checks for both phases are still pending: see docs/device-test-results.md.

Use WealthManager_phase10.zip for the cumulative latest project. Earlier archives are independent cumulative checkpoints, not patches. No node_modules, generated Android/iOS directories, credentials, database files or scratch tooling are included.

## Run and build

1. Back up your existing app data before installing a SQLite build. Preserve the backup outside the app.
2. Extract the project, use Node 24.12 or later, and run `npm ci`.
3. Run `npm test -- --runInBand` and `npm run lint`. Also available: `npm run test:tz` (IST and UTC), `npm run test:coverage` (fails below the thresholds in package.json) and `npm run format:check`.
4. Build a native development app with `npm run android`, or use the existing EAS preview profile to create an APK (`eas build --platform android --profile preview`). An Android SDK/JDK or an authenticated EAS account is required. Expo Go cannot run the old native SMS modules.
5. Choose manual entry or SMS tracking during onboarding. Tabs are Home · Accounts · Budget · Goals · Settings. New transfer and category rules are in Settings, bulk edit in the Transactions export menu, goal contributions under a goal's "Add money", and calculators on Accounts. Settings → Backup & restore holds plain and encrypted backups.

Gmail is switched off by default (`EXPO_PUBLIC_ENABLE_GMAIL=false`); the owner relies on SMS and statements. It also remains unconfigured because no OAuth client was supplied. See docs/phase7-notes.md before entering an EXPO_PUBLIC_GOOGLE_CLIENT_ID. A Web client secret must never be bundled in the app; Google's Android custom-scheme restrictions must be resolved for the configured client before this PKCE implementation can be used.

## Wallets and UPI Lite

- Add a wallet in Wealth → Add account → Wallet (UPI Lite, Paytm Wallet, Amazon Pay, FASTag or Other), with its app and the bank that funds it. A top-up SMS also creates a UPI Lite wallet linked to the paying bank if none exists.
- Top-ups and withdrawals are transfers: the bank goes down, the wallet goes up, net worth is unchanged and they never count as spending. History marks them with a swap icon and the route.
- Captures that don't match exactly one account wait in Review accounts (Home shows a card) (pick an account, create the suggested one, or pick a wallet). Bank and card accounts are never created automatically, and unresolved captures don't move balances.
- **Known limitation:** most UPI Lite payments send no SMS, so spending inside the wallet is visible only through **Reconcile** (type the balance your UPI app shows; the gap becomes one "Unrecorded wallet spends" expense after you confirm), a statement import, or the "Below zero - reconcile" flag. An optional weekly reminder is in Settings.
- Statement and PDF imports treat "UPI LITE" rows as transfers and ask before creating a wallet. Re-importing the same file adds nothing.
- Only the Axis UPI Lite top-up wording comes from a real SMS; other wallet wordings are unverified (see docs/phase11-notes.md).

## Phase 12

- **Redesign.** Design tokens in `components/tokens.js` (light and dark, contrast checked in tests), shared components in `components/ui/`, Inter and Space Grotesk fonts. Dark mode is opt-in from Settings. Screens outside the redesign (Expense, Income, Import, Analytics, Recurring, Savings and others) still use the old colours through `shade()`.
- **Files on transactions.** Transaction detail → Bills & files: Camera, Gallery or Any file; up to 10 files of 25 MB each, kept under the app's `attachments/<txId>/` folder and opened through Share. Home → Scan bill opens the camera and attaches the photo to a new expense. Deleting a transaction deletes its files. Backups include files by default (base64); above 50 MB the app asks and offers a backup without files.
- **Tags.** Lowercase slugs (`#Tax 2026` → `tax-2026`). Capture markers (`auto-sms`, `auto-sync`, `ai`, `imported`, `recurring`, `auto`) are hidden on rows but searchable. Search `#tag` in Transactions; several tags must all match. Old `Auto-SMS` / `Auto-Sync` tags are converted once at startup.
- **Investments.** Net worth counts only accounts added on Accounts; nothing is created from SMS. Mutual funds use the NAV and stocks/gold the live price on refresh. PF, FD and RD add interest (FD quarterly by default, monthly or simple; RD instalments compound quarterly); FD/RD stop at maturity and remind 7 days before. A bank debit to Groww, Zerodha, Kuvera and similar platforms becomes a transfer into the investment when exactly one investment has that platform; otherwise Transaction detail offers "Link to an investment". A mutual fund's units are not changed by a SIP, so update the units after an allotment or its value drops back on the next NAV refresh.

## Data and recovery

The first run migrates AsyncStorage to SQLite in a transaction and checks the row count. It retains user_transactions_backup and a complete sqlite_migration_backup in the original storage. Corrupt rows or duplicate IDs abort migration with a retry screen; original data remains available for recovery. Legacy imports do not record whether their balances were adjusted, so verify balances after migration.

Standard backups and authenticated encrypted backups include transactions, accounts/assets, goals, contribution history, recurring entries, monthly budgets, category rules, rejected capture markers and net-worth history. Tokens, biometric preferences and price caches are excluded. Encrypted backups require the original passphrase. Merge adds missing data while preserving current account balances and settings. Imported merged rows do not move balances. Replace writes all present fields atomically.

The app lock protects the app UI, including when the app returns from the background. It does not encrypt the SQLite database; Android device storage protection applies. Biometric enrollment must remain available to unlock.

## AI assistant (optional)

Providers, tried in order with automatic fallback when one fails or hits its rate limit:

1. **Google Gemini Flash** — free key from https://aistudio.google.com/apikey
2. **Groq** — free tier, key from https://console.groq.com/keys
3. **xAI Grok** — paid, key from https://console.x.ai (only used if a key is saved)

Keys are typed into Settings → AI assistant and stored with expo-secure-store; they are never put in `.env` (any `EXPO_PUBLIC_` value is bundled into the APK in plain text). `.env` only holds `EXPO_PUBLIC_ENABLE_AI` and `EXPO_PUBLIC_AI_PROVIDER_ORDER`. Models are picked automatically from each provider's model list (a model name typed in Settings overrides it); "Test" shows the model in use.

What AI does: reads bank SMS the parser missed (max 16 new per sync, each SMS sent once; rows land in Review as pending), categorizes new "General" rows, reads statements the parsers can't (preview before saving), and answers spending questions on the AI Assistant screen. An AI amount is accepted only if that number is written in the source text; reference numbers, last-4 digits and balances are always extracted on the phone.

## Privacy

- All data stays on this phone in an SQLite database. Nothing is uploaded; the only network calls are price lookups (MF NAV / Yahoo) that send the scheme code or ticker, and — only if you switch AI on — the AI requests described below.
- The database is **not encrypted** by the app. Anyone who can unlock and read the phone's app storage (root, adb backup on debuggable builds) can read it. The app lock hides the UI only.
- A plain backup is readable JSON. Use the encrypted backup for anything you store in cloud drives or send through chat apps.
- SMS bodies are parsed on the device; the app stores only the extracted fields plus the sender and an SMS id for de-duplication. Logs avoid full SMS bodies, account numbers and balances.
- Gmail import is off by default (`EXPO_PUBLIC_ENABLE_GMAIL`).
- AI is off until you turn on **Settings → AI assistant** and save a key. It then sends: bank SMS the regex parser could not read (9+ digit numbers masked), titles of transactions still in "General", statement text when the built-in parsers find no rows (you confirm the preview), and monthly totals for AI Assistant questions. Free providers' terms may allow them to use free-tier requests to improve their products.
- Uninstalling the app deletes everything not exported: back up regularly (Home warns after 30 days).

PDF parsing embeds PDF.js and its worker locally (Apache-2.0 license in assets/pdfjs-LICENSE.txt). It needs an up-to-date Android System WebView and a text-based PDF. Scanned/password-protected documents may need conversion or unlocking first. To refresh the vendored parser after updating pdfjs-dist, run `npm run vendor:pdf` and re-test offline extraction.

## Verification and remaining device checks

Phase 12 adds tests for tags (property tests included), attachments with a fake file system, FD/RD maths, SIP linking, backup round trips with files, the redesigned screens and accessibility labels; the new pure modules must keep 90% coverage. Phase 11 adds fixture tests with the owner's real SMS, wallet/transfer pipeline tests on SQLite, property tests (fast-check), screen smoke tests (React Native Testing Library) and coverage thresholds; CI runs them in IST and UTC. Earlier automated checks cover parser/dedup, recurrence, balances, real SQLite SQL through a test adapter, migration backup/counts, concurrent writes, rollback, transfer accounting, budget rollover, encryption/tampering, category/review/bulk actions, goals, merge restore, and mocked OAuth code/refresh/401/revocation paths. See docs/jest-phase10.txt and docs/eslint-after-phase10.txt. Android native-project generation and Android JavaScript bundle export were checked; this does not establish that an APK builds or launches. The export disables Hermes bytecode because the sandboxed Windows compiler could not write its temporary output.

Before using real data, verify on Android:

- Migrate a copy of real data, compare counts and balances, add/edit/delete a transaction and restore a backup.
- Receive an SMS with the app closed, open it, confirm it appears once; disable tracking; undo a capture and re-scan.
- Confirm a transfer changes both accounts, including a credit-card payment; verify reports exclude it.
- Import SBI/HDFC statements and a text PDF in airplane mode; check duplicate re-imports.
- Confirm category rules, bulk edits/deletes, CSV/Excel sharing, goals and contribution history.
- Confirm month/year budgets, rollover and 80%/100% alerts from manual, imported and captured expenses.
- Test biometric cancel/failure, background privacy, cold-start lock and dark-theme contrast.
- Configure Gmail and verify callback, HTML mail, pagination, refresh after an hour and SMS/Gmail dedup.
- Verify card reminders. They are scheduled for twelve months, clamp short months, and can be delayed by Android's inexact-alarm scheduling. Renew after a year.
- Check investment refresh, stock/gold units and net-worth snapshots. Loan and XIRR tools provide simulations; multiple sign changes may have multiple XIRR roots.

## Upgrade plan

Remain on Expo SDK 54 while using the two existing SMS bridge libraries. SDK 54 is the last Expo SDK that supports disabling the New Architecture. Evaluate replacing inbox reads with an Expo native module around Android ContentResolver and paged queries, and real-time capture with an Expo native event/receiver module. OTP-only SMS Retriever alternatives do not replace bank-inbox scanning. Validate process death, permission denial, timestamp IDs, duplicate delivery and background scheduling before upgrading. Then test all other native modules, regenerate projects and run a signed-device migration test before moving SDKs.

References: https://docs.expo.dev/guides/new-architecture/ and https://developers.google.com/identity/protocols/oauth2/native-app
