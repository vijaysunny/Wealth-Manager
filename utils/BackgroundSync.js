import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '../data/Storage';
import { syncSms } from './SmsSync';

export const BACKGROUND_SYNC_TASK = 'BACKGROUND_SMS_SYNC';
const MIGRATED_KEY = 'bg_task_migrated_to_background_task';

// Same task name and body as before; the work itself lives in SmsSync (shared with the
// foreground catch-up). Permission is only CHECKED there, never requested.
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    console.log('🔄 Background Sync Running...');
    const res = await syncSms();
    console.log('Background Sync result:', res.status, res.added);
    return res.status === 'error'
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.log('Background Task Error:', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export const registerBackgroundSync = async () => {
  try {
    // One-time: drop a registration left over from expo-background-fetch (same task name)
    if (!(await AsyncStorage.getItem(MIGRATED_KEY))) {
      if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
        await TaskManager.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
      }
      await AsyncStorage.setItem(MIGRATED_KEY, 'true');
    }
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK))) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: 15 }); // minutes
      console.log('✅ Background Sync Registered');
    }
  } catch (err) {
    console.log('Task Register Error:', err);
  }
};
