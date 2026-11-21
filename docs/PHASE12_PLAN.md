# WealthManager — Phase 12 Claude Code Plan: bug fixes, redesign, files & tags

Personal-use Android finance app (Expo SDK 54, React Native 0.81, SQLite, JS). Repo: `vijaysunny/Wealth-Manager`.
**Do not upgrade the Expo SDK** (the SMS bridge libraries pin us to SDK 54).

Put this file at `docs/PHASE12_PLAN.md`. It follows the same shape as `docs/CLAUDE_CODE_PLAN.md`:

- **Part A:** Bugs found on the owner's phone (with root causes already traced)
- **Part B:** New features (files on transactions, tags, investments)
- **Part C:** Redesign (design tokens, shared components, every screen)
- **Part D:** Testing plan
- **Part E:** Order of work and definition of done

## Visual reference: `docs/design/`

PNG screenshots of the design at 2× (390 pt wide). Open the image for a screen before building it. **Where an image and the written spec in Part C differ, follow Part C.** The sample figures in the images come from the owner's SMS and are not test expectations.

| Image | Screen | Spec |
|---|---|---|
| `01-home.png` | Home | C5.1 |
| `02-transactions.png` | Transactions | C5.2 |
| `03-transaction-detail.png` | Transaction detail, sections collapsed (default) | C5.3 |
| `03-transaction-detail-expanded.png` | Transaction detail, Bills & files and Tags open | C5.3, B1, B2 |
| `04-review-accounts.png` | Review accounts | C5.4, A2 |
| `05-accounts.png` | Accounts, Investments collapsed (default) | C5.5 |
| `05-accounts-expanded.png` | Accounts, Investments open | C5.5, B3 |
| `06-budget.png` | Budget | C5.6 |
| `07-goals.png` | Goals (empty state) | C5.7 |
| `08-settings.png` | Settings with the SMS-blocked banner | C5.8, A8 |
| `09-ai-assistant.png` | AI assistant | C5.9, A9 |

When a screen is finished, take a screenshot of it running in an emulator at 390 pt wide and compare it side by side with its image (D6 step 13).

---

## 0. Ground rules for Claude Code

- Start with `npm ci && npm test -- --runInBand && npm run lint && npm run format:check`. Record the baseline (suites, tests, coverage) in the first commit message. Never leave the repo worse than that.
- CI runs tests in **two timezones** (`Asia/Kolkata` and `UTC`). Run `npm run test:tz` before any commit that touches dates.
- **One commit per task ID** (A1, A2, …, C4). Each commit must pass tests, lint and prettier.
- **Test first** for parser, resolver, balance and backup logic: add the failing test from the fixture, then fix.
- Keep logic in pure modules (no React Native imports) so it stays unit-testable. Screens only call those modules.
- Money: use the existing `round2`. In tests use `toBeCloseTo(x, 2)` or integer paise.
- Never `console.log` SMS bodies, account numbers, balances or API keys.
- Transactions are stored as JSON in `transactions.data` (see `data/Database.js`). **New fields (`attachments`, `tags`) go in that JSON. No schema migration is needed**, and none should be added.
- Do not claim device behaviour is verified. Device checks go in `docs/device-test-results.md` as **pending** until the owner confirms on the phone.
- Ask the owner before adding any dependency not named in this plan.

---

# PART A — Bugs (root causes already found)

The owner's 14 real SMS (Axis savings ••0973, Axis credit card ••9070, SBI credit card ••1987, UPI Lite) were run through the current parser. Parsing of bank, card or account, and last 4 digits is correct for all of them. The bugs are below.

### A1. Text invisible on phones in dark mode (P0)

**Cause:** `app.json` has `"userInterfaceStyle": "automatic"`. When Android is in dark mode, any `Text` or `TextInput` without an explicit `color` gets a near-white system default. `components/Theme.js` only sets a default text colour when the app's own dark mode is on. The result is white text on light cards: the Security section, Budget headings, Goals help text, the Edit Transaction amount, the AI switch labels and the AI screen's "AI is off" message.

**Fix:**
1. `app.json`: set `"userInterfaceStyle": "light"` (also under `android` if present). Dark mode returns properly in C-phase via tokens.
2. `components/Theme.js` → `themed()`: always pass a default colour for `Text` and `TextInput`, and a default `placeholderTextColor`:
   ```js
   const defaults = (Component === NativeText || Component === NativeInput)
     ? { color: dark ? tokens.dark.text : tokens.light.text } : {};
   ```
3. Grep for any `Text` imported straight from `react-native` (e.g. `components/Bootstrap.js`) and switch it to the themed import.

**Tests:** see D3 (`Theme.test.js`).

### A2. Bank and card transactions never get an account (P0)

