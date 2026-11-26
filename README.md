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

## Credit cards and liabilities

- **Card setup.** Accounts → a card → Set up: credit limit, statement day and the due rule (N days after the statement, or a fixed day). With the limit, every spend SMS that shows the available limit gives what you owe: limit − available, then the spends and payments after that SMS. Without it the app falls back to the last bill, then to an estimate added up from SMS (marked as an estimate). A card created from SMS that nobody has set up is **not counted** in net worth; the net-worth card says which. Setup shows the new figure next to the stored one and changes the stored balance only when you press Save.
- **Card detail.** What you owe (billed, this cycle, other), the current bill with Record payment (opens a transfer with the amount left) and a reminder 3 days before the due date (only while something is unpaid), this cycle's spends and card EMIs, and the latest transactions with "this cycle" / "on bill of …". Axis and SBI statement SMS fill in the bill (total, minimum, due date) by themselves; "Add this month's bill" covers other banks. Statement SMS and lender "EMI Received" receipts are never saved as income.
- **Liabilities.** Accounts lists Credit cards and Loans & EMIs. The total is what the cards owe plus what the loans still owe. An overpaid card counts as an asset (shown under Cash & bank). Closed loans are hidden behind "Show closed".
- **Card EMIs are never counted twice.** "EMI on credit card" entries (Add loan or EMI, or "Track as EMI" on a card purchase of ₹1,000+) only track months left. The bank already billed the full amount on the card, so the entry is not added to Liabilities or net worth.
- **Loans.** Add loan or EMI works out the EMI (reducing balance; 0 % = no-cost) and you can type the lender's figure. EMIs count by their dates (first EMI + k months). Loan detail shows the principal still owed, what was paid this financial year (principal and interest, CSV export with figures only), the payments, the next EMI and Part-prepay (reduce EMI or end sooner).
- **Linking payments.** Transaction detail → Link to loan (bank debits), or Loan detail → + Link a payment. Choose EMI, Prepayment, Fee / penalty, Foreclosure or Loan received; the principal and interest must add up to the amount. EMIs with no linked payment are assumed paid from the schedule and flagged. Loan received becomes a transfer, never income. "Count in budget as: Interest only" leaves the principal out of spending; net worth is the same either way.
- **Bank EMIs from SMS.** Two or more ACH/NACH debits from one payee on about the same day of the month appear in Review → Check. Link them to a new or existing loan (different amounts are offered separately; "Not a loan" stops the suggestion). Later debits from that payee and amount link themselves as the next EMI. If none arrives by the debit day + 2, you get one reminder that month.

**Parsers built on unverified SMS wording (`UNVERIFIED-SAMPLE`).** They are best guesses until a real message is added to `__fixtures__/sms/owner_real_samples.json`:

| Where | What is guessed | What is missing |
|---|---|---|
| `utils/TransactionParser.js` `extractChannel` | ECS and standing-instruction ("SI-") debits | A real ECS or SI loan debit SMS (D0.4). ACH-DR is verified (Axis, Bajaj Finance). |
| `utils/CardStatementSms.js` | A "Cr." (credit) total on the Axis statement; other banks' statement wording | A statement SMS with a credit balance, and statements from other banks. The Axis and SBI wordings are verified (owner, Nov 2026). |
| C0 EMI-conversion credit | Not built yet | An EMI-conversion SMS, ideally one saying the amount was credited or reversed (D0.3). Until then, a conversion credit may lower what the card shows as owed until the next spend SMS brings a new available limit. |
| `utils/TransferPairing.js` | Words a bank debit for a card bill carries | The owner's bank-side SMS for a card bill payment. |
| `utils/TransactionParser.js` wallet rules | Paytm Wallet, Amazon Pay, FASTag, MobiKwik names; FASTag "recharge"; wallet → bank returns | Real SMS from those wallets (only the Axis UPI Lite top-up is real). |

## Organising transactions

