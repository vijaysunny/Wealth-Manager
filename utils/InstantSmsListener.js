/**
 * InstantSmsListener.js  (Enhanced v2)
 * Real-time SMS listener for instant transaction detection.
 * Uses DeduplicationEngine to prevent double-counting with Gmail sync.
 */

import { parseCardStatement } from './CardStatementSms';
import { applyStatementSms } from './CardService';
import SmsListener from 'react-native-android-sms-listener';
import AsyncStorage from '../data/Storage';
import { sendTransactionNotification } from './NotificationService';
import { saveWithDedup, buildSmsId, hashText } from './DeduplicationEngine';
import { refundWords } from './RefundMatch';
import { isReportable } from './BalanceService';
import { parseTransactionText } from './TransactionParser';
import { capturedFields } from './CaptureMapper';

// ── Main listener ─────────────────────────────────────────────────────────

export const startSmsListener = () => {
  console.log('👂 Instant SMS Listener v2 started');

  const handleMessage = async (message) => {
    const body = message.body || '';
    const sender = message.originatingAddress || '';
    console.log('📩 SMS from:', sender);

    // B7: a card statement SMS becomes that card's bill, not a transaction
    const statement = parseCardStatement(body);
    if (statement) {
      if ((await AsyncStorage.getItem('sms_auto_track_enabled')) === 'false') return;
      await applyStatementSms(statement, new Date(Number(message.timestamp) || Date.now())).catch(() => null);
      return;
    }
    const parsed = parseTransactionText(body, { sender, bankFallback: sender || 'Unknown' });
    if (!parsed) return;

    const bankName = parsed.bankName;
    const now = new Date();
    // Use the SMS's own timestamp so the ID matches the inbox scan / background task
    const smsMs = Number(message.timestamp) || now.getTime();
    const smsDate = new Date(smsMs);

    const newTx = {
      id: Date.now() + Math.random(),
      smsId: buildSmsId(sender, smsMs, parsed.amount),
      bodyHash: hashText(body),
      refNo: parsed.refNo,
      title: parsed.merchant || parsed.category,
      merchant: parsed.merchant,
      vpa: parsed.vpa,
      amount: parsed.amount,
      type: parsed.type,
      date: smsDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      fullDate: smsDate.toISOString(),
      category: parsed.category,
      account: bankName,
      tags: ['auto-sms'],
      ...(parsed.type === 'income' && refundWords(body) ? { refundWords: true } : {}), // E5
      extractedBalance: parsed.balance,
      ...capturedFields(parsed),
    };

    // ── Load existing & deduplicate ────────────────────────────────────────
    if ((await AsyncStorage.getItem('sms_auto_track_enabled')) === 'false') return;
    const result = await saveWithDedup([newTx], { balanceMode: 'captured' });
    if (!result.added) return;
    const updatedTx = JSON.parse(await AsyncStorage.getItem('user_transactions'));

    // ── Budget-aware notification ─────────────────────────────────────────
    if (parsed.type === 'expense') {
      const catLimitsJson = await AsyncStorage.getItem('user_category_budgets');
      const catLimits = catLimitsJson ? JSON.parse(catLimitsJson) : {};
      const limit = catLimits[parsed.category] || 0;

      const mon = now.getMonth();
      const yr = now.getFullYear();
      const catSpent = updatedTx
        .filter(
          (t) =>
            isReportable(t) &&
            t.category === parsed.category &&
            t.type === 'expense' &&
            new Date(t.fullDate).getMonth() === mon &&
            new Date(t.fullDate).getFullYear() === yr
        )
        .reduce((s, t) => s + t.amount, 0);

      let notifBody = `${parsed.category} total this month: ₹${catSpent.toLocaleString('en-IN')}`;
      if (limit > 0) {
        const pct = Math.round((catSpent / limit) * 100);
        notifBody = `₹${catSpent.toLocaleString('en-IN')} / ₹${limit.toLocaleString('en-IN')} budget (${pct}%)`;
        if (pct >= 90) notifBody = `⚠️ ${notifBody} — Near limit!`;
        if (pct >= 100) notifBody = `🚨 ${notifBody} — Budget exceeded!`;
      }
      await sendTransactionNotification(`Spent ₹${parsed.amount} on ${parsed.category}`, notifBody);
    } else if (parsed.type === 'transfer') {
      await sendTransactionNotification(
        'Transfer captured',
        `₹${parsed.amount} · ${parsed.category} · ${bankName}`
      );
    } else {
      await sendTransactionNotification('Income Credited 💰', `₹${parsed.amount} from ${bankName}`);
    }
  };
  const subscription = SmsListener.addListener((message) => {
    handleMessage(message).catch((error) => console.warn('SMS capture failed:', error.message));
  });
  return subscription;
};
