/**
 * LoanLedger.js (Phase 13 C6) - pure. What a loan's payments did: principal, interest & charges.
 *
 * Rules:
 * - Payments are transactions with loanLink { loanId, kind: 'emi'|'prepayment'|'charges'|
 *   'foreclosure'|'disbursal', emiNo, principal, interest, mode? } dated on or before asOf.
 *   Manual prepayments on the loan ({ id, date, amount, mode }) work like linked ones.
 * - Each EMI date that has passed with no linked payment is assumed paid from the schedule
 *   (flagged `assumed` for the UI). A payment linked later with that emiNo replaces it, so
 *   nothing is counted twice. A linked EMI paid early counts on its own date.
 * - Scheduled split: interest = balance × monthly rate (0 for no-cost; original × rate / 12 for
 *   flat), principal = EMI − interest. The last EMI clears what is left.
 * - Prepayment: principal comes off on its date, then the schedule is rebuilt: 'reduceEmi' → new EMI
 *   over the same remaining months; 'endSooner' (default) → same EMI, fewer months.
 * - Charges: no change to what you owe. Foreclosure: owed → 0, loan closed. Disbursal: a row only.
 * - fy: Indian financial year (1 Apr – 31 Mar) of asOf; principal and interest & charges paid.
 */
import { formatMoney } from './Format';
import { calculateOutstandingBalance, emiDate, emiFor, firstEmiDateOf } from './LoanCalculator';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const DAY = 86400000;

/** Indian financial year holding `asOf`: { start: 1 Apr, end: 31 Mar } (local midnight). */
export const fyOf = (asOf = new Date()) => {
  const y = asOf.getMonth() >= 3 ? asOf.getFullYear() : asOf.getFullYear() - 1;
  return { start: new Date(y, 3, 1), end: new Date(y + 1, 2, 31) };
};

/** Months of `emi` needed to clear `bal` at `ratePct` a year (Infinity if the EMI never clears it). */
export const monthsToClear = (bal, ratePct, emi) => {
  if (!(bal > 0)) return 0;
  const r = num(ratePct) / 1200;
  if (r <= 0) return emi > 0 ? Math.ceil(bal / emi - 1e-9) : Infinity;
  if (emi <= bal * r) return Infinity;
  return Math.ceil(-Math.log(1 - (bal * r) / emi) / Math.log(1 + r) - 1e-9);
};

const linkedTo = (loan) => (t) => !!t && !!t.loanLink && String(t.loanLink.loanId) === String(loan.id);

/** True when the ledger has more to go on than the schedule (links or manual prepayments). */
export const hasLedgerData = (loan, txs = []) =>
  (Array.isArray(loan.prepayments) && loan.prepayments.length > 0) || txs.some(linkedTo(loan));

const sourceOf = (tx) =>
  !tx ? 'manual' : tx.smsId || (Array.isArray(tx.tags) && tx.tags.includes('auto-sms')) ? 'sms' : 'manual';

