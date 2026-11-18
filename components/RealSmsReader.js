import SmsAndroid from 'react-native-get-sms-android';
import { PermissionsAndroid, Platform } from 'react-native';
import { parseTransactionText, isTransactionalSender } from '../utils/TransactionParser';
import { buildSmsId, hashText } from '../utils/DeduplicationEngine';
import { collectPages } from '../utils/SmsScan';

const PAGE_SIZE = 500;
const MAX_MESSAGES = 10000; // safety ceiling per scan (≈ years of inbox for a normal phone)

/** Silent check, safe in headless/background tasks (never shows a dialog). */
export const hasSmsPermission = async () => {
  if (Platform.OS !== 'android') return false;
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  } catch {
    return false;
  }
};

/** Shows the system dialog. Call ONLY from UI code (Settings, onboarding, manual scan). */
export const requestSmsPermission = async () => {
  if (Platform.OS !== 'android') return false;
  try {
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
      title: 'SMS Permission',
      message: 'We need access to read bank SMS for auto-tracking.',
      buttonPositive: 'OK',
    });
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
};

const listPage = (minDate, indexFrom, count) =>
  new Promise((resolve, reject) => {
    const filter = { box: 'inbox', minDate, indexFrom, maxCount: count };
    SmsAndroid.list(
      JSON.stringify(filter),
      (fail) => reject(new Error(String(fail))),
      (_count, smsList) => {
        try {
          resolve(JSON.parse(smsList));
        } catch (e) {
          reject(e);
        }
      }
    );
  });

/**
 * Scan the inbox since `minDate` (epoch ms), paging through ALL results and keeping
 * only likely bank/UPI senders.
 * Returns { ok, reason, items }. ok=false means the scan could not run (no permission /
 * SMS read failed), so callers must NOT advance their "last synced" marker.
 */
export const scanBankSms = async (minDate = 0) => {
  if (Platform.OS !== 'android') return { ok: false, reason: 'not_android', items: [] };
  if (!(await hasSmsPermission())) return { ok: false, reason: 'no_permission', items: [] };
  try {
    const { messages, truncated } = await collectPages((from, count) => listPage(minDate, from, count), {
      pageSize: PAGE_SIZE,
      maxTotal: MAX_MESSAGES,
    });
    if (truncated) console.log(`⚠️ SMS scan stopped at ${MAX_MESSAGES} messages`);
    const relevant = messages.filter((m) => isTransactionalSender(m.address));
    console.log(`📥 ${messages.length} SMS read, ${relevant.length} from bank-like senders`);
    return { ok: true, reason: null, items: parseData(relevant) };
  } catch (err) {
    console.log('❌ Error reading SMS:', err);
    return { ok: false, reason: 'read_failed', items: [] };
  }
};

/** Backwards-compatible: just the parsed messages ([] on any failure). */
export const fetchRecentBankSms = async (lastSyncTime = 0) => (await scanBankSms(lastSyncTime)).items;

const parseData = (messages) => {
  const results = [];

  messages.forEach((msg) => {
    const parsed = parseTransactionText(msg.body, { sender: msg.address, bankFallback: 'Unknown Bank' });
    if (!parsed) return;

    results.push({
      id: msg._id,
      smsId: buildSmsId(msg.address, msg.date, parsed.amount), // shared with listener / background task
      bodyHash: hashText(msg.body),
      refNo: parsed.refNo,
      date: msg.date,
      body: msg.body,
      sender: msg.address,
      amount: parsed.amount,
      type: parsed.type,
      category: parsed.category,
      merchant: parsed.merchant,
      vpa: parsed.vpa,
      bankName: parsed.bankName,
      currentBalance: parsed.balance,
      accountType: parsed.accountType,
    });
  });

  return results;
};
