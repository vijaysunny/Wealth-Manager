import { walletFields } from '../utils/WalletAccounts';

test('UPI Lite wallet gets subtype, provider, linked bank and matching aliases', () => {
  expect(
    walletFields({
      name: 'PhonePe UPI Lite',
      walletSubType: 'UPI Lite',
      provider: 'PhonePe',
      linkedBankId: 'axis',
    })
  ).toEqual({
    subType: 'UPI Lite',
    provider: 'PhonePe',
    linkedBankId: 'axis',
    aliases: ['phonepe upi lite', 'phonepe lite', 'upi lite phonepe'],
  });
  expect(walletFields({ name: 'FASTag', walletSubType: 'FASTag', provider: 'Other' })).toMatchObject({
    subType: 'FASTag',
    provider: null,
    linkedBankId: null,
  });
});
