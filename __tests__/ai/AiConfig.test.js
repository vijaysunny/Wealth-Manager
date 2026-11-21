import { aiSummary } from '../../utils/ai/AiConfig';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

test('aiSummary: one readable line for Settings', () => {
  expect(aiSummary({ enabled: false }, {})).toBe('No key yet · AI is off');
  expect(aiSummary({ enabled: true }, {})).toBe('On · no key yet');
  expect(aiSummary({ enabled: false, order: ['gemini', 'groq', 'xai'] }, { gemini: true })).toBe(
    'Gemini key saved · AI is off'
  );
  expect(aiSummary({ enabled: false, order: ['gemini', 'groq', 'xai'] }, { gemini: true, groq: true })).toBe(
    'Gemini, Groq keys saved · AI is off'
  );
  expect(aiSummary({ enabled: true, order: ['groq', 'gemini', 'xai'] }, { gemini: true, groq: true })).toBe(
    'On · Groq'
  );
});
