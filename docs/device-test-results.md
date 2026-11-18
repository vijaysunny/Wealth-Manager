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

## Failures found

(none recorded yet)