**Cause:** `utils/AccountResolver.js` deliberately never auto-creates bank or card accounts (plan B7). The owner only has a UPI Lite account, so every Axis and SBI capture is stored with `accountUnresolved: true, reviewReason: 'new_account'` in a review list hidden under Money tools → Review. `EditTransactionScreen` lists only existing accounts (UPI Lite, Cash), so nothing is selected.

**Fix (keep B7, make the review visible):**
1. New pure helper `utils/AccountDiscovery.js`:
   `discoverAccounts(txs) → [{ signature, suggested: suggestedAccountFor(tx), count, txIds }]`. Group pending captures by `captureSignature()`, sorted by count.
2. New screen `screens/ReviewAccountsScreen.js` (design C5.4). For each discovered account, **Add account** creates `suggested`, then calls the existing `FeatureService` resolve-all-by-signature path for every pending capture with that signature. **Link to existing** opens a picker of same-type accounts. **Add all** does every group.
3. Home shows the "N new accounts found in SMS" card (design C5.1) when `discoverAccounts()` is non-empty.
4. `EditTransactionScreen` account picker: if the tx has `suggestedAccount`, show a chip "+ Add Axis Bank ••0973" first.

**Tests:** D1 (`AccountDiscovery.test.js`) and D4 (review screen flow).

### A3. Credit-card bill payment read as income (P1)

**Cause:** `CC_PAYMENT_RE` in `utils/TransactionParser.js` uses `[^.]*`, which stops at the decimal point in "INR 9145.91". So "Payment of INR 9145.91 has been received towards your Axis Bank Credit Card XX9070" becomes **income ₹9,145.91** instead of a `cc_payment` transfer.

**Fix:** replace `[^.]*` with a bounded lazy match that allows decimals, e.g. `[\s\S]{0,80}?`, in both alternatives.

**Test:** fixture `axis-cc-payment-01` → `{ type: 'transfer', kind: 'cc_payment', flow: 'in', accountType: 'Credit Card', last4: '9070' }`.

### A4. Card bill paid from bank counted as spending (P1)

**Cause:** "INR 12511.38 debited A/c XX0973 … UPI/P2M/…/Amazon Pay Credit C" is stored as a ₹12,511 **expense**. The card purchases are expenses too, so the money is counted twice. This is part of why Home showed "Saved −201%".

**Fix:** in the parser, when the payee or narration matches a card-bill pattern (`/credit\s*c(?:ard)?\b|\bcc\s*(?:bill|payment)\b|cred\s*club|\bbbps\b.*card/i`) on a bank debit, return `type: 'transfer', kind: 'cc_bill', flow: 'out'`. Then extend `utils/TransferPairing.js` so a `cc_bill` (bank side) pairs with a `cc_payment` (card side) of the same amount within ±3 days.

**Tests:** parser fixture for the 12,511.38 SMS, and a `TransferPairing` test for the pair.

### A5. UPI Lite top-up moves only the wallet (P1)

**Cause:** "UPI LITE top-up on UPI App amounting to INR 500.00 has been successful … - Axis Bank" has no `A/c` word, so `classifyWalletEvent` decides `perspective: 'wallet'`. The wallet goes up by ₹500 but the Axis account is never debited (UPI Lite shows ₹1,000 with no matching bank debit).

**Fix:** a top-up or withdraw message whose sender or body names a bank should be treated as a **two-legged transfer**: bank → wallet. Set `perspective: 'bank'` when `kind` is `wallet_topup` or `wallet_withdraw` and a bank is named, so `linkWalletTransfer` links both legs (it already does this for the bank perspective).

**Tests:** parser test for the real top-up SMS, and an `AccountResolver` test showing both Axis ••0973 (−500) and UPI Lite (+500).

### A6. Payee name polluted from narration (P2)

**Cause:** `CHANNEL_SLASH_RE` captures to the end of the line, so the NEFT credit's payee becomes `"C DA.View bal: https:"`.

**Fix:** stop the counterparty at `View bal`, `Chk Bal`, `http`, `Not you`, ` - ` and trailing `/`. Trim punctuation.

**Test:** the NEFT 136193.00 SMS → counterparty `"C DA"`.

### A7. ACH debits have no payee; category rules (P2)

- "ACH-DR-BAJAJ FINANCE LTD-V" → merchant `"Bajaj Finance"`, category `Loan/EMI`. Add `ACH-DR-<name>` extraction.
- "ADYAR ANAND" (the card network cuts off "Bhavan") → `Food`. Extend the Food regex with `adyar ?anand`.

**Tests:** both SMS in the fixtures.

### A8. SMS auto-tracking never starts (P0)

**Cause 1 (code):** `components/RealSmsReader.js` → `requestSmsPermission()` requests only `READ_SMS`. `utils/SmsTracking.js` → `hasReceivePermission()` requires `READ_SMS` **and** `RECEIVE_SMS`, so `syncTrackingWithFlag()` always stops the listener.

