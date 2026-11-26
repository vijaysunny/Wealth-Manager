/**
 * PeopleScreen (Phase 14 E4, docs/design/25-people.png): who owes whom.
 * Totals, settle suggestions for incoming credits, a row per person, Add person, Record "I owe".
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, Chip, ScreenHeader, Segmented, TextSheet } from '../components/ui';
import { addPerson, addIou, settleFromCredit, dismissSettle } from '../utils/FeatureService';
import { peopleSummary, itemsLine, settleSuggestions } from '../utils/People';
import { payeeName } from '../utils/PayeeMatch';
import { formatMoney, parseAmount } from '../utils/Format';

const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const loadPeople = async () => ({
  people: JSON.parse((await Storage.getItem('people')) || '[]'),
  ious: JSON.parse((await Storage.getItem('ious')) || '[]'),
});

export const Avatar = ({ name, owe, t }) => (
  <View
    style={{
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: owe ? t.dangerBg : t.incomeBg,
      marginRight: space.md,
    }}
  >
    <Text style={{ color: owe ? t.expense : t.income, fontFamily: fonts.bold, fontSize: 17 }}>
      {String(name || '?')
        .charAt(0)
        .toUpperCase()}
    </Text>
  </View>
);

/** Record "I owe" (or "owes me") by hand. */
function IouSheet({ visible, people, onClose, onSave, t }) {
  const [personId, setPersonId] = useState(null);
  const [direction, setDirection] = useState('iOwe');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const reset = () => {
    setPersonId(null);
    setDirection('iOwe');
    setAmount('');
    setNote('');
  };
  const input = {
    minHeight: 48,
    borderWidth: 1,
    borderColor: t.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: t.text,
    fontFamily: fonts.body,
    fontSize: 16,
    marginBottom: space.md,
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(14,23,38,0.45)' }}
      />
      <View
        style={{
          backgroundColor: t.card,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
          padding: space.xl,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: t.text, fontFamily: fonts.display, fontSize: 20, marginBottom: space.md }}
        >
          Record an IOU
        </Text>
        <Segmented
          style={{ marginBottom: space.md }}
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'iOwe', label: 'I owe' },
            { value: 'owedToMe', label: 'Owes me' },
          ]}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
          {people.map((p) => (
            <Chip
              key={p.id}
              testID={`iou-person-${p.id}`}
              label={p.name}
              selected={personId === p.id}
              onPress={() => setPersonId(p.id)}
            />
          ))}
          {!people.length ? (
            <Text style={{ color: t.muted, fontFamily: fonts.body }}>Add a person first.</Text>
          ) : null}
        </View>
        <TextInput
          accessibilityLabel="Amount"
          placeholder="Amount"
          placeholderTextColor={t.placeholder}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          style={input}
        />
        <TextInput
          accessibilityLabel="What for"
          placeholder="What for (Movie tickets)"
          placeholderTextColor={t.placeholder}
          value={note}
          onChangeText={setNote}
          style={input}
        />
        <AppButton
          title="Save"
          disabled={!personId || !parseAmount(amount)}
          onPress={async () => {
            if (await onSave({ personId, direction, amount: parseAmount(amount), note })) reset();
          }}
        />
      </View>
    </Modal>
  );
}

