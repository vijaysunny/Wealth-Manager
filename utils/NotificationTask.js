/**
 * NotificationTask (Phase 14 E3): the background task that receives category-button taps while
 * the app is closed, and the app-start hook-up. Imported by App.js only (it needs the native
 * task manager), so tests and services can import NotificationActions freely.
 */
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { handleResponse, openPending } from './NotificationActions';

export const NOTIFICATION_TASK = 'WM_NOTIFICATION_ACTIONS';

// Taps while the app is closed arrive here (Android, opensAppToForeground: false).
TaskManager.defineTask(NOTIFICATION_TASK, async ({ data, error }) => {
  if (error || !data?.actionIdentifier) return;
  await handleResponse(data);
});

/**
 * App start: register the background task, listen for taps while the app runs, and handle the
 * last tap if it opened the app (fallback when the background task did not run).
 * Returns a function that removes the listener.
 */
export const startNotificationActions = async (navigate) => {
  await Notifications.registerTaskAsync(NOTIFICATION_TASK).catch(() => null);
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    handleResponse(r, { navigate });
  });
  let last = null;
  try {
    last = Notifications.getLastNotificationResponse();
  } catch {
    last = null;
  }
  if (last) {
    await handleResponse(last, { navigate });
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      // older native module: the 'handled' list still stops a second run
    }
  }
  await openPending(navigate);
  return () => sub.remove();
};
