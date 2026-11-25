/**
 * FilterSheet (Phase 14 B3, docs/design/20-filter-sheet.png): Sort by, Date, Type, Accounts,
 * Categories, Amount, Show only. "Show N transactions" counts live; closing without Show
 * discards the changes; Reset goes back to the default query but keeps the sort.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTokens } from './Theme';
import { fonts, radius, space, type } from './tokens';
import { AppButton, Chip, IconButton } from './ui';
import {
  DATE_PRESETS,
  FLAG_LABELS,
  SORTS,
  SORT_LABELS,
  dateRange,
  defaultQuery,
  runQuery,
} from '../utils/TransactionQuery';
import { shortAccountName } from '../utils/TransactionList';
import { parseNonNegative } from '../utils/Format';

const DATE_LABELS = {
  thisMonth: 'This month',
  lastMonth: 'Last month',
  last3: 'Last 3 months',
  thisFY: 'This FY',
  custom: 'Custom…',
};
const TYPES = [
  ['expense', 'Expense'],
  ['income', 'Income'],
  ['transfer', 'Transfer'],
];
const TOP_CATEGORIES = 5;

/** Categories by how often they are used (most first), then the rest of the owner's list. */
export const categoriesByUse = (rows, known = []) => {
  const n = new Map();
  for (const tx of rows || [])
    if (tx?.category && tx.type !== 'transfer') n.set(tx.category, (n.get(tx.category) || 0) + 1);
  const used = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
  return [...used, ...known.filter((c) => !n.has(c))];
};

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayLabel = (s) => {
  const r = dateRange({ preset: 'custom', from: s }, new Date()).from;
  return r ? r.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Choose';
};
const amountText = (v) => (v == null ? '' : String(v));

function Heading({ children, t }) {
  return (
    <Text
      accessibilityRole="header"
      style={[type.overline, { color: t.muted, marginTop: space.lg, marginBottom: space.sm }]}
    >
      {children}
    </Text>
  );
}