export default function PeopleScreen({ navigation }) {
  const t = useTokens();
  const [people, setPeople] = useState([]);
  const [ious, setIous] = useState([]);
  const [txs, setTxs] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const p = await loadPeople();
    setPeople(p.people);
    setIous(p.ious);
    setTxs(await getAll());
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Load error', e.message));
    }, [load])
  );

  const summary = useMemo(() => peopleSummary(people, ious), [people, ious]);
  const suggestions = useMemo(() => settleSuggestions(txs, people, ious).slice(0, 3), [txs, people, ious]);
  const quiet = people.filter((p) => !summary.rows.some((r) => r.person.id === p.id));

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
      await load();
      return true;
    } catch (e) {
      Alert.alert('Cannot complete', e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const total = (label, value, owe) => (
    <View
      style={{
        flex: 1,
        backgroundColor: owe ? t.dangerBg : t.incomeBg,
        borderRadius: radius.xl,
        padding: space.lg,
      }}
    >
      <Text style={{ color: owe ? t.expense : t.income, fontFamily: fonts.body, fontSize: 15 }}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={{ color: owe ? t.expense : t.income, fontFamily: fonts.display, fontSize: 28, marginTop: 4 }}
      >
        {formatMoney(value)}
      </Text>
    </View>
  );

  const personRow = (person, net, items, last) => {
    const owe = net < 0;
    return (
      <Pressable
        key={person.id}
        testID={`person-${person.id}`}
        accessibilityRole="button"
        accessibilityLabel={`${person.name}, ${net ? `${formatMoney(Math.abs(net))} ${owe ? 'you owe' : 'owes you'}` : 'settled'}`}
        onPress={() => navigation.navigate('Person', { personId: person.id })}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderBottomWidth: last ? 0 : 1,
          borderColor: t.divider,
        }}
      >
        <Avatar name={person.name} owe={owe} t={t} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>{person.name}</Text>
          <Text numberOfLines={1} style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>
            {items.length ? itemsLine(items) : 'All settled'}
          </Text>
        </View>
        {net ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: owe ? t.expense : t.income, fontFamily: fonts.bold, fontSize: 17 }}>
              {formatMoney(Math.abs(net))}
            </Text>
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>
              {owe ? 'you owe' : 'owes you'}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const allRows = [...summary.rows.map((r) => [r.person, r.net, r.items]), ...quiet.map((p) => [p, 0, []])];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="People" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.md }}>
          {total('Owed to you', summary.owedToMe, false)}
          {total('You owe', summary.iOwe, true)}
        </View>

        {suggestions.map((s) => (
          <View
            key={String(s.tx.id)}
            testID={`settle-${s.tx.id}`}
            style={{
              backgroundColor: t.primarySoft,
              borderRadius: radius.xl,
              padding: space.lg,
              marginBottom: space.md,
            }}
          >
            <Text style={{ color: t.primary, fontFamily: fonts.body, fontSize: 16, lineHeight: 23 }}>
              <Text style={{ fontFamily: fonts.bold }}>
                {`${formatMoney(s.tx.amount)} received from ${s.tx.counterparty || payeeName(s.tx) || s.tx.title}`}
              </Text>
              {` on ${day(s.tx.fullDate)}. Is this ${s.person.name} paying you back?`}
            </Text>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.md }}>
              <View style={{ flex: 1 }}>
                <AppButton
                  title="Yes, settle"
                  loading={busy}
                  onPress={() => run(() => settleFromCredit(s.tx.id, s.person.id))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton
                  title="No, it's income"
                  variant="secondary"
                  onPress={() => run(() => dismissSettle(s.tx.id))}
                />
              </View>
            </View>
          </View>
        ))}

        {allRows.length ? (
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
            {allRows.map(([p, net, items], i) => personRow(p, net, items, i === allRows.length - 1))}
          </View>
        ) : (
          <Text
            style={{
              color: t.muted,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 22,
              marginVertical: space.lg,
            }}
          >
            No one yet. Split a transaction with someone, or record what you owe.
          </Text>
        )}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <AppButton title="Add person" variant="secondary" onPress={() => setSheet('person')} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton title={'Record "I owe"'} variant="secondary" onPress={() => setSheet('iou')} />
          </View>
        </View>
        <Text
          style={{
            color: t.text2,
            fontFamily: fonts.body,
            fontSize: 14,
            lineHeight: 21,
            marginTop: space.md,
          }}
        >
          Tap a person to see each item, remind them (shares a message with your UPI ID), or mark it settled.
        </Text>
      </ScrollView>

      <TextSheet
        visible={sheet === 'person'}
        title="Add person"
        label="Name"
        placeholder="Ravi"
        action="Add"
        autoCapitalize="words"
        onClose={() => setSheet(null)}
        onSubmit={(name) => run(() => addPerson(name)).then((ok) => ok && setSheet(null))}
      />
      <IouSheet
        t={t}
        visible={sheet === 'iou'}
        people={people}
        onClose={() => setSheet(null)}
        onSave={async (fields) => {
          const ok = await run(() => addIou(fields));
          if (ok) setSheet(null);
          return ok;
        }}
      />
    </SafeAreaView>
  );
}
