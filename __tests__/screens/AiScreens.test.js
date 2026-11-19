/**
 * AI UI smoke tests: the Settings panel keeps keys in SecureStore (never echoed back), refuses to
 * switch on without a key, and the AI Assistant screen explains how to enable AI when it is off.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (cb) => R.useEffect(cb, []) };
});
const secure = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k) => secure[k] ?? null),
  setItemAsync: jest.fn(async (k, v) => {
    secure[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k) => {
    delete secure[k];
  }),
}));

const AiSettingsPanel = require('../../components/AiSettingsPanel').default;
const AiAssistantScreen = require('../../screens/AiAssistantScreen').default;

afterEach(() => jest.restoreAllMocks());

test('panel: cannot enable without a key; saved key goes to SecureStore and is not shown', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<AiSettingsPanel />);
  await screen.findByText(/Google Gemini Flash · no key/);

  fireEvent(screen.UNSAFE_getAllByType(require('react-native').Switch)[0], 'valueChange', true);
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith('AI', expect.stringMatching(/Save at least one API key/))
  );

  fireEvent.changeText(screen.getAllByPlaceholderText('Paste API key')[0], 'secret-gemini-key');
  fireEvent.press(screen.getAllByText('Save key')[0]);
  await screen.findByText(/Google Gemini Flash · key saved ✓/);
  expect(secure.ai_key_gemini).toBe('secret-gemini-key');
  expect(screen.queryByDisplayValue('secret-gemini-key')).toBeNull();
});

test('assistant screen explains how to turn AI on', async () => {
  render(<AiAssistantScreen navigation={{ goBack: jest.fn() }} />);
  await screen.findByText(/AI is off/);
});
