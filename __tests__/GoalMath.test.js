import { goalPlan, deadlineIn, GOAL_TEMPLATES } from '../utils/GoalMath';

const today = new Date(2026, 10, 21);

test('no return: gap spread evenly over the months left', () => {
  const p = goalPlan(
    { targetAmount: '60000', savedAmount: '0', roi: '0', deadline: new Date(2027, 4, 21) },
    today
  );
  expect(p.monthsLeft).toBe(6);
  expect(p.monthlyNeed).toBe(10000);
  expect(p.progress).toBe(0);
  expect(p.done).toBe(false);
});

test('with return: SIP formula, less than the even split', () => {
  const p = goalPlan(
    { targetAmount: 120000, savedAmount: 0, roi: 12, deadline: new Date(2027, 10, 21) },
    today
  );
  expect(p.monthsLeft).toBe(12);
  expect(p.monthlyNeed).toBeCloseTo(9461.88, 1);
});

test('already saved enough: done, nothing needed; progress capped; past deadline counts as 1 month', () => {
  const p = goalPlan({ targetAmount: 100, savedAmount: 150, roi: 0, deadline: new Date(2020, 0, 1) }, today);
  expect(p).toEqual({ monthsLeft: 1, monthlyNeed: 0, progress: 1, done: true });
  expect(goalPlan({ targetAmount: 0, savedAmount: 'x', deadline: today }, today).progress).toBe(0);
});

test('deadlineIn clamps to the month end; templates are complete', () => {
  expect(deadlineIn(3, new Date(2026, 10, 30)).toDateString()).toBe(new Date(2027, 1, 28).toDateString());
  expect(deadlineIn(6, today).toDateString()).toBe(new Date(2027, 4, 21).toDateString());
  expect(GOAL_TEMPLATES.map((g) => g.name)).toEqual([
    'Emergency fund',
    'Trip',
    'New phone or laptop',
    'Clear a card or loan',
  ]);
});
