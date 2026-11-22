# Device test results (Phase 11)

Fill this in while testing on a device. Scenarios and expected results are copied from `docs/CLAUDE_CODE_PLAN.md` § C7.

**Status: not started.** Every row is pending. Don't mark a row as passed unless it was actually run on a device.

## Setup

| Field | Value |
|---|---|
| Date | |
| Tester | |
| Device / Android version | |
| Emulator or real phone | |
| App build (commit / EAS build id) | |
| Data used (fresh / copy of real) | |

Emulator SMS injection: `adb emu sms send <SENDER> "<fixture body>"` (bodies in `__fixtures__/sms/owner_real_samples.json`). Use a real phone for the final pass (biometrics, notifications, background behaviour).

Result values: `PENDING`, `PASS`, `FAIL`, `BLOCKED`.

## Results

| # | Scenario | Expected | Result | Notes / evidence |
|---|---|---|---|---|
| D1 | Fresh install, onboarding, grant SMS + notification | No crash; permission rationale shown | PENDING | |
| D2 | Migrate a **copy** of real data | Counts and balances equal pre-migration; backup retained | PENDING | |
| D3 | Inject top-up SMS with app open | One transfer in the review queue; bank −X, wallet +X; net worth unchanged; not in expenses | PENDING | |
| D4 | Inject same SMS again / force re-scan | Still one | PENDING | |
| D5 | Inject with app **closed**, then open | Appears once after catch-up | PENDING | |
| D6 | Reconcile wallet with a lower balance | One "Unrecorded wallet spends" expense; wallet balance matches the app | PENDING | |
| D7 | Import real bank statement containing a top-up | Top-up deduped against the SMS transfer; no extra expense | PENDING | |
| D8 | Re-import the same statement | 0 added | PENDING | |
| D9 | Import real credit-card PDF **in airplane mode** | Rows parsed; totals match statement | PENDING | |
| D10 | Delete a wallet transfer | Both balances restored | PENDING | |
| D11 | Backup → uninstall → reinstall → restore | Everything identical, including wallets | PENDING | |
| D12 | Encrypted backup with wrong passphrase | Clear error, no data change | PENDING | |
| D13 | Revoke SMS permission, reopen | Graceful message; no crash; sync marker unchanged | PENDING | |
| D14 | Biometric lock: cancel, fail, background/foreground, cold start | Locked until success; privacy screen in app switcher | PENDING | |
| D15 | Budget alerts at 80% and 100% from SMS-captured spend | Notification once per threshold | PENDING | |
| D16 | Dark mode on every screen | Text readable; no white-on-white | PENDING | |
| D17 | Card reminder notification | Arrives (may be delayed); fires for each month | PENDING | |
| D18 | Phone reboot, then receive SMS | Capture still works (boot receiver) | PENDING | |
| D19 | Battery saver / app killed | Catch-up on next open recovers everything | PENDING | |
| D20 | Stock/MF price refresh offline | Cached price + stale label, no crash | PENDING | |

## Phase 11 screen checks (also pending)

| # | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| W1 | Wealth → Cash & wallets on a phone, light and dark mode | Wallet rows readable; provider and funding bank shown | PENDING | |
| W2 | Add account → Wallet → UPI Lite, PhonePe, Axis | Saved; appears under Cash & wallets | PENDING | |
| W3 | Tools → Review: capture with no matching account | Create / Pick account works; Confirm hidden until resolved | PENDING | |
| W4 | Import a statement with UPI LITE rows and no wallet | "Create wallet account?" prompt; Not now imports bank side only | PENDING | |
| W5 | Settings → weekly wallet reminder on | Arrives Sunday 10:00 (may be delayed) | PENDING | |
| W6 | Revoke notification permission | Red banner on Home; SMS capture still saves | PENDING | |
| W7 | No backup for 30+ days | Banner on Home; tapping opens Settings | PENDING | |

## Phase 12 Part A checks (pending until the owner confirms on the phone; Android dark mode ON)