**Cause 2 (Android):** on Android 13+, SMS permissions for an app installed from an APK are blocked as a "restricted setting". The request returns `never_ask_again` without a dialog.

**Fix:**
1. Request both permissions together:
   ```js
   const res = await PermissionsAndroid.requestMultiple([P.READ_SMS, P.RECEIVE_SMS]);
   ```
   Return `{ granted, blocked }`, where `blocked` = any result `never_ask_again`.
2. New pure helper `utils/PermissionHealth.js` (the file exists; extend it): `smsPermissionState(results) → 'granted' | 'denied' | 'blocked'`.
3. When `blocked`, Settings shows the red banner (design C5.8). "Open App info" calls `Linking.openSettings()`. The banner tells the owner to tap ⋮ → *Allow restricted settings*, then allow SMS.
4. Settings switch state = `flag && permission`. If the switch is on but permission is missing, show the banner instead of silently turning it off.

**Tests:** D1 (`PermissionHealth`), D4 (Settings banner render).

### A9. Gemini "not working" (P1)

**Causes:**
- The "Use AI" master switch is off. Its label and the AI screen's "AI is off" message were invisible (A1). The four greyed feature switches in the screenshot are disabled because the master switch is off.
- `utils/ai/AiProviders.js` → `gemini.avoid` drops every id containing `preview`/`exp`. Gemini 2.5 was shut down in Oct 2026, so if the key only lists `*-preview` Flash models, `pickModel` returns null ("no suitable model").

**Fix:**
1. `pickModel`: first try ids not matching `avoid`. If none match `prefer`, retry allowing `preview` (still excluding image, tts, audio, live and embed).
2. Settings → AI: after **Save key**, run `testProvider` automatically. Show the result line under the provider ("Working · <model>" or the error text from the API, first 120 characters).
3. AI screen when not ready: a visible card with a **Turn on AI** button that goes to Settings → AI.
4. Saving the first key asks "Turn on AI now?" and turns it on if the owner says yes.

**Tests:** `AiProviders.test` for preview fallback; `AiClient.test` for the error surfaced on Test (fetch mocked; no network in tests).

### A11. Debit card spends land on a new account (P1)

**Cause** (tested with sample Axis/SBI debit-card SMS):
- "INR 450 spent on Axis Bank Debit Card XX4821 … Avl Bal …" → `accountType: 'Bank Account'` (correct), but `extractLast4` returns the **card** digits 4821. The savings account is ••0973, so `resolveAccount` treats it as a different account and suggests "Axis Bank ••4821". ATM withdrawals by debit card behave the same.
- Axis's newer format "Spent / Card no. XX4821 / … / Avl Bal INR …" names neither debit nor credit, so `detectAccountType` returns **Credit Card**.
- "debited from A/c XX5678 using SBI Debit Card XX9911" already works (the account digits come first).

**Fix:**
1. Parser: return `cardLast4` (the digits after `card`) separately from `last4` (the digits after `a/c|acct|account|ending`). For a debit card SMS with no account digits, `last4 = null`.
2. `detectAccountType`: `debit card` → Bank Account. If the SMS says only `card` with no debit/credit word, decide by the balance wording: `avl bal|available balance` → Bank Account (debit card); `avl (credit )?limit|avl lmt` → Credit Card. If there's neither, assume Credit Card.
3. Account data: Bank Accounts get `debitCards: string[]`. `AccountResolver.resolveAccount` matches a Bank Account when `tx.last4` matches its `last4` **or** `tx.cardLast4` is in its `debitCards`.
4. Unknown debit card + exactly one bank account of that bank → `reviewReason: 'link_debit_card'` with the candidate. Review shows "Is Debit Card ••4821 linked to Axis Bank ••0973?" [Yes] [Different account]. Yes adds `4821` to `debitCards` and resolves every pending capture with that card. With several accounts of that bank, it asks the owner to pick one.
5. `captureSignature` includes `cardLast4` so the one-tap resolve groups correctly.

**Tests:**
- Fixtures `axis-debitcard-spend-01`, `axis-debitcard-atm-01`, `axis-card-no-avlbal-01` (Bank Account, `cardLast4: '4821'`, `last4: null`), `axis-card-no-avllmt-01` (Credit Card), `sbi-ac-and-debitcard-01` (`last4: '5678'`, `cardLast4: '9911'`).
- Resolver: a card in `debitCards` matches the savings account; an unknown card gives `link_debit_card`; a credit card with the same digits never matches a bank account.
- Integration: after "Yes", 3 pending debit-card captures move to Axis ••0973 and its balance changes.
- **Replace the sample texts with the owner's real debit-card SMS** before marking A11 done.

### A10. Buttons crammed and unstyled (P1)

**Cause:** `SecurityPanel`, `AiSettingsPanel` and `AiAssistantScreen` use React Native's `Button`. On Android it is an uppercase block with no margin, and stacked buttons touch.

