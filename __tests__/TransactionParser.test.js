import {
  parseTransactionText, detectDirection, detectBank, extractAmount, extractBalance,
  detectColumns, parseStatementRows, parsePdfText, parseDate, guessCategory,
} from '../utils/TransactionParser';

describe('SMS classification (C7)', () => {
  test('ICICI debit mentioning "credited" in Info is an expense', () => {
    const sms = 'ICICI Bank Acct XX123 debited for Rs 500.00 on 05-Jan-24; Rahul credited. UPI:401234567890. Avl Bal Rs 12,345.67';
    const r = parseTransactionText(sms, { sender: 'VK-ICICIB' });
    expect(r.type).toBe('expense');
    expect(r.amount).toBe(500);
    expect(r.bankName).toBe('ICICI Bank');
    expect(r.balance).toBe(12345.67);
  });

  test('genuine credit is income', () => {
    const r = parseTransactionText('Rs 25,000.00 credited to your A/c XX4321 on 01-Jan-24 by ACME Salary. Avl Bal Rs 30,000.00', { sender: 'AD-HDFCBK' });
    expect(r.type).toBe('income');
    expect(r.amount).toBe(25000);
    expect(r.category).toBe('Salary');
    expect(r.bankName).toBe('HDFC Bank');
  });

  test('UPI "Sent" and "Received"', () => {
    expect(parseTransactionText('Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 02/01/24 Ref 401', {}).type).toBe('expense');
    expect(parseTransactionText('Received Rs.700.00 in your A/c from Amit via UPI', {}).type).toBe('income');
  });

  test('"debit card" is not a debit word; credit-card spend stays an expense', () => {
    expect(detectDirection('Credit Card XX99 spent Rs 1,200 at AMAZON')).toBe('expense');
    expect(detectDirection('Debit Card XX12: Rs 300 credited back as refund')).toBe('income');
  });

  test('ignores OTPs, reminders and failures', () => {
    expect(parseTransactionText('123456 is your OTP for txn of Rs 500. Do not share.')).toBeNull();
    expect(parseTransactionText('Rs 5,000 will be debited from your a/c on 05-Jan for EMI')).toBeNull();
    expect(parseTransactionText('Payment of Rs 800 failed. Please retry.')).toBeNull();
    expect(parseTransactionText('Your credit card bill of Rs 4,500 payment due on 10-Jan')).toBeNull();
  });

  test('plain "due to" wording does not trigger the due-ignore', () => {
    const r = parseTransactionText('Due to a revision, Rs 99 debited from A/c XX11 for NETFLIX');
    expect(r && r.amount).toBe(99);
  });

  test('amount skips balance mentioned first', () => {
    expect(extractAmount('Avl Bal Rs 5,000.00. Rs 100 debited at ZOMATO')).toBe(100);
    expect(extractBalance('Rs 100 debited. Avl Bal: INR 4,900.50')).toBe(4900.5);
  });

  test('bank detection uses word boundaries', () => {
    expect(detectBank('', 'Rs 100 credited to your account')).toBeNull(); // not "CRED"
    expect(detectBank('CRED', 'payment received')).toBe('CRED');
    expect(detectBank('VM-SBIINB', 'SBI a/c debited')).toBe('SBI');
  });

  test('category guessing avoids substring false positives', () => {
    expect(guessCategory('automatic payment')).not.toBe('Transport'); // "auto" inside a word
    expect(guessCategory('Kolkata trip')).not.toBe('Transport');      // "ola" inside a word
    expect(guessCategory('Zomato order')).toBe('Food');
  });
});

