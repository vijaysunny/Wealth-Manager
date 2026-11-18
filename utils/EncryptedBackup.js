import { gcm } from '@noble/ciphers/aes';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 } from '@noble/hashes/utils';
import { getRandomBytes } from 'expo-crypto';
const derive = (password, salt) => pbkdf2(sha256, utf8ToBytes(password), salt, { c: 210000, dkLen: 32 });
export const encryptBackup = (data, password) => {
  if (password.length < 10) throw new Error('Use a backup passphrase of at least 10 characters');
  const salt = getRandomBytes(16),
    nonce = getRandomBytes(12);
  const header = {
    app: 'WealthManager',
    encrypted: true,
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 210000,
  };
  const aad = utf8ToBytes(JSON.stringify(header));
  const ciphertext = gcm(derive(password, salt), nonce, aad).encrypt(utf8ToBytes(JSON.stringify(data)));
  return { ...header, salt: bytesToHex(salt), nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) };
};
export const decryptBackup = (envelope, password) => {
  if (
    envelope.app !== 'WealthManager' ||
    envelope.version !== 1 ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    envelope.iterations !== 210000
  )
    throw new Error('Unsupported encrypted backup');
  try {
    const salt = hexToBytes(envelope.salt),
      nonce = hexToBytes(envelope.nonce);
    if (salt.length !== 16 || nonce.length !== 12) throw new Error('Invalid backup');
    const header = {
      app: 'WealthManager',
      encrypted: true,
      version: 1,
      kdf: 'PBKDF2-SHA256',
      iterations: 210000,
    };
    return JSON.parse(
      bytesToUtf8(
        gcm(derive(password, salt), nonce, utf8ToBytes(JSON.stringify(header))).decrypt(
          hexToBytes(envelope.ciphertext)
        )
      )
    );
  } catch {
    throw new Error('Wrong passphrase or damaged backup');
  }
};