**Fix:** replace every `Button` from `react-native` with the shared `AppButton` (C3). Lint guard: add an ESLint `no-restricted-imports` rule that blocks `Button` from `react-native`.

---

# PART B — New features

### B1. Files on transactions (bills, receipts, any file)

**Data** (inside `transactions.data` JSON):
```js
attachments: [{ id, uri, name, mime, size, addedAt }]   // uri = file://.../attachments/<txId>/<id>-<safeName>
```

**New module** `utils/Attachments.js`. Keep the pure parts separate from the parts that use `expo-file-system`, and inject the file-system functions so tests can pass fakes:
- `safeFileName(name)`: strip path separators and control characters, max 80 characters, keep the extension.
- `addAttachment(tx, picked, fs)`: copy the file to `documentDirectory/attachments/<txId>/`, return the new tx.
- `removeAttachment(tx, id, fs)`: delete the file and remove the entry.
- `deleteAllFor(txId, fs)`: called from `TransactionRepo.remove`.
- Limits: 25 MB per file, 10 files per transaction. The UI shows a clear error message when either is exceeded.

**Pickers:**
- `expo-image-picker` (new dependency, owner already approved: **Camera** and **Gallery**)
- `expo-document-picker` (already installed) with `type: '*/*'` and `copyToCacheDirectory: true` for **Any file**

**Opening a file:** `expo-sharing` → `shareAsync(uri, { mimeType })` (already installed) so Android opens the right viewer.

**Backup:** `utils/BackupService.js` + `utils/EncryptedBackup.js`:
- Add an `includeAttachments` option (default **on**). Include files as base64 under `attachments/<txId>/<id>`.
- On restore, write the files back and rewrite the `uri` values.
- If the backup would be larger than 50 MB, warn and offer "Backup without files".

**Search index:** a transaction "has file" when `attachments.length > 0`.

### B2. Tags

**Data:** `tags: string[]` already exists (used for "Auto-SMS" and "Auto-Sync"). Normalise it.

**New pure module** `utils/Tags.js`:
- `normalizeTag(s)`: lowercase, trim, strip a leading `#`, spaces become `-`, allow only `[a-z0-9-]`, max 32 characters.
- `addTag(tx, s)` / `removeTag(tx, s)`: no duplicates.
- `SYSTEM_TAGS = ['auto-sms', 'auto-sync']`. These are hidden in the UI, but searchable.
- `recentTags(txs, n=8)`: user tags by most recent use.
- `parseSearch(query) → { text, tags[] }`: `"google #tax-2026 #work"` → `{ text: 'google', tags: ['tax-2026','work'] }`.
- `matchesSearch(tx, parsed)`: AND across tags; text matches title, merchant, counterparty, category, amount and attachment names.

**Migration:** on first run, map `'Auto-SMS'` → `'auto-sms'` and `'Auto-Sync'` → `'auto-sync'`. Do it in the existing migration step in `components/Bootstrap.js`, and make it safe to run twice.

**UI:** a tag editor in Transaction detail and tag filter chips plus `#tag` search in Transactions (C5.2, C5.3).

### B3. Investments in net worth

**Current behaviour** (explain this in the Accounts screen help text):
- Net worth counts only accounts added on the Wealth screen. Nothing is created from SMS.
- Mutual funds use the live NAV (mfapi.in), and stocks and gold use live prices (Yahoo). PF adds interest daily. Loans recompute the outstanding amount.
- **FD and RD do not grow**: the balance stays at the amount typed in.

**Fixes:**
1. **FD interest:** new pure `utils/DepositValue.js`:
   - `fdValue({ principal, ratePct, startDate, compounding: 'quarterly'|'monthly'|'simple', maturityDate }, asOf)`.
   - Value is capped at maturity. Use Indian bank quarterly compounding by default.
   - Wire it into `WealthScreen` the same way PF interest is.
2. **RD value:** `rdValue({ monthly, ratePct, startDate, months }, asOf)`, quarterly compounding.
3. **Maturity reminder:** schedule a local notification 7 days before `maturityDate` (`NotificationService`).
4. **SIP debits as transfers:** when a bank debit's payee matches a known investment platform (`groww|zerodha|upstox|kuvera|coin|paytm money|indmoney|et money|mf utilities|bse star|camsonline|kfintech`) and the owner has an investment account linked to that platform, store it as `type: 'transfer'`, `kind: 'investment'`, from bank to investment. Otherwise keep it as an Investment expense and offer "Link to an investment" in Review.
5. The net-worth card shows three numbers: Cash & bank, Investments, Owed.

---

# PART C — Redesign

### C1. Design tokens — new `components/tokens.js`

