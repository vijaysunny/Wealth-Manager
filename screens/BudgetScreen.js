/**
 * Budget (Phase 12 C5.6, docs/design/Budget.png).
 * Month pill · card: spent of monthly budget, budget input + Set, "Carry unused budget
 * forward" switch with the leftover · By category: amount, limit or "Set limit", progress
 * bar (over 90 % warn, over 100 % danger); tapping a row opens a limit sheet.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { getMonthlyBudget, saveMonthlyBudget } from '../utils/MonthlyBudgets';
import { parseAmount, shiftMonth, formatMoney } from '../utils/Format';
import { monthSpending, categoryRows, previousMonthName } from '../utils/BudgetView';
import { monthDate } from '../utils/TransactionQuery';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, AppSwitch, IconButton, OptionSheet } from '../components/ui';

const DEFAULT_CATS = ['Food', 'Transport', 'Shopping', 'Bills', 'Health'];
const BAR_COLORS = ['#5B3CC4', '#A35200', '#1B3F8F', '#97212E', '#0E7C4A', '#1F6FD8'];

export default function BudgetScreen({ navigation }) {
  const t = useTokens();
  const isFocused = useIsFocused();
  const [month, setMonth] = useState(new Date());
  const [budgetText, setBudgetText] = useState('');
  const [limit, setLimit] = useState(0);
  const [rollover, setRollover] = useState(false);
  const [carry, setCarry] = useState(0);
  const [spent, setSpent] = useState(0);
  const [byCategory, setByCategory] = useState({});
  const [limits, setLimits] = useState({});
  const [categories, setCategories] = useState(DEFAULT_CATS);
  const [editing, setEditing] = useState(null); // { name, text }
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    const txs = await getAll();
    const monthly = await getMonthlyBudget(month, txs);
    setLimit(monthly.limit || 0);
    setBudgetText(monthly.limit ? String(monthly.limit) : '');
    setLimits(monthly.categories || {});
    setRollover(!!monthly.rollover);
    setCarry(monthly.carry || 0);
    const s = monthSpending(txs, month);
    setSpent(s.total);
    setByCategory(s.byCategory);
    const saved = JSON.parse((await Storage.getItem('user_categories')) || 'null') || DEFAULT_CATS;
    setCategories([...new Set([...saved, ...txs.map((x) => x.category).filter(Boolean)])].sort());
  }, [month]);
  useEffect(() => {
    if (isFocused) load().catch((e) => Alert.alert('Load error', e.message));
  }, [isFocused, load]);

  const saveBudget = async () => {
    if (budgetText.trim() === '') {
      await saveMonthlyBudget(month, { limit: 0 });
      return load();
    }
    const v = parseAmount(budgetText);
    if (v === null) {
      Alert.alert('Budget', 'Enter an amount greater than 0.');
      return;
    }
    await saveMonthlyBudget(month, { limit: v, rollover });
    await load();
  };

  const saveLimit = async (name, text) => {
    const next = { ...limits };
    if (String(text).trim() === '') delete next[name];
    else {
      const v = parseAmount(text);
      if (v === null) {
        Alert.alert('Limit', 'Enter an amount greater than 0, or leave it empty to remove the limit.');
        return;
      }
      next[name] = v;
    }
    await saveMonthlyBudget(month, { categories: next });
    setEditing(null);
    await load();
  };

  const rows = categoryRows(byCategory, limits);
  const total = limit > 0 ? limit + (rollover ? carry : 0) : 0;
  const isNow =
    month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();
  const statusColor = (s, i) =>
    s === 'over' ? t.expense : s === 'warn' ? '#B26A00' : BAR_COLORS[i % BAR_COLORS.length];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text
            accessibilityRole="header"
            style={{ flex: 1, color: t.text, fontFamily: fonts.display, fontSize: 30 }}
          >
            Budget
          </Text>
          <View style={[styles.pill, { backgroundColor: t.card, borderColor: t.border }]}>
            <IconButton
              icon="chevron-back"
              label="Previous month"
              onPress={() => setMonth(shiftMonth(month, -1))}
            />
            <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}>
              {month.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
            </Text>
            <IconButton
              icon="chevron-forward"
              label="Next month"
              color={isNow ? t.border : t.text}
              onPress={() => !isNow && setMonth(shiftMonth(month, 1))}
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15 }}>
            Spent of monthly budget
          </Text>
          <View
            style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: space.xs }}
          >
            <Text
              testID="budget-spent"
              style={{
                color: total && spent > total ? t.expense : t.text,
                fontFamily: fonts.display,
                fontSize: 34,
              }}
            >
              {formatMoney(Math.round(spent))}
            </Text>
            <Text style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 18, marginLeft: space.sm }}>
              / {total ? formatMoney(Math.round(total)) : 'no budget'}
            </Text>
          </View>
          {total ? (
            <View style={[styles.track, { backgroundColor: t.divider, marginTop: space.md }]}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.min(100, (spent / total) * 100)}%`,
                    backgroundColor: spent > total ? t.expense : spent / total > 0.9 ? '#B26A00' : t.primary,
                  },
                ]}
              />
            </View>
          ) : null}
          <Text
            style={{
              color: t.text2,
              fontFamily: fonts.semibold,
              fontSize: 15,
              marginTop: space.lg,
              marginBottom: space.sm,
            }}
          >
            Monthly budget
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={[styles.input, { borderColor: t.inputBorder }]}>
              <Text
                style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 17, marginRight: space.sm }}
              >
                ₹
              </Text>
              <TextInput
                testID="budget-input"
                accessibilityLabel="Monthly budget"
                value={budgetText}
                onChangeText={setBudgetText}
                keyboardType="numeric"
                placeholder="e.g. 40,000"
                placeholderTextColor={t.placeholder}
                style={{ flex: 1, color: t.text, fontFamily: fonts.body, fontSize: 17 }}
              />
            </View>
            <AppButton
              title="Set"
              size="lg"
              style={{ marginVertical: 0, paddingHorizontal: space.xl }}
              onPress={saveBudget}
            />
          </View>
          <View style={{ borderTopWidth: 1, borderColor: t.divider, marginTop: space.lg }}>
            <AppSwitch
              label="Carry unused budget forward"
              sublabel={`Leftover from ${previousMonthName(month)}: ${formatMoney(Math.round(carry))}`}
              value={rollover}
              onValueChange={async (v) => {
                setRollover(v);
                await saveMonthlyBudget(month, { rollover: v });
                await load();
              }}
            />
          </View>
        </View>

        <View style={styles.catHead}>
          <Text
            accessibilityRole="header"
            style={{ color: t.text, fontFamily: fonts.displaySemi, fontSize: 20 }}
          >
            By category
          </Text>
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>
            Tap a row to set a limit
          </Text>
        </View>
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border, paddingVertical: 0 }]}>
          {rows.length === 0 ? (
            <Text style={{ color: t.muted, fontFamily: fonts.body, paddingVertical: space.lg }}>
              No spending this month.
            </Text>
          ) : (
            rows.map((r, i) => (
              <Pressable
                key={r.name}
                testID={`cat-${r.name}`}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}, ${formatMoney(Math.round(r.spent))}${r.limit ? ` of ${formatMoney(r.limit)}` : ', no limit'}. Show transactions`}
                // B4: a category row opens its transactions for this month; the limit has its own button
                onPress={() =>
                  navigation.navigate('Transactions', {
                    query: { date: monthDate(month), categories: [r.name], types: ['expense'] },
                  })
                }
                style={({ pressed }) => [
                  styles.catRow,
                  {
                    borderColor: t.divider,
                    borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}
                  >
                    {r.name}
                  </Text>
                  <Text
                    style={{
                      color: r.status === 'over' ? t.expense : t.text,
                      fontFamily: fonts.medium,
                      fontSize: 16,
                    }}
                  >
                    {formatMoney(Math.round(r.spent))}
                  </Text>
                  <Pressable
                    testID={`limit-${r.name}`}
                    accessibilityRole="button"
                    accessibilityLabel={r.limit ? `Edit limit for ${r.name}` : `Set limit for ${r.name}`}
                    hitSlop={12}
                    onPress={() => setEditing({ name: r.name, text: r.limit ? String(r.limit) : '' })}
                  >
                    <Text
                      style={{ color: r.limit ? t.muted : t.primary, fontFamily: fonts.body, fontSize: 16 }}
                    >
                      {r.limit ? ` / ${formatMoney(r.limit)}` : ' · Set limit'}
                    </Text>
                  </Pressable>
                </View>
                <View style={[styles.track, { backgroundColor: t.divider }]}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${Math.max(2, r.ratio * 100)}%`, backgroundColor: statusColor(r.status, i) },
                    ]}
                  />
                </View>
                {r.status === 'over' ? (
                  <Text
                    style={{ color: t.expense, fontFamily: fonts.medium, fontSize: 13, marginTop: space.xs }}
                  >
                    Over by {formatMoney(Math.round(r.spent - r.limit))}
                  </Text>
                ) : r.status === 'warn' ? (
                  <Text
                    style={{ color: t.warnText, fontFamily: fonts.medium, fontSize: 13, marginTop: space.xs }}
                  >
                    Almost at the limit
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>
        <AppButton
          title="Set a limit for another category"
          variant="dashed"
          icon="add"
          onPress={() => setPicking(true)}
        />
        <AppButton
          title="Spending reports"
          variant="secondary"
          icon="stats-chart-outline"
          onPress={() => navigation.navigate('Analytics')}
        />
        <AppButton
          title="Month in review"
          variant="secondary"
          icon="calendar-outline"
          style={{ marginTop: space.sm }}
          onPress={() => navigation.navigate('MonthReview')}
        />
      </ScrollView>

      <OptionSheet
        visible={picking}
        title="Category"
        options={categories.map((c) => ({
          value: c,
          label: c,
          sublabel: limits[c] ? `Limit ${formatMoney(limits[c])}` : null,
        }))}
        onSelect={(c) => {
          setPicking(false);
          setEditing({ name: c, text: limits[c] ? String(limits[c]) : '' });
        }}
        onClose={() => setPicking(false)}
      />

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ flex: 1, backgroundColor: 'rgba(14,23,38,0.45)' }}
          onPress={() => setEditing(null)}
        />
        <View style={[styles.sheet, { backgroundColor: t.card }]}>
          <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>
            {editing?.name} limit
          </Text>
          <Text
            style={{ color: t.muted, fontFamily: fonts.body, marginTop: space.xs, marginBottom: space.md }}
          >
            Monthly limit for {editing?.name}. Leave empty to remove it. You get a notice at 90 %.
          </Text>
          <View style={[styles.input, { borderColor: t.inputBorder, flex: 0 }]}>
            <Text style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 17, marginRight: space.sm }}>
              ₹
            </Text>
            <TextInput
              testID="limit-input"
              accessibilityLabel="Limit"
              value={editing?.text ?? ''}
              onChangeText={(v) => setEditing((e) => ({ ...e, text: v }))}
              keyboardType="numeric"
              autoFocus
              style={{ flex: 1, color: t.text, fontFamily: fonts.body, fontSize: 17 }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
            <AppButton
              title="Cancel"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => setEditing(null)}
            />
            <AppButton
              title="Save limit"
              style={{ flex: 1 }}
              onPress={() => saveLimit(editing.name, editing.text)}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: space.lg, paddingBottom: space.lg },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space.xl,
    paddingHorizontal: space.xl,
    marginBottom: space.md,
  },
  input: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 52,
  },
  catHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  catRow: { paddingVertical: space.lg },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: space.sm },
  fill: { height: 8, borderRadius: 4 },
  sheet: {
    padding: space.xl,
    paddingBottom: space.xxl,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
  },
});
