import { signInWithGoogle, syncGmailTransactions } from '../utils/GmailTracker';
jest.mock('expo-auth-session', () => ({}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
test('missing client ID does not open OAuth or sync', async () => {
  expect(await signInWithGoogle()).toEqual({ success: false, error: 'not_configured' });
  expect(await syncGmailTransactions()).toEqual({ success: false, error: 'not_configured' });
});
