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
    shouldSetBadge: false
  })
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
    console.log("🚫 Duplicate Notification Blocked:", title);
    return;
  }

  // Update tracker
  lastNotifContent = contentKey;
  lastNotifTime = now;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: title,
      body: body,
      sound: true,
      priority: Notifications.AndroidNotificationPriority.HIGH
    },
    trigger: null // Send Immediately
  });
}

// 4. DAILY NIGHT SUMMARY (9 PM)
export async function scheduleDailySummary() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const hasDaily = scheduled.some(n => n.content.title === "Daily Spending Summary");
    if (!hasDaily) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Daily Spending Summary",
          body: "Tap to view your total spending for today."
        },
        // expo-notifications 0.32 requires an explicit trigger type
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: 21,
          // 9:00 PM
          minute: 0
        }
      });
      console.log("✅ Daily 9PM Summary Scheduled");
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
      title: "⚠️ Budget Warning",
      body: message
    },
    trigger: null
  });
  if (!force) await AsyncStorage.setItem('last_budget_alert_date', today);
}