| # | Scenario | Expected | Result | Notes |
|---|---|---|---|---|
| P1 | Fresh install of the APK with the phone in dark mode (A1) | Every screen's text is readable (Security, Budget headings, Goals help, Edit amount, AI switch labels, AI screen) | PENDING | App is pinned to light until dark mode returns in Part C |
| P2 | Settings → Read bank SMS automatically (A8) | Red banner with the restricted-settings steps; Open App info → ⋮ → Allow restricted settings → allow SMS; back in the app the switch is on | PENDING | |
| P3 | Real Axis debit SMS arrives (A8) | Appears within seconds on Axis ••0973 with a notification | PENDING | |
| P4 | Scan old SMS → Home card → Review accounts → Add all (A2) | Axis ••0973, Axis Card ••9070, SBI Card ••1987 (and Equitas ••1246) added; Accounts lists them; no capture left waiting | PENDING | |
| P5 | UPI Lite top-up SMS without "A/c" (A5) | UPI Lite +500 and Axis −500 | PENDING | |
| P6 | Axis card bill paid from the bank (A4) | Not counted in Spent; shows as a transfer; pairs with the card's "payment received" SMS | PENDING | |
| P7 | Debit-card spend (A11) | Review asks "Is Debit Card ••xxxx linked to Axis Bank ••0973?"; Yes moves it and later spends go straight there | PENDING | Real sample added 2026-11-22 (`axis-debitcard-ngef-01`, card ••8285). Axis's real wording names the account too, so it goes straight to ••0973 and the card is learned; the question only appears for an SMS naming the card alone |
| P8 | Gemini: Save key (A9) | Test runs automatically → "Working · <model>"; "Turn on AI now?" asked once; Ask a question gets a reply | PENDING | |
| P9 | Buttons in Settings → Security, AI panel, AI screen (A10) | Normal-case, spaced, nothing touching, ≥44px | PENDING | |

## Failures found

(none recorded yet)

---

# Phase 12 device checks (plan D6)

**Status: not started.** Run on the owner's phone with Android dark mode **on**. Scenarios are copied from `docs/PHASE12_PLAN.md` § D6. Rows P1–P9 from the plan's Part A check-in are the same as rows 1–9 here.

| Field | Value |
|---|---|
| Date | |
| Device / Android version | |
| App build (commit / EAS build id) | |

| # | Scenario | Expected | Result | Notes / evidence |
|---|---|---|---|---|
| 1 | Fresh install of the APK, phone in dark mode | Every screen's text readable | PENDING | |
| 2 | Settings → Read bank SMS | "Restricted settings" steps shown; after allowing, the switch stays on | PENDING | |
| 3 | A real Axis debit SMS arrives | Appears within seconds on the right account; notification shown | PENDING | |
| 4 | Scan old SMS → Review → Add all | Axis ••0973, Axis Card ••9070, SBI Card ••1987 listed on Accounts | PENDING | |
| 5 | UPI Lite top-up | UPI Lite +500 **and** Axis −500 | PENDING | |
| 6 | Axis card bill paid from the bank | Not counted in "Spent" | PENDING | |
| 7 | Transaction detail: attach camera photo, gallery image, PDF; then delete the tx | Each opens in a viewer; files gone after delete (app storage size drops) | PENDING | |
| 8 | Tag `#tax-2026` on two transactions; search `#tax-2026` | Both shown | PENDING | |
| 9 | Gemini: save key, ask "Where did my money go this month?" | Test runs automatically → "Working · model"; a reply comes back | PENDING | |
| 10 | Add FD ₹10,000 at 7%, today | Next day the value is slightly higher; maturity reminder scheduled | PENDING | |
| 11 | Encrypted backup with files → uninstall → install → restore | Transactions, tags and files all back | PENDING | |
| 12 | Collapsible sections; tap targets | Open/close smoothly; nothing overlaps; every button ≥ 44 px | PENDING | |
| 13 | Each screen vs `docs/design/` | Section order, spacing, colours and default-collapsed state match | PENDING | |
| 14 | Home → Scan bill | Camera opens; saved expense has the photo under Bills & files | PENDING | |
| 15 | SIP debit (Groww) with a Groww fund added (Platform = Groww) | Saved as a transfer Axis → fund, not spending | PENDING | |
| 16 | Real debit-card SMS (A11) | Spend at a shop with card ••8285 lands on Axis ••0973 with the payee and balance; Axis lists card ••8285 | PENDING | fixture `axis-debitcard-ngef-01` |