- **Apply to similar.** Change a transaction's payee name, category or tags and save: if the same payee has other transactions, a sheet offers to copy the changes ("Apply to N more from this payee?"). Untick a change or a transaction to leave it out. "Also for future SMS" saves a payee rule. "Updated N transactions · Undo" lasts 10 seconds, and the last bulk change can be undone for 10 minutes. A category or name you set by hand on another transaction is kept; loan payments and transfers are skipped.
- **Same payee** means the same UPI ID, or the same name after dropping case, punctuation, "Pvt Ltd" and similar words and reference numbers. There is no fuzzy matching: "SWIGGY INST" and "Swiggy Instamart" are different payees until you rename one.
- **Payee rules** (Settings → Categories → Payee rules) rename, categorise and tag new SMS, Gmail, statement-import and recurring transactions from a payee. They never change a category or name you set by hand, and never remove a tag you added. Each rule shows how often it was used. Add a rule from a recent payee or "contains text"; ⋯ → "Apply to past transactions now" runs the same sheet for past rows.
- **Transactions list.** The Filter button opens Sort & filter: date (this month, last month, last 3 months, this FY from 1 April, custom), type, accounts, categories, amount range and "Show only" (needs review, has file, has tags, not in reports, loan payments, added by hand, from SMS). Active filters show as removable chips. The summary line shows the count and what was spent (the same rules as Budget: transfers and rows left out of reports don't count). The sort is remembered. Filters reset when the app starts fresh; if Android closes the app in the background, the list comes back with its filters. Budget category rows and Home's "Spent this month" open the list already filtered.
- **Select mode.** Long-press a transaction or tap Select. The bar changes Category, Tag, Account, "Not in reports" or deletes; ⋯ has Rename payee and Export selected. Category and Account skip loan payments and transfers. Every change except Delete can be undone.

## Bills, splits, refunds and the monthly review

- **Upcoming bills** (Accounts → Upcoming bills, and Home's "Next bill"). Lists the next 30 days: card bills, loan EMIs, repeating entries and bills you saved, then what is left in your main bank after them. Debits from one payee that repeat weekly, monthly or yearly (3 times, or twice with an autopay mandate; amounts within 10 %, exact for EMIs) show under "Review N found": **Add** keeps them, **Not a bill** hides that payee. Autopay paused or cancelled by SMS is shown, and cards not set up are flagged. Each bill gets a reminder 2 days before at 9:00.
- **Split a transaction** (Transaction detail → Split): parts by category and parts paid for someone. Only your parts count as spending. **People** (Accounts → People) shows who owes you and whom you owe; "Remind" shares a message with your UPI ID (Settings → Your UPI ID). A credit from that person is suggested as a settlement (by learned UPI ID or name, never by amount alone); "Yes, settle" clears the oldest amounts first and the credit is not counted as income. What you owe people counts in net worth.
- **Refunds.** Credits with refund wording, or a card credit from a payee you paid before, show in Review → Check as "Looks like a refund" (cashback never does). Match it to the purchase (part refunds allowed): the purchase month's spending goes down and income does not go up. Unlink or "Not a refund" undoes it.
- **Month in review** (Budget → Month in review; Home on the 1st–7th; a notification on the 1st at 9:00). Spent vs the month before, income, saved %, the top 4 categories and the rest, over-budget categories and up to 3 notes (most frequent payee group, uncategorised count, a card not set up or no recent backup). Any of the last 12 months from the calendar button. Share sends totals and categories only, never single payees.
- **Category buttons on notifications** (Settings, on by default). A captured debit shows "₹322 at Swiggy Instamart" with 3 buttons: your most used categories for this payee, then this account. If a rule already chose one, the next 2 plus **Not mine** (marks it for review and opens it). A tap saves the category and shows "Saved as Food"; Review → Check later offers to apply it to similar transactions, never automatically. Taps with the app closed rely on Android delivering them to a background task; if that doesn't happen they are applied the next time the app opens (phone check E-3).
- Every one of these uses the same rules for what counts as spending and income as Home, Budget, Reports, filters and exports. Backup stays manual (Settings → Backup → Export).

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
- Capture notifications show the amount, payee and account, and can appear on the lock screen; turn off "Category buttons on notifications" or hide sensitive notification content in Android settings if that matters. The Month in review share text has no payee names.
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
