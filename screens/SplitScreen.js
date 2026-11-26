/**
 * SplitScreen (Phase 14 E4, docs/design/24-split-transaction.png).
 * Split one transaction into category parts and parts paid for someone (they owe you).
 * The first part takes whatever is left until the owner types its amount.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, OptionSheet, ScreenHeader, TextSheet } from '../components/ui';
import { saveSplit, removeSplit, addPerson } from '../utils/FeatureService';
import { equalSplit, partsTotal, validateSplit, yourSpending, round2 } from '../utils/Splits';
import { payeeOf } from '../utils/PayeeMatch';
import { shortAccountName } from '../utils/TransactionList';
import { formatMoney } from '../utils/Format';
import { showSnackbar } from '../utils/Snackbar';

const DEFAULT_CATS = ['Food', 'Groceries', 'Shopping', 'Electronics', 'Travel', 'Bills', 'Health', 'Other'];
const toText = (n) => (n ? String(round2(n)) : '');
const toNum = (s) => {
  const n = Number(String(s || '').replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Parts with amounts; part 0 is "auto" (takes the rest) until typed into. */
export const resolveParts = (tx, rows, auto) => {
  const parts = rows.map((r) => ({ ...r, amount: toNum(r.text) }));
  if (auto && parts.length) {
    const others = partsTotal(parts.slice(1));
    parts[0] = { ...parts[0], amount: round2(Math.max(0, Number(tx.amount) - others)) };
  }
  return parts.map(({ text, ...p }) => p);
};

