/**
 * MonthReviewReminder (Phase 14 E6): "Your November summary is ready" on the 1st at 9:00.
 * A one-off date trigger (so the month's name is right) re-planned every time the app opens.
 */
import * as Notifications from 'expo-notifications';
import Storage from '../data/Storage';
import { nextReviewAt, monthName, monthKeyOf } from './MonthReview';

const KEY = 'month_review_notification';

export const scheduleMonthReview = async (now = new Date()) => {
  const { at, month } = nextReviewAt(now);
  const saved = JSON.parse((await Storage.getItem(KEY)) || 'null');
  if (saved && saved.at === at.toISOString()) return at; // already planned
  if (saved?.id) await Notifications.cancelScheduledNotificationAsync(saved.id).catch(() => null);
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: `Your ${monthName(month)} summary is ready`,
      body: 'Where the money went, and how it compares with the month before.',
      data: { screen: 'MonthReview', month: monthKeyOf(month) },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  });
  await Storage.setItem(KEY, JSON.stringify({ id, at: at.toISOString() }));
  return at;
};
