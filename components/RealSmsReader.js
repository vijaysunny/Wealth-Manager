import SmsAndroid from 'react-native-get-sms-android';
import { PermissionsAndroid, Platform } from 'react-native';
import { parseTransactionText, isTransactionalSender } from '../utils/TransactionParser';
import { parseCardStatement } from '../utils/CardStatementSms';
import { isAiSmsCandidate } from '../utils/ai/AiTasks';
import { buildSmsId, hashText } from '../utils/DeduplicationEngine';
import { collectPages } from '../utils/SmsScan';
import { capturedFields } from '../utils/CaptureMapper';
import Storage from '../data/Storage';
import { smsPermissionState, SMS_PERMISSION_STATE_KEY } from '../utils/PermissionHealth';

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

/**
 * Shows the system dialog. Call ONLY from UI code (Settings, onboarding, manual scan).
 * Asks for READ_SMS and RECEIVE_SMS together: the live listener needs both (A8).
 * Returns { granted, blocked, state }. blocked = Android answered never_ask_again, which on
 * Android 13+ is the "restricted setting" for apps installed from an APK (no dialog appears).
 */
export const requestSmsPermission = async () => {
  if (Platform.OS !== 'android') return { granted: false, blocked: false, state: 'denied' };
  try {
    const P = PermissionsAndroid.PERMISSIONS;
    const res = await PermissionsAndroid.requestMultiple([P.READ_SMS, P.RECEIVE_SMS]);
    const state = smsPermissionState(res);
    await Storage.setItem(SMS_PERMISSION_STATE_KEY, state);
    return { granted: state === 'granted', blocked: state === 'blocked', state };
  } catch {
    return { granted: false, blocked: false, state: 'denied' };
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
    const unparsed = [];
    const items = parseData(relevant, unparsed);
    // B7: card statement SMS → { statement, date } for the card's bill
    const statements = relevant
      .map((m) => ({ statement: parseCardStatement(m.body), date: new Date(Number(m.date) || Date.now()) }))
      .filter((x) => x.statement);
    return { ok: true, reason: null, items, unparsed, statements };
  } catch (err) {
    console.log('❌ Error reading SMS:', err);
    return { ok: false, reason: 'read_failed', items: [] };
  }
};

/** Backwards-compatible: just the parsed messages ([] on any failure). */
export const fetchRecentBankSms = async (lastSyncTime = 0) => (await scanBankSms(lastSyncTime)).items;

/** `unparsed` collects bank SMS the regex parser rejected but that look like money moved (AI input). */
const parseData = (messages, unparsed = []) => {
  const results = [];

  messages.forEach((msg) => {
    const parsed = parseTransactionText(msg.body, { sender: msg.address, bankFallback: 'Unknown Bank' });
    if (!parsed) {
      if (isAiSmsCandidate(msg.body))
        unparsed.push({ id: msg._id, body: msg.body, sender: msg.address, date: msg.date });
      return;
    }

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
      captured: capturedFields(parsed),
    });
  });

  return results;
};
