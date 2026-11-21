/**
 * GoalMath.js (C5.7) - pure. Months left, monthly saving needed and progress for a goal,
 * plus the "Start from" templates.
 */
export const GOAL_TEMPLATES = [
  { key: 'emergency', name: 'Emergency fund', months: 12, roi: 6, icon: 'shield-outline', tone: 'income' },
  { key: 'trip', name: 'Trip', months: 9, roi: 6, icon: 'navigate-outline', tone: 'primary' },
  {
    key: 'device',
    name: 'New phone or laptop',
    months: 6,
    roi: 0,
    icon: 'phone-portrait-outline',
    tone: 'violet',
  },
  { key: 'debt', name: 'Clear a card or loan', months: 6, roi: 0, icon: 'card-outline', tone: 'expense' },
];

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);

/** Deadline `months` from today (same day of month, clamped to the month's end). */
export const deadlineIn = (months, today = new Date()) => {
  const d = new Date(today.getFullYear(), today.getMonth() + months, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(today.getDate(), last));
  return d;
};

export const goalPlan = (goal, today = new Date()) => {
  const target = num(goal.targetAmount);
  const current = num(goal.savedAmount);
  const rate = num(goal.roi) / 100 / 12;
  const deadline = new Date(goal.deadline);
  const months = Math.max(
    1,
    (deadline.getFullYear() - today.getFullYear()) * 12 + (deadline.getMonth() - today.getMonth())
  );
  const gap = target - current * Math.pow(1 + rate, months);
  let monthlyNeed = 0;
  if (gap > 0) monthlyNeed = rate > 0 ? (gap * rate) / (Math.pow(1 + rate, months) - 1) : gap / months;
  return {
    monthsLeft: months,
    monthlyNeed: Math.max(0, monthlyNeed),
    progress: target > 0 ? Math.min(1, Math.max(0, current / target)) : 0,
    done: target > 0 && current >= target,
  };
};
