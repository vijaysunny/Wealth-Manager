/** Phase 14 E3: category buttons on capture notifications. */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'n'),
  dismissNotificationAsync: jest.fn(async () => {}),
  registerTaskAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  AndroidNotificationPriority: { HIGH: 'high' },
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

const Notifications = require('expo-notifications');
const TaskManager = require('expo-task-manager');
const Storage = require('../data/Storage').default;
const { addMany, getAll } = require('../data/TransactionRepo');
const A = require('../utils/NotificationActions');

const now = new Date(2026, 10, 26, 12);
const day = (d) => new Date(2026, 10, d, 12).toISOString();
const ex = (id, category, over = {}) => ({
  id,
  type: 'expense',
  amount: 100,
  category,
  fullDate: day(20),
  ...over,
});

describe('which buttons show', () => {
  const history = [
    ex('h1', 'Groceries', { merchant: 'Local store' }),
    ex('h2', 'Groceries', { merchant: 'Local store' }),
    ex('h3', 'Food', { merchant: 'Local store' }),
    ex('a1', 'Transport', { merchant: 'Uber', account: 'Axis Card' }),
    ex('a2', 'Transport', { merchant: 'Ola', account: 'Axis Card' }),
    ex('a3', 'Bills', { merchant: 'Airtel', account: 'Axis Card' }),
    ex('old', 'Health', {
      merchant: 'Apollo',
      account: 'Axis Card',
      fullDate: new Date(2026, 5, 1).toISOString(),
    }),
    ex('gen', 'General', { merchant: 'Local store' }),
    ex('sp', 'Rent', { merchant: 'Local store', splits: [{ id: 'x', category: 'Rent', amount: 100 }] }),
    { id: 'inc', type: 'income', amount: 5, category: 'Salary', merchant: 'Local store', fullDate: day(3) },
    null,
  ];
  test('no category yet: this payee first, then this account (90 days), then common ones', () => {
    const tx = ex('new', 'General', { merchant: 'Local store', account: 'Axis Card' });
    expect(A.buttonsFor(tx, history, { now })).toEqual({
      categories: ['Groceries', 'Food', 'Transport'],
      notMine: false,
    });
    const fresh = ex('n2', null, { merchant: 'Somewhere', account: 'Axis Card' });
    expect(A.buttonsFor(fresh, history, { now }).categories).toEqual(['Transport', 'Bills', 'Food']);
    expect(
      A.buttonsFor(ex('n3', '', { accountId: 7 }), [ex('z', 'Gifts', { accountId: 7 })], { now }).categories
    ).toEqual(['Gifts', 'Food', 'Groceries']);
    expect(A.buttonsFor(ex('n4', 'Other'), undefined).categories).toEqual(['Food', 'Groceries', 'Shopping']);
  });
  test('a rule chose one: the next 2 likely + Not mine', () => {
    const tx = ex('new', 'Groceries', { merchant: 'Local store', categorySource: 'rule' });
    expect(A.buttonsFor(tx, history, { now })).toEqual({ categories: ['Food', 'Shopping'], notMine: true });
  });
  test('ids, actions and text', () => {
    const b = { categories: ['Food', 'Loan/EMI'], notMine: true };
    expect(A.categoryIdFor(b)).toBe('tx_food_loan-emi_nm');
    expect(A.categoryIdFor({ categories: ['Food'], notMine: false })).toBe('tx_food');
    expect(A.actionsFor(b)).toEqual([
      { identifier: 'cat:Food', buttonTitle: 'Food', options: { opensAppToForeground: false } },
      { identifier: 'cat:Loan/EMI', buttonTitle: 'Loan/EMI', options: { opensAppToForeground: false } },
      { identifier: 'not_mine', buttonTitle: 'Not mine', options: { opensAppToForeground: true } },
    ]);
    expect(
      A.captureText(
        ex('a', 'Food', {
          merchant: 'Swiggy Instamart',
          amount: 322,
          account: 'Axis Card',
          last4: '9070',
          categorySource: 'rule',
        })
      )
    ).toEqual({
      title: '₹322 at Swiggy Instamart',
      body: 'Axis Card ••9070 · Food (rule) · tap to change',
    });
    expect(
      A.captureText(ex('b', 'General', { merchant: 'Local store', amount: 121 }), '₹900 / ₹1,000 budget')
    ).toEqual({
      title: '₹121 at Local store',
      body: 'no category yet\n₹900 / ₹1,000 budget',
    });
    expect(A.captureText(ex('c', 'Food', { merchant: null, title: null })).title).toBe('₹100 at a payee');
    expect(A.parseAction('cat:Food')).toEqual({ kind: 'category', category: 'Food' });
    expect(A.parseAction('not_mine')).toEqual({ kind: 'notMine' });
    expect(A.parseAction(undefined)).toEqual({ kind: 'open' });
    expect(A.changesFor({}, { kind: 'open' })).toBeNull();
  });
  test('the categorised list keeps one entry per transaction, newest first', () => {
    let l = A.addCategorised([], { id: '1', to: 'Food' });
    l = A.addCategorised(l, { id: '2', to: 'Bills' });
    l = A.addCategorised(l, { id: '1', to: 'Groceries' });
    expect(l.map((e) => [e.id, e.to])).toEqual([
      ['1', 'Groceries'],
      ['2', 'Bills'],
    ]);
    expect(A.addCategorised(undefined, { id: 'x' })).toHaveLength(1);
    expect(
      A.pendingSimilar(l, [
        { id: '1', category: 'Groceries' },
        { id: '2', category: 'Food' },
      ])
    ).toEqual([l[0]]);
    expect(A.pendingSimilar(undefined, undefined)).toEqual([]);
  });
});

