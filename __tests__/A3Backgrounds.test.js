/** Phase 13 A3: first-run, loading and crash screens have their own background and readable text. */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet, Text } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';
import { contrast, tokens } from '../components/tokens';
import Onboarding from '../components/Onboarding';
import Bootstrap from '../components/Bootstrap';
import ErrorBoundary from '../components/ErrorBoundary';
import { setNoForceDark } from '../plugins/withNoForceDark';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const opaque = (c) => typeof c === 'string' && /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{6}ff)$/i.test(c);
const bgOf = (node) => {
  for (let n = node; n; n = n.parent) {
    const bg = StyleSheet.flatten(n.props?.style)?.backgroundColor;
    if (bg) return bg;
  }
  return null;
};
const expectReadable = (root) => {
  expect(opaque(StyleSheet.flatten(root.props.style).backgroundColor)).toBe(true);
  const texts = root.findAll((n) => n.type === Text);
  expect(texts.length).toBeGreaterThan(0);
  texts.forEach((n) => {
    const color = StyleSheet.flatten(n.props.style)?.color;
    expect(color).toBeTruthy();
    expect(contrast(color, bgOf(n))).toBeGreaterThanOrEqual(4.5);
  });
};

test('Onboarding welcome: own background, every text ≥ 4.5:1', async () => {
  render(
    <Onboarding>
      <Text>APP</Text>
    </Onboarding>
  );
  expect(await screen.findByText('Welcome to WealthManager')).toBeTruthy();
  expectReadable(screen.getByTestId('onboarding-root'));
  expect(screen.getByText('Use manual entry')).toBeTruthy();
});

test('Bootstrap loading and error views: own background, readable', async () => {
  render(
    <Bootstrap open={() => new Promise(() => {})}>
      <Text>APP</Text>
    </Bootstrap>
  );
  expectReadable(screen.getByTestId('bootstrap-root'));
  screen.unmount();
  render(
    <Bootstrap open={() => Promise.reject(new Error('Migration count mismatch'))}>
      <Text>APP</Text>
    </Bootstrap>
  );
  await act(async () => {});
  expect(screen.getByText('Migration count mismatch')).toBeTruthy();
  expectReadable(screen.getByTestId('bootstrap-root'));
});

test('ErrorBoundary crash view: own background, readable', () => {
  const Boom = () => {
    throw new Error('boom');
  };
  jest.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>
  );
  expectReadable(screen.getByTestId('error-root'));
  expect(StyleSheet.flatten(screen.getByTestId('error-root').props.style).backgroundColor).toBe(
    tokens.light.bg
  );
});

test('app.json sets a window background and the no-force-dark plugin', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
  expect(app.expo.backgroundColor).toBe(tokens.light.bg);
  expect(app.expo.plugins).toContain('./plugins/withNoForceDark');
});

test('withNoForceDark adds forceDarkAllowed=false to AppTheme once', () => {
  const styles = {
    resources: {
      style: [
        { $: { name: 'AppTheme' }, item: [{ $: { name: 'android:forceDarkAllowed' }, _: 'true' }] },
        { $: { name: 'Other' } },
      ],
    },
  };
  const out = setNoForceDark(setNoForceDark(styles));
  const items = out.resources.style[0].item.filter((i) => i.$.name === 'android:forceDarkAllowed');
  expect(items).toEqual([{ $: { name: 'android:forceDarkAllowed' }, _: 'false' }]);
  expect(setNoForceDark({ resources: {} })).toEqual({ resources: {} });
  const noItems = setNoForceDark({ resources: { style: [{ $: { name: 'AppTheme' } }] } });
  expect(noItems.resources.style[0].item).toHaveLength(1);
});