```js
export const light = {
  bg: '#F5F6F8', card: '#FFFFFF', border: '#E3E6EC', divider: '#EEF0F4', inputBorder: '#D5DAE3',
  text: '#0E1726', text2: '#3A4456', muted: '#5B6475',
  primary: '#1F4FD8', primaryPressed: '#173EA8', primarySoft: '#E8EEFF',
  expense: '#C2362B', income: '#0E7C4A', ink: '#0E1726', inkCard: '#1B2638', inkMuted: '#C9D2E3',
  warnBg: '#FFF7E8', warnBorder: '#F3D9A4', warnText: '#6B4600',
  dangerBg: '#FFF1F0', dangerBorder: '#F2C4BF', dangerText: '#7A1A24', danger: '#97212E',
  switchOff: '#C5CBD6',
};
export const dark = { /* same keys; bg '#0F141C', card '#18202B', text '#E6EAF0', muted '#9AA4B5', border '#2A3342' ... */ };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };   // screen gutter = 20
export const radius = { sm: 10, md: 12, lg: 16, xl: 18, xxl: 20, pill: 999 };
export const type = {
  display: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 34 },
  title:   { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22 },
  section: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 17 },
  body:    { fontFamily: 'Inter_400Regular', fontSize: 15 },
  bodyStrong: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  meta:    { fontFamily: 'Inter_400Regular', fontSize: 12 },
  overline:{ fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
};
```

- **Fonts:** `@expo-google-fonts/inter` and `@expo-google-fonts/space-grotesk` (new dependencies, owner approved), loaded with `expo-font` in `App.js` before the first screen.
- **Contrast rule:** every text/background pair must be at least 4.5:1. `muted` on `card` is about 5.9:1. A test checks the token pairs (D3).
- **Sizes:** every tap target is at least 44×44. Primary buttons are 52 tall and inline buttons 36–46 tall.

### C2. Theme

- `Theme.js` reads tokens; `useAppTheme()` returns `{ dark, t }`. Dark mode is opt-in from Settings (the system setting no longer leaks in).
- Replace the current `shade()` colour-guessing approach with explicit tokens in each new component. Keep `shade()` only for old screens not yet rewritten, and delete it when C5 is done.

### C3. Shared components — `components/ui/`

| Component | Props | Notes |
|---|---|---|
| `AppButton` | `variant: 'primary'\|'secondary'\|'dashed'\|'danger'`, `size: 'lg'\|'md'\|'sm'`, `icon`, `loading`, `disabled` | Replaces RN `Button`. Normal case, 600 weight. |
| `Card` | `padding`, `style` | white, border, radius 16–18 |
| `ListRow` | `label`, `value`, `sublabel`, `left`, `right`, `onPress`, `chevron` | min height 52; dividers inset 16 |
| `Section` | `title` (overline), `action` | |
| `Collapsible` | `title`, `summary`, `badge`, `left`, `defaultOpen=false` | header row is a button with `accessibilityState={{expanded}}`; chevron rotates 180°; `LayoutAnimation.easeInEaseOut` |
| `Segmented` | `options`, `value`, `onChange` | Expense / Income / Transfer |
| `Chip` | `label`, `selected`, `onPress`, `onRemove` | account and tag chips; remove target 28px |
| `AppSwitch` | `value`, `onValueChange`, `label` | Wraps RN `Switch` using token colours. Always has a visible label. |
| `Banner` | `tone: 'warn'\|'danger'\|'info'`, `title`, `body`, `action` | backup, SMS-blocked, review |
| `MoneyText` | `amount`, `type` | sign, ₹, Indian grouping via `utils/Format`, red/green/muted |
| `EmptyState` | `icon`, `title`, `body`, `action` | Goals, Investments |
| `TabBar` | — | 5 tabs: Home, Accounts, Budget, Goals, Settings; height 80; active colour is `primary` |

Icons: keep `@expo/vector-icons` (Ionicons outline at 20–22px). **No emoji in the UI.**

### C4. Navigation

Bottom tabs: **Home · Accounts · Budget · Goals · Settings** (rename "Wealth" to "Accounts").

Stack screens:
- Transactions (from Home "See all")
- Transaction detail
- Review accounts
- AI assistant (from Settings)
- Add investment (the existing AddAssetScreen, restyled)
- Backup

Remove the "Money tools" hub screen. Its tabs move as follows: Transfers → Transactions filter, Review → Review accounts, History → Transactions, Goals → Goals tab, Wealth → Accounts.

### C5. Screens

**C5.1 Home**
1. Header: date + "Hi <name>" with a search icon button.
2. Backup `Banner` (warn) when there has never been a backup.
3. Dark summary card with month switcher, **Spent this month** (display size) and a note "Card bills and wallet top-ups are transfers, not spending". Below it, a 2-up row: Income and Transfers.
4. Review card: "N new accounts found in SMS · M transactions waiting", with a count badge. Hidden when there are none.
5. Four quick actions: Expense, Income, **Scan bill** (camera, then a new tx with the attachment), Import.
6. Recent: 3 rows with "See all".