export const ledger = (loan, txs = [], asOf = new Date()) => {
  const fy = fyOf(asOf);
  const statusClosed = loan.status === 'closed';
  const first = firstEmiDateOf(loan);
  const original = num(loan.originalAmount);
  if (!first || !num(loan.emiAmount) || !original) {
    return {
      rows: [],
      principalOwed: statusClosed ? 0 : round2(num(loan.balance)),
      paidCount: 0,
      nextEmi: null,
      monthsLeft: null,
      tenureNow: null,
      endDate: null,
      emi: num(loan.emiAmount),
      fy: { ...fy, principal: 0, interest: 0 },
      fromLinks: false,
      closed: statusClosed,
    };
  }
  const limit = endOfDay(asOf).getTime();
  const rate = num(loan.interestRate);
  const r = rate / 1200;
  const noCost = loan.loanType === 'No Cost EMI' || rate === 0;
  const flat = loan.loanType === 'Flat Rate';
  const interestFor = (b) => (noCost ? 0 : flat ? round2((original * rate) / 1200) : round2(b * r));

  const links = txs
    .filter(linkedTo(loan))
    .map((tx) => ({ ...tx.loanLink, tx, at: new Date(tx.fullDate) }))
    .filter((l) => Number.isFinite(l.at.getTime()) && l.at.getTime() <= limit)
    .sort((a, b) => a.at - b.at);
  const emiLinks = new Map();
  links
    .filter((l) => l.kind === 'emi')
    .forEach((l) => !emiLinks.has(Number(l.emiNo)) && emiLinks.set(Number(l.emiNo), l));
  const manual = (Array.isArray(loan.prepayments) ? loan.prepayments : [])
    .map((p) => ({
      kind: 'prepayment',
      at: new Date(p.date),
      principal: num(p.amount),
      interest: 0,
      mode: p.mode,
      prepaymentId: p.id,
    }))
    .filter((p) => Number.isFinite(p.at.getTime()) && p.at.getTime() <= limit && p.principal > 0);
  const events = [...links.filter((l) => l.kind !== 'emi'), ...manual].sort((a, b) => a.at - b.at);

  let bal = original;
  let emi = num(loan.emiAmount);
  let tenureNow = Math.round(num(loan.tenure)) || 1200;
  let k = 0;
  let closed = false;
  const rows = [];
  const used = new Set();

  const rowOf = (e, extra) => ({
    date: e.at,
    kind: e.kind,
    amount: e.tx ? round2(num(e.tx.amount)) : round2(num(e.principal) + num(e.interest)),
    principal: round2(num(e.principal)),
    interest: round2(num(e.interest)),
    assumed: false,
    txId: e.tx ? e.tx.id : undefined,
    source: sourceOf(e.tx),
    prepaymentId: e.prepaymentId,
    ...extra,
  });
  const apply = (e) => {
    const row = rowOf(e);
    if (e.kind === 'prepayment') {
      const before = tenureNow - k;
      bal = round2(Math.max(0, bal - row.principal));
      if (bal <= 0) closed = true;
      else if (e.mode === 'reduceEmi') {
        emi = noCost
          ? round2(bal / before)
          : flat
            ? round2(bal / before + interestFor(bal))
            : emiFor(bal, rate, before);
        row.note = `EMI now ${formatMoney(emi)}`;
      } else {
        const left =
          noCost || flat ? monthsToClear(bal, 0, emi - interestFor(bal)) : monthsToClear(bal, rate, emi);
        if (Number.isFinite(left) && left < before) {
          tenureNow = k + left;
          const cut = before - left;
          row.note = `tenure cut by ${cut} EMI${cut === 1 ? '' : 's'}`;
        }
      }
    } else if (e.kind === 'foreclosure') {
      bal = 0;
      closed = true;
    }
    rows.push(row);
  };

  let ei = 0;
  while (!closed && bal > 0 && k < tenureNow && k < 1200) {
    const no = k + 1;
    const due = emiDate(loan, no);
    const link = emiLinks.get(no);
    if (!link && due.getTime() > limit) break;
    const at = link ? link.at : due;
    while (ei < events.length && events[ei].at < at) apply(events[ei++]);
    if (closed || bal <= 0 || k >= tenureNow) break;
    let row;
    if (link) {
      used.add(link);
      row = rowOf(link, { emiNo: no, dueDate: due });
    } else {
      const interest = interestFor(bal);
      const principal = no === tenureNow || emi - interest > bal ? bal : round2(emi - interest);
      row = {
        date: due,
        dueDate: due,
        kind: 'emi',
        emiNo: no,
        amount: round2(principal + interest),
        principal,
        interest,
        assumed: true,
        source: 'schedule',
      };
    }
    bal = no === tenureNow ? 0 : round2(Math.max(0, bal - row.principal));
    k = no;
    rows.push(row);
  }
  while (ei < events.length) apply(events[ei++]);
  // EMI links whose number the schedule never reached still paid principal.
  links
    .filter((l) => l.kind === 'emi' && !used.has(l))
    .forEach((l) => {
      const row = rowOf(l, { emiNo: Number(l.emiNo) || null });
      bal = round2(Math.max(0, bal - row.principal));
      rows.push(row);
    });
  rows.sort((a, b) => a.date - b.date);

  if (bal <= 0) closed = true;
  const owed = statusClosed ? 0 : bal;
  const live = !closed && !statusClosed && k < tenureNow;
  let nextEmi = null;
  if (live) {
    const no = k + 1;
    const interest = interestFor(bal);
    const principal = no === tenureNow || emi - interest > bal ? bal : round2(emi - interest);
    nextEmi = { no, date: emiDate(loan, no), amount: round2(principal + interest), principal, interest };
  }
  const fyEnd = endOfDay(fy.end).getTime();
  const inFy = rows.filter((x) => x.date >= fy.start && x.date.getTime() <= fyEnd);
  return {
    rows,
    principalOwed: owed,
    paidCount: k,
    nextEmi,
    monthsLeft: live ? tenureNow - k : 0,
    tenureNow,
    endDate: emiDate(loan, live ? tenureNow : Math.max(1, k)),
    emi,
    fy: {
      ...fy,
      principal: round2(inFy.reduce((s, x) => s + x.principal, 0)),
      interest: round2(inFy.reduce((s, x) => s + x.interest, 0)),
    },
    fromLinks: links.length > 0,
    closed: closed || statusClosed,
  };
};

/** What is owed on a loan: the ledger when it has links or prepayments, else the plain schedule. */
export const loanOwed = (loan, txs = [], asOf = new Date()) => {
  if (loan.status === 'closed') return 0;
  return hasLedgerData(loan, txs)
    ? ledger(loan, txs, asOf).principalOwed
    : calculateOutstandingBalance(loan, asOf);
};

