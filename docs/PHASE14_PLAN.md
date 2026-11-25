# WealthManager — Phase 14 Claude Code Plan: organise transactions + six new features

Put this file at `docs/PHASE14_PLAN.md`. Requested by the owner on 25 Nov 2026.

- **Part A:** after changing a transaction's **payee name, category and/or tags**, offer to copy those changes to the same payee's other transactions, and to future ones
- **Part B:** the Transactions list gets sort, a full filter sheet, totals for what's shown, and a select mode for bulk changes
- **Part E:** five more features: upcoming bills, categorise from the notification, splits and People, refund matching, month in review (Drive backup dropped: the owner uses manual export)
- **Part C:** testing for A and B (Part E carries its own tests)
- **Part D:** order of work and definition of done

## Visual reference: `docs/design/`

Where an image and the text differ, follow the text. Payees, dates and amounts in the images are examples.

| Image | Screen | Spec |
|---|---|---|
| `18-update-similar.png` | Bottom sheet after saving changes to payee, category and tags | A3 |
| `19-transactions-sorted-filtered.png` | Transactions with active filters, totals, sort | B1, B2 |
| `20-filter-sheet.png` | Sort & filter sheet | B3 |
| `21-select-mode.png` | Select mode with bulk actions | B5 |
| `22-upcoming-bills.png` | Upcoming bills, next 30 days | E2 |
| `23-notification-actions.png` | Category buttons on capture notifications | E3 |
| `24-split-transaction.png` | Split a transaction (categories + a person) | E4 |
| `25-people.png` | People: who owes whom, settle suggestion | E4 |
| `26-refund-match.png` | Match a refund to its purchase | E5 |
| `27-month-summary.png` | Month in review | E6 |

## 0. Ground rules

Same as `docs/PHASE12_PLAN.md` §0 and `docs/PHASE13_PLAN.md` §0:
- Start with a green baseline: `npm ci`, then `npm run lint`, `npm run format:check`, `npm run test:tz` and `npm run test:coverage`.
- One commit per task ID; test first for pure logic; money uses `round2`; no logging of SMS bodies or payee lists.
- Phone checks are **pending** in `docs/device-test-results.md` until the owner confirms them.

Additional rules for this phase:
- **Bulk changes are reversible.** Any change to more than one transaction (A4, B5) keeps an undo record until the next bulk change or 10 minutes, whichever comes first.
- **Balances.** Bulk changes go through the same `updateInDb` path as single edits, so account balances stay right (changing type or account moves balances; changing category or tags does not).

---

# PART A — Update similar transactions

### A1. What already exists (don't duplicate it)

- `utils/FinanceTools.applyCategoryRules(tx, rules)`: **substring** rules (`pattern` → `category`), first match wins, stored in `category_rules`. They are applied **only to SMS/Gmail captures** when stored (`TransactionRepo.persistMany`).
- `screens/ToolsScreen.js` has a "Category rules" tab and a "Bulk edit & export" tab (`FeatureService.bulkUpdate`, `bulkDelete`). Neither is easy to find.
- `components/ui/TransactionRow.payeeOf(tx)` picks the displayed payee: `merchant || counterparty || title (≠ category) || …`.

### A2. Same payee: new pure `utils/PayeeMatch.js`

- `payeeKey(tx)` → a normalised key or `null`:
  - Take the source: `tx.vpa` if present (exact, lowercase), else `merchant || counterparty || payeeOf(tx)`.
  - Normalise: lowercase; `&` → `and`; drop punctuation; collapse spaces; drop trailing noise words (`pvt`, `ltd`, `private`, `limited`, `llp`, `india`, `inc`, `store`, `payments`), and drop trailing 4+ digit runs and ref-like tokens (`[a-z]*\d{6,}`).
  - Return `null` for generic payees that must never group: empty; `transfer`, `upi transfer`, `atm`, `cash`, `transaction`; and anything that equals a category name.
  - Examples: `"SWIGGY INST"` and `"Swiggy Instamart"` are **different** keys (no fuzzy matching; see A6 for aliases). `"Shri Manjunath Medi"` and `"SHRI MANJUNATH MEDI"` are the same key. A VPA `abc@okaxis` beats any name.
- `diffEdit(before, after)` → `{ name?: { from, to }, category?: { from, to }, tags?: { add: [], remove: [] } }`, covering only what the owner changed in this save.
  - Tags compare after `normalizeTag`; system tags (`auto-sms`, `auto-sync`) are ignored.
  - Changing only amount, date, account, files or "count in reports" gives `{}` (no sheet).