export default function FilterSheet({
  visible,
  query,
  rows,
  accounts = [],
  categories = [],
  asOf,
  onApply,
  onClose,
}) {
  const t = useTokens();
  const [draft, setDraft] = useState(query || defaultQuery());
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [allCats, setAllCats] = useState(false);
  const [picking, setPicking] = useState(null); // 'from' | 'to'
  useEffect(() => {
    if (!visible) return;
    const q = query || defaultQuery();
    setDraft(q);
    setMinText(amountText(q.amountMin));
    setMaxText(amountText(q.amountMax));
    setAllCats(false);
  }, [visible, query]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const min = minText.trim() ? parseNonNegative(minText) : null;
  const max = maxText.trim() ? parseNonNegative(maxText) : null;
  const amountBad = (minText.trim() && min === null) || (maxText.trim() && max === null);
  const rangeBad = min != null && max != null && max < min;
  const custom = draft.date?.preset === 'custom';
  const { from: cFrom, to: cTo } = custom ? dateRange(draft.date, asOf) : {};
  const dateBad = custom && cFrom && cTo && cFrom >= cTo;
  const final = useMemo(() => ({ ...draft, amountMin: min, amountMax: max }), [draft, min, max]);
  const count = useMemo(
    () => (visible ? runQuery(rows, final, asOf, { accounts }).rows.length : 0),
    [visible, rows, final, asOf, accounts]
  );
  const cats = categoriesByUse(rows, categories);
  const shownCats = allCats ? cats : cats.slice(0, TOP_CATEGORIES);
  const blocked = !!(amountBad || rangeBad || dateBad || count === 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close filters"
        onPress={onClose}
        style={{ height: 48, backgroundColor: 'rgba(14,23,38,0.45)' }}
      />
      <View
        style={{
          flex: 1,
          backgroundColor: t.card,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: space.xl,
            paddingRight: space.sm,
            paddingVertical: space.sm,
            borderBottomWidth: 1,
            borderColor: t.divider,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ flex: 1, color: t.text, fontFamily: fonts.display, fontSize: 22 }}
          >
            Sort & filter
          </Text>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>
        <ScrollView
          testID="filter-sheet"
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <Heading t={t}>Sort by</Heading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {SORTS.map((s) => (
              <Chip
                key={s}
                label={SORT_LABELS[s]}
                selected={draft.sort === s}
                onPress={() => set({ sort: s })}
              />
            ))}
          </View>

          <Heading t={t}>Date</Heading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {DATE_PRESETS.map((p) => (
              <Chip
                key={p}
                label={DATE_LABELS[p]}
                selected={draft.date?.preset === p}
                onPress={() =>
                  set({
                    date:
                      draft.date?.preset === p
                        ? { preset: 'all' }
                        : p === 'custom'
                          ? {
                              preset: 'custom',
                              from: ymd(new Date(asOf.getFullYear(), asOf.getMonth(), 1)),
                              to: ymd(asOf),
                            }
                          : { preset: p },
                  })
                }
              />
            ))}
          </View>
          {custom ? (
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.xs }}>
              {['from', 'to'].map((k) => (
                <View key={k} style={{ flex: 1 }}>
                  <AppButton
                    variant="secondary"
                    title={`${k === 'from' ? 'From' : 'To'}: ${dayLabel(draft.date[k])}`}
                    onPress={() => setPicking(k)}
                  />
                </View>
              ))}
            </View>
          ) : null}
          {dateBad ? (
            <Text style={{ color: t.expense, fontFamily: fonts.body, marginTop: space.xs }}>
              The start date is after the end date.
            </Text>
          ) : null}

          <Heading t={t}>Type</Heading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {TYPES.map(([v, label]) => (
              <Chip
                key={v}
                label={label}
                selected={draft.types.includes(v)}
                onPress={() => set({ types: toggle(draft.types, v) })}
              />
            ))}
          </View>

          {accounts.length ? <Heading t={t}>Accounts</Heading> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {accounts.map((a) => (
              <Chip
                key={String(a.id)}
                label={shortAccountName(a.name, a.last4)}
                selected={draft.accountIds.map(String).includes(String(a.id))}
                onPress={() => set({ accountIds: toggle(draft.accountIds.map(String), String(a.id)) })}
              />
            ))}
          </View>

          {cats.length ? <Heading t={t}>Categories</Heading> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            {shownCats.map((c) => (
              <Chip
                key={c}
                label={c}
                selected={draft.categories.includes(c)}
                onPress={() => set({ categories: toggle(draft.categories, c) })}
              />
            ))}
            {!allCats && cats.length > TOP_CATEGORIES ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setAllCats(true)}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md }}
              >
                <Text style={{ color: t.primary, fontFamily: fonts.semibold, fontSize: 15 }}>
                  {`+ ${cats.length - TOP_CATEGORIES} more`}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Heading t={t}>Amount</Heading>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            {[
              ['Minimum amount', minText, setMinText, 'Min'],
              ['Maximum amount', maxText, setMaxText, 'Max'],
            ].map(([label, value, onChange, ph]) => (
              <TextInput
                key={label}
                accessibilityLabel={label}
                value={value}
                onChangeText={onChange}
                placeholder={`₹ ${ph}`}
                placeholderTextColor={t.placeholder}
                keyboardType="decimal-pad"
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderWidth: 1,
                  borderColor: rangeBad ? t.expense : t.inputBorder,
                  borderRadius: radius.md,
                  paddingHorizontal: space.md,
                  color: t.text,
                  fontFamily: fonts.body,
                  fontSize: 16,
                }}
              />
            ))}
          </View>
          {rangeBad || amountBad ? (
            <Text style={{ color: t.expense, fontFamily: fonts.body, marginTop: space.xs }}>
              {rangeBad ? 'Max is less than min.' : 'Enter an amount, like 500.'}
            </Text>
          ) : null}

          <Heading t={t}>Show only</Heading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {Object.entries(FLAG_LABELS).map(([f, label]) => (
              <Chip
                key={f}
                label={label}
                selected={draft.flags.includes(f)}
                onPress={() => set({ flags: toggle(draft.flags, f) })}
              />
            ))}
          </View>
        </ScrollView>
        <View
          style={{
            flexDirection: 'row',
            gap: space.md,
            paddingHorizontal: space.xl,
            paddingTop: space.md,
            paddingBottom: space.xl,
            borderTopWidth: 1,
            borderColor: t.divider,
          }}
        >
          <View style={{ flex: 1 }}>
            <AppButton
              title="Reset"
              variant="secondary"
              size="lg"
              onPress={() => {
                setDraft({ ...defaultQuery(), text: draft.text, sort: draft.sort });
                setMinText('');
                setMaxText('');
              }}
            />
          </View>
          <View style={{ flex: 2 }}>
            <AppButton
              title={count === 0 ? 'No matches' : `Show ${count} transaction${count === 1 ? '' : 's'}`}
              size="lg"
              disabled={blocked}
              onPress={() => onApply(final)}
            />
          </View>
        </View>
      </View>
      {picking ? (
        <DateTimePicker
          value={dateRange({ preset: 'custom', from: draft.date[picking] }, asOf).from || asOf}
          mode="date"
          onChange={(_, picked) => {
            const k = picking;
            setPicking(null);
            if (picked) set({ date: { ...draft.date, [k]: ymd(picked) } });
          }}
        />
      ) : null}
    </Modal>
  );
}
