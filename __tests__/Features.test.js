import { isGmailEnabled } from '../utils/Features';
import { signInWithGoogle, syncGmailTransactions } from '../utils/GmailTracker';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

test('Gmail is off by default and its entry points refuse to run (B1)', async () => {
  delete process.env.EXPO_PUBLIC_ENABLE_GMAIL;
  expect(isGmailEnabled()).toBe(false);
  expect(await signInWithGoogle()).toEqual({ success: false, error: 'not_configured' });
  expect(await syncGmailTransactions()).toEqual({ success: false, error: 'not_configured' });
});
