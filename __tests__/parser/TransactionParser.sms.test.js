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
import { applyCategoryRules } from '../../utils/FinanceTools';

const FIXTURE_DIR = path.join(__dirname, '..', '..', '__fixtures__', 'sms');
// Owner's category rules run after parsing, as TransactionRepo.persistMany does for SMS captures
const { rules: OWNER_RULES } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '__fixtures__', 'category_rules.owner.json'), 'utf8')
);

const KNOWN_FAILING = new Set([
  // A5: bank-named UPI Lite top-up must be the bank leg (bank → wallet)
  'axis-upilite-topup-01.flow',
  'axis-upilite-topup-01.accountType',
  // A4: card bill paid from the bank is a transfer, not spending
  'axis-debit-ccbill-amazon-01.type',
  'axis-debit-ccbill-amazon-01.kind',
  'axis-debit-ccbill-amazon-01.flow',
  // A7: Adyar Anand (Bhavan cut off by the card network) is Food
  'axis-cc-spend-adyar-01.category',
  // A3: "INR 9145.91" decimal point stopped CC_PAYMENT_RE
  'axis-cc-payment-01.type',
  'axis-cc-payment-01.kind',
  'axis-cc-payment-01.flow',
  // A7: card limit-change notice is not a transaction
  'sbi-cc-limit-reset-01.parsed',
  // A6: counterparty runs into "View bal"/"Chk Bal" links
  'axis-neft-credit-01.counterparty',
  'axis-neft-credit-baja-01.counterparty',
  // A7: ACH-DR-<name> payee
  'axis-ach-bajaj-01.merchant',
  'axis-ach-bajaj-02.merchant',
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
  const parse = () => {
    const p = parseTransactionText(fx.body, { sender: fx.sender || '' });
    return p && applyCategoryRules({ ...p, title: p.merchant || p.category }, OWNER_RULES);
  };
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
      else if (want === false)
        expect(actual ?? false).toBe(false); // absent flag = false
      else expect(actual).toEqual(want);
    });
  });
});