export default function SplitScreen({ navigation, route }) {
  const t = useTokens();
  const txId = route.params?.txId;
  const [tx, setTx] = useState(null);
  const [account, setAccount] = useState(null);
  const [people, setPeople] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATS);
  const [rows, setRows] = useState([]); // [{ id, category?, personId?, text }]
  const [auto, setAuto] = useState(true);
  const [sheet, setSheet] = useState(null); // { kind: 'category'|'person'|'equal'|'add-person', index? }
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const all = await getAll();
    const row = all.find((x) => String(x.id) === String(txId));
    if (!row) {
      Alert.alert('Split', 'This transaction no longer exists.');
      navigation.goBack();
      return;
    }
    const accounts = JSON.parse((await Storage.getItem('user_wealth_accounts')) || '[]');
    setAccount(accounts.find((a) => String(a.id) === String(row.accountId)) || null);
    setPeople(JSON.parse((await Storage.getItem('people')) || '[]'));
    const saved = JSON.parse((await Storage.getItem('user_categories')) || 'null');
    const cats = Array.isArray(saved) && saved.length ? saved : DEFAULT_CATS;
    setCategories(row.category && !cats.includes(row.category) ? [row.category, ...cats] : cats);
    setTx((prev) => {
      if (!prev) {
        const has = Array.isArray(row.splits) && row.splits.length;
        setRows(
          has
            ? row.splits.map((p) => ({ ...p, text: toText(p.amount) }))
            : [{ id: 'p0', category: row.category || 'Other', text: '' }]
        );
        setAuto(!has);
      }
      return row;
    });
  }, [txId, navigation]);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Load error', e.message));
    }, [load])
  );

  const parts = useMemo(() => (tx ? resolveParts(tx, rows, auto) : []), [tx, rows, auto]);
  if (!tx) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;

  const check = validateSplit(tx, parts);
  const nameOf = (id) => people.find((p) => String(p.id) === String(id))?.name || 'Someone';
  const isSplit = Array.isArray(tx.splits) && tx.splits.length > 0;
  const nextId = () => `p${Date.now()}${rows.length}`;
  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const left = round2(Number(tx.amount) - partsTotal(parts));
  const addRow = (row) =>
    setRows([...rows, { id: nextId(), text: auto ? '' : toText(Math.max(0, left)), ...row }]);

  const pickFor = (value) => {
    const { kind, index } = sheet;
    setSheet(null);
    if (kind === 'category') {
      if (index == null) addRow({ category: value });
      else setRow(index, { category: value, personId: undefined });
    } else if (index == null) addRow({ personId: value });
    else setRow(index, { personId: value, category: undefined });
  };

  const applyEqual = () => {
    const split = equalSplit(tx, picked, rows[0]?.category || tx.category || 'Other');
    setRows(split.map((p) => ({ ...p, text: toText(p.amount) })));
    setAuto(false);
    setSheet(null);
    setPicked([]);
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveSplit(tx.id, parts);
      navigation.goBack();
      showSnackbar({ text: `Split into ${parts.length} parts` });
    } catch (e) {
      Alert.alert('Cannot save split', e.message);
    } finally {
      setBusy(false);
    }
  };
  const unsplit = () =>
    Alert.alert(
      'Remove split?',
      `It counts as ${tx.category || 'Other'} again. Open IOUs from it are removed.`,
      [
        { text: 'Cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            removeSplit(tx.id)
              .then(() => navigation.goBack())
              .catch((e) => Alert.alert('Cannot remove split', e.message)),
        },
      ]
    );

  const day = new Date(tx.fullDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const where = [account ? shortAccountName(account.name, account.last4) : tx.account, day]
    .filter(Boolean)
    .join(' · ');
  const ok = check.ok;
  const barText = ok
    ? `Adds up to ${formatMoney(tx.amount)}`
    : left > 0
      ? `${formatMoney(left)} left to assign`
      : `${formatMoney(-left)} too much`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Split" backIcon="close" backLabel="Close" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: t.card,
            borderColor: t.border,
            borderWidth: 1,
            borderRadius: radius.xl,
            padding: space.lg,
            marginBottom: space.md,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 18 }}>{payeeOf(tx)}</Text>
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>{where}</Text>
          </View>
          <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 22 }}>
            {formatMoney(tx.amount)}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: t.card,
            borderColor: t.border,
            borderWidth: 1,
            borderRadius: radius.xl,
            overflow: 'hidden',
            marginBottom: space.md,
          }}
        >
          {rows.map((r, i) => {
            const person = !!r.personId;
            const label = person ? `${nameOf(r.personId)} owes you` : r.category;
            const shown = i === 0 && auto ? toText(parts[0]?.amount) : r.text;
            return (
              <View
                key={r.id}
                testID={`part-${i}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                  borderBottomWidth: 1,
                  borderColor: t.divider,
                  backgroundColor: person ? t.primarySoft : t.card,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${person ? 'Person' : 'Category'} for part ${i + 1}: ${label}. Change`}
                  onPress={() => setSheet({ kind: person ? 'person' : 'category', index: i })}
                  style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={{ color: person ? t.primary : t.muted, fontFamily: fonts.body, fontSize: 14 }}>
                    {person ? 'Paid for someone' : 'Category'}
                  </Text>
                  <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>{label}</Text>
                </Pressable>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: person ? t.primary : t.inputBorder,
                    borderRadius: radius.md,
                    paddingHorizontal: space.md,
                    width: 140,
                    minHeight: 48,
                    backgroundColor: t.card,
                  }}
                >
                  <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 16 }}>₹</Text>
                  <TextInput
                    accessibilityLabel={`Amount for ${label}`}
                    value={shown}
                    keyboardType="decimal-pad"
                    onChangeText={(v) => {
                      if (i === 0 && auto) {
                        // typing into the first part fixes all amounts as shown
                        setRows(rows.map((x, j) => (j === 0 ? { ...x, text: v } : x)));
                        setAuto(false);
                      } else setRow(i, { text: v });
                    }}
                    style={{
                      flex: 1,
                      textAlign: 'right',
                      color: t.text,
                      fontFamily: fonts.semibold,
                      fontSize: 17,
                    }}
                  />
                </View>
                {rows.length > 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${label}`}
                    hitSlop={8}
                    onPress={() => setRows(rows.filter((_, j) => j !== i))}
                    style={{ marginLeft: space.sm, minWidth: 32, minHeight: 44, justifyContent: 'center' }}
                  >
                    <Ionicons name="close-circle-outline" size={22} color={t.muted} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
            <View style={{ flex: 1 }}>
              <AppButton title="+ Category" variant="dashed" onPress={() => setSheet({ kind: 'category' })} />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton title="+ Person" variant="dashed" onPress={() => setSheet({ kind: 'person' })} />
            </View>
          </View>
        </View>

        <View
          testID="split-bar"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: ok ? t.incomeBg : t.warnBg,
            borderRadius: radius.lg,
            padding: space.lg,
            marginBottom: space.md,
          }}
        >
          <Text style={{ color: ok ? t.income : t.warnText, fontFamily: fonts.bold, fontSize: 16 }}>
            {barText}
          </Text>
          <Text style={{ color: ok ? t.income : t.warnText, fontFamily: fonts.body, fontSize: 14 }}>
            {`Your spending: ${formatMoney(yourSpending(parts))}`}
          </Text>
        </View>
        {!ok && check.errors.length ? (
          <Text style={{ color: t.warnText, fontFamily: fonts.body, fontSize: 14, marginBottom: space.md }}>
            {check.errors.filter((e) => !/to assign|too much/.test(e))[0] || ''}
          </Text>
        ) : null}

        <AppButton
          title="Split equally with people…"
          variant="secondary"
          onPress={() => {
            setPicked([]);
            setSheet({ kind: 'equal' });
          }}
        />
        <Text
          style={{
            color: t.text2,
            fontFamily: fonts.body,
            fontSize: 14,
            lineHeight: 21,
            marginTop: space.md,
          }}
        >
          Each part counts in its own budget. A part paid for someone isn&apos;t your spending; it shows in
          People until they pay you back.
        </Text>
        {isSplit ? (
          <AppButton
            title="Remove split"
            variant="danger"
            style={{ marginTop: space.lg }}
            onPress={unsplit}
          />
        ) : null}
      </ScrollView>
      <View style={{ padding: space.xl, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
        <AppButton title="Save split" size="lg" loading={busy} disabled={!ok} onPress={save} />
      </View>

      <OptionSheet
        visible={sheet?.kind === 'category'}
        title="Category"
        value={sheet?.index != null ? rows[sheet.index]?.category : undefined}
        options={categories.map((c) => ({ value: c, label: c }))}
        onSelect={pickFor}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet?.kind === 'person'}
        title="Paid for"
        value={sheet?.index != null ? rows[sheet.index]?.personId : undefined}
        options={people.map((p) => ({ value: p.id, label: p.name }))}
        onSelect={pickFor}
        onClose={() => setSheet(null)}
        footer={
          <AppButton
            title="Add person"
            icon="person-add-outline"
            variant="secondary"
            style={{ marginTop: space.md }}
            onPress={() => setSheet({ ...sheet, kind: 'add-person', back: 'person' })}
          />
        }
      />
      <OptionSheet
        visible={sheet?.kind === 'equal'}
        title={
          picked.length ? `Split with ${picked.length} · you and them pay the same` : 'Split equally with'
        }
        options={people.map((p) => ({
          value: p.id,
          label: picked.includes(p.id) ? `✓ ${p.name}` : p.name,
        }))}
        onSelect={(id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])}
        onClose={() => setSheet(null)}
        footer={
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <AppButton
              title="Add person"
              icon="person-add-outline"
              variant="secondary"
              onPress={() => setSheet({ kind: 'add-person', back: 'equal' })}
            />
            <AppButton
              title={picked.length ? `Split ${picked.length + 1} ways` : 'Pick people'}
              disabled={!picked.length}
              onPress={applyEqual}
            />
          </View>
        }
      />
      <TextSheet
        visible={sheet?.kind === 'add-person'}
        title="Add person"
        label="Name"
        placeholder="Ravi"
        action="Add"
        autoCapitalize="words"
        onClose={() => setSheet(null)}
        onSubmit={async (name) => {
          try {
            const person = await addPerson(name);
            setPeople([...people, person]);
            if (sheet.back === 'equal') {
              setPicked([...picked, person.id]);
              setSheet({ kind: 'equal' });
            } else {
              setSheet(null);
              if (sheet.index == null) addRow({ personId: person.id });
              else setRow(sheet.index, { personId: person.id, category: undefined });
            }
          } catch (e) {
            Alert.alert('Cannot add', e.message);
          }
        }}
      />
    </SafeAreaView>
  );
}
