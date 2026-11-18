/**
 * CaptureMapper.js
 * Pure (no React Native imports). The ONE place that copies parser output fields onto a
 * captured transaction record, so the SMS inbox scan, live listener, manual scan and
 * Gmail sync all store the same fields.
 */

/** Extra fields from parseTransactionText() that a stored transaction must keep. */
export const capturedFields = (parsed = {}) => {
  const out = {
    accountType: parsed.accountType || null,
    last4: parsed.last4 || null,
    channel: parsed.channel || null,
    counterparty: parsed.counterparty || null,
    availableLimit: Number.isFinite(parsed.availableLimit) ? parsed.availableLimit : null,
  };
  if (parsed.type === 'transfer' && parsed.kind) {
    out.transferKind = parsed.kind;
    out.flow = parsed.flow;
  }
  if (parsed.needsAccountReview) out.needsAccountReview = true;
  if (parsed.transferCandidate) out.transferCandidate = true;
  return out;
};