The "Saved %" tile is removed. It returns only when income > 0, and is capped to the range −100…100 with "—" otherwise.

**C5.2 Transactions**
- Back button, title, export button.
- Search field with placeholder "Search payee, amount or #tag". It uses `parseSearch`.
- Account filter chips (All, plus each account).
- Tag chips row: recent tags plus a **Has file** chip.
- List grouped by day with a day total in the header.
- Each row shows: icon, payee, account chip, category, a paperclip if there are files, user tags (blue, one line, ellipsis), and the amount.
- Transfers are muted, not red.
- "Self-transfer?" hint for `transferCandidate`.

**C5.3 Transaction detail** (fits 844 tall when collapsed)
- Header: close and delete (delete asks for confirmation and also removes the attachments).
- Card 1: `Segmented` type control and the large amount input.
- Card 2: `ListRow`s for Payee (input), Paid from, Category, Date, and **Count in reports** (`AppSwitch`; replaces the "Exclude from reports" wording).
- **`Collapsible` "Bills & files"**, closed by default. The badge shows the file count. When open: the file list (thumbnail or icon, name, type and size, remove) and three dashed buttons: Camera, Gallery, Any file.
- **`Collapsible` "Tags"**, closed by default. The summary shows the tags on one line. When open: removable chips, a "# Add a tag" input (Enter or comma adds), and "Used before" suggestions from `recentTags`.
- Source note: "From SMS · <bank>" with the masked first line of the SMS.
- Sticky footer: **Save changes**.

**C5.4 Review accounts**
- Intro text, then `Segmented`: New accounts (n) / Check (n).
- One card per discovered account: bank badge, name with ••last4, type and txn count (plus the card limit if seen), and **Add account** / **Link to existing**.
- Sticky footer: **Add all N accounts**.
- The "Check" tab holds the existing review items (self-transfer, pick wallet, etc.).

**C5.5 Accounts**
- Header with **Add**.
- Dark net-worth card: the total, plus a warning line "N balances missing · set them to see the real figure". Below it, 3-up: Cash & bank, Investments, Owed.
- Sections:
  - **Bank accounts**: a "Set balance" warn button when the balance is unknown.
  - **Credit cards**: available limit from SMS; "Set due".
  - **Wallets**: linked bank shown.
  - **`Collapsible` Investments**, closed by default. Summary: "MF, stocks, FD/RD, PF" plus the total. When open: rows for Mutual funds (NAV daily), Stocks (price on refresh), FD/RD (interest daily · maturity reminder) and PF/gold/property, each with **Add**, plus the SIP-as-transfer info note.
- Content scrolls; the tab bar is fixed.

**C5.6 Budget**
- Month pill switcher.
- Card: "Spent of monthly budget", an amount input with **Set**, and a "Carry unused budget forward" `AppSwitch` with the leftover shown. This replaces the overlapping switch in the old header.
- "By category" list: each row shows the amount, "Set limit" or the limit, and a progress bar. Over 90% turns warn and over 100% turns danger. Tapping a row opens a limit sheet. This replaces the clipped horizontal category picker.

**C5.7 Goals**
- `EmptyState` ("Save for something specific…" with readable help text) and **Create a goal**.
- "Start from" template cards: Emergency fund, Trip, New phone or laptop, Clear a card or loan.
- The existing goal list keeps its logic and is restyled with `Card` and progress bars.

**C5.8 Settings**
- SMS-blocked `Banner` (danger) when the A8 state is `blocked`.
- Grouped sections:
  - **Capture:** Read bank SMS automatically (switch + sublabel), Scan old SMS now, AI assistant (status sublabel)
  - **Money:** Accounts & cards, Categories (count)
  - **Security & backup:** Dark mode, Fingerprint lock, Backup & restore (with a "Never backed up" status)
- Categories and accounts management move to their own sub-screens.

**C5.9 AI assistant**
- Status card: **Use AI** switch with a privacy sublabel. Below it, providers in order, each showing status ("Working · model", "No key", or the error) and **Test** / **Add key**.
- "Ask about your money" suggestion chips, then the chat bubbles (user on the right in primary, AI on the left in a card with a "via Gemini" note).
- Input bar fixed at the bottom with a send button.

---

# PART D — Testing plan

Use the existing tools: **Jest (jest-expo)**, **@testing-library/react-native**, **fast-check**, the in-memory SQLite from `jest.setup.js`, and fixtures in `__fixtures__/`. No test may hit the network or the real file system.

### D0. Fixtures

Add the owner's SMS from the conversation to `__fixtures__/sms/owner_real_samples.json`, each with `expected` set to the **correct** behaviour:

