import { encryptBackup,decryptBackup } from '../utils/EncryptedBackup';
jest.mock('expo-crypto',()=>({getRandomBytes:count=>Uint8Array.from(require('crypto').randomBytes(count))}));
test('encrypted backup round trips, refuses wrong passphrase and detects tampering',()=>{
  const envelope=encryptBackup({transactions:[{amount:123}]},'long-passphrase-123');
  expect(JSON.stringify(envelope)).not.toContain('transactions');
  expect(decryptBackup(envelope,'long-passphrase-123')).toEqual({transactions:[{amount:123}]});
  expect(()=>decryptBackup(envelope,'wrong-passphrase')).toThrow();
  const modified={...envelope,ciphertext:(envelope.ciphertext[0]==='0'?'1':'0')+envelope.ciphertext.slice(1)};
  expect(()=>decryptBackup(modified,'long-passphrase-123')).toThrow();
});
