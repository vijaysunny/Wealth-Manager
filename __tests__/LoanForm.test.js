/** Phase 13 C2: add/edit a loan or EMI - kinds, validation, the stored record, "Track as EMI". */
import {
  LOAN_KINDS,
  parseDmy,
  formatDmy,
  longDate,
  loanFormCheck,
  buildLoan,
  formFromLoan,
  trackAsEmiPrefill,
} from '../utils/LoanForm';

const d = (y, m, day) => new Date(y, m - 1, day);
const phone = {
  kind: 'cardEmi',
  name: 'Phone EMI',
  amount: 25000,
  months: 12,
  rate: 15,
  firstEmi: d(2026, 9, 15),
  emi: 2256.46,
  payFromId: 'ac',
};

test('the seven kinds in design order', () => {
  expect(LOAN_KINDS.map((k) => k.label)).toEqual([
    'Personal',
    'Home',
    'Car / bike',
    'Gold',
    'Education',
    'Consumer durable',
    'EMI on credit card',
  ]);
});

test('dates: DD/MM/YYYY or "15 Sep 2026"; invalid days rejected', () => {
  expect(parseDmy('15/09/2026')).toEqual(d(2026, 9, 15));
  expect(parseDmy('5-9-2026')).toEqual(d(2026, 9, 5));
  expect(parseDmy('15 Sep 2026')).toEqual(d(2026, 9, 15));
  expect(parseDmy('15 september 2026')).toEqual(d(2026, 9, 15));
  expect(parseDmy('31/02/2026')).toBeNull();
  expect(parseDmy('31 Foo 2026')).toBeNull();
  expect(parseDmy('')).toBeNull();
  expect(formatDmy(d(2026, 9, 5))).toBe('05/09/2026');
  expect(longDate(d(2026, 9, 15))).toBe('15 Sep 2026');
});

test('check: the design values pass; each rule has its message', () => {
  expect(loanFormCheck(phone)).toEqual({ error: null, warn: null });
  expect(loanFormCheck({ ...phone, name: ' ' }).error).toMatch(/name/);
  expect(loanFormCheck({ ...phone, amount: 0 }).error).toMatch(/amount/);
  expect(loanFormCheck({ ...phone, months: 0 }).error).toMatch(/1 and 360/);
  expect(loanFormCheck({ ...phone, months: 361 }).error).toMatch(/1 and 360/);
  expect(loanFormCheck({ ...phone, months: 2.5 }).error).toMatch(/1 and 360/);
  expect(loanFormCheck({ ...phone, rate: 61 }).error).toMatch(/0 and 60/);
  expect(loanFormCheck({ ...phone, rate: -1 }).error).toMatch(/0 and 60/);
  expect(loanFormCheck({ ...phone, firstEmi: null }).error).toMatch(/first EMI date/);
  expect(loanFormCheck({ ...phone, emi: 0 }).error).toMatch(/EMI/);
  expect(loanFormCheck({ ...phone, payFromId: null }).error).toMatch(/card/);
  expect(loanFormCheck({ ...phone, kind: 'personal', payFromId: null }).error).toBeNull();
  // EMI × months below the amount: an error with interest, a warning at 0 %
  expect(loanFormCheck({ ...phone, emi: 1000 }).error).toMatch(/less than the amount/);
  expect(loanFormCheck({ ...phone, rate: 0, emi: 1000 })).toEqual({
    error: null,
    warn: '12 EMIs of ₹1,000 add up to ₹12,000, less than ₹25,000.',
  });
  // paise of rounding never trip it
  expect(
    loanFormCheck({
      kind: 'durable',
      name: 'TV',
      amount: 6456,
      months: 12,
      rate: 0,
      firstEmi: d(2026, 8, 7),
      emi: 537.99,
    }).warn
  ).toBeNull();
});

test('card EMI record: on the card, included in it, no bank fields; outstanding from the schedule', () => {
  const r = buildLoan(phone, {}, d(2026, 11, 22));
  expect(r).toMatchObject({
    type: 'Loan',
    loanKind: 'cardEmi',
    name: 'Phone EMI',
    originalAmount: 25000,
    interestRate: 15,
    loanType: 'Reducing',
    tenure: 12,
    emiAmount: 2256.46,
    onCardId: 'ac',
    includedInCard: true,
    status: 'active',
    prepayments: [],
    balance: 19094.92,
  });
  expect(new Date(r.firstEmiDate)).toEqual(d(2026, 9, 15));
  expect(new Date(r.startDate)).toEqual(d(2026, 8, 15));
  expect(r.payFromAccountId).toBeUndefined();
  expect(r.debitDay).toBeUndefined();
  expect(typeof r.id).toBe('string');
});

