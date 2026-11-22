import React from 'react';
import fc from 'fast-check';
import { render, screen } from '@testing-library/react-native';
import TransactionRow, { payeeOf } from '../components/ui/TransactionRow';
import {
  groupByDay,
  dayTitle,
  touchesAccount,
  shortAccountName,
  accountInitials,
} from '../utils/TransactionList';

// babel-jest hoists this above the imports
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const at = (d, h, o) => ({ fullDate: new Date(2026, 10, d, h).toISOString(), ...o });

test('groups by day, newest first; day total ignores transfers and excluded rows', () => {
  const groups = groupByDay([
    at(17, 9, { id: 'p', type: 'expense', amount: 30 }),
    at(18, 10, { id: 'g', type: 'expense', amount: 1998.19 }),
    at(18, 12, { id: 'u', type: 'transfer', amount: 500 }),
    at(17, 11, { id: 'b', type: 'expense', amount: 75 }),
    at(17, 12, { id: 's', type: 'income', amount: 10 }),
    at(17, 13, { id: 'x', type: 'expense', amount: 999, excludeFromReports: true }),
    { id: 'bad', fullDate: 'nope' },
    null,
  ]);
  expect(groups.map((g) => g.title)).toEqual(['WED, 18 NOV', 'TUE, 17 NOV']);
  expect(groups[0].total).toBe(-1998.19);
  expect(groups[0].data.map((t) => t.id)).toEqual(['u', 'g']);
  expect(groups[1].total).toBe(-95);
  expect(groupByDay()).toEqual([]);
});

test('dayTitle', () => {
  expect(dayTitle(new Date(2026, 10, 16))).toBe('MON, 16 NOV');
});

test('touchesAccount by id or name on either side', () => {
  const axis = { id: 7, name: 'Axis Bank' };
  expect(touchesAccount({ accountId: 7 }, axis)).toBe(true);
  expect(touchesAccount({ toAccountId: '7' }, axis)).toBe(true);
  expect(touchesAccount({ account: 'Axis Bank' }, axis)).toBe(true);
  expect(touchesAccount({ toAccount: 'Axis Bank' }, axis)).toBe(true);
  expect(touchesAccount({ account: 'SBI' }, axis)).toBe(false);
  expect(touchesAccount({ account: 'SBI' }, null)).toBe(true);
});

test('shortAccountName', () => {
  expect(shortAccountName('Axis Bank', '0973')).toBe('Axis ••0973');
  expect(shortAccountName('Axis Bank Credit Card', '9070')).toBe('Axis Card ••9070');
  expect(shortAccountName('UPI Lite')).toBe('UPI Lite');
  expect(shortAccountName()).toBe('');
});

test('A1: digits already in the name are not repeated', () => {
  expect(shortAccountName('Axis Bank ••0973', '0973')).toBe('Axis ••0973');
  expect(shortAccountName('Axis Bank Credit Card ••9070', '9070')).toBe('Axis Card ••9070');
  expect(shortAccountName('SBI Credit Card ••1987', null)).toBe('SBI Card ••1987');
  expect(shortAccountName('Axis Bank XX0973', '0973')).toBe('Axis ••0973');
  expect(shortAccountName('Axis Bank xx0973')).toBe('Axis ••0973');
  expect(shortAccountName('HDFC Bank *1234', '1234')).toBe('HDFC ••1234');
  expect(shortAccountName('Equitas Small Finance Bank 1246', '1246')).toBe('Equitas Small Finance ••1246');
  expect(shortAccountName('Axis Bank ••0973 ••0973', '0973')).toBe('Axis ••0973');
  expect(shortAccountName('UPI Lite')).toBe('UPI Lite');
  // stored last4 wins over digits in the name
  expect(shortAccountName('Axis Bank ••1111', '0973')).toBe('Axis ••0973');
});

test('A1 property: the output never contains the same 4 digits twice', () => {
  const marker = fc.constantFrom('••', ' ••', ' XX', ' xx', ' *', ' ', '');
  fc.assert(
    fc.property(
      fc.constantFrom(
        'Axis Bank',
        'SBI Credit Card',
        'Axis Bank Credit Card',
        'HDFC',
        'UPI Lite',
        'Kotak Bank'
      ),
      fc.option(fc.tuple(marker, fc.integer({ min: 0, max: 9999 })), { nil: null }),
      fc.option(fc.integer({ min: 0, max: 9999 }), { nil: null }),
      (base, suffix, stored) => {
        const pad = (n) => String(n).padStart(4, '0');
        const nameDigits = suffix ? pad(suffix[1]) : null;
        const name = suffix ? `${base}${suffix[0] === '' ? ' ' : suffix[0]}${nameDigits}` : base;
        const last4 = stored === null ? null : pad(stored);
        const out = shortAccountName(name, last4);
        const groups = out.match(/\d{4}/g) || [];
        expect(new Set(groups).size).toBe(groups.length);
        expect(groups.length).toBeLessThanOrEqual(1);
        const want = last4 || nameDigits;
        if (want) expect(out.endsWith(`••${want}`)).toBe(true);
      }
    )
  );
});

test('A1.3: badge initials use the bank short code', () => {
  expect(accountInitials('Axis Bank ••0973')).toBe('AX');
  expect(accountInitials('Axis Bank Credit Card')).toBe('AX');
  expect(accountInitials('SBI Credit Card ••1987')).toBe('SBI');
  expect(accountInitials('State Bank of India')).toBe('SBI');
  expect(accountInitials('HDFC Bank')).toBe('HD');
  expect(accountInitials('ICICI Bank')).toBe('IC');
  expect(accountInitials('Kotak Mahindra')).toBe('KO');
  expect(accountInitials('Equitas Small Finance Bank')).toBe('EQ');
  expect(accountInitials('Bajaj Finance')).toBe('BA');
  expect(accountInitials('')).toBe('?');
  expect(accountInitials()).toBe('?');
});

describe('A5: row title is the payee, not the category', () => {
  test('merchant beats a title that repeats the category', () => {
    expect(payeeOf({ title: 'Subscriptions', merchant: 'Google', category: 'Subscriptions' })).toBe('Google');
    expect(payeeOf({ title: 'Subscriptions', counterparty: 'Kavya', category: 'Subscriptions' })).toBe(
      'Kavya'
    );
    expect(payeeOf({ title: 'Chai', category: 'Food' })).toBe('Chai');
    expect(payeeOf({ title: 'Food', category: 'Food' })).toBe('Food');
    expect(payeeOf({ type: 'transfer' })).toBe('Transfer');
    expect(payeeOf({})).toBe('Transaction');
  });
  test('the row renders "Google"', () => {
    render(
      React.createElement(TransactionRow, {
        tx: {
          id: 1,
          type: 'expense',
          amount: 1998.19,
          title: 'Subscriptions',
          merchant: 'Google',
          category: 'Subscriptions',
        },
      })
    );
    expect(screen.getByText('Google')).toBeTruthy();
  });
});
