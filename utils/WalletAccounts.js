/** WalletAccounts.js - pure helpers for creating wallet accounts (plan A1/A6). */
export const WALLET_PROVIDER_CHOICES = [
  'PhonePe',
  'Paytm',
  'Google Pay',
  'BHIM',
  'Amazon Pay',
  'CRED',
  'MobiKwik',
  'Other',
];

/** Wallet metadata for a new Wallet account (plan A1/A6). Pure; exported for tests. */
export const walletFields = ({ name, walletSubType, provider, linkedBankId }) => {
  const prov = provider && provider !== 'Other' ? provider : null;
  const aliases = [
    String(name || '')
      .toLowerCase()
      .trim(),
  ];
  if (prov && walletSubType === 'UPI Lite')
    aliases.push(`${prov.toLowerCase()} lite`, `upi lite ${prov.toLowerCase()}`);
  return {
    subType: walletSubType || 'Other Wallet',
    provider: prov,
    linkedBankId: linkedBankId ?? null,
    aliases: [...new Set(aliases.filter(Boolean))],
  };
};
