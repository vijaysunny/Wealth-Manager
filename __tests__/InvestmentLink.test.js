import {
  platformOf,
  isSipDebit,
  investmentsOn,
  linkSipDebits,
  linkToInvestment,
} from '../utils/InvestmentLink';

// babel-jest hoists this above the imports (AccountsOverview → BalanceService → Storage)
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const bank = { id: 'b', name: 'Axis Bank', type: 'Bank Account' };
const groww = { id: 'g', name: 'Groww MF', type: 'Mutual Fund', subType: 'Mutual Fund' };
const zer = {
  id: 'z',
  name: 'Nifty index',
  type: 'Investment',
  subType: 'Stocks / Equity',
  platform: 'Zerodha',
};

test('platformOf / isSipDebit', () => {
  expect(platformOf('NEXTBILLION TECHNOLOGY GROWW')).toBe('groww');
  expect(platformOf('Paytm Money Ltd')).toBe('paytmmoney');
  expect(platformOf('BSE STAR MF')).toBe('bsestar');
  expect(platformOf('Swiggy')).toBeNull();
  expect(isSipDebit({ type: 'expense', merchant: 'Zerodha Broking' })).toBe(true);
  expect(isSipDebit({ type: 'income', merchant: 'Zerodha' })).toBe(false);
  expect(isSipDebit({ type: 'expense', vpa: 'groww.mf@axisbank' })).toBe(true);
});

test('investmentsOn matches platform field or name', () => {
  expect(investmentsOn([bank, groww, zer], 'groww')).toEqual([groww]);
  expect(investmentsOn([bank, groww, zer], 'zerodha')).toEqual([zer]);
  expect(investmentsOn([bank, groww], 'kuvera')).toEqual([]);
  expect(investmentsOn([bank], null)).toEqual([]);
});

test('linkSipDebits: one match → transfer bank → investment; else unchanged', () => {
  const sip = {
    id: 1,
    type: 'expense',
    category: 'Investment',
    merchant: 'GROWW',
    amount: 5000,
    accountId: 'b',
    account: 'Axis Bank',
  };
  const [linked] = linkSipDebits([bank, groww], [sip]);
  expect(linked).toMatchObject({
    type: 'transfer',
    kind: 'investment',
    accountId: 'b',
    toAccountId: 'g',
    toAccount: 'Groww MF',
  });
  // no investment on that platform
  expect(linkSipDebits([bank, zer], [sip])[0]).toBe(sip);
  // two candidates: leave for Review
  const groww2 = { ...groww, id: 'g2', name: 'Groww ELSS' };
  expect(linkSipDebits([bank, groww, groww2], [sip])[0]).toBe(sip);
  // unresolved / card / non-platform rows untouched
  expect(linkSipDebits([bank, groww], [{ ...sip, accountUnresolved: true }])[0].type).toBe('expense');
  expect(linkSipDebits([{ ...bank, type: 'Credit Card' }, groww], [sip])[0].type).toBe('expense');
  expect(linkSipDebits([bank, groww], [{ ...sip, merchant: 'Swiggy' }])[0].type).toBe('expense');
  expect(linkToInvestment(sip, zer).toAccountId).toBe('z');
  expect(linkSipDebits([bank, groww], [{ ...sip, extractedBalance: 900 }])[0].balanceAccountId).toBe('b');
  expect(linked.balanceAccountId).toBeUndefined();
});

test('edge cases', () => {
  expect(platformOf(undefined)).toBeNull();
  expect(isSipDebit(null)).toBe(false);
  expect(investmentsOn(undefined, 'groww')).toEqual([]);
  expect(linkSipDebits()).toEqual([]);
  const sip = { type: 'expense', merchant: 'Groww', accountId: 'missing' };
  expect(linkSipDebits([groww], [sip])[0]).toBe(sip);
  expect(linkSipDebits([bank, groww], [{ ...sip, accountId: null }])[0].type).toBe('expense');
  const kept = linkSipDebits(
    [bank, groww],
    [{ ...sip, accountId: 'b', extractedBalance: 5, balanceAccountId: 'x' }]
  )[0];
  expect(kept.balanceAccountId).toBe('x');
});