describe('sending and handling', () => {
  const response = (txId, actionIdentifier, identifier = 'notif-1') => ({
    actionIdentifier,
    notification: { request: { identifier, content: { data: { txId, kind: 'capture' } } } },
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    A._resetRegistered();
    await Storage.clear();
    await addMany(
      [
        ex('t1', 'General', { merchant: 'Local store', amount: 121, account: 'Axis Card' }),
        ex('t2', 'Groceries', { merchant: 'Local store' }),
      ],
      { dedup: false }
    );
  });

  test('captureContent: buttons for debits, each button set registered once; off in Settings → plain', async () => {
    const tx = (await getAll()).find((t) => t.id === 't1');
    const c = await A.captureContent(tx, 'budget line');
    expect(c).toMatchObject({
      title: '₹121 at Local store',
      categoryIdentifier: 'tx_groceries_food_shopping',
      data: { txId: 't1' },
    });
    await A.captureContent(tx);
    A._resetRegistered(); // a new app start remembers what was registered
    await A.captureContent(tx);
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    expect(await A.captureContent({ ...tx, type: 'income' })).toBeNull();
    expect(await A.captureContent(null)).toBeNull();
    await Storage.setItem(A.BUTTONS_KEY, 'false');
    expect(await A.captureContent(tx)).toBeNull();
  });

  test('sendTransactionNotification uses the buttons when given the transaction', async () => {
    const { sendTransactionNotification } = require('../utils/NotificationService');
    const tx = (await getAll()).find((t) => t.id === 't1');
    await sendTransactionNotification('Spent ₹121 on General', 'General total', tx);
    expect(Notifications.scheduleNotificationAsync.mock.calls[0][0].content).toMatchObject({
      title: '₹121 at Local store',
      categoryIdentifier: 'tx_groceries_food_shopping',
    });
  });

  test('a category tap updates the right transaction once and posts "Saved as"', async () => {
    expect(await A.handleResponse(response('t1', 'cat:Food'))).toEqual({ status: 'saved' });
    expect(await A.handleResponse(response('t1', 'cat:Food'))).toEqual({ status: 'duplicate' });
    // the same tap delivered under another id (listener + last response) changes nothing
    expect(await A.handleResponse(response('t1', 'cat:Food', 'notif-1b'))).toEqual({ status: 'unchanged' });
    const rows = await getAll();
    expect(rows.find((t) => t.id === 't1')).toMatchObject({ category: 'Food', categorySource: 'user' });
    expect(rows.find((t) => t.id === 't2').category).toBe('Groceries');
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('notif-1');
    expect(Notifications.scheduleNotificationAsync.mock.calls[0][0].content).toMatchObject({
      title: 'Saved as Food',
      body: '₹121 at Local store · Undo in the app',
    });
    expect(await A.loadCategorised(rows)).toEqual([
      expect.objectContaining({ id: 't1', from: 'General', to: 'Food' }),
    ]);
    await A.dropCategorised(['t1']);
    expect(await A.loadCategorised(rows)).toEqual([]);
  });

  test('Not mine marks it disputed and opens it (now, or when the app next opens)', async () => {
    const navigate = jest.fn();
    expect((await A.handleResponse(response('t1', 'not_mine'), { navigate })).status).toBe('saved');
    expect((await getAll()).find((t) => t.id === 't1').reviewStatus).toBe('disputed');
    expect(navigate).toHaveBeenCalledWith('TransactionDetail', {
      transaction: expect.objectContaining({ id: 't1' }),
    });
    // from the background task: no navigator yet
    await A.handleResponse(response('t2', 'not_mine', 'n2'));
    expect(await A.openPending(navigate)).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith('TransactionDetail', {
      transaction: expect.objectContaining({ id: 't2' }),
    });
    expect(await A.openPending(navigate)).toBe(false);
    expect((await A.handleResponse(response('t2', 'not_mine', 'n3'))).status).toBe('unchanged');
  });

  test('other taps: open the transaction, the month review, ignore or miss safely', async () => {
    const navigate = jest.fn();
    expect(await A.handleResponse(response('t1', undefined), { navigate })).toEqual({ status: 'opened' });
    expect(navigate).toHaveBeenCalledWith('TransactionDetail', expect.anything());
    const month = {
      notification: {
        request: { identifier: 'm', content: { data: { screen: 'MonthReview', month: '2026-11' } } },
      },
    };
    expect(await A.handleResponse(month, { navigate })).toEqual({ status: 'opened' });
    expect(navigate).toHaveBeenLastCalledWith('MonthReview', { month: '2026-11' });
    expect(
      await A.handleResponse({
        ...month,
        notification: { request: { identifier: 'm2', content: { data: { screen: 'MonthReview' } } } },
      })
    ).toEqual({ status: 'opened' });
    expect(await A.handleResponse({ notification: { request: { identifier: 'x', content: {} } } })).toEqual({
      status: 'ignored',
    });
    expect(await A.handleResponse(response('gone', 'cat:Food', 'g'))).toEqual({ status: 'missing' });
    expect(await A.handleResponse(null)).toEqual({ status: 'ignored' });
    await Storage.setItem('notif_handled', '{bad');
    expect((await A.handleResponse(response('t1', 'cat:Bills', 'z'))).status).toBe('saved');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const set = jest.spyOn(Storage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    expect(await A.handleResponse(response('t1', 'cat:Bills', 'y'))).toEqual({ status: 'error' });
    set.mockRestore();
    warn.mockRestore();
  });
});

describe('app start and the background task', () => {
  beforeEach(() => jest.clearAllMocks());
  test('the task handles taps that carry an action; start wires the listener and the last tap', async () => {
    jest.isolateModules(() => require('../utils/NotificationTask'));
    const { startNotificationActions, NOTIFICATION_TASK } = require('../utils/NotificationTask');
    const [name, body] = TaskManager.defineTask.mock.calls.at(-1);
    expect(name).toBe(NOTIFICATION_TASK);
    await body({ data: null });
    await body({ error: new Error('x'), data: { actionIdentifier: 'cat:Food' } });
    await body({
      data: {
        actionIdentifier: 'cat:Food',
        notification: { request: { identifier: 'bg', content: { data: {} } } },
      },
    });
    const navigate = jest.fn();
    Notifications.getLastNotificationResponse.mockReturnValueOnce({
      notification: {
        request: { identifier: 'last', content: { data: { screen: 'MonthReview', month: '2026-10' } } },
      },
    });
    const stop = await startNotificationActions(navigate);
    expect(Notifications.registerTaskAsync).toHaveBeenCalledWith(NOTIFICATION_TASK);
    expect(navigate).toHaveBeenCalledWith('MonthReview', { month: '2026-10' });
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
    const listener = Notifications.addNotificationResponseReceivedListener.mock.calls[0][0];
    listener({
      notification: {
        request: { identifier: 'live', content: { data: { screen: 'MonthReview', month: '2026-09' } } },
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(navigate).toHaveBeenLastCalledWith('MonthReview', { month: '2026-09' });
    stop();
    Notifications.getLastNotificationResponse.mockImplementationOnce(() => {
      throw new Error('old');
    });
    await startNotificationActions(navigate);
  });
});
