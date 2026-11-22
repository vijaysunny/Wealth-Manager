# WealthManager — Phase 13 Claude Code Plan: phone-test fixes, credit cards and liabilities

Put this file at `docs/PHASE13_PLAN.md`. It comes from the owner testing the Phase 12 build on his phone (Android, system dark mode on) on 22 Nov 2026.

- **Part A:** Bugs found on the phone, with root causes already traced
- **Part B:** Credit cards: what you owe, this cycle, the bill
- **Part C:** Liabilities section: credit cards, loans and EMIs in one place
- **Part D:** Testing
- **Part E:** Order of work and definition of done

## Visual reference: `docs/design/`

Where an image and the text differ, follow the text. Figures in images are examples (the ₹3,00,000 limit, the phone EMI, the Bajaj loan details and the ₹3,914 bill are made up), but they are internally consistent.

| Image | Screen | Spec |
|---|---|---|
| `05-accounts.png`, `05-accounts-full.png` | Accounts with the **Liabilities** section | C1 |
| `12-credit-card.png`, `12-credit-card-full.png` | Credit card detail | B5 |
| `13-credit-card-setup.png` | Credit card setup | B4 |
| `14-add-loan-card-emi.png` | Add loan or EMI (shown with "EMI on credit card") | C2 |
| `15-bank-emi-loan.png` | Link a bank auto-debit EMI to a loan | C4 |
| `16-loan-detail.png`, `16-loan-detail-full.png` | Loan detail with principal/interest per payment (example: ₹2,00,000 personal loan at 12%, not the owner's) | C3, C6 |
| `17-link-loan-payment.png` | Link a payment to a loan | C6 |

Phase 12 images `01`–`11` still apply to the other screens.

## 0. Ground rules

Same as `docs/PHASE12_PLAN.md` §0:
- Start with a green baseline: `npm ci`, then `npm run lint`, `npm run format:check`, `npm run test:tz` and `npm run test:coverage`.
- One commit per task ID; test first for pure logic; money uses `round2`; no logging of SMS bodies, card numbers or keys.
- Phone checks are **pending** in `docs/device-test-results.md` until the owner confirms them.

Additional rules for this phase:
- **Card numbers and SMS formats.** Any parser for a card statement, EMI-conversion or loan SMS must carry the marker `// UNVERIFIED-SAMPLE` until its test fixture is a real SMS from the owner (see D0). Do not invent bank SMS wording and present it as verified.
- **Balances.** No task may change a stored account balance silently. Any correction (B3) is shown to the owner and confirmed.

---

# PART A — Bugs from the phone test

### A1. Account and card numbers shown twice (P0)

**Seen:** "Axis Card ••9070 ••9070", "Axis ••0973 ••0973 → UPI Lite", "SBI Card ••1987 ••1987" in Transactions chips, rows and Accounts.

**Cause:** `AccountResolver.suggestedAccountFor()` names a new account `"Axis Bank ••0973"` and also stores `last4: '0973'`. `utils/TransactionList.shortAccountName(name, last4)` then appends `••0973` again. The tests in `__tests__/TransactionList.test.js` only use names without digits.

**Fix:**
1. `shortAccountName(name, last4)`:
   - Remove any trailing digit marker from the name: `••1234`, `XX1234`, `xx1234`, `*1234`, or ` 1234` at the end.
   - Shorten as now ("Bank" removed, "Credit Card" → "Card").
   - Append `••last4` once. If `last4` is missing, use the digits removed from the name.
2. Keep stored names unchanged (no data migration). This is display only.
3. Account badge initials (`WealthScreen.initials`): for a known bank use its short code (Axis → "AX", SBI → "SBI", HDFC → "HD", ICICI → "IC", Kotak → "KO"). Otherwise use the first two letters of the first word. Today "Axis Bank" shows "AB".
4. Check every caller (TransactionRow, AllTransactionsScreen chips, EditTransactionScreen, WealthScreen, Review) on a phone-sized render.

**Tests:**
- `shortAccountName('Axis Bank ••0973','0973')` → `'Axis ••0973'`
- `('Axis Bank Credit Card ••9070','9070')` → `'Axis Card ••9070'`
- `('SBI Credit Card ••1987', null)` → `'SBI Card ••1987'`
- `('Axis Bank XX0973','0973')` → `'Axis ••0973'`
- `('UPI Lite')` → `'UPI Lite'`
- A property test: the output never contains the same 4 digits twice.
- A screen test: the Transactions account chips for accounts created by `addAllDiscoveredAccounts()` contain each last-4 exactly once.

### A2. Gemini "timed out" (P0)

**Seen:** AI assistant → Google Gemini Flash · key saved → status "timed out".

**Causes in the code (`utils/ai/AiClient.js`, `AiProviders.js`):**
1. **No thinking level is sent.** Gemini 3 Flash models default to `thinkingLevel: high` with dynamic thinking ([Gemini 3 guide](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3)). Google warns this "may take much longer to produce its first … output token". `generate()` sends only `temperature` and `responseMimeType`.
2. **Two sequential calls, each with a 30 s timeout.** `testProvider` forces a fresh `listModels` (pageSize 1000), then `generateContent`. Any slow call fails with no retry.
3. **Google outages.** Gemini Flash has had periods where requests hang with zero bytes ([forum, Jul 2026](https://discuss.ai.google.dev/t/sustained-outage-14h-gemini-3-5-flash-generatecontent-hangs-indefinitely-on-structured-output-thinkingconfig-returns-0-bytes/174959)). There is no backup provider configured on the phone (Groq: no key).
4. **The error is not useful.** "timed out" doesn't say which step, which model or after how long.

**Fix:**
1. **Thinking level.** For Gemini models matching `/^gemini-(?:[3-9]|\d{2})|flash-latest|flash-lite-latest/`, send:
   - `generationConfig.thinkingConfig = { thinkingLevel: 'low' }` for chat questions
   - `'minimal'` for Test, SMS parsing, categories and statement rows

   Never send `thinkingBudget` as well (the API returns 400). If the API answers 400 and mentions `thinking`, retry once without `thinkingConfig`.
2. **Model choice per job.** Prefer `flash-lite` for Test, SMS, categories and statements (fast, minimal thinking by default). Prefer `flash` for questions.
   - Add `preferFast` to `PROVIDERS.gemini`: `[/^gemini-flash-lite-latest$/, /flash-lite/]`.
   - `pickModel(providerId, ids, { fast })`.
   - Cache both picks.
3. **Model list cache.** Cache the model list for 24 h (`ai_models_<provider>` with a timestamp). Test uses the cached list unless older than 24 h, so it makes one network call.
4. **Timeouts and retry:**
   - list models: 10 s
   - Test: 20 s
   - SMS, categories and statements: 20 s
   - chat: 45 s
   - On timeout, 429 or 503: one retry after 2 s, then move to the next provider.
5. **Error text:** `"Timed out after 20 s · gemini-3.1-flash-lite · generating"` (or `"· listing models"`). `HTTP 503: high demand` is passed through. Keep it ≤ 120 characters (existing `describeAiError`).
6. **UI (AI assistant):**
   - When Gemini fails, show under it: "Gemini is slow or down right now. Add a free Groq key so questions still work." with an **Add key** button for Groq.
   - The send button stays enabled while any provider has a key.

**Tests** (fetch is faked; no network; use `jest.useFakeTimers()`):
- The body for `gemini-3.1-flash-lite` contains `thinkingConfig.thinkingLevel = 'minimal'` for Test and `'low'` for chat. There is never a `thinkingBudget`.
- 400 mentioning thinking → retried without `thinkingConfig` → success.
- First call hangs past 20 s → retried once → success. Both hang → Groq is used when it has a key, and the error names both.
- A model list cached less than 24 h ago means Test makes exactly one fetch.
- Error text format, as above.

**Device check:** Test shows "Working · <model>" in under 10 s on 4G, and "Where did my money go this month?" answers.

### A3. Welcome screen unreadable (dark text on dark background) (P0)

**Seen:** the first-run "Welcome to WealthManager" text is dark navy on dark grey.

**Cause:** these screens have no background of their own and show the window behind them:
- `components/Onboarding.js` (root `View` has no `backgroundColor`)
- `components/Bootstrap.js` (loading/migration screen)
- `components/ErrorBoundary.js` (crash screen)

`app.json` has no top-level `backgroundColor`, so `expo-system-ui` sets none. On a phone in dark mode the window behind them is dark, while A1 of Phase 12 pinned the text to the light theme (dark text).

**Fix:**
1. Give the root view of all three `backgroundColor: t.bg` (from `useAppTheme`; ErrorBoundary is a class, so use `tokens.light.bg`).
2. `app.json`: set top-level `"backgroundColor": "#F5F6F8"` (same as `tokens.light.bg`).
3. Add a small config plugin `plugins/withNoForceDark.js` that sets `<item name="android:forceDarkAllowed">false</item>` in `AppTheme` (styles.xml). Some Android skins (MIUI/HyperOS) darken apps that don't opt out.
4. Restyle Onboarding with the C1 tokens and type scale. Make the second button secondary ("Use manual entry").

**Tests:**
- Render Onboarding, Bootstrap's loading view and ErrorBoundary's error view. Each root has a non-transparent background, and every `Text` meets 4.5:1 contrast against it (reuse the contrast helper from `tokens.test.js`).
- A guard test that reads `app.json` and expects `backgroundColor`.

### A4. Edit Asset shows a card balance as a raw negative number (P1)

**Seen:** Accounts → Axis Card ••9070 → "Edit Asset · Current balance −4857.94".

**Cause:** `screens/EditAssetScreen.js` shows `account.balance` as stored. For a Credit Card, the balance is the debt (positive = you owe). The Axis card is **−4,857.94**, meaning "in credit", because history before the SMS scan is missing (the 6 Jul payment of ₹9,145.91 paid for spends the app never saw). See B3.

**Fix:**
- Tapping a credit card opens **Card detail** (B5), not EditAsset.
- EditAsset, for cards, is reachable only from Card detail → ⋯ → "Rename / delete". Label it **"Amount you owe (₹)"**, show a positive number when owed, and add the hint "Negative = the bank owes you (overpaid)".
- For a Loan, label it "Amount you owe".

**Test:** a card with balance 1200 shows "1200" under "Amount you owe"; −50 shows "−50" with the hint.

### A5. Transaction row shows the category instead of the payee (P2)

**Seen:** a Google ₹1,998.19 row is titled "Subscriptions" (the category), with "Subscriptions" again as its category.

**Fix:** `TransactionRow` title order is `merchant || counterparty || title || category`. If title equals category and a merchant exists, show the merchant.

**Test:** a row with `{ title: 'Subscriptions', merchant: 'Google', category: 'Subscriptions' }` renders "Google".

### A6. App always reopens on Home after switching apps (P0)

**Seen:** switch to another app, come back → the app is on Home, the screen you were on is gone, and half-typed input is lost.

**Cause (`components/AppLock.js`):** `AppLock` wraps the whole app (App.js: `Bootstrap → ThemeProvider → AppLock → Onboarding → AppContent`). Its AppState listener sets `hidden = true` whenever the state is not `active`, and also `locked = true` on `background`. Then `if (!loaded || hidden || locked) return <LockView/>` renders the lock view **instead of** `children`. That unmounts `NavigationContainer`, so on return the navigator is rebuilt at `initialRouteName="Main"`. This happens **even when app lock is off** (`hidden` alone does it, and `locked` flips to true until SecureStore answers). Verified: a child of `AppLock` records `mount, unmount, mount` after `background → active` with the lock off.

**Fix:**
1. **Never unmount the app.** `AppLock` always renders `children`, and draws the lock or privacy cover as an absolutely positioned overlay on top (`StyleSheet.absoluteFill`, opaque `tokens.light.bg` or ink, with `pointerEvents` blocking touches and `importantForAccessibility="no-hide-descendants"` on the content behind it while it's covered).
2. **Lock off:** no `locked` flip at all. Read `LOCK_KEY` once at start (and again when Settings changes it, via a small event or context). Don't set `locked = true` and then read again on every background.
3. **Lock on:** lock only after the app has been in the background for **more than 30 seconds** (a `LOCK_AFTER_MS` constant). Store `backgroundAt` on `background`; on `active`, lock if `Date.now() − backgroundAt > LOCK_AFTER_MS`. Ignore the `inactive`/`background` caused by our own biometric prompt, image picker, document picker, camera, share sheet or `Linking.openSettings()`: set a module-level `suppressNextLock()` before opening them.
4. **Privacy in the recent-apps view:** keep the cover overlay while the state is not `active` (the overlay only, never an unmount). Optionally add `expo-screen-capture`'s `preventScreenCaptureAsync()` when app lock is on (ask the owner first; it also blocks screenshots).
5. **Android killing the app in the background:** persist navigation state.
   - `NavigationContainer` `onStateChange` saves the state (debounced 500 ms) to `nav_state`, with a timestamp.
   - On start, restore it as `initialState` if it is less than **30 minutes** old and the app version matches. Otherwise start on Home.
   - Never restore into a screen whose params point at a deleted transaction or account: screens must handle a missing record with "This item no longer exists" and go back.
6. **Unsaved forms:** Expense/Income entry, Transaction detail, Add loan and Card setup keep a draft in memory while mounted (now preserved by fix 1). Restoring drafts after the process is killed is out of scope.
7. **`catchUp()` on every `active`** (App.js): it does an SMS catch-up, due recurring transactions and a net-worth snapshot on every return. Debounce it to at most once per 5 minutes, and run it after the first frame (`InteractionManager.runAfterInteractions`), so returning to the app stays smooth.

**Tests:**
- `AppLock.test.js`: with the lock off, a child stays mounted through `background → active` (`events === ['mount']`), and no lock view is shown afterwards. With the lock on and 10 s away: still mounted and not locked. With the lock on and 31 s away: still mounted, lock overlay shown, and children not pressable until unlocked. After `suppressNextLock()` and a picker round-trip: not locked.
- `NavigationPersistence.test.js`: state saved on change (debounced); restored when fresh and the version matches; ignored when older than 30 min, on a version mismatch, or when the JSON is corrupt.
- `catchUp` debounce: 3 `active` events within 5 min → 1 run.

**Phone check:** open Transactions → a transaction → switch to WhatsApp for 1 minute → come back: the same transaction is open. With the lock on: the same screen, behind the fingerprint prompt.

---

# PART B — Credit cards

### B1. Background: why the card numbers are wrong today

A card account starts at 0 when it is created from SMS, and its balance is the sum of captured spends minus payments. The SMS scan can include a payment for spending **before** the scan window. So:
- Axis Card shows **₹4,857.94 in credit**, when in reality the owner owes something.
- "Owed ₹8,881" on Accounts sums the cards with their signs, so it is meaningless.
- The SMS already give the better number: the **available limit** in every Axis spend SMS ("Avl limit: INR 274919.19") and in SBI payment SMS ("available limit is Rs.178,307.37"). With the **credit limit**, what you owe = limit − available.

### B2. Card data (inside the account JSON; no schema change)

```js
{
  type: 'Credit Card',
  creditLimit: 300000,                       // owner enters once (B4)
  statementDay: 15,                          // 1–31; months with fewer days → last day
  due: { mode: 'afterStatement', days: 20 }, // or { mode: 'fixedDay', day: 5 }
  remindDue: true,
  latestAvailable: { amount: 274919.19, at: ISO, sourceId },   // newest SMS with availableLimit
  statements: [{ date: ISO, totalDue, minDue, dueDate: ISO, source: 'sms'|'manual', paid: 0 }],
  emiPlans: [ /* C1 */ ],
  balance,                                   // kept = "owed" (positive = you owe), recomputed by B3
}
```

The existing `dueDay` maps to `due: { mode: 'fixedDay', day: dueDay }` (a migration that is safe to run twice).

### B3. What you owe: new pure `utils/CardMath.js`

`cardOwed(card, txs, asOf)` → `{ owed, source: 'limit'|'statement'|'history', asOf }`. Use the first that works:
1. **limit:** `creditLimit` and `latestAvailable` are set. `owed = creditLimit − latestAvailable.amount`, plus card spends **after** that SMS, minus payments and refunds after it. (The SMS figure already includes everything up to that SMS, including EMI-blocked limit.)
2. **statement:** the latest statement is known. `owed = totalDue` + spends after the statement date − payments after it. (EMI principal not yet billed isn't known here; the "limit" method includes it, which is why it comes first.)
3. **history:** today's captured sum, labelled "estimate" in the UI. When it is negative, the card shows "Looks overpaid by ₹X. Set up the card to fix" (link to B4).

Also in `CardMath`:
- `cycleWindow(statementDay, asOf)` → `{ start, end }`. The window ends on the next statement day. Handle short months and 31 → 30/28.
- `cycleSpend(card, txs, asOf)` → `{ spent, refunds, count, emiDue }`. Card expenses in the window, refunds (card income), and `emiDue` = the sum of this card's tracked EMIs (C2, `onCardId`) due at window end; 0 if none are tracked.
- `currentBill(card, txs, asOf)` → `{ statement, paid, left, dueDate, daysLeft }`. `paid` = `cc_payment` transfers to this card after the statement date. `left = max(0, totalDue − paid)`.
- `owedParts(...)` → `{ billed: left, thisCycle: spent − refunds, other: owed − billed − thisCycle }` for the bar on Card detail. `other` is labelled "EMIs & older" (the EMI amount the bank is holding back, and anything older). Show the parts only when `source === 'limit'`; otherwise show just the total.

When B3 differs from the stored `balance` by more than ₹1, the card setup's "What you owe now" box explains the difference, and **Save** writes the new balance with a `balanceSetAt` stamp. Never apply it silently.

Net worth (`computeNetWorth`, `accountsOverview.owed`) uses `cardOwed().owed` for cards. Negative owed (overpaid) counts as an asset, not as a smaller debt shown with a minus sign. Owed on Accounts = sum of positive owed amounts only; overpaid cards go into "Cash & bank" with a "(card credit)" note.

### B4. Card setup screen (`13-credit-card-setup.png`)

- Opened from Card detail ⚙ and from "Set up" on an Accounts card row.
- Fields:
  - **Credit limit** (with the hint "printed on the statement; not the available limit in SMS")
  - **Statement date** (day chips; prefilled when a statement SMS was seen: "Found in your statement SMS of …")
  - **Payment due** (Segmented: "N days after statement" with the default 20, or "Fixed day")
- A "What you owe now" box shows limit − available (date of the SMS) = owed, and the overpaid explanation when the history balance differs.
- **Remind me before the due date** switch: 3 days before, only if `left > 0`. Uses `NotificationService`; reschedule when a payment arrives.
- **Save** validates: limit > 0 and ≥ the available limit; statement day 1–31.

### B5. Card detail screen (`12-credit-card*.png`)

1. **Header:** back, the card name (A1 format), settings.
2. **Dark summary:** "You owe in total" (`owed`), the source line ("Limit ₹X − available ₹Y (SMS, date)", "From bill of …", or "Estimate from SMS history"), and a 3-part bar with a legend (Billed / This cycle / In EMIs) when `owedParts` is available.
3. **Bill card:** "Bill of <statement date> · Pay by <due>", a badge ("Due in N days" in warn tone, "Overdue" in danger, "Paid" in income colour), a 3-up row (Total due, Minimum, Paid), and buttons **Record payment** (pre-fills a transfer bank → card for `left`) and **Remind me**. With no statement yet: "Add this month's bill", which opens a sheet with total due, minimum and due date (`source: 'manual'`).
4. **This cycle card:** the window dates; Spent (n transactions), Refunds, "<EMI name> added on <date>" (one line per tracked card EMI, C2); then **Next bill so far** = spent − refunds + EMIs.
5. **"EMIs on this card" row:** a link to Accounts → Liabilities, showing the tracked EMIs ("Phone EMI · 9 left · managed in Liabilities"). It is hidden when there are none. No EMI maths on this screen.
6. **On this card:** the latest 5 transactions, each tagged "this cycle" or "on bill of <date>"; **See all** opens Transactions filtered to the card.

### B6. Accounts card rows (`05-accounts.png`)

Credit cards now live inside **Liabilities** (C1).
- Set-up card: name, "This cycle ₹X · **Pay ₹Y by <date>**" (warn tone when due within 5 days), and `owed` on the right. Tapping opens Card detail.
- Card not set up: name, "Available ₹Y · add limit to see what you owe", and a **Set up** button.

### B7. Card statement SMS (needs real samples)

Add `parseCardStatement(body, sender)` → `{ bankName, last4, totalDue, minDue, dueDate, statementDate? }`, or null. Mark it `// UNVERIFIED-SAMPLE` until D0 has the owner's real Axis and SBI statement SMS. Until then the bill comes from the manual "Add this month's bill". When parsed, add or replace `statements[]` by statement date and learn `statementDay` if it isn't set (asking first).

---

# PART C — Liabilities: cards, loans and EMIs

**Owner's decision (22 Nov):** no separate EMI engine for credit cards. With an EMI or no-cost EMI, the bank debits the full purchase on the card in that month and adds the EMI to the following bills. So:
- the purchase counts **once**, as spending in the month it was made;
- what you owe on the card comes from B3 (limit − available), which already includes the EMI amount the bank holds back;
- EMIs are tracked in a **Liabilities** section where the owner also manages loans.

### C0. Guard: the EMI-conversion credit (needs a real SMS)

Some banks send "₹X credited/reversed to your card for EMI conversion" when a purchase becomes an EMI. Today that would be read as a refund or income, so the month's spending would drop by the whole purchase. Add `kind: 'emi_conversion'`:
- type `transfer`, `excludeFromReports: true`, and it does **not** move the card balance;
- shown in Review → Check as "EMI conversion credit: not a refund" with **OK** / **It's a real refund**;
- `// UNVERIFIED-SAMPLE` until the owner pastes a real conversion SMS (D0).

### C1. Accounts → Liabilities section (`05-accounts*.png`)

Order on Accounts: net-worth card · Bank accounts · Wallets · **Liabilities** · Investments (collapsed).

- **Net-worth card:** the third tile is renamed **Liabilities**. When a card isn't set up, the warning line says "<card> not set up · its debt is not counted yet".
- **Liabilities header:** "LIABILITIES", with the total owed in red on the right. The total = cards' `owed` (B3, positive amounts only) + loans' outstanding. **It excludes card-EMI entries** (C2), because they are already inside the card's owed.
- **"Credit cards" group:** the B6 rows.
- **"Loans & EMIs" group:** one row per liability item. Each row shows an initials or icon badge, the name, a thin progress bar (EMIs paid / total), "₹EMI/mo · N left · next <date>", and the outstanding on the right.
  - A card-EMI row shows "· in card balance", a muted grey bar, and a muted amount, and isn't counted in the total.
  - Closed loans are hidden behind "Show closed (n)".
- **Add loan or EMI:** a dashed button at the end of the group.
- `utils/AccountsOverview.accountsOverview` gains `liabilities` and `groups.liabilities = { cards, loans }`. `owed` is replaced by `liabilities`; keep `owed` as an alias for one release.

### C2. Add or edit a loan or EMI (`14-add-loan-card-emi.png`)

Uses the existing Loan account type and `utils/LoanCalculator`, with new fields:

```js
{
  type: 'Loan',
  loanKind: 'personal'|'home'|'vehicle'|'gold'|'education'|'durable'|'cardEmi',
  name, originalAmount, interestRate, loanType: 'Reducing'|'Flat Rate'|'No Cost EMI',
  tenure, firstEmiDate, emiAmount,     // startDate kept for old loans = first EMI date − 1 month
  payFromAccountId, debitDay,          // bank loans
  onCardId,                            // cardEmi only
  includedInCard: true,                // cardEmi only: never added to Liabilities total or net worth
  status: 'active'|'closed', closedAt, prepayments: [{ date, amount }],
}
```

- **Type chips:** Personal · Home · Car / bike · Gold · Education · Consumer durable · EMI on credit card.
- **Fields:** Name; Amount; Months; Interest % a year (0 → `loanType: 'No Cost EMI'`); First EMI date; **EMI**, worked out with the reducing-balance formula and editable (owners copy it from the lender's app); Paid from (a bank account for loans, a card for card EMIs).
- **Note box:**
  - For card EMIs (warn tone): "Already in your card balance … This entry only tracks months left; it is not added to Liabilities again."
  - For loans (info tone): how the EMI is counted (C4).
- **Validation:** amount > 0, months 1–360, rate 0–60, EMI > 0, and EMI × months ≥ amount (warn, don't block, when the rate is 0).
- **From a transaction:** a card expense ≥ ₹1,000 gets the action "Track as EMI". It opens this screen prefilled (type `cardEmi`, amount, card, first EMI = the next statement date). The purchase itself is not changed.

**Fix in `utils/LoanCalculator.calculateOutstandingBalance` (bug found while checking the design numbers):**
- **Today:** it counts `monthsPassed` as calendar months since `startDate` and ignores the day of the month. A loan whose first EMI was 7 Aug therefore shows 3 EMIs paid on 22 Nov instead of 4 (₹538 too much still owed).
- **Change:** `paidCount(loan, asOf)` = the number of EMI dates (`firstEmiDate` + k months, same day; short months use the last day) that are on or before `asOf`, capped at `tenure`. Use it in all three loan types.
- **Old loans** with only `startDate` keep today's behaviour via `firstEmiDate = addMonths(startDate, 1)`.
- **Tests:**
  - first EMI 7 Aug 2026, ₹538 × 12, no-cost → on 22 Nov, 4 paid, ₹4,304 left; on 6 Dec still 4; on 7 Dec 5.
  - first EMI 31 Jan → 28/29 Feb counts.

### C3. Loan detail / manage (`16-loan-detail*.png`)

- **Header:** back, name, edit (opens C2).
- **Dark summary:** "Principal still owed", from the loan ledger (C6). The subtitle gives the amount, rate, rate kind and "from linked payments". Below it, a progress bar (principal repaid ÷ loan amount) and 3-up tiles: EMI, Paid "k of n", Ends (moves earlier after a prepayment that cuts the tenure).
- **Paid this financial year** (Indian FY, 1 Apr – 31 Mar): two tiles, Principal and Interest, plus **Export for tax filing (CSV)** (date, type, amount, principal, interest, charges, source). Only export the figures; do not label tax sections or give tax advice in the app.
- **Payments list** (newest first), with "+ Link a payment" (opens C6 for this loan):
  - each linked row shows its date, kind ("EMI 6", "Prepayment", "Fee", "Foreclosure", "Loan received") and amount, with chips for **Principal ₹x** (green) and **Interest ₹y** (red), and its source ("from SMS", "manual", or the bank/channel);
  - EMI dates that have passed with no linked payment are grouped ("7 Jun – 7 Sep · EMIs 1–4") and flagged "No SMS seen: counted from the schedule. Link them if you have them.";
  - tapping a row opens C6 to edit the split or unlink it.
- **Next EMI row:** date, amount, and its schedule split.
- **Actions:**
  - **Part-prepay:** opens C6 with the kind Prepayment and no transaction (manual), then asks **Reduce EMI** or **End sooner** (keep EMI, shorten tenure).
  - **Mark as closed:** status closed, outstanding 0, confirm first.
  - **Delete:** in the edit screen, with confirmation.
- For `cardEmi` items: no Part-prepay and no payment linking (the bank handles it on the card); "Mark as closed" still works.

### C4. Bank EMIs: link debits to a loan (`15-bank-emi-loan.png`)

1. **Detect:** bank debits with `ACH-DR`, `NACH`, `ECS`, `SI-` or "EMI" from the same payee, about monthly (25–35 days apart) on about the same day (±3), get the suggestion "Link to a loan" in Review → Check. Different amounts from the same lender are offered as separate loans (the owner's Bajaj Finance: ₹538 on 7 Nov and ₹160 on 7 Jul).
2. **Link screen:** the debits found; **New loan** (opens C2 prefilled: EMI, debit day, paid from, lender) or **Existing loan**. "Not a loan" dismisses the suggestion for that payee and amount.
3. **Recording (write the rule in a code comment and a test):**
   - Linking uses C6. Later debits from the same payee and amount link automatically as the next EMI.
   - What you owe follows the C6 ledger.
4. **Missed EMI:** if no linked debit has arrived by debit day + 2, notify "<lender> EMI not seen this month" (once per month per loan). Not for card EMIs.

### C6. Link payments to a loan: principal, interest, charges (`17-link-loan-payment.png`)

The owner asked to link loan transactions and see what went to principal and what to interest.

**Where it starts:**
- Transaction detail of a bank debit → action **Link to loan**
- Loan detail → **+ Link a payment** (shows candidate debits: same payee, or an amount within ±1% of the EMI, within ±5 days of an EMI date, newest first)
- Review → Check suggestions (C4)

**Screen:**
1. The transaction (payee, account, date, amount); a **Loan** picker.
2. **This payment is** (chips):

   | Kind | Default split | Effect on what you owe |
   |---|---|---|
   | EMI | from the schedule for the next unpaid EMI number | − principal |
   | Prepayment | all principal | − principal, then asks Reduce EMI / End sooner |
   | Fee / penalty | all interest & charges (late fee, bounce charge, processing fee, GST) | none |
   | Foreclosure | outstanding as principal; the rest as charges | → 0, loan closed |
   | Loan received | money in from the lender | sets `originalAmount` if the loan is new |

3. **Split:** two editable amounts, Principal and Interest & charges. They must add up to the transaction amount (show the difference and block Save until they do). The note shows where the default came from ("EMI 6 of 24 · from the schedule, edit to match your lender").
4. **Count in budget as** (a per-loan setting, Segmented): **Full payment** (default; the whole EMI is Loan/EMI spending) or **Interest only** (only interest and charges count as spending; the principal is treated as repaying debt). Note: "Net worth is the same either way."

**Data** (inside the transaction JSON):
```js
loanLink: { loanId, kind: 'emi'|'prepayment'|'charges'|'foreclosure'|'disbursal',
            emiNo, principal, interest, source: 'schedule'|'manual' }
```
- One transaction links to one loan. An amount larger than the EMI (EMI + bounce charge) is split by the owner as principal + interest + charges in the interest field.
- **Loan received** becomes `type: 'transfer'` (loan → bank), never income.
- Unlinking removes `loanLink` and restores the transaction's previous category and type.

**Loan ledger (new pure `utils/LoanLedger.js`)** replaces the "schedule only" rule from C4:
- `ledger(loan, txs, asOf)` → `{ rows, principalOwed, paidCount, nextEmi, fy: { principal, interest } }`.
- `principalOwed` = `originalAmount` − Σ principal of linked payments − Σ principal of **scheduled EMIs that are due but have no linked payment** (assumed paid and flagged in the UI) − manual prepayments.
- A due EMI counts as "linked" when a payment with `kind: 'emi'` and that `emiNo` exists. An EMI linked later replaces its assumed row, so nothing is counted twice.
- After a prepayment the schedule is rebuilt from that date: `reduceEmi` gives a new EMI over the same remaining months; `endSooner` keeps the EMI with fewer months (the last EMI is smaller).
- The default split for the next EMI = interest on `principalOwed` at the monthly rate; principal = EMI − interest. For no-cost EMI, interest = 0.
- `LoanCalculator.calculateOutstandingBalance` becomes a thin wrapper over `ledger(...).principalOwed` for loans with any linked payment; old behaviour otherwise.
- **Budget and reports:** linked rows keep `type: 'expense'`. In **Interest only** mode, reports exclude `loanLink.principal` from spending (a computed adjustment; do not change the stored amount). The FY totals use `loanLink` splits.
- **Net worth:** the bank goes down by the full payment (as today), and the loan goes down by the principal part, so only interest and charges reduce net worth.

### C5. Net worth

`computeNetWorth`: liabilities = Σ card `owed` (B3, positive only) + Σ loan outstanding where `!includedInCard && status === 'active'`. An overpaid card is an asset (B3).

# PART D — Testing

### D0. Fixtures needed from the owner (ask; don't invent)

Add to `__fixtures__/sms/owner_real_samples.json` once the owner pastes them:
1. An Axis credit card **statement** SMS
2. An SBI credit card **statement** SMS
3. An **EMI conversion** SMS (any bank), especially one saying the amount was credited or reversed (C0)
4. A NACH/ECS loan EMI SMS other than Bajaj, if any

Until then, the parsers in B7/C3/C4 stay `UNVERIFIED-SAMPLE` and their tests use clearly fake samples named `synthetic-*`.

### D1. Unit tests (pure)

| File | Cases |
|---|---|
| `TransactionList.test.js` | the A1 cases plus the property test |
| `ai/AiClient.test.js` | the A2 cases (thinkingConfig, retry, cache, error text, fallback) |
| `CardMath.test.js` | owed from limit (`300000 − 274919.19 = 25080.81`); spends and payments after the available-limit SMS; statement fallback; history fallback marked estimate; overpaid → asset; `cycleWindow` (15th; 31st in Feb; leap year; on the statement day itself); `cycleSpend` with a refund; `currentBill` partial payment, full payment, overdue; `owedParts` sum = owed |
| `LoanCalculator.test.js` (extend) | EMI formula: ₹25,000, 15%, 12 months → ₹2,256.46; outstanding after 3 EMIs = ₹19,094.92; no-cost ₹6,456 / 12 = ₹538 with 8 left = ₹4,304; prepayment reduces outstanding; closed = 0 |
| `AccountsOverview.test.js` (extend) | the liabilities total excludes `includedInCard` and closed loans; an overpaid card counts as an asset; the `owed` alias still works |
| `LoanLink.test.js` | detects monthly ACH from the same payee; separates different amounts; ignores one-offs; auto-links later debits; missed-EMI check; no double count in net worth |
| `LoanLedger.test.js` | Example loan ₹2,00,000, 12%, 24 months, first EMI 7 Jun 2026 → EMI ₹9,414.69; EMI 6 split ₹7,792.91 + ₹1,621.78; after 6 EMIs ₹1,54,384.71 owed. A ₹10,000 prepayment on 15 Nov → ₹1,44,384.71; FY principal ₹55,615.29 and interest ₹10,872.85; next EMI split ₹7,970.84 + ₹1,443.85; End sooner → 17 EMIs left, ends Apr 2028; Reduce EMI → new EMI over 18 months. Also: an assumed EMI replaced by a later link (no double count); the split must sum to the amount; fee kind leaves the owed amount unchanged; foreclosure closes the loan; disbursal is a transfer, not income; unlink restores the old category; Interest-only mode removes principal from spending but not from net worth |
| `TransactionParser` (C0) | the conversion credit → `emi_conversion`, excluded, no balance move (synthetic until D0) |
| `BalanceService.test.js` | card net worth uses `cardOwed`; `emi_conversion` doesn't move balances |
| `property/Loan.property.test.js` | fast-check: for any amount 1k–1Cr, rate 0–36% and months 1–360, outstanding is non-increasing month by month, never below 0, and 0 after the last EMI |

### D2. Integration (in-memory SQLite, owner fixtures)

- Phase 12 flow → "Add all" → set up Axis card (limit 3,00,000, statement day 15). Card detail shows `owed = 25,080.81`, and the old −4,857.94 is shown as the difference and is fixed only after Save.
- Add a ₹25,000 card purchase, then "Track as EMI" (12 months, 15%). The purchase month's spending includes ₹25,000 once; the Liabilities total and net worth are unchanged by the EMI entry; Card detail shows "Phone EMI added on <statement date>".
- Link the Bajaj ₹538 debit to a new loan. The budget shows ₹538 Loan/EMI; the Liabilities total = card owed + loan outstanding; net worth changes only by the schedule.

### D3. Screen tests (RNTL)

- **Accounts:** the set-up card row shows owed and "Pay ₹X by <date>"; the not-set-up row shows **Set up**; labels have no repeated digits.
- **Accounts:** the Liabilities section renders both groups; the card-EMI row says "in card balance" and its amount is excluded from the header total.
- **Card detail:** Record payment pre-fills `left`; Overdue badge when past due; the "EMIs on this card" row appears only when tracked EMIs exist.
- **Add loan:** choosing "EMI on credit card" switches Paid from to a card picker and shows the warn note; the EMI works itself out from amount, months and rate.
- **Loan detail:** Part-prepay updates "Principal still owed"; Mark as closed asks for confirmation; the payments list shows Principal/Interest chips; assumed EMIs are grouped and flagged; the FY tiles match the ledger.
- **Link to a loan:** each kind chip sets the default split; a split that doesn't add up blocks Save; Loan received shows as a transfer afterwards.
- **Card setup:** validation messages; the overpaid explanation appears when history < 0.
- **Onboarding, Bootstrap, ErrorBoundary:** background and contrast (A3).
- **AI assistant:** a failed Gemini shows the Groq hint and the Add key button.

### D4. Phone checklist (add to `docs/device-test-results.md`, all pending)

1. Fresh install with the phone in dark mode: Welcome, loading and lock screens are readable.
1a. Switching to another app and back keeps you on the same screen with your typing intact (A6), with the lock on and off.
2. No account or card number appears twice anywhere (Transactions chips, rows, Accounts, Review, pickers).
3. AI Test shows "Working · <model>" in under 10 s, and a question gets an answer.
4. Set up Axis card ••9070 with your real limit and statement day. "You owe" matches the Axis app (±₹1).
5. After the next statement: the bill shows the right total, minimum and due date; paying from Axis marks it paid; the reminder fires 3 days before if unpaid.
6. Add a real card EMI under Liabilities; months left and the EMI match the bank app; the Liabilities total doesn't count it twice.
7. Link Bajaj Finance: next month's ACH debit links by itself; the loan's outstanding amount matches the Bajaj app.
8. Add any other loan you have; the net worth change equals its outstanding amount.
9. Link a real EMI and enter the split from your lender's statement or app; "Principal still owed" matches the lender (±₹1). Link a prepayment and check the new end date against the lender.

---

# PART E — Order and done

| # | Tasks |
|---|---|
| 1 | A6 (app returns to Home), A1, A3, A5 |
| 2 | A2 Gemini |
| 3 | A4 + B2 data + B3 CardMath (test first) |
| 4 | B4 setup, B5 detail, B6 Accounts rows |
| 5 | C1 Liabilities section + C5 net worth (test first) |
| 6 | C2 add/edit, C3 loan detail (prepayments in LoanCalculator) |
| 7 | C6 loan ledger (test first), then C6 screen, then C4 detection and auto-link |
| 8 | B7 statement SMS + C0 conversion credit, once D0 fixtures arrive |
| 9 | D gaps, docs, README section "Credit cards and liabilities" |

**Done when:**
- [ ] lint, format:check, test:tz and test:coverage are green; new pure modules (`CardMath`, `LoanLedger`, loan link) and the changed `LoanCalculator` are each ≥ 90% lines and branches.
- [ ] No duplicated digits in any account label (test plus phone check).
- [ ] No card balance or net-worth change is applied without the owner confirming it.
- [ ] A card EMI is never counted twice (test + phone check D4.6).
- [ ] Every `UNVERIFIED-SAMPLE` parser is listed in the README with what is missing.
- [ ] D4 items listed as pending.
