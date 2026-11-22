/** Phase 13 B4: card setup saves; the balance changes only on Save and only when it differs. */
import * as Notifications from 'expo-notifications';
import Storage from '../data/Storage';
import { addMany } from '../data/TransactionRepo';
import {
  loadCard,
  saveCardSetup,
  saveCardStatement,
  setupError,
  remindCardBill,
  syncCardReminders,
} from '../utils/CardService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'rid'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};
const read = async (id) => JSON.parse(await Storage.getItem('user_wealth_accounts')).find((a) => a.id === id);

beforeEach(async () => {
  await Storage.setItem('user_transactions', '[]');
  await Storage.setItem(
    'user_wealth_accounts',
    JSON.stringify([
      {
        id: 'ac',
        type: 'Credit Card',
        name: 'Axis Bank Credit Card ••9070',
        last4: '9070',
        balance: -4857.94,
        dueDay: 5,
      },
      { id: 'axis', type: 'Bank Account', name: 'Axis Bank ••0973', balance: 1000 },
    ])
  );
  await addMany(
    [
      {
        id: 's',
        type: 'expense',
        amount: 30,
        accountId: 'ac',
        account: 'Axis Card',
        availableLimit: 274919.19,
        fullDate: day(-1).toISOString(),
      },
    ],
    { dedup: false }
  );
  Notifications.scheduleNotificationAsync.mockClear();
});

test('loadCard normalises the old dueDay; a missing card is null', async () => {
  const { card, loans } = await loadCard('ac');
  expect(card.due).toEqual({ mode: 'fixedDay', day: 5 });
  expect(loans).toEqual([]);
  expect((await loadCard('nope')).card).toBeNull();
});

test('setupError messages', () => {
  const ok = { creditLimit: 300000, statementDay: 15, due: { mode: 'afterStatement', days: 20 } };
  expect(setupError(ok, { amount: 274919.19 })).toBeNull();
  expect(setupError({ ...ok, creditLimit: 0 })).toMatch(/credit limit/);
  expect(setupError({ ...ok, creditLimit: 1000 }, { amount: 274919.19 })).toMatch(
    /can't be less than the available/
  );
  expect(setupError({ ...ok, statementDay: 32 })).toMatch(/statement date/);
  expect(setupError({ ...ok, statementDay: null })).toMatch(/statement date/);
  expect(setupError({ ...ok, due: { mode: 'fixedDay', day: 0 } })).toMatch(/due day/);
  expect(setupError({ ...ok, due: { mode: 'afterStatement', days: 90 } })).toMatch(/Days after/);
});

test('Save writes limit, statement day, due and the new owed balance with a stamp', async () => {
  const r = await saveCardSetup('ac', {
    creditLimit: 300000,
    statementDay: 15,
    due: { mode: 'afterStatement', days: 20 },
    remindDue: true,
  });
  expect(r).toMatchObject({ balanceChanged: true, owed: { owed: 25080.81, source: 'limit' } });
  const saved = await read('ac');
  expect(saved).toMatchObject({ creditLimit: 300000, statementDay: 15, remindDue: true, balance: 25080.81 });
  expect(saved.balanceSetAt).toBeTruthy();
  expect(saved.latestAvailable.amount).toBe(274919.19);
  // a second save with the same numbers does not touch the balance again
  const again = await saveCardSetup('ac', {
    creditLimit: 300000,
    statementDay: 15,
    due: { mode: 'fixedDay', day: 5 },
    remindDue: false,
  });
  expect(again.balanceChanged).toBe(false);
  expect((await read('ac')).balanceSetAt).toBe(saved.balanceSetAt);
});

test('Save refuses bad input and missing cards', async () => {
  await expect(
    saveCardSetup('ac', { creditLimit: 1000, statementDay: 15, due: { mode: 'afterStatement', days: 20 } })
  ).rejects.toThrow(/available/);
  await expect(saveCardSetup('gone', { creditLimit: 1000, statementDay: 15 })).rejects.toThrow(
    /no longer exists/
  );
  expect((await read('ac')).balance).toBe(-4857.94);
});

test('a manual bill is added, replaced by the same date, and validated; Remind me schedules 3 days before', async () => {
  await saveCardSetup('ac', {
    creditLimit: 300000,
    statementDay: day(-2).getDate(),
    due: { mode: 'afterStatement', days: 20 },
    remindDue: false,
  });
  await saveCardStatement('ac', { date: day(-2), totalDue: 3914, minDue: 200, dueDate: day(10) });
  await saveCardStatement('ac', { date: day(-2), totalDue: 4000, minDue: 200, dueDate: day(10) });
  const saved = await read('ac');
  expect(saved.statements).toHaveLength(1);
  expect(saved.statements[0]).toMatchObject({ totalDue: 4000, minDue: 200, source: 'manual' });
  await expect(saveCardStatement('ac', { date: day(-2), totalDue: 'x' })).rejects.toThrow(/total due/);
  await expect(saveCardStatement('ac', { date: day(-2), totalDue: 10, minDue: 20 })).rejects.toThrow(
    /minimum/
  );
  await expect(saveCardStatement('gone', { date: day(-2), totalDue: 10 })).rejects.toThrow(
    /no longer exists/
  );
  const when = await remindCardBill('ac');
  expect(when.getDate()).toBe(day(7).getDate());
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect((await read('ac')).remindDue).toBe(true);
  await expect(remindCardBill('gone')).rejects.toThrow(/no longer exists/);
  // a payment clears the bill → the catch-up cancels the reminder and schedules none
  await addMany(
    [
      {
        id: 'p',
        type: 'transfer',
        amount: 4000,
        accountId: 'axis',
        toAccountId: 'ac',
        fullDate: new Date().toISOString(),
      },
    ],
    { dedup: false }
  );
  Notifications.scheduleNotificationAsync.mockClear();
  expect(await syncCardReminders()).toBe(1);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('rid');
});

test('syncCardReminders does nothing without cards that want reminders', async () => {
  expect(await syncCardReminders()).toBe(0);
});