- `findSimilar(before, after, all)` → `{ matches, skipped, changes }`:
  - **Match on the payee as it was before the edit** (`payeeKey(before)`), because the other transactions still carry the old name. Also match rows that already carry the new name (`payeeKey(after)`), so a second rename pass finds them.
  - same `type` (an expense never matches an income), not the edited transaction itself, not deleted;
  - a row is in `matches` when **at least one** selected change would alter it:
    - its name ≠ new name;
    - its category ≠ new category;
    - it lacks an added tag, or has a removed tag;
  - each match carries `willChange: ['name','category','tags']` for the row subtitle;
  - `skipped`, with a reason:
    - `'loan'`: `loanLink` present (category and name are owned by the loan);
    - `'transfer'`: `type === 'transfer'`.
  - **Rows the owner set by hand:** these are *not* skipped. A row whose category has `categorySource === 'user'` keeps its category, but still gets the name and tag changes. It is counted in "1 with a category you set by hand keeps it". Same for `nameSource === 'user'` (A5) and the name.
  - sorted newest first.

### A3. The prompt (`18-update-similar.png`)

**When:** in `EditTransactionScreen.handleSave`, *after* the single update succeeds, if `diffEdit` is non-empty and `findSimilar` returns at least one match. Don't navigate back until the sheet closes.

**Sheet:**
- **Title:** "Apply to N more from this payee?" Body: "Other transactions from **<old payee name>**. Pick which of your changes to copy."
- **Changes card:** one checkbox row per changed field, all ticked by default:
  - **Payee:** ~~SWIGGY INST~~ **Swiggy Instamart**
  - **Category:** ~~General~~ **Food**
  - **Tags:** **+ #groceries** (and **− #work** for a removed tag; several tags on one line, wrapping)

  Unticking a change removes it everywhere (from the update and the future rule). With none ticked, Update is disabled.
- **Transactions list:** up to 3 rows (date, "now <category> · <tags>", amount), each a round checkbox, all ticked. Then "+ k more" (expands the full list inside the sheet) and, when relevant, "· m with a category you set by hand keeps it" / "· m skipped (loan payments)".
- **N** in the title and button = ticked rows that at least one ticked change would alter. It updates live.
- **"Also for future SMS" switch** (on by default). Its subtitle repeats the ticked changes: "SWIGGY INST: rename to Swiggy Instamart · Food · #groceries".
- **Buttons:** **Only this one** (secondary), **Update N** (primary). Back or swipe down = Only this one.

