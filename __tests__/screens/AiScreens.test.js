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

// No network in tests: the automatic Test after Save key is mocked (A9)
const mockRunTest = jest.fn(async () => ({ ok: true, model: 'gemini-x', line: 'Working · gemini-x' }));
jest.mock('../../utils/ai/AiClient', () => ({
  ...jest.requireActual('../../utils/ai/AiClient'),
  runProviderTest: (...a) => mockRunTest(...a),
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
  await screen.findByText(/Google Gemini Flash · key saved/);
  expect(secure.ai_key_gemini).toBe('secret-gemini-key');
  expect(screen.queryByDisplayValue('secret-gemini-key')).toBeNull();
});

test('assistant screen (C5.9): status card on top, visible "AI is off" note, no input bar', async () => {
  ['gemini', 'groq', 'xai'].forEach((id) => delete secure[`ai_key_${id}`]);
  render(<AiAssistantScreen navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  expect(await screen.findByTestId('ai-off-card')).toBeTruthy();
  expect(await screen.findByTestId('ai-status-card')).toBeTruthy();
  const title = screen.getByText('AI is off');
  // the regression: text must carry an explicit colour, never the system default
  expect(require('react-native').StyleSheet.flatten(title.props.style).color).toBe('#0E1726');
  expect(screen.getByText('No key · used if Gemini fails')).toBeTruthy();
  expect(screen.queryByTestId('ai-question')).toBeNull();
});

test('assistant screen: with AI on, chips ask and the reply bubble names the provider', async () => {
  secure.ai_key_gemini = 'k';
  const Storage = require('../../data/Storage').default;
  await Storage.setItem('ai_settings', JSON.stringify({ enabled: true }));
  const tasks = require('../../utils/ai/AiTasks');
  jest.spyOn(tasks, 'aiInsights').mockResolvedValue({ text: 'Mostly food.', provider: 'gemini' });
  render(<AiAssistantScreen navigation={{ goBack: jest.fn(), navigate: jest.fn() }} />);
  fireEvent.press(await screen.findByRole('button', { name: 'Where did my money go this month?' }));
  expect(await screen.findByText('Mostly food.')).toBeTruthy();
  expect(screen.getByText(/via Gemini/)).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('ai-question'), 'And transport?');
  fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(screen.getAllByText('Mostly food.')).toHaveLength(2));
  await Storage.setItem('ai_settings', JSON.stringify({ enabled: false }));
  delete secure.ai_key_gemini;
});

test('A9: Save key runs the Test, shows the status line and offers to turn AI on', async () => {
  delete secure.ai_key_gemini;
  delete secure.ai_key_groq;
  delete secure.ai_key_xai;
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<AiSettingsPanel />);
  await screen.findByText(/Google Gemini Flash · no key/);
  fireEvent.changeText(screen.getAllByPlaceholderText('Paste API key')[0], 'k2');
  fireEvent.press(screen.getAllByText('Save key')[0]);
  expect(await screen.findByText('Working · gemini-x')).toBeTruthy();
  expect(mockRunTest).toHaveBeenCalledWith('gemini', 'k2');
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith('Turn on AI now?', expect.any(String), expect.any(Array))
  );
  const turnOn = alert.mock.calls
    .find((c) => c[0] === 'Turn on AI now?')[2]
    .find((b) => b.text === 'Turn on');
  turnOn.onPress();
  await waitFor(() =>
    expect(
      screen
        .UNSAFE_getAllByType(require('react-native').Switch)
        .find((x) => x.props.accessibilityLabel === 'Use AI').props.value
    ).toBe(true)
  );
});

test('A9: a failing Test shows the API error under the provider', async () => {
  ['gemini', 'groq', 'xai'].forEach((id) => delete secure[`ai_key_${id}`]);
  mockRunTest.mockResolvedValueOnce({ ok: false, line: 'HTTP 400: API key not valid.' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<AiSettingsPanel />);
  await screen.findByText(/Google Gemini Flash · no key/);
  fireEvent.changeText(screen.getAllByPlaceholderText('Paste API key')[0], 'bad');
  fireEvent.press(screen.getAllByText('Save key')[0]);
  expect(await screen.findByText('HTTP 400: API key not valid.')).toBeTruthy();
});
