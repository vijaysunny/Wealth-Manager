/**
 * Card setup (Phase 13 B4, docs/design/13-credit-card-setup.png).
 * Credit limit · statement date (day chips) · payment due (N days after statement / fixed day)
 * · "What you owe now" (limit − available, and why it differs from the stored balance)
 * · Remind me before the due date · Save.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, AppSwitch, Card, ScreenHeader, Segmented } from '../components/ui';
import { parseAmount, formatMoney } from '../utils/Format';
import { shortAccountName } from '../utils/TransactionList';
import { DEFAULT_DUE, nextDueDate } from '../utils/CardMath';
import { setupOwedBox, shortDate, weekdayDate } from '../utils/CardView';
import { loadCard, saveCardSetup, setupError } from '../utils/CardService';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export default function CardSetupScreen({ navigation, route }) {
  const t = useTokens();
  const cardId = route.params?.cardId;
  const [data, setData] = useState(null);
  const [limit, setLimit] = useState('');
  const [day, setDay] = useState(null);
  const [dueMode, setDueMode] = useState(DEFAULT_DUE.mode);
  const [dueDays, setDueDays] = useState(String(DEFAULT_DUE.days));
  const [dueDay, setDueDay] = useState('');
  const [remind, setRemind] = useState(true);
  const [saving, setSaving] = useState(false);
  const chips = useRef(null);

  const load = useCallback(async () => {
    const d = await loadCard(cardId);
    if (!d.card) {
      Alert.alert('Card', 'This item no longer exists.');
      navigation.goBack();
      return;
    }
    const c = d.card;
    const sms = (c.statements || []).filter((s) => s.source === 'sms').pop();
    setData({ ...d, smsStatement: sms || null });
    if (c.creditLimit) setLimit(String(c.creditLimit));
    setDay(c.statementDay || (sms ? new Date(sms.date).getDate() : null));
    if (c.due?.mode === 'fixedDay') {
      setDueMode('fixedDay');
      setDueDay(String(c.due.day));
    } else if (c.due?.mode === 'afterStatement') setDueDays(String(c.due.days));
    setRemind(c.remindDue !== false);
  }, [cardId, navigation]);
  useEffect(() => {
    load().catch((e) => Alert.alert('Card', e.message));
  }, [load]);

  const due = useMemo(
    () =>
      dueMode === 'fixedDay'
        ? { mode: 'fixedDay', day: Math.round(Number(dueDay)) }
        : { mode: 'afterStatement', days: Math.round(Number(dueDays)) },
    [dueMode, dueDay, dueDays]
  );
  const parsedLimit = parseAmount(limit);
  const box = useMemo(
    () => (data ? setupOwedBox(data.card, parsedLimit, data.txs) : null),
    [data, parsedLimit]
  );
  const values = { creditLimit: parsedLimit, statementDay: day, due, remindDue: remind };
  const error = data ? setupError(values, box?.available) : null;
  const next = day && !error ? nextDueDate({ type: 'Credit Card', statementDay: day, due }) : null;

  useEffect(() => {
    if (day && chips.current?.scrollTo)
      chips.current.scrollTo({ x: Math.max(0, (day - 3) * 56), animated: false });
  }, [day, data]);

  const save = async () => {
    if (error) {
      Alert.alert('Card setup', error);
      return;
    }
    setSaving(true);
    try {
      await saveCardSetup(cardId, values);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Card setup', e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;
  const name = shortAccountName(data.card.name, data.card.last4);
  const label = { color: t.text2, fontFamily: fonts.semibold, fontSize: 15, marginBottom: space.sm };
  const input = {
    borderWidth: 1,
    borderColor: t.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 52,
    color: t.text,
    fontFamily: fonts.medium,
    fontSize: 18,
    backgroundColor: t.card,
  };
  const line = (left, right, strong) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm }}>
      <Text
        style={{
          color: strong ? t.text : t.text2,
          fontFamily: strong ? fonts.bold : fonts.body,
          fontSize: strong ? 17 : 15,
        }}
      >
        {left}
      </Text>
      <Text
        style={{
          color: t.text,
          fontFamily: strong ? fonts.display : fonts.medium,
          fontSize: strong ? 18 : 15,
        }}
      >
        {right}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        title={`Set up ${name}`}
        backIcon="close"
        backLabel="Close"
        onBack={() => navigation.goBack()}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <Text
            style={{
              color: t.text2,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 22,
              marginBottom: space.lg,
            }}
          >
            Three numbers from your card statement. With them, every spend SMS tells us exactly what you owe.
          </Text>
          <Card>
            <Text style={label}>Credit limit</Text>
            <View style={[input, { flexDirection: 'row', alignItems: 'center' }]}>
              <Text style={{ color: t.text2, fontFamily: fonts.medium, fontSize: 18, marginRight: space.sm }}>
                ₹
              </Text>
              <TextInput
                testID="card-limit"
                accessibilityLabel="Credit limit"
                value={limit}
                onChangeText={setLimit}
                keyboardType="numeric"
                placeholder="e.g. 3,00,000"
                placeholderTextColor={t.placeholder}
                style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 18 }}
              />
            </View>
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13, marginTop: space.xs }}>
              Printed on the statement as &quot;Credit limit&quot;. Not the &quot;available limit&quot; in
              SMS.
            </Text>

            <Text style={[label, { marginTop: space.lg }]}>Statement date (day of the month)</Text>
            <ScrollView ref={chips} horizontal showsHorizontalScrollIndicator={false}>
              {DAYS.map((d) => {
                const on = d === day;
                return (
                  <Pressable
                    key={d}
                    accessibilityRole="button"
                    accessibilityLabel={`Statement day ${d}`}
                    accessibilityState={{ selected: on }}
                    onPress={() => setDay(d)}
                    style={{
                      width: 48,
                      height: 44,
                      marginRight: space.sm,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: on ? t.primary : t.inputBorder,
                      backgroundColor: on ? t.primary : t.card,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        color: on ? t.onPrimary : t.text,
                        fontFamily: on ? fonts.bold : fonts.body,
                        fontSize: 16,
                      }}
                    >
                      {d}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {data.smsStatement ? (
              <Text
                style={{ color: t.income, fontFamily: fonts.semibold, fontSize: 14, marginTop: space.sm }}
              >
                Found in your statement SMS of {shortDate(data.smsStatement.date)}
              </Text>
            ) : null}

            <Text style={[label, { marginTop: space.lg }]}>Payment due</Text>
            <Segmented
              value={dueMode}
              onChange={setDueMode}
              options={[
                {
                  value: 'afterStatement',
                  label: `${Number(dueDays) || DEFAULT_DUE.days} days after statement`,
                },
                { value: 'fixedDay', label: 'Fixed day' },
              ]}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.sm, gap: space.sm }}>
              <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 15 }}>
                {dueMode === 'fixedDay' ? 'Day of the month' : 'Days after the statement'}
              </Text>
              <TextInput
                accessibilityLabel={
                  dueMode === 'fixedDay' ? 'Due day of the month' : 'Days after the statement'
                }
                value={dueMode === 'fixedDay' ? dueDay : dueDays}
                onChangeText={dueMode === 'fixedDay' ? setDueDay : setDueDays}
                keyboardType="number-pad"
                style={[input, { minHeight: 44, width: 72, fontSize: 16 }]}
              />
            </View>
            {next ? (
              <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: space.sm }}>
                Next due: {weekdayDate(next)}
              </Text>
            ) : null}
          </Card>

          <Card testID="owed-now">
            <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 19 }}>What you owe now</Text>
            {box?.available ? (
              <>
                {line('Limit', parsedLimit ? formatMoney(parsedLimit) : '—')}
                {line(
                  `Available (SMS, ${shortDate(box.available.at)})`,
                  `− ${formatMoney(box.available.amount)}`
                )}
                <View style={{ height: 1, backgroundColor: t.divider, marginTop: space.md }} />
                {line('You owe', box.owed !== null ? formatMoney(box.owed) : '—', true)}
                {box.note ? (
                  <View
                    testID="owed-note"
                    style={{
                      backgroundColor: t.warnBg,
                      borderColor: t.warnBorder,
                      borderWidth: 1,
                      borderRadius: radius.md,
                      padding: space.md,
                      marginTop: space.md,
                    }}
                  >
                    <Text style={{ color: t.warnText, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 }}>
                      {box.note}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <Text
                style={{
                  color: t.muted,
                  fontFamily: fonts.body,
                  fontSize: 14,
                  lineHeight: 20,
                  marginTop: space.sm,
                }}
              >
                No SMS with the available limit yet. What you owe updates with the next spend SMS from this
                card.
              </Text>
            )}
          </Card>

          <Card padding={0} style={{ paddingHorizontal: space.lg }}>
            <AppSwitch
              label="Remind me before the due date"
              sublabel="3 days before, only if the bill isn't paid"
              value={remind}
              onValueChange={setRemind}
            />
          </Card>
          {error && limit ? (
            <Text
              testID="setup-error"
              style={{ color: t.dangerText, fontFamily: fonts.medium, fontSize: 14 }}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>
        <View style={{ padding: space.lg, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
          <AppButton title="Save" size="lg" loading={saving} disabled={saving} onPress={save} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