| id | key expectation |
|---|---|
| `axis-upilite-topup-01` | transfer `wallet_topup`, bank Axis, two legs after resolve (A5) |
| `axis-debit-irctc-01` | expense 67.90, Axis Bank Account 0973, Transport, merchant "Indian Railways UTS" |
| `axis-debit-ccbill-amazon-01` | **transfer `cc_bill`** 12511.38 (A4) |
| `axis-cc-spend-adyar-01` | expense 281, Credit Card 9070, **Food** (A7) |
| `axis-cc-payment-01` | **transfer `cc_payment`** 9145.91 (A3) |
| `axis-imps-baja-01` | expense 178, `transferCandidate: true` |
| `axis-mandate-google-01` | expense 1998.19, Subscriptions, no last4 → `needsAccountReview` |
| `sbi-cc-recharge-01` | expense 1020.58, SBI Credit Card 1987, Bills |
| `sbi-cc-payment-bbps-01` | transfer `cc_payment` 5770 |
| `axis-neft-credit-01` | income 136193, counterparty **"C DA"** (A6) |
| `axis-upi-credit-person-01` | income 30000, counterparty "Kavya" (fake name) |
| `axis-ach-bajaj-01` | expense 538, Loan/EMI, merchant **"Bajaj Finance"** (A7) |
| `axis-autopay-paused-01` | `null` (not a transaction) |
| `sbi-cc-jan-aushadhi-01` | expense 143, Health |
| `axis-debitcard-*` (A11) | Bank Account, `cardLast4`, links to ••0973 after one confirmation |

Third-party names and refs must be **replaced with fakes** before any public push, as the fixture's `_note` already says.

### D1. Unit tests (pure modules)

| File | Cases |
|---|---|
| `parser/TransactionParser.owner.test.js` | every D0 fixture: type, amount, kind, accountType, bankName, last4, category, merchant/counterparty |
| `AccountResolver.test.js` (extend) | top-up gives two legs; card vs bank of the same bank never cross; learning last4 |
| `AccountDiscovery.test.js` | groups by signature; counts; ignores resolved; sort order; empty input |
| `TransferPairing.test.js` (extend) | `cc_bill` ↔ `cc_payment` same amount within ±3 days pairs; 4 days apart or a different amount does not |
| `Tags.test.js` | normalise (`'#Tax 2026'`→`'tax-2026'`, emoji or illegal characters stripped, 32-character limit); add/remove with no duplicates; `parseSearch`; `matchesSearch` AND logic; system tags hidden; migration safe to run twice |
| `Attachments.test.js` | `safeFileName` (path traversal `../../x`, control characters, long names, keeps extension); add copies to the right dir (fake fs); 25 MB and 10-file limits; remove deletes the file; `deleteAllFor` |
| `DepositValue.test.js` | FD quarterly: ₹1,00,000 @ 7% for 1 year = ₹107,185.90 (±0.01); simple; capped at maturity; before start = principal; RD known value; leap year |
| `PermissionHealth.test.js` | granted / denied / never_ask_again on either permission gives `blocked` |
| `ai/AiProviders.test.js` (extend) | only `-preview` flash ids → picks preview; never picks image/tts/embed |
| `ai/AiClient.test.js` (extend) | Test surfaces HTTP error text; 404 re-pick; no key → clear message |
| `BackupService.test.js` (extend) | attachments round-trip (fake fs); `includeAttachments:false`; >50 MB warning; old backups without attachments still restore |
| `property/Tags.property.test.js` | fast-check: `normalizeTag` is idempotent and output always matches `/^[a-z0-9-]{0,32}$/` |
| `property/Money.property.test.js` (extend) | net worth = assets − liabilities for random account sets, including investments |

### D2. Integration tests (in-memory SQLite)

- **SMS → store → resolve → review:**
  1. Feed all D0 fixtures through `SmsSync` with `scanBankSms` mocked.
  2. Assert that 3 accounts are discovered.
  3. "Add all", then: every capture has an `accountId`, Axis ••0973 has the bank debits, the cards have their spends, UPI Lite is +500 and Axis is −500 for the top-up, and the cc bill is paired, not counted as spend.
- **Monthly totals:** `monthlyAggregates` for Nov 2026 over the fixtures. Spending excludes transfers. Assert exact figures computed from the fixtures (write the expected numbers into the test, not computed by the same code).
- **Delete tx** removes its attachment files (fake fs spy).
- **Tag search** over 200 generated transactions returns the correct ids.

### D3. Theme and design tests

- `Theme.test.js`: a `Text` with no style gets `color === tokens.light.text` in light mode and `tokens.dark.text` in dark mode. `TextInput` gets a placeholder colour.
- `tokens.test.js`: a WCAG contrast function. Assert at least 4.5:1 for these pairs: `text/bg`, `text/card`, `muted/card`, `muted/bg`, `primary/card`, white on `primary`, `warnText/warnBg`, `dangerText/dangerBg`, `inkMuted/ink`, and the same pairs in dark mode.
- ESLint rule test: importing `Button` from `react-native` fails lint.

