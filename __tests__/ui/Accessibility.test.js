/**
 * D4 accessibility: every pressable in the shared components has an accessibilityLabel or a
 * text child (icon-only buttons must be labelled), and a button role.
 */
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  AppButton,
  AppSwitch,
  Banner,
  Chip,
  Collapsible,
  EmptyState,
  IconButton,
  ListRow,
  OptionSheet,
  ScreenHeader,
  Segmented,
  TabBar,
  TransactionRow,
} from '../../components/ui';

jest.mock('../../data/Storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) },
}));

const textOf = (node) =>
  !node ? '' : typeof node === 'string' ? node : (node.children || []).map(textOf).join('');

/** Host nodes a finger can press (Pressable / Touchable render onClick + accessible). */
const pressables = (tree) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const p = n.props || {};
    if (((p.onClick || p.onResponderRelease) && p.accessible !== false) || p.accessibilityRole === 'switch')
      out.push(n);
    (n.children || []).forEach(walk);
  };
  walk(tree);
  return out;
};

const routes = ['HomeTab', 'AccountsTab', 'BudgetTab', 'GoalTab', 'SettingsTab'].map((name) => ({
  key: name,
  name,
}));
const descriptors = Object.fromEntries(
  routes.map((r) => [r.key, { options: { title: r.name.replace('Tab', '') } }])
);

const CASES = {
  AppButton: <AppButton title="Save" onPress={() => {}} />,
  'AppButton icon': <AppButton title="Add" icon="add" onPress={() => {}} />,
  AppSwitch: <AppSwitch label="Dark mode" value={false} onValueChange={() => {}} />,
  Banner: <Banner title="Backup" body="Never" action={{ label: 'Back up', onPress: () => {} }} />,
  Chip: <Chip label="#work" selected onPress={() => {}} onRemove={() => {}} />,
  Collapsible: (
    <Collapsible title="Tags" left={<Ionicons name="pricetag" />}>
      <Text>x</Text>
    </Collapsible>
  ),
  EmptyState: (
    <EmptyState icon="flag" title="No goals" body="Start" action={{ label: 'Add goal', onPress: () => {} }} />
  ),
  IconButton: <IconButton icon="close" label="Close" onPress={() => {}} />,
  ListRow: <ListRow label="Categories" value="12" onPress={() => {}} chevron />,
  OptionSheet: (
    <OptionSheet
      visible
      title="Pick"
      options={[{ value: 'a', label: 'A' }]}
      onSelect={() => {}}
      onClose={() => {}}
    />
  ),
  ScreenHeader: <ScreenHeader title="Backup" onBack={() => {}} />,
  Segmented: (
    <Segmented
      options={['Expense', 'Income', 'Transfer'].map((l) => ({ value: l.toLowerCase(), label: l }))}
      value="expense"
      onChange={() => {}}
    />
  ),
  TabBar: (
    <TabBar
      state={{ index: 0, routes }}
      descriptors={descriptors}
      navigation={{ navigate: jest.fn(), emit: jest.fn(() => ({})) }}
    />
  ),
  TransactionRow: (
    <TransactionRow
      tx={{ id: 1, type: 'expense', amount: 10, title: 'Tea', fullDate: '2026-11-20T10:00:00Z' }}
      onPress={() => {}}
    />
  ),
};

test.each(Object.entries(CASES))('%s: every pressable is labelled', (_name, el) => {
  const tree = render(el).toJSON();
  const found = pressables(tree);
  expect(found.length).toBeGreaterThan(0);
  found.forEach((n) => {
    const name = n.props.accessibilityLabel || textOf(n).trim();
    expect(name).toBeTruthy();
    expect(['button', 'tab', 'switch', 'link', 'radio', 'checkbox', 'menuitem']).toContain(
      n.props.accessibilityRole
    );
  });
});