/**
 * Payments list (C3): consecutive assumed EMIs become one group
 * { type: 'assumed', firstNo, lastNo, from, to, amount, rows }; others { type: 'row', row }.
 */
export const groupAssumed = (rows = []) => {
  const out = [];
  rows.forEach((row) => {
    const last = out[out.length - 1];
    if (row.assumed && last && last.type === 'assumed') {
      last.rows.push(row);
      last.firstNo = Math.min(last.firstNo, row.emiNo);
      last.lastNo = Math.max(last.lastNo, row.emiNo);
      last.from = row.date < last.from ? row.date : last.from;
      last.to = row.date > last.to ? row.date : last.to;
      last.amount = round2(last.amount + row.amount);
    } else if (row.assumed)
      out.push({
        type: 'assumed',
        firstNo: row.emiNo,
        lastNo: row.emiNo,
        from: row.date,
        to: row.date,
        amount: row.amount,
        rows: [row],
      });
    else out.push({ type: 'row', row });
  });
  return out;
};

/**
 * Default split when linking a payment of `amount` on `asOf` (C6). For an EMI: the next EMI
 * number not yet linked whose date is on or before asOf + 5 days (or the number of the link being
 * edited), split from the schedule; anything above the scheduled EMI goes to interest & charges.
 */
export const defaultSplit = (loan, txs = [], kind, amount, asOf = new Date(), editing = null) => {
  const amt = round2(num(amount));
  const others = txs.filter((t) => t && (!editing || t.id !== editing.id));
  if (kind === 'prepayment') return { principal: amt, interest: 0, note: 'All principal' };
  if (kind === 'charges')
    return { principal: 0, interest: amt, note: 'Late fee, bounce charge, processing fee or GST' };
  if (kind === 'disbursal') return { principal: 0, interest: 0, note: 'Money in from the lender' };
  if (kind === 'foreclosure') {
    const owed = ledger(loan, others, asOf).principalOwed;
    const principal = Math.min(owed, amt);
    return {
      principal,
      interest: round2(amt - principal),
      note: 'What is owed as principal; the rest as charges',
    };
  }
  let no;
  if (
    editing &&
    editing.loanLink &&
    editing.loanLink.kind === 'emi' &&
    editing.loanLink.emiNo &&
    String(editing.loanLink.loanId) === String(loan.id) // moved to another loan: number it afresh
  )
    no = Number(editing.loanLink.emiNo);
  else {
    const linked = new Set(
      others
        .filter(linkedTo(loan))
        .filter((t) => t.loanLink.kind === 'emi')
        .map((t) => Number(t.loanLink.emiNo))
    );
    const horizon = new Date(asOf.getTime() + 5 * DAY);
    no = 1;
    while (no < 1200 && emiDate(loan, no + 1) && emiDate(loan, no + 1) <= horizon) no += 1;
    while (linked.has(no)) no += 1;
  }
  const due = emiDate(loan, no);
  const before = due ? ledger(loan, others, new Date(due.getTime() - DAY)) : null;
  const next = before && before.nextEmi && before.nextEmi.no === no ? before.nextEmi : null;
  if (!next || loan.status === 'closed')
    return { emiNo: no, principal: amt, interest: 0, note: 'Nothing scheduled: all principal' };
  const principal = Math.min(next.principal, amt);
  return {
    emiNo: no,
    principal,
    interest: round2(amt - principal),
    note: `EMI ${no} of ${before.tenureNow} · from the schedule, edit to match your lender`,
  };
};

const KIND_LABEL = {
  emi: 'EMI',
  prepayment: 'Prepayment',
  charges: 'Fee',
  foreclosure: 'Foreclosure',
  disbursal: 'Loan received',
};
/** "EMI 6", "Prepayment", "Fee", "Foreclosure", "Loan received". */
export const kindLabel = (row) =>
  row.kind === 'emi' && row.emiNo ? `EMI ${row.emiNo}` : KIND_LABEL[row.kind] || 'Payment';

const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const SOURCE = { sms: 'SMS', manual: 'manual', schedule: 'schedule (no SMS seen)' };

/**
 * C3 "Export for tax filing (CSV)": this FY's rows, oldest first. Figures only: no tax sections and
 * no advice. Fees go in the charges column; EMI and foreclosure interest in the interest column.
 */
export const loanCsv = (l) => {
  const end = endOfDay(l.fy.end).getTime();
  const lines = ['date,type,amount,principal,interest,charges,source'];
  l.rows
    .filter((x) => x.date >= l.fy.start && x.date.getTime() <= end)
    .forEach((x) => {
      const charges = x.kind === 'charges';
      lines.push(
        [
          ymd(x.date),
          kindLabel(x),
          x.amount.toFixed(2),
          x.principal.toFixed(2),
          (charges ? 0 : x.interest).toFixed(2),
          (charges ? x.interest : 0).toFixed(2),
          SOURCE[x.source] || x.source,
        ].join(',')
      );
    });
  return `${lines.join('\n')}\n`;
};
