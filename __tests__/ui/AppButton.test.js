import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import AppButton, { buttonColors } from '../../components/ui/AppButton';
import { tokens } from '../../components/tokens';

jest.mock('../../data/Storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) },
}));

test('renders a normal-case label and fires onPress', () => {
  const onPress = jest.fn();
  render(<AppButton title="Save key" onPress={onPress} />);
  fireEvent.press(screen.getByRole('button', { name: 'Save key' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Save key')).toBeTruthy();
});

test('disabled and loading buttons do not fire', () => {
  const onPress = jest.fn();
  render(
    <>
      <AppButton title="A" disabled onPress={onPress} />
      <AppButton title="B" loading onPress={onPress} />
    </>
  );
  fireEvent.press(screen.getByRole('button', { name: 'A' }));
  fireEvent.press(screen.getByRole('button', { name: 'B' }));
  expect(onPress).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'B' }).props.accessibilityState.busy).toBe(true);
});

test('tap target is at least 44 tall for every size', () => {
  ['lg', 'md', 'sm'].forEach((size) => {
    const { unmount } = render(<AppButton title={size} size={size} onPress={() => {}} />);
    const btn = screen.getByRole('button', { name: size });
    const h = StyleSheet.flatten(btn.props.style).minHeight;
    const slop = btn.props.hitSlop ? btn.props.hitSlop.top + btn.props.hitSlop.bottom : 0;
    expect(h + slop).toBeGreaterThanOrEqual(44);
    unmount();
  });
});

test('variants map to token colours', () => {
  const t = tokens.light;
  expect(buttonColors('primary', t).fg).toBe(t.onPrimary);
  expect(buttonColors('danger', t).fg).toBe(t.dangerText);
  expect(buttonColors('secondary', t).fg).toBe(t.primary);
  expect(buttonColors('dashed', t).dashed).toBe(true);
});