**After Update N:** one `bulkApply(ids, changes)` call (FeatureService) that, per row:
- **name** → `merchant = to`, `title = to`, `nameSource: 'bulk'` (unless the row's `nameSource === 'user'`);
- **category** → `category = to`, `categorySource: 'bulk'` (unless the row's `categorySource === 'user'`);
- **tags** → `tags = unique(tags − remove + add)`, keeping system tags;
- writes through `updateInDb`, inside one `atomic` batch;
- records undo (B6).

Then go back and show "Updated N transactions · **Undo**" (10 s). Undo restores each row's previous `merchant`, `title`, `category`, `tags`, `categorySource` and `nameSource`, and removes a rule created by this action.

Budgets, reports, Home and tag searches read from storage, so they refresh on focus. Check Budget recalculates and `#groceries` search shows the updated rows.

### A4. Same bulk path from the Transactions list

In select mode (B5), the "Category", "Payee name" and "Tag" actions use the same `bulkApply` and snackbar Undo, but no "same payee" lookup (the owner chose the rows).

### A5. Remember who set a category or name: `categorySource`, `nameSource`

New fields on transactions: `categorySource` and `nameSource`, each `'parser' | 'rule' | 'user' | 'bulk' | 'ai'`. `nameSource` follows the same rules as below for the payee name (the owner editing the Payee field sets `'user'`). Tags need no source: rules only ever **add** tags and never remove one the owner added.
- Parser/AI captures set `'parser'`/`'ai'`; `applyCategoryRules` sets `'rule'`.
- `EditTransactionScreen` save sets `'user'` when the category changed; A3/B5 set `'bulk'`.
- Old rows have none: treat them as `'parser'` (they can be updated in bulk).

Rules (A6) **never** overwrite a category or name whose source is `'user'` or `'bulk'`. In the A3 sheet, `'user'` rows stay in the list: their category and name are left alone, and they still get the other changes.

### A6. Payee rules (future transactions) and the rules screen

- Extend the `category_rules` items:
  ```js
  { id, kind: 'payee' | 'contains', payeeKey?, pattern?,
    category?, rename?, tagsAdd?: [], tagsRemove?: [],   // at least one of these
    createdAt, hits: 0 }
  ```
  Existing items without `kind` are `'contains'`.
- `applyCategoryRules(tx, rules)`:
  - **payee rules first** (exact `payeeKey(tx) === rule.payeeKey`), then `contains` rules in order;
  - sets `category` (`categorySource: 'rule'`), `merchant`/`title` when `rename` is set (`nameSource: 'rule'`), and adds `tagsAdd` / removes `tagsRemove` (tagsRemove only removes tags that a rule added, never the owner's);
  - a payee rule matches on the **original** SMS payee key, so later SMS still saying "SWIGGY INST" are renamed and categorised;
  - increments `hits` (stored when the batch is saved).
- Apply rules to **every new transaction** that has no user-chosen category: SMS, Gmail, statement import, and recurring postings. Manual Expense/Income entry: only pre-fill the category picker (the owner can change it).
- **Merging rules:** saving a rule for a payee that already has one merges them: the newest value wins per field, and tag lists are unioned. The rules screen shows one line per payee: "SWIGGY INST → Swiggy Instamart · Food · #groceries · used 14 times".
- **Rules screen:** move it from Tools to **Settings → Categories → Payee rules**:
  - list rules: "SWIGGY INST → Swiggy Instamart · Food · #groceries · used 14 times";
  - swipe or ⋯ for Edit / Delete;
  - an **Add rule** sheet: payee (from a recent-payee picker) or "contains text", then any of: rename to, category, tags to add;
  - "Apply to past transactions now" on a rule runs the A3 sheet logic for that rule.
- **Remove the Tools tabs** "Category rules" and "Bulk edit & export" once A6 and B5 ship (Tools keeps the rest).

---

# PART B — Transactions: sort, filter, totals, select

### B1. Query model: new pure `utils/TransactionQuery.js`

```js
query = {
  text: '',                        // existing parseSearch: words + #tags
  date: { preset: 'all'|'thisMonth'|'lastMonth'|'last3'|'thisFY'|'custom', from?, to? },
  types: [],                       // 'expense'|'income'|'transfer'; empty = all
  accountIds: [], categories: [],  // empty = all
  amountMin: null, amountMax: null,
  flags: [],                       // 'needsReview'|'hasFile'|'hasTags'|'notInReports'|'loanPayments'|'manual'|'sms'
  sort: 'newest'|'oldest'|'amountDesc'|'amountAsc'|'payee',
}
```

- `runQuery(rows, query, asOf)` → `{ rows, totals: { count, spent, income, transfers } }`:
  - filters with AND across groups and OR inside a group;
  - `thisFY` = 1 Apr – 31 Mar (Indian FY);
  - dates are compared in local time (CI runs IST and UTC);
  - `spent` follows the report rules: expenses where `!excludeFromReports`, and in a loan's Interest-only mode only interest (reuse the existing report helper; don't re-implement it);
  - sorting is stable; ties break by `fullDate` desc, then `id`. `payee` sort uses `payeeOf`, compared with `localeCompare(…, 'en-IN', { sensitivity: 'base' })`.
- `activeFilterChips(query, accounts)` → `[{ key, label }]` for the chip row ("November", "Expenses", "Axis Card ••9070" using the A1 label format, "₹500–₹2,000", "Has file"…).
- `removeChip(query, key)` and `defaultQuery()`.
- Keep `utils/FinanceTools.filterHistory` working (export uses it) or make it call `runQuery`.

### B2. Transactions screen (`19-transactions-sorted-filtered.png`)

- **Header:** back, title, **Select** (B5), export (exports what's shown: `runQuery(...).rows`).
- **Search row:** the search field, plus a **Filter** button (ink square) with a count badge of active filters (sort doesn't count). `accessibilityLabel` "Filters, N active".
- **Chip row** (only when filters are active): one removable chip per active filter, then **Clear all**. Replaces today's always-visible account chips and tag chips.
- **Summary row:** "**N** transactions · spent **₹X**" (add "· income ₹Y" when income > 0), and on the right a **sort button** showing the current sort. Tapping it opens a small menu (the 5 options), so you don't need the full sheet to change the sort.
- **List:** with the `newest`/`oldest` sort, day headers with day totals (as now). With any other sort, a flat list where each row shows its date in the subtitle ("9 Nov · Food").
- Use `SectionList`/`FlatList` with `keyExtractor`, `initialNumToRender: 20`, `windowSize: 10`, and a memoised `runQuery`; it must stay smooth with 5,000 rows (D2).
- **Opening with a filter:** Card detail "See all" and Home's category tiles open the list with a query (`navigation.navigate('Transactions', { query })`). This replaces the current `accountId` param (keep it working as a shortcut).
- **Persistence:** keep the query while the app is open (A6 of Phase 13 keeps the screen mounted). Remember the **sort** across restarts (`tx_list_sort`). Filters reset on restart.
- **Empty state:** "No transactions match these filters" with **Clear filters**.

### B3. Filter sheet (`20-filter-sheet.png`)

A bottom sheet (near full height, scrolls), with sections in this order:
1. **Sort by:** chips for the 5 options, single choice.
2. **Date:** This month · Last month · Last 3 months · This FY · Custom… (a date-range picker; validate from ≤ to).
3. **Type:** a 3-way multi-select (Expense, Income, Transfer).
4. **Accounts:** a chip per account (A1 label format), multi.
5. **Categories:** the 5 most used chips + "+ N more" (expands to all), multi.
6. **Amount:** Min / Max inputs, numeric; if max < min, show an inline error and disable Show.
7. **Show only:** Needs review · Has file · Has tags · Not in reports · Loan payments · Added by hand · From SMS.

Footer: **Reset** (back to `defaultQuery()` except the sort) and **Show N transactions** (live count from `runQuery`; "No matches" disables it). Closing without Show discards the changes.

### B4. Home and Budget shortcuts

- Budget → tap a category row → Transactions with `{ date: that month, categories: [c], types: ['expense'] }`.
- Home "Spent this month" → Transactions with `{ date: thisMonth, types: ['expense'] }`.

### B5. Select mode and bulk actions (`21-select-mode.png`)

- **Enter:** the **Select** button, or long-press a row (the pressed row starts selected).
- **Header:** ✕ (exit), "N selected · ₹X" (the sum of the selected expenses' amounts), **Select all M** (all rows matching the current query, not only the visible ones).
- **Rows:** a round checkbox on the left, selected rows tinted; tap toggles; `accessibilityRole="checkbox"` with `checked`.
- **Payee name** is in the header ⋯ menu ("Rename payee…"), since the action bar holds 5.
- **Action bar** (bottom, fixed), 5 actions:
  - **Category:** a picker, then `bulkUpdate` with `categorySource: 'bulk'`, plus Undo.
  - **Tag:** add a tag (or remove one already on all selected), plus Undo.
  - **Account:** a picker; only for non-transfer rows; balances move via `updateInDb`; plus Undo.
  - **Not in reports:** toggles `excludeFromReports` (if all are already excluded, the action reads "Count in reports"), plus Undo.
  - **Delete:** confirm "Delete N transactions? Their files are deleted too." Undo is not offered for delete; the confirmation is the guard.
- Rows linked to a loan or merged transfers are skipped for Category/Account changes, with a note "k skipped (loan payments / transfers)".
- Leaving the screen or pressing Android Back exits select mode first.
- **Export selected** (⋯ in the header): CSV/XLSX of the selected rows.

### B6. Undo store: new pure `utils/UndoStore.js`

- `recordBulk(kind, beforeRows, extra)` and `undoLast()` → restores `before` values for exactly the changed fields; removes a rule created by the action.
- One level, in memory, expires after 10 minutes. Undo after a later edit of the same row restores only the fields this action changed, unless the row was changed since (then that row is skipped and the snackbar says "k changed since, kept").

---

# PART E — More features (owner asked for these on 25 Nov)

Each feature is its own task group with tests; ship them in the order of Part D. All of them reuse what Parts A and B add (`payeeKey`, `TransactionQuery`, the report helper, `UndoStore`).

### E1. Backup: not in this phase

The owner decided on 25 Nov to keep using **manual export** (Settings → Backup → Export, encrypted file through the share sheet). Don't add Google Drive backup, Drive scopes, Android Auto Backup or any automatic backup in this phase, and leave the backup screen as it is.

- Manual export already sets `last_backup_at` (`screens/BackupScreen.js`), so Home's "No backup yet" banner goes away after an export. Keep it that way: nothing in this phase should change it.

### E2. Upcoming bills (`22-upcoming-bills.png`)

- **Sources**, merged in a new pure `utils/UpcomingBills.js` → `upcoming(asOf, days = 30)`:
  1. credit card bills: `CardMath.currentBill` (amount left and due date);
  2. loan EMIs: `LoanLedger.ledger(...).nextEmi`, skipping `includedInCard`;
  3. manual recurring entries: `RecurringEngine.dueDatesUpTo`;
  4. **detected subscriptions:** new pure `utils/RecurringDetect.js`;
  5. autopay mandate SMS: "mandate … set/paused/cancelled", parsed into `{ payee, amount, status, pausedUntil }` (`// UNVERIFIED-SAMPLE` except the owner's OpenAI "paused" SMS, which is already a fixture).
- **`RecurringDetect.detect(txs)`:**
  - group expenses by `payeeKey`;
  - a series needs ≥ 3 occurrences (or 2 plus a mandate SMS) with a stable interval: monthly 26–35 days, weekly 6–8, yearly 350–380;
  - amounts within ±10% (exact for EMIs);
  - next date = last + median interval; next amount = last amount;
  - `confidence` comes from the count and spread.
  - Detected items start as **suggestions** ("Review 2 found"); confirmed ones become saved bills (`recurring_bills` store), and "Not a bill" dismisses that payee.
- **Screen:**
  - **Summary card:** "Next 30 days · <range>", the total, and "<main bank> after these: ₹X" (that bank's balance minus the bills paid from it, card bills counted against the bank they were last paid from);
  - a **month-grouped list** (weekday + day, name, source line, amount);
  - a **Paused** group (mandates with `pausedUntil`);
  - a warn line for cards not set up;
  - **Add a bill** and **Review N found**.
  - Home gets a small "Next bill: Axis Card ₹3,914 · 5 Dec" row linking here.
- **Reminders:** optional per bill, 2 days before. The card and loan reminders already exist, so don't double up.
- **Tests:**
  - `RecurringDetect.test.js`: monthly/weekly/yearly detected; jittered dates OK; amount drift ±10% OK, 20% not; 2 occurrences without a mandate → nothing; a dismissed payee stays dismissed; month-end dates (31st → 30th/28th).
  - `UpcomingBills.test.js`: merge, sort, 30-day window edges, card not set up → warn item, paused mandate, no duplicate when a detected series is also a loan or card bill.

### E3. Categorise from the notification (`23-notification-actions.png`)

- On each captured debit, `NotificationService` sends the notification with a **category** `tx_actions` (`Notifications.setNotificationCategoryAsync`). It has 3 buttons:
  - no category yet: the 3 categories most used for this payee, else the 3 most used for this account in the last 90 days;
  - a rule already chose one: the next 2 likely ones + **Not mine**.
- **Tapping a button:**
  - updates the transaction (`categorySource: 'user'`) and posts a quiet confirmation "Saved as Food";
  - **Not mine** marks it `reviewStatus: 'disputed'` and opens the app to the transaction.
  - It also offers the A3 "apply to similar" next time the app opens (a Review card "You categorised 3 from notifications · apply to similar?"), never silently.
- **App killed:**
  - handle the response in a registered background notification task (`Notifications.registerTaskAsync` + `TaskManager.defineTask`), with `opensAppToForeground: false` on the actions.
  - **Verify on the phone.** If Android/Expo doesn't deliver the response while killed, fall back to opening the app straight into the transaction with the chosen category pre-selected. Don't claim it works until device check E-3 passes.
- **Settings toggle:** "Category buttons on notifications" (default on).
- **Tests:**
  - `NotificationActions.test.js`: button choice (payee history, account history, rule present); a response handler updates the right transaction and is idempotent (two taps → one update); Not mine;
  - the category is registered once.

### E4. Split a transaction and People (`24-split-transaction.png`, `25-people.png`)

- **Data:**
  - transaction gets `splits: [{ id, amount, category?, personId? }]`; exactly one of category or person per part. Parts must sum to `amount` (block Save and show the difference).
  - New stores `people: [{ id, name, payeeKeys: [], upiId? }]` and `ious: [{ id, personId, amount, direction: 'owedToMe' | 'iOwe', txId?, note, date, settledAt?, settledByTxId? }]`.
- **Split screen** (from Transaction detail → "Split"):
  - parts with a category and an amount;
  - **+ Category**, **+ Person** ("Paid for someone": that part becomes an IOU owed to you and isn't your spending);
  - **Split equally with people…** (pick people; it divides the amount, and the rounding remainder goes to you);
  - a live "Adds up to ₹X · Your spending ₹Y" bar.
  - Removing the split restores the single category.
- **Reports:**
  - the shared report helper uses split parts in place of the transaction's category: person parts count as neither spending nor income; category parts count in their category.
  - Budget, Month summary (E6), category filters (B1 matches if any part matches) and exports (one row per part, with a "Split of" column) all follow.
- **People screen** (Accounts → People row, plus a Home shortcut when something is owed):
  - totals **Owed to you** / **You owe**, and a row per person with the net and the latest items;
  - **Record "I owe"** (manual IOU);
  - a person's detail lists items, with **Remind** (shares a text through the Android share sheet: "Hi Ravi, ₹500 for Amazon (12 Nov). UPI: <owner's UPI ID from Settings>") and **Mark settled**.
- **Settle suggestion:**
  - an incoming credit whose `payeeKey` is in a person's `payeeKeys` (learned the first time the owner confirms), or whose counterparty name starts with the person's name, with an amount ≤ their open balance → a card "₹500 received from RAVI K. Is this Ravi paying you back?";
  - **Yes, settle** marks the IOUs settled (oldest first, partial allowed) and turns that credit into `kind: 'settlement'` (not income, `excludeFromReports`);
  - **No, it's income** dismisses it.
- **Net worth:** owed-to-you counts as an asset and you-owe as a liability, shown as a "People" row in Accounts (Liabilities shows "You owe people").
- **Part A interaction:** `findSimilar` skips split rows for the category change (reason `'split'`); the name and tags still apply.
- **Tests:**
  - `Splits.test.js`: sum validation; the equal split's rounding goes to the owner; reports by category with splits; person parts excluded from spending; unsplit restores; export rows.
  - `People.test.js`: IOU totals and net per person; settle oldest first; partial settle; the suggestion matches on a learned payeeKey and on a name prefix, never on amount alone; a settled credit isn't income; net worth includes IOUs.

### E5. Refund matching (`26-refund-match.png`)

- **Detect refund-like credits:**
  - SMS words `refund`, `refunded`, `reversal`, `reversed`, `return`;
  - or a credit on a credit card from a merchant the owner has paid before.
  - Cashback is not a refund: it stays income, category Cashback.
  - Mark them `refundCandidate: true`. This shows in Review → Check and as a filter flag in B3.
- **New pure `utils/RefundMatch.js` `candidates(refund, txs)`:**
  - expenses from the 120 days before, on the same account or with the same `payeeKey`, with amount ≥ refund − already refunded;
  - scored: exact amount + same account + same payee best; then same payee; then same account;
  - the top one is labelled "Best match". A split purchase is shown as "would be a part refund".
- **Link:**
  - the refund gets `refundOf: <txId>` and stays in the list (type `income`, but excluded from income totals);
  - the report helper subtracts it from the original's **category and month** (as the sheet says: "November Shopping goes down by ₹1,499");
  - several partial refunds may link to one purchase, up to its amount;
  - both rows show a "Refunded ₹X" / "Refund of …" chip and open each other.
  - **Not a refund** clears the flag and keeps it as income. Unlink restores it.
- **Card cycles:** `CardMath.cycleSpend` already subtracts card refunds from "this cycle". Keep that, and don't double-count.
- **Tests (`RefundMatch.test.js`):**
  - candidate ordering;
  - the 120-day window;
  - partial refunds can't exceed the original;
  - a split original;
  - report totals: the original month goes down and income doesn't go up;
  - unlink restores;
  - cashback is never a candidate.

### E6. Month in review (`27-month-summary.png`)

- **New pure `utils/MonthReview.js` `review(month, txs, budgets)`** → `{ spent, prevSpent, delta, deltaPct, income, saved, savedPct, top: [4 categories], restTotal, restCount, overBudget: [{ category, by, budget }], underCount, notes: [] }`.
  - Use the shared report helper, so splits, refunds, transfers, excluded rows and Interest-only loans all count correctly.
  - `notes` (up to 3):
    - the most frequent payee group, e.g. "Food delivery 9 times (₹3,210)": group payees using `RecurringDetect`'s payee keys and a small built-in map (swiggy/zomato → delivery, uber/ola/rapido → rides);
    - uncategorised count;
    - setup nudges (a card not set up, no backup in 7 days).
- **When:**
  - on the 1st of each month at 9:00 local, a notification "Your November summary is ready". Use a monthly calendar trigger if `expo-notifications` supports it on Android in SDK 54; otherwise schedule the next one each time the app opens.
  - Home shows a "November in review" card for the first 7 days of the month.
  - The screen can open any past month (a month switcher in the header menu).
- **Share:** a plain-text summary through the share sheet (no amounts of individual payees).
- **Tests (`MonthReview.test.js`):**
  - figures from fixtures: delta and percent, savedPct with 0 income (shows "—"), top 4 + rest add up to spent;
  - over-budget list; notes chosen correctly;
  - month boundaries in IST and UTC;
  - refunds and splits counted as in E4/E5.

### E7. Phone checklist additions (pending)

- **E-1:** export a backup manually; Home's backup banner is gone.
- **E-2:** Upcoming bills lists the Axis card bill, the Bajaj EMI and Google, with correct dates; confirming a detected bill keeps it next month.
- **E-3:** with the app closed, tap a category button on a capture notification; open the app; the transaction has that category.
- **E-4:** split an order, part to Ravi; Budget counts only your part; Ravi's UPI payment back is suggested as a settlement.
- **E-5:** a real refund SMS is matched to its purchase; that month's spending goes down; income doesn't go up.
- **E-6:** on the 1st, the summary notification arrives and the numbers match Reports for that month.

---

# PART C — Testing

### C1. Unit (pure)

| File | Cases |
|---|---|
| `PayeeMatch.test.js` | case/punctuation/space normalisation; `pvt ltd` dropped; ref digits dropped; VPA wins over name; generic payees → null; a category name → null; "SWIGGY INST" ≠ "Swiggy Instamart" by key. `diffEdit`: name only, category only, tags add/remove only, all three; amount/date/account/files-only edits → `{}`; system tags ignored; tag case/`#` normalised. `findSimilar`: matches on the **old** name after a rename (and on the new name); same type only; excludes self; a row needing only a tag change is a match; a row already matching every change isn't; `categorySource: 'user'` rows keep their category but get name/tags; loan-linked and transfers skipped; `willChange` correct; newest first |
| `FeatureService.bulkApply.test.js` | name/category/tags applied per row; user-set category and name preserved; tags unioned, removed tags removed, system tags kept; one atomic batch; every write goes through `updateInDb` (spy) |
| `FinanceTools.test.js` (extend) | payee rules before contains rules; `rename`, `category`, `tagsAdd`, `tagsRemove` applied with their sources; never overrides `'user'`/`'bulk'`; tagsRemove never removes an owner tag; a rule matches the original SMS name; merging two rules for one payee; `hits` counted; old rules without `kind` still work |
| `TransactionQuery.test.js` | each date preset in IST and UTC (month boundaries; FY starts 1 Apr; last 3 months over a year end); multi-select OR inside / AND across; amount range inclusive; each flag; text + #tag combined with filters; every sort, including ties and payee sorting with mixed case; totals follow report rules (excluded rows, transfers, Interest-only loan); `activeFilterChips` labels (no repeated card digits); `removeChip`; `defaultQuery` |
| `UndoStore.test.js` | undo restores only changed fields; removes the created rule; expires after 10 min (fake timers); a row edited after the bulk change is skipped and counted |
| `property/TransactionQuery.property.test.js` | fast-check: the result is a subset of the input; sorting doesn't change the set; with `defaultQuery()` the result has the same size as the input; `count` = rows.length; `spent` ≥ 0 |

### C2. Integration (in-memory SQLite, owner fixtures + generated rows)

- Edit one "SWIGGY INST" capture: rename to "Swiggy Instamart", category Food, add #groceries → `findSimilar` returns the others → bulk apply → all show the new name; Budget's Food total rises by their sum and General falls by the same; `#groceries` search returns them all. Undo → names, categories and tags all back exactly.
- A payee rule created from the sheet: a new SMS still reading "SWIGGY INST" is stored as "Swiggy Instamart", Food, #groceries, with rule sources; a row set by hand keeps its category.
- Select 3 rows → change account → both accounts' balances move by the sum; Undo moves them back.
- Bulk delete removes the attachment files (existing B1 behaviour).
- **Performance:** `runQuery` over 5,000 generated rows with every filter on finishes in < 50 ms in Jest (`performance.now()`, a loose bound and a warning only, not a CI failure).

### C3. Screen tests (RNTL)

- **EditTransaction:**
  - change the category → Save → the sheet shows "Apply to N more from this payee?" with only the Category change row;
  - change name + category + a tag → three change rows; untick Category → N and the rule subtitle update; untick all → Update disabled;
  - change only a tag → a sheet with only the Tags row; a row that already has the tag isn't counted;
  - untick one transaction → the button reads Update N−1;
  - Only this one → no other rows change;
  - Update → the snackbar appears and Undo works;
  - no sheet when nothing matches; no sheet for a transfer.
- **Transactions:**
  - the Filter badge counts filters;
  - chips appear and can be removed;
  - Clear all;
  - the summary totals match `runQuery`;
  - the amount sort shows a flat list with dates; Newest shows day headers;
  - the empty state with Clear filters;
  - the sort is remembered after a remount.
- **Filter sheet:** the live "Show N transactions" count; max < min error; Reset keeps the sort; closing without Show discards.
- **Select mode:**
  - long-press starts it with that row selected;
  - Select all selects every match;
  - each action calls the bulk path;
  - loan rows are skipped with a note;
  - Back exits select mode before leaving the screen.
- **Settings → Categories → Auto-categorise rules:** list, add, delete, "Apply to past transactions now".
- **Accessibility:** checkboxes have role and checked state; the filter button label includes the count; every chip's remove button has a label ("Remove filter November").

### C4. Phone checklist (add to `docs/device-test-results.md`, all pending)

1. On one "SWIGGY INST" transaction, rename it to "Swiggy Instamart", set Food and add #groceries: the sheet shows all three changes and the other transactions; Update; the list shows the new name; Budget shows the new totals; `#groceries` finds them; Undo works within 10 s.
2. Leave "Also for future SMS" on; the next Swiggy SMS arrives renamed, as Food, tagged #groceries.
3. Filter November + Expenses + Axis Card: the total matches the card's "This cycle" spend for the same dates.
4. Sort by amount, then go to another app and back: the sort and filters are still there. Restart the app: the sort is remembered and the filters are cleared.
5. Long-press → select 5 → Tag #tax-2026 → search `#tax-2026` shows those 5.
6. The list scrolls smoothly with a full year of SMS.

---

# PART D — Order and done

| # | Tasks |
|---|---|
| 1 | A5 `categorySource`, A2 `PayeeMatch` (test first) |
| 2 | B6 `UndoStore`, then A3 sheet in EditTransaction |
| 3 | A6 payee rules + rules screen in Settings; remove the Tools "Category rules" tab |
| 4 | B1 `TransactionQuery` (test first) |
| 5 | B2 screen, B3 filter sheet, B4 shortcuts |
| 6 | B5 select mode; remove the Tools "Bulk edit & export" tab |
| 7 | C gaps, README "Organising transactions", phone checklist |
| 8 | E5 refund matching + E4 splits and People (both change the shared report helper: do them together, test first) |
| 9 | E2 recurring detection + upcoming bills |
| 10 | E6 month in review |
| 11 | E3 notification actions (needs device check E-3 before calling it done) |
| 12 | README sections for E2–E6, phone checklist E-1…E-6 (pending) |

**Done when:**
- [ ] lint, format:check, test:tz and test:coverage are green; `PayeeMatch`, `TransactionQuery`, `UndoStore`, `RecurringDetect`, `UpcomingBills`, `RefundMatch`, `MonthReview`, splits and People logic are each ≥ 90% lines and branches.
- [ ] One shared report helper decides what counts as spending (splits, refunds, settlements, transfers, excluded rows, Interest-only loans); Budget, Home, Reports, Month in review, filters and exports all use it (a test checks they agree on the same fixture month).
- [ ] No bulk change bypasses `updateInDb` (a test spies on it).
- [ ] A category or payee name the owner set by hand is never changed by a rule or by "apply to similar"; tags the owner added are never removed by a rule.
- [ ] Every bulk change except delete can be undone for 10 minutes.
- [ ] C4 items listed as pending.
