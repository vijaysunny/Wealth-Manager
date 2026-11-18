import * as Notifications from 'expo-notifications';
import AsyncStorage from '../data/Storage';
// 1. CONFIGURE NOTIFICATIONS (Updated Handler)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    // Replaces shouldShowAlert
    shouldShowList: true,
    // Replaces shouldShowAlert
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// VARIABLES TO TRACK LAST NOTIFICATION
let lastNotifContent = '';
let lastNotifTime = 0;

// 2. REQUEST PERMISSIONS

// 3. SEND INSTANT TRANSACTION ALERT (With Spam Blocker)
export async function sendTransactionNotification(title, body) {
  const now = Date.now();
  const contentKey = `${title}|${body}`;

  // BLOCK if identical message sent within last 2 seconds
  if (contentKey === lastNotifContent && now - lastNotifTime < 2000) {
    console.log('🚫 Duplicate Notification Blocked:', title);
    return;
  }

  // Update tracker
  lastNotifContent = contentKey;
  lastNotifTime = now;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: title,
        body: body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null, // Send Immediately
    });
  } catch (e) {
    // B11: a revoked notification permission must never break SMS capture
    console.warn('Notification not shown:', e?.message || e);
  }
}

/** B11: true / false, or null when the status cannot be read. */
export async function notificationsAllowed() {
  try {
    return (await Notifications.getPermissionsAsync()).granted === true;
  } catch {
    return null;
  }
}

// 4. DAILY NIGHT SUMMARY (9 PM)
export async function scheduleDailySummary() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const hasDaily = scheduled.some((n) => n.content.title === 'Daily Spending Summary');
    if (!hasDaily) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Daily Spending Summary',
          body: 'Tap to view your total spending for today.',
        },
        // expo-notifications 0.32 requires an explicit trigger type
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: 21,
          // 9:00 PM
          minute: 0,
        },
      });
      console.log('✅ Daily 9PM Summary Scheduled');
    }
  } catch (e) {
    console.warn('Daily summary scheduling failed:', e?.message || e);
  }
}

// 5. GENERAL BUDGET WARNING (Once per day)
export async function sendBudgetAlert(message, force = false) {
  const today = new Date().toDateString();
  const lastAlertDate = await AsyncStorage.getItem('last_budget_alert_date');
  if (!force && lastAlertDate === today) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '⚠️ Budget Warning',
      body: message,
    },
    trigger: null,
  });
  if (!force) await AsyncStorage.setItem('last_budget_alert_date', today);
}

// 6. WEEKLY WALLET RECONCILE REMINDER (plan A4.1 / A6, optional)
export const WALLET_REMINDER_KEY = 'wallet_reconcile_reminder';
const WALLET_REMINDER_TITLE = 'Reconcile your wallets';

/** Turn the weekly (Sunday 10:00) reminder on/off. Idempotent; never throws. */
export async function setWalletReconcileReminder(enabled) {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled.filter((s) => s.content?.title === WALLET_REMINDER_TITLE))
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    if (enabled)
      await Notifications.scheduleNotificationAsync({
        content: {
          title: WALLET_REMINDER_TITLE,
          body: 'UPI Lite payments often send no SMS. Enter the balance your UPI app shows (Wealth → Reconcile).',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 10, minute: 0 },
      });
    await AsyncStorage.setItem(WALLET_REMINDER_KEY, enabled ? 'true' : 'false');
    return true;
  } catch (e) {
    console.warn('Wallet reminder scheduling failed:', e?.message || e);
    return false;
  }
}
