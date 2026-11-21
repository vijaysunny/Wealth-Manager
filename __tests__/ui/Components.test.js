/** C3 shared components: behaviour and accessibility (D4). */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import {
  AppSwitch,
  Banner,
  Chip,
  Collapsible,
  EmptyState,
  ListRow,
  MoneyText,
  moneyLabel,
  ScreenHeader,
  Section,
  Segmented,
  TabBar,
} from '../../components/ui';
import { tokens } from '../../components/tokens';

jest.mock('../../data/Storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) },
}));

const t = tokens.light;
const colorOf = (el) => StyleSheet.flatten(el.props.style).color;

describe('Collapsible', () => {
  test('closed by default: expanded=false and content not rendered; tap opens and closes', () => {
    render(
      <Collapsible title="Bills & files" summary="2 files" badge={2}>
        <Text>inside</Text>
      </Collapsible>
    );
    const header = screen.getByRole('button', { name: 'Bills & files' });
    expect(header.props.accessibilityState.expanded).toBe(false);
    expect(screen.queryByText('inside')).toBeNull();
    expect(screen.getByText('2 files')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    fireEvent.press(header);
    expect(screen.getByRole('button', { name: 'Bills & files' }).props.accessibilityState.expanded).toBe(
      true
    );
    expect(screen.getByText('inside')).toBeTruthy();
    fireEvent.press(header);
    expect(screen.queryByText('inside')).toBeNull();
  });
  test('defaultOpen renders the content', () => {
    render(
      <Collapsible title="Tags" defaultOpen>
        <Text>open</Text>
      </Collapsible>
    );
    expect(screen.getByText('open')).toBeTruthy();
  });
});

test('MoneyText signs and colours: expense red, income green, transfer muted', () => {
  expect(moneyLabel(1998.19, 'expense')).toBe('−₹1,998.19');
  expect(moneyLabel(500, 'income')).toBe('+₹500');
  expect(moneyLabel(1251138.5, 'transfer')).toBe('₹12,51,138.5');
  expect(moneyLabel(-20, undefined)).toBe('−₹20');
  render(
    <>
      <MoneyText amount={10} type="expense" testID="e" />
      <MoneyText amount={10} type="income" testID="i" />
      <MoneyText amount={10} type="transfer" testID="x" />
    </>
  );
  expect(colorOf(screen.getByTestId('e'))).toBe(t.expense);
  expect(colorOf(screen.getByTestId('i'))).toBe(t.income);
  expect(colorOf(screen.getByTestId('x'))).toBe(t.muted);
});

test('Chip: select and remove are separate labelled buttons', () => {
  const onPress = jest.fn();
  const onRemove = jest.fn();
  render(<Chip label="#tax-2026" onPress={onPress} onRemove={onRemove} selected />);
  fireEvent.press(screen.getByRole('button', { name: 'Remove #tax-2026' }));
  expect(onRemove).toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: '#tax-2026' }));
  expect(onPress).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '#tax-2026' }).props.accessibilityState.selected).toBe(true);
});

test('AppSwitch has a visible label and passes it to the switch', () => {
  const onChange = jest.fn();
  render(<AppSwitch label="Count in reports" value onValueChange={onChange} />);
  expect(screen.getByText('Count in reports')).toBeTruthy();
  fireEvent(screen.getByLabelText('Count in reports'), 'valueChange', false);
  expect(onChange).toHaveBeenCalledWith(false);
});

test('ListRow: pressable rows are labelled buttons; plain rows are not buttons', () => {
  const onPress = jest.fn();
  render(
    <>
      <ListRow label="Paid from" value="Axis Bank ••0973" onPress={onPress} />
      <ListRow label="Plain" value="x" />
    </>
  );
  fireEvent.press(screen.getByRole('button', { name: 'Paid from, Axis Bank ••0973' }));
  expect(onPress).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Plain/ })).toBeNull();
});

test('Segmented marks the selected tab and reports changes', () => {
  const onChange = jest.fn();
  render(
    <Segmented
      value="expense"
      onChange={onChange}
      options={[
        { value: 'expense', label: 'Expense' },
        { value: 'income', label: 'Income' },
      ]}
    />
  );
  expect(screen.getByRole('tab', { name: 'Expense' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByRole('tab', { name: 'Income' }));
  expect(onChange).toHaveBeenCalledWith('income');
});

test('Banner, EmptyState, Section, ScreenHeader render their text and actions', () => {
  const act = jest.fn();
  const back = jest.fn();
  render(
    <>
      <ScreenHeader title="Review" onBack={back} />
      <Section title="Capture">
        <Text>row</Text>
      </Section>
      <Banner
        tone="warn"
        title="No backup yet"
        body="Back up now"
        action={{ label: 'Back up', onPress: act }}
      />
      <EmptyState
        title="No goals"
        body="Save for something"
        action={{ label: 'Create a goal', onPress: act }}
      />
    </>
  );
  fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(back).toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Back up' }));
  fireEvent.press(screen.getByRole('button', { name: 'Create a goal' }));
  expect(act).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Capture')).toBeTruthy();
  expect(colorOf(screen.getByText('No backup yet'))).toBe(t.warnText);
});

test('TabBar: 5 labelled tabs, active one selected, press navigates', () => {
  const routes = ['HomeTab', 'AccountsTab', 'BudgetTab', 'GoalTab', 'SettingsTab'].map((name) => ({
    key: name,
    name,
  }));
  const titles = {
    HomeTab: 'Home',
    AccountsTab: 'Accounts',
    BudgetTab: 'Budget',
    GoalTab: 'Goals',
    SettingsTab: 'Settings',
  };
  const descriptors = Object.fromEntries(routes.map((r) => [r.key, { options: { title: titles[r.name] } }]));
  const navigation = { emit: jest.fn(() => ({ defaultPrevented: false })), navigate: jest.fn() };
  render(<TabBar state={{ index: 0, routes }} descriptors={descriptors} navigation={navigation} />);
  expect(screen.getAllByRole('tab')).toHaveLength(5);
  expect(screen.getByRole('tab', { name: 'Home' }).props.accessibilityState.selected).toBe(true);
  fireEvent.press(screen.getByRole('tab', { name: 'Accounts' }));
  expect(navigation.navigate).toHaveBeenCalledWith('AccountsTab');
  fireEvent.press(screen.getByRole('tab', { name: 'Home' }));
  expect(navigation.navigate).toHaveBeenCalledTimes(1);
});
