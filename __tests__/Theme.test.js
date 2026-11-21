/**
 * A1: themed Text/TextInput always get a token colour, so Android's system dark mode can't turn
 * unstyled text near-white on light cards.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';

const store = {};
jest.mock('../data/Storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k) => store[k] ?? null),
    setItem: jest.fn(async (k, v) => {
      store[k] = v;
    }),
  },
}));

const { ThemeProvider, Text, TextInput } = require('../components/Theme');
const tokens = require('../components/tokens').tokens;

const colorOf = (el) => StyleSheet.flatten(el.props.style).color;

const renderIn = async (isDark, ui) => {
  store.dark_mode = String(isDark);
  render(<ThemeProvider>{ui}</ThemeProvider>);
  await act(async () => {});
};

afterEach(() => delete store.dark_mode);

test('Text with no style gets the light text token in light mode', async () => {
  await renderIn(false, <Text>Hello</Text>);
  expect(colorOf(screen.getByText('Hello'))).toBe(tokens.light.text);
});

test('Text with no style gets the dark text token in dark mode', async () => {
  await renderIn(true, <Text>Hello</Text>);
  expect(colorOf(screen.getByText('Hello'))).toBe(tokens.dark.text);
});

test('Text outside the provider still gets a colour (Bootstrap renders before it)', () => {
  render(<Text>Loading</Text>);
  expect(colorOf(screen.getByText('Loading'))).toBe(tokens.light.text);
});

test('an explicit colour still wins over the default', async () => {
  await renderIn(false, <Text style={{ color: '#123456' }}>Red</Text>);
  expect(colorOf(screen.getByText('Red'))).toBe('#123456');
});

test('TextInput gets a text colour and a placeholder colour', async () => {
  await renderIn(false, <TextInput placeholder="Amount" />);
  const input = screen.getByPlaceholderText('Amount');
  expect(colorOf(input)).toBe(tokens.light.text);
  expect(input.props.placeholderTextColor).toBe(tokens.light.placeholder);
});

test('TextInput placeholder colour can be overridden', async () => {
  await renderIn(true, <TextInput placeholder="Note" placeholderTextColor="#ABCDEF" />);
  expect(screen.getByPlaceholderText('Note').props.placeholderTextColor).toBe('#ABCDEF');
});

test('app.json pins the light interface style so the system theme does not leak in', () => {
  const app = require('../app.json');
  expect(app.expo.userInterfaceStyle).toBe('light');
  expect(app.expo.android.userInterfaceStyle).toBe('light');
});