test('bank loan record: rate 0 → No Cost EMI; debit day from the first EMI; edit keeps id, prepayments, status and Flat Rate', () => {
  const v = {
    kind: 'durable',
    name: 'Bajaj Finance',
    amount: 6456,
    months: 12,
    rate: 0,
    firstEmi: d(2026, 8, 7),
    emi: 538,
    payFromId: 'axis',
  };
  const r = buildLoan(v, {}, d(2026, 11, 22));
  expect(r).toMatchObject({ loanType: 'No Cost EMI', payFromAccountId: 'axis', debitDay: 7, balance: 4304 });
  expect(r.onCardId).toBeUndefined();
  expect(r.includedInCard).toBeUndefined();
  const old = {
    id: 'L1',
    type: 'Loan',
    loanType: 'Flat Rate',
    status: 'closed',
    closedAt: 'x',
    prepayments: [{ date: '2026-10-01', amount: 1 }],
    onCardId: 'ac',
    includedInCard: true,
    createdAt: 'c',
  };
  const e = buildLoan({ ...v, rate: 10 }, old, d(2026, 11, 22));
  expect(e).toMatchObject({
    id: 'L1',
    loanType: 'Flat Rate',
    status: 'closed',
    closedAt: 'x',
    createdAt: 'c',
    balance: 0,
  });
  expect(e.prepayments).toHaveLength(1);
  expect(e.onCardId).toBeUndefined();
  expect(e.includedInCard).toBeUndefined();
  expect(buildLoan({ ...v, rate: 12 }, {}, d(2026, 11, 22)).loanType).toBe('Reducing');
  expect(buildLoan({ ...v, payFromId: null }, {}).payFromAccountId).toBeUndefined();
});

test('form from a stored loan (edit), including old loans with only a start date', () => {
  expect(formFromLoan(buildLoan(phone, { id: 'x' }))).toEqual({
    kind: 'cardEmi',
    name: 'Phone EMI',
    amount: '25000',
    months: '12',
    rate: '15',
    firstEmi: '15/09/2026',
    emi: '2256.46',
    payFromId: 'ac',
  });
  const old = formFromLoan({
    type: 'Loan',
    name: 'Home',
    originalAmount: 100,
    tenure: 10,
    interestRate: 8,
    emiAmount: 11,
    startDate: d(2026, 1, 31).toISOString(),
  });
  expect(old).toMatchObject({ kind: 'personal', firstEmi: '28/02/2026', payFromId: null });
  expect(formFromLoan({ type: 'Loan', name: 'x' })).toMatchObject({
    amount: '',
    months: '',
    rate: '',
    firstEmi: '',
    emi: '',
  });
});

test('Track as EMI: card expenses ≥ ₹1,000 only; first EMI = the next statement date', () => {
  const card = { id: 'ac', type: 'Credit Card', statementDay: 15 };
  const tx = {
    id: 't',
    type: 'expense',
    amount: 25000,
    accountId: 'ac',
    merchant: 'Croma',
    fullDate: d(2026, 9, 2).toISOString(),
  };
  expect(trackAsEmiPrefill(tx, card)).toEqual({
    kind: 'cardEmi',
    name: 'Croma EMI',
    amount: '25000',
    payFromId: 'ac',
    firstEmi: '15/09/2026',
    sourceTxId: 't',
  });
  // on the statement day itself → that statement; no statement day → a month later
  expect(trackAsEmiPrefill({ ...tx, fullDate: d(2026, 9, 15).toISOString() }, card).firstEmi).toBe(
    '15/09/2026'
  );
  expect(trackAsEmiPrefill({ ...tx, fullDate: d(2026, 9, 16).toISOString() }, card).firstEmi).toBe(
    '15/10/2026'
  );
  expect(trackAsEmiPrefill(tx, { ...card, statementDay: null }).firstEmi).toBe('02/10/2026');
  expect(trackAsEmiPrefill({ ...tx, merchant: '', title: '' }, card).name).toBe('Card EMI');
  expect(trackAsEmiPrefill({ ...tx, amount: 999 }, card)).toBeNull();
  expect(trackAsEmiPrefill({ ...tx, type: 'income' }, card)).toBeNull();
  expect(trackAsEmiPrefill(tx, { ...card, type: 'Bank Account' })).toBeNull();
  expect(trackAsEmiPrefill(tx, null)).toBeNull();
  expect(trackAsEmiPrefill(null, card)).toBeNull();
});
