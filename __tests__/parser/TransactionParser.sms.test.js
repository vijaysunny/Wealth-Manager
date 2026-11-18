/**
 * Data-driven SMS parser tests (plan §C1).
 * Every JSON file in __fixtures__/sms is loaded; every key in each entry's
 * `expected` block becomes its own test. Adding a new SMS case = adding JSON only.
 *
 * KNOWN_FAILING lists "<fixtureId>.<field>" pairs the parser does not handle yet.
 * They run as `test.failing`, so the suite stays green, and Jest reports an error
 * as soon as one starts passing - remove it from the list when that happens.
 */
import fs from 'fs';
import path from 'path';
import { parseTransactionText } from '../../utils/TransactionParser';

const FIXTURE_DIR = path.join(__dirname, '..', '..', '__fixtures__', 'sms');

const KNOWN_FAILING = new Set([
  'axis-cc-spend-01.last4',
  'axis-cc-spend-01.refNo',
  'axis-cc-spend-01.availableLimit',
  'axis-autopay-google-01.needsAccountReview',
  'axis-autopay-google-01.merchant',
  'axis-autopay-google-01.category',
  'axis-imps-debit-178.last4',
  'axis-imps-debit-178.channel',
  'axis-imps-debit-178.counterparty',
  'axis-upilite-topup-500.parsed',
  'axis-upilite-topup-500.type',
  'axis-upilite-topup-500.kind',
  'axis-upilite-topup-500.subType',
  'axis-upilite-topup-500.amount',
  'axis-upilite-topup-500.bank',
  'axis-upilite-topup-500.last4',
  'axis-upilite-topup-500.refNo',
  'axis-upilite-topup-500.balance',
  'axis-upi-groww-5050.last4',
  'axis-upi-groww-5050.merchant',
  'axis-imps-debit-42000.last4',
  'axis-imps-debit-42000.channel',
  'axis-imps-debit-42000.counterparty',
  'axis-imps-debit-42000.transferCandidate',
  'equitas-upi-96.bank',
  'equitas-upi-96.last4',
  'equitas-upi-25.bank',
  'equitas-upi-25.last4',
  'sbi-cc-spend-143.last4',
  'sbi-cc-spend-143.category',
  'sbi-cc-payment-5770.type',
  'sbi-cc-payment-5770.kind',
  'sbi-cc-payment-5770.availableLimit',
  'sbi-cc-payment-5770.channel',
  'sbi-cc-spend-86.last4',
  'sbi-cc-spend-86.category',
  'sbi-cc-spend-600.last4',
  'sbi-cc-spend-600.category',
  'sbi-cc-spend-353.last4',
  'syn-hdfc-salary-credit.last4',
  'syn-hdfc-upi-sent.last4',
]);

// Fixture key → parser output key, where the names differ.
const FIELD_MAP = { bank: 'bankName' };

const loadFixtures = () =>
  fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((file) => {
      const { messages } = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
      return messages.map((m) => ({ ...m, file }));
    });

const fixtures = loadFixtures();

test('fixture ids are unique', () => {
  const ids = fixtures.map((f) => f.id);
  expect(new Set(ids).size).toBe(ids.length);
});

describe.each(fixtures.map((f) => [f.id, f]))('%s', (id, fx) => {
  const parse = () => parseTransactionText(fx.body, { sender: fx.sender || '' });
  const { parsed: shouldParse = true, ...fields } = fx.expected;

  const t = (name, fn) => (KNOWN_FAILING.has(`${id}.${name}`) ? test.failing(name, fn) : test(name, fn));

  t('parsed', () => {
    if (shouldParse) expect(parse()).not.toBeNull();
    else expect(parse()).toBeNull();
  });

  if (!shouldParse) return;

  Object.entries(fields).forEach(([key, want]) => {
    t(key, () => {
      const got = parse();
      expect(got).not.toBeNull();
      const actual = got[FIELD_MAP[key] || key];
      if (typeof want === 'number') expect(actual).toBeCloseTo(want, 2);
      else if (want === null) expect(actual ?? null).toBeNull();
      else expect(actual).toEqual(want);
    });
  });
});
