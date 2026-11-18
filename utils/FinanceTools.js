export const xirr = (flows) => {
  if (flows.length < 2 || !flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const ordered = flows
    .map((f) => ({ amount: Number(f.amount), time: new Date(f.date).getTime() }))
    .sort((a, b) => a.time - b.time);
  if (
    ordered.some((f) => !Number.isFinite(f.time) || !Number.isFinite(f.amount)) ||
    ordered[0].time === ordered[ordered.length - 1].time
  )
    return null;
  const value = (rate) =>
    ordered.reduce(
      (total, f) => total + f.amount / Math.pow(1 + rate, (f.time - ordered[0].time) / 31536000000),
      0
    );
  let low = -0.9999,
    high = 1;
  while (value(low) * value(high) > 0 && high < 1e6) high = high * 2 + 1;
  if (value(low) * value(high) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const middle = (low + high) / 2;
    if (Math.abs(value(middle)) < 1e-7) return middle;
    if (value(low) * value(middle) <= 0) high = middle;
    else low = middle;
  }
  return (low + high) / 2;
};
export const amortize = ({ principal, annualRate, emi, prepayment = 0 }) => {
  if (
    ![principal, annualRate, emi, prepayment].every(Number.isFinite) ||
    principal <= 0 ||
    annualRate < 0 ||
    emi <= 0 ||
    prepayment < 0
  )
    throw new Error('Enter valid loan values');
  let balance = Math.max(0, principal - prepayment),
    totalInterest = 0;
  const schedule = [];
  for (let month = 1; balance > 0.005 && month <= 1200; month++) {
    const interest = (balance * annualRate) / 1200;
    if (emi <= interest) throw new Error('EMI does not cover monthly interest');
    const payment = Math.min(emi, balance + interest);
    balance = Math.max(0, balance + interest - payment);
    totalInterest += interest;
    schedule.push({ month, payment, interest, principal: payment - interest, balance });
  }
  if (balance > 0.005) throw new Error('Loan term exceeds 100 years');
  return { schedule, months: schedule.length, totalInterest };
};
export const filterHistory = (
  rows,
  { text = '', account = '', min = null, max = null, from = '', to = '', type = '' } = {}
) =>
  rows.filter((tx) => {
    const query = text.trim().toLowerCase();
    const date = tx.fullDate.slice(0, 10);
    return (
      (!query ||
        [tx.title, tx.category, tx.merchant, tx.vpa, tx.note, ...(tx.tags || [])]
          .join(' ')
          .toLowerCase()
          .includes(query)) &&
      (!account || tx.account === account) &&
      (!type || tx.type === type) &&
      (min === null || tx.amount >= min) &&
      (max === null || tx.amount <= max) &&
      (!from || date >= from) &&
      (!to || date <= to)
    );
  });
export const applyCategoryRules = (tx, rules) => {
  const text = [tx.title, tx.merchant, tx.vpa, tx.note].join(' ').toLowerCase();
  const hit = rules.find((rule) => rule.pattern?.trim() && text.includes(rule.pattern.toLowerCase()));
  if (!hit) return tx;
  // A merchant the owner has named is a known payee, not a possible self-transfer
  const { transferCandidate, ...rest } = tx;
  return { ...rest, category: hit.category };
};
export const escapeCsv = (value) => {
  const safe = String(value ?? '').replace(/^[=+@-]/, (match) => "'" + match);
  return `"${safe.replace(/"/g, '""')}"`;
};
export const historyCsv = (rows) =>
  [
    ['Date', 'Title', 'Type', 'Amount', 'Category', 'Account'],
    ...rows.map((tx) => [tx.fullDate, tx.title, tx.type, tx.amount, tx.category, tx.account]),
  ]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\r\n');