describe('statement column detection (C4)', () => {
  test('SBI-style headers: Description is not a credit column', () => {
    const cols = detectColumns(['Txn Date', 'Value Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance']);
    expect(cols).toEqual({ date: 0, narration: 2, refNo: 3, debit: 4, credit: 5, balance: 6 });
  });

  test('column index 0 is valid and first date column wins', () => {
    const cols = detectColumns(['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']);
    expect(cols.date).toBe(0);
    expect(cols.debit).toBe(4);
    expect(cols.credit).toBe(5);
    expect(cols.balance).toBe(6);
  });

  test('single amount + Dr/Cr column', () => {
    const cols = detectColumns(['Date', 'Particulars', 'Amount (INR)', 'Dr/Cr', 'Balance']);
    expect(cols.amount).toBe(2);
    expect(cols.drCr).toBe(3);
    expect(cols.debit).toBeUndefined();
    expect(cols.credit).toBeUndefined();
  });

  test('SBI statement: credit rows are kept', () => {
    const rows = [
      ['Account Name', 'Mr X', 'Branch', 'Bangalore'],
      ['Txn Date', 'Value Date', 'Description', 'Ref No./Cheque No.', 'Debit', 'Credit', 'Balance'],
      ['01/01/2024', '01/01/2024', 'SALARY ACME CORP', 'N001', '', '50,000.00', '60,000.00'],
      ['02/01/2024', '02/01/2024', 'UPI/ZOMATO/401', 'U002', '450.00', '', '59,550.00'],
    ];
    const txs = parseStatementRows(rows, 'SBI');
    expect(txs).toHaveLength(2);
    expect(txs[0]).toMatchObject({ amount: 50000, type: 'income', category: 'Salary', account: 'SBI' });
    expect(txs[1]).toMatchObject({ amount: 450, type: 'expense', category: 'Food' });
    expect(txs[0].fullDate.slice(0, 10)).toBe('2024-01-01'); // Txn Date, not overwritten by Value Date
  });

  test('HDFC statement', () => {
    const rows = [
      ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
      ['05/01/24', 'UPI-AMAZON PAY', '401', '05/01/24', '1,299.00', '', '10,000.00'],
      ['06/01/24', 'NEFT-REFUND', '402', '06/01/24', '', '299.00', '10,299.00'],
    ];
    const txs = parseStatementRows(rows, 'HDFC Bank');
    expect(txs.map(t => [t.amount, t.type])).toEqual([[1299, 'expense'], [299, 'income']]);
  });
});

describe('dates', () => {
  test('formats', () => {
    expect(parseDate('05/01/2024').toISOString().slice(0, 10)).toBe('2024-01-05');
    expect(parseDate('5-1-24').toISOString().slice(0, 10)).toBe('2024-01-05');
    expect(parseDate('05 Jan 2024').toISOString().slice(0, 10)).toBe('2024-01-05');
    expect(parseDate('05-Jan-24').toISOString().slice(0, 10)).toBe('2024-01-05');
    expect(parseDate('2024-01-05').toISOString().slice(0, 10)).toBe('2024-01-05');
    expect(parseDate('31/02/2024')).toBeNull();
  });
});

describe('PDF text lines (C3)', () => {
  const text = [
    'HDFC BANK Statement of account',
    'Statement period 01/01/2024 to 31/01/2024',
    '01/01/2024 UPI-ZOMATO-401 450.00 9,550.00',
    '02/01/2024 SALARY ACME CORP 50,000.00 59,550.00',
    '03/01/2024 ATM WITHDRAWAL 2,000.00 57,550.00',
    '04 Jan 2024 INTEREST CREDIT 12.50 Cr',
  ].join('\n');

  test('one transaction per row, direction from running balance', () => {
    const txs = parsePdfText(text, 'HDFC Bank');
    expect(txs.map(t => [t.amount, t.type])).toEqual([
      [450, 'expense'],      // no previous balance → narration keywords → expense
      [50000, 'income'],     // balance rose
      [2000, 'expense'],     // balance fell
      [12.5, 'income'],      // explicit Cr marker
    ]);
    expect(txs[0].category).toBe('Food');
    expect(txs[3].fullDate.slice(0, 10)).toBe('2024-01-04');
  });
});