### D4. Screen tests (RNTL; mock native modules like `__tests__/screens/Smoke.test.js` does)

- **Home:** the review card appears with the correct count when there are unresolved captures; the backup banner appears when there has never been a backup; Spent excludes transfers.
- **ReviewAccounts:**
  - renders 3 cards
  - "Add account" on Axis resolves 12 transactions and the card disappears
  - "Add all" empties the list
  - "Link to existing" assigns to the chosen account
- **TransactionDetail:**
  - Files and Tags are collapsed at first (`accessibilityState.expanded === false`) and their contents are not rendered
  - tapping expands them
  - adding a tag shows a chip
  - picking a file (mocked picker) shows the row
  - removing asks for confirmation
  - Save persists `tags` and `attachments`
- **Transactions:** typing `#tax-2026` filters the list; the "Has file" chip filters; the account chip filters.
- **Accounts:** Investments is collapsed at first and the total shows in its header; the FD value increases when the clock is mocked forward 90 days.
- **Settings:** the SMS-blocked banner renders when the permission mock returns `never_ask_again`; "Open App info" calls `Linking.openSettings`.
- **AI assistant:** when not ready, the visible "Turn on AI" card is present (the regression for the invisible text).
- **Accessibility:** every `Pressable`/`TouchableOpacity` in the new components has an `accessibilityLabel` or text child; icon-only buttons have labels.

### D5. Coverage

Keep the `coverageThreshold` in `package.json`. New pure modules (`Tags`, `Attachments`, `AccountDiscovery`, `DepositValue`) must each reach **≥ 90% lines and branches**.

### D6. Device test checklist (owner's phone, Android dark mode **on**) — record in `docs/device-test-results.md`

1. Fresh install of the APK. Every screen's text is readable with the phone in dark mode.
2. Settings → Read bank SMS → the banner shows the "restricted settings" steps → after allowing, the switch stays on.
3. Send yourself or wait for a real Axis debit SMS. It appears within seconds on the correct account, and a notification is shown.
4. Scan old SMS → Review shows Axis ••0973, Axis Card ••9070, SBI Card ••1987 → Add all → Accounts lists them.
5. UPI Lite top-up: UPI Lite +500 **and** Axis −500.
6. Axis card bill paid from the bank is not counted in "Spent".
7. Transaction detail: attach a camera photo, a gallery image and a PDF. Each opens in a viewer. Delete the tx and the files are gone (check the app's storage size).
8. Tags: add `#tax-2026` to two transactions, then search `#tax-2026` and see both.
9. Gemini: save key → the test runs automatically → "Working · <model>". Ask "Where did my money go this month?" and get a reply.
10. Add an FD (₹10,000, 7%, today). The next day the value is slightly higher, and a maturity reminder is scheduled.
11. Encrypted backup with files → uninstall → install → restore → transactions, tags and files are all back.
12. Collapsible sections open and close smoothly, nothing overlaps, and every button is at least 44px.
13. Each screen on the phone matches its image in `docs/design/`: section order, spacing, colours and what is collapsed by default.

---

# PART E — Order of work and definition of done

| # | Tasks | Why this order |
|---|---|---|
| 1 | A1 → A10 lint rule | readable UI first; the lint rule stops regressions |
| 2 | D0 fixtures, then A3, A4, A5, A6, A7 (test first) | parser correctness affects all numbers |
| 3 | A2 + `AccountDiscovery` + ReviewAccounts screen | gets the owner's data into the right accounts |
| 4 | A11 debit cards, A8 SMS permissions | correct account for card spends; live capture |
| 5 | A9 AI | |
| 6 | C1 tokens, C2 theme, C3 components, C4 navigation | foundation for the screens |
| 7 | C5.1–C5.9 screens, one commit each | |
| 8 | B2 tags, then B1 attachments (+ backup) | B1 depends on the C5.3 layout |
| 9 | B3 investments (FD/RD value, SIP transfer) | |
| 10 | D2/D3/D4 gaps, coverage, docs | |

**Done when:**
- [ ] `npm run lint`, `npm run format:check` and `npm run test:tz` are green; coverage thresholds pass; new pure modules are at ≥ 90%.
- [ ] Every D0 fixture parses to its `expected` value.
- [ ] No `Button` imported from `react-native`; no `Text` without a token colour in new components; no emoji in the UI.
- [ ] Each screen matches C5 (layout order, collapsibles closed by default, tab bar, 44px targets).
- [ ] Backups made before this phase still restore (test).
- [ ] `docs/device-test-results.md` lists D6 with each item **pending** until the owner confirms it on the phone.
- [ ] `README.md` updated: SMS "restricted settings" steps, AI setup, attachments and backup size.
