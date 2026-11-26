/**
 * UpcomingBillsScreen (Phase 14 E2, docs/design/22-upcoming-bills.png).
 * Next 30 days: card bills, loan EMIs, repeating entries and saved bills (found in SMS or added by
 * hand), what the main bank has left after them, paused autopays, and "Review N found".
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, AppSwitch, Chip, ScreenHeader, Segmented } from '../components/ui';
import { upcoming, suggestions, newBill, CADENCE_LABEL } from '../utils/UpcomingBills';
import { saveBill, deleteBill, confirmSeries, dismissBillPayee } from '../utils/FeatureService';
import { syncBillReminders } from '../utils/BillReminders';
import { shortAccountName } from '../utils/TransactionList';
import { formatMoney, parseAmount } from '../utils/Format';

const readList = async (key) => {
  try {
    const v = JSON.parse((await Storage.getItem(key)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** Everything the bills list needs from storage. */
export const loadBillsData = async () => ({
  accounts: await readList('user_wealth_accounts'),
  txs: await getAll(),
  recurring: await readList('recurring_transactions'),
  bills: await readList('recurring_bills'),
  mandates: await readList('mandates'),
  dismissed: await readList('bill_dismissed'),
});

const short = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const monthName = (d) => new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const weekday = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
const DAY = 24 * 60 * 60 * 1000;

function Sheet({ visible, title, onClose, children, t }) {
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
          maxHeight: '85%',
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: t.text, fontFamily: fonts.display, fontSize: 20, marginBottom: space.md }}
        >
          {title}
        </Text>
        <ScrollView>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export default function UpcomingBillsScreen({ navigation }) {
  const t = useTokens();
  const [data, setData] = useState(null);
  const [sheet, setSheet] = useState(null); // 'add' | 'review' | { bill }
  const [form, setForm] = useState(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const [asOf, setAsOf] = useState(() => new Date());
  const load = useCallback(async () => {
    const fresh = await loadBillsData();
    setAsOf(new Date());
    setData(fresh);
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Load error', e.message));
    }, [load])
  );

  const r = useMemo(() => (data ? upcoming({ ...data, asOf }) : null), [data, asOf]);
  const found = useMemo(() => (data ? suggestions({ ...data, asOf }) : []), [data, asOf]);
  if (!r) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;

  const byId = Object.fromEntries(data.accounts.map((a) => [String(a.id), a]));
  const payable = data.accounts.filter((a) =>
    ['Bank Account', 'Credit Card', 'Wallet', 'Cash'].includes(a.type)
  );

  /** Save, then re-plan the reminders (bills with reminder on). */
  const run = async (action) => {
    setBusy(true);
    try {
      await action();
      const fresh = await loadBillsData();
      setData(fresh);
      await syncBillReminders(fresh.bills, fresh.txs, { fmt: formatMoney }).catch(() => null);
      return true;
    } catch (e) {
      Alert.alert('Cannot save', e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setForm({
      name: '',
      amount: '',
      cadence: 'monthly',
      nextDate: new Date(asOf.getTime() + 7 * DAY),
      accountId: r.afterBank?.account.id ?? null,
      reminder: true,
    });
    setSheet('add');
  };

  const openItem = (item) => {
    if (item.kind === 'card') navigation.navigate('CardDetail', { cardId: item.ref.cardId });
    else if (item.kind === 'loan') navigation.navigate('LoanDetail', { loanId: item.ref.loanId });
    else if (item.kind === 'recurring') navigation.navigate('Recurring');
    else {
      const bill = data.bills.find((b) => String(b.id) === String(item.ref.billId));
      if (bill) setSheet({ bill });
    }
  };

  // month groups
  const groups = [];
  for (const item of r.items) {
    const label = monthName(item.date);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(item);
  }
  const soon = (d) => new Date(d).getTime() - asOf.getTime() < 3 * DAY;
  const bank = r.afterBank;

  const box = (children, extra) => (
    <View
      style={{
        backgroundColor: t.card,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: radius.xl,
        overflow: 'hidden',
        marginBottom: space.md,
        ...extra,
      }}
    >
      {children}
    </View>
  );
  const groupTitle = (label) => (
    <Text
      accessibilityRole="header"
      style={{
        color: t.text2,
        fontFamily: fonts.semibold,
        fontSize: 14,
        letterSpacing: 0.6,
        marginTop: space.md,
        marginBottom: space.sm,
      }}
    >
      {label.toUpperCase()}
    </Text>
  );

  const row = (item, last) => (
    <Pressable
      key={item.id}
      testID={`bill-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${formatMoney(item.amount)}, ${item.overdue ? 'overdue' : 'due'} ${short(item.date)}`}
      onPress={() => openItem(item)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: last ? 0 : 1,
        borderColor: t.divider,
      }}
    >
      <View style={{ width: 48, alignItems: 'center', marginRight: space.md }}>
        <Text
          style={{
            color: item.overdue ? t.expense : soon(item.date) ? t.warnText : t.muted,
            fontFamily: fonts.semibold,
            fontSize: 13,
          }}
        >
          {item.overdue ? 'LATE' : weekday(item.date)}
        </Text>
        <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 24 }}>
          {new Date(item.date).getDate()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>{item.name}</Text>
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>{item.sub}</Text>
      </View>
      <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17, marginLeft: space.sm }}>
        {formatMoney(item.amount)}
      </Text>
    </Pressable>
  );

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
  const editing = sheet && typeof sheet === 'object' ? sheet.bill : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Upcoming bills" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        <View style={{ backgroundColor: t.ink, borderRadius: radius.xxl, padding: space.xl }}>
          <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 15 }}>
            {`Next 30 days · ${short(r.from)} – ${short(r.to)}`}
          </Text>
          <Text
            testID="bills-total"
            adjustsFontSizeToFit
            numberOfLines={1}
            style={{ color: '#FFFFFF', fontFamily: fonts.display, fontSize: 40, marginVertical: space.sm }}
          >
            {formatMoney(r.total)}
          </Text>
          {bank ? (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                backgroundColor: t.inkCard,
                borderRadius: radius.lg,
                padding: space.md,
              }}
            >
              <Text style={{ color: t.inkMuted, fontFamily: fonts.body, fontSize: 15 }}>
                {`${shortAccountName(bank.account.name, bank.account.last4)} after these`}
              </Text>
              <Text
                style={{
                  color: bank.balance < 0 ? '#F08A80' : '#5CC998',
                  fontFamily: fonts.semibold,
                  fontSize: 15,
                }}
              >
                {formatMoney(bank.balance)}
              </Text>
            </View>
          ) : null}
        </View>

        {groups.map((g) => (
          <View key={g.label}>
            {groupTitle(g.label)}
            {box(g.items.map((item, i) => row(item, i === g.items.length - 1)))}
          </View>
        ))}
        {!r.items.length ? (
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15, marginTop: space.lg }}>
            Nothing due in the next 30 days.
          </Text>
        ) : null}

        {r.paused.length ? (
          <View>
            {groupTitle('Paused')}
            {box(
              r.paused.map((p, i) => (
                <View
                  key={p.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: space.lg,
                    borderBottomWidth: i === r.paused.length - 1 ? 0 : 1,
                    borderColor: t.divider,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>{p.name}</Text>
                    <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>{p.sub}</Text>
                  </View>
                  {p.amount ? (
                    <Text style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 17 }}>
                      {formatMoney(p.amount)}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </View>
        ) : null}

        {r.warnings.map((w) => (
          <View
            key={w.card.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: t.warnBg,
              borderColor: t.warnBorder,
              borderWidth: 1,
              borderRadius: radius.lg,
              padding: space.lg,
              marginTop: space.md,
            }}
          >
            <Text style={{ flex: 1, color: t.warnText, fontFamily: fonts.body, fontSize: 15 }}>
              {`${shortAccountName(w.card.name, w.card.last4)} bill isn't shown until the card is set up.`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Set up ${w.card.name}`}
              hitSlop={8}
              onPress={() => navigation.navigate('CardSetup', { cardId: w.card.id })}
            >
              <Text
                style={{
                  color: t.warnText,
                  fontFamily: fonts.bold,
                  fontSize: 15,
                  textDecorationLine: 'underline',
                }}
              >
                Set up
              </Text>
            </Pressable>
          </View>
        ))}

        <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.lg }}>
          <View style={{ flex: 1 }}>
            <AppButton title="Add a bill" variant="secondary" onPress={openAdd} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton
              title={found.length ? `Review ${found.length} found` : 'None found'}
              variant="secondary"
              disabled={!found.length}
              onPress={() => setSheet('review')}
            />
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
          Bills are found from debits that repeat every week, month or year. Card bills and loan EMIs come
          from the card and the loan.
        </Text>
      </ScrollView>

      <Sheet t={t} visible={sheet === 'review'} title="Regular bills found" onClose={() => setSheet(null)}>
        {found.map((s) => (
          <View
            key={s.key}
            testID={`found-${s.key}`}
            style={{ borderBottomWidth: 1, borderColor: t.divider, paddingVertical: space.md }}
          >
            <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>
              {`${s.name} · ${formatMoney(s.amount)}`}
            </Text>
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14 }}>
              {`${CADENCE_LABEL[s.cadence]} · ${s.count} times · next ${short(s.nextDate)}${byId[String(s.accountId)] ? ` · ${shortAccountName(byId[String(s.accountId)].name, byId[String(s.accountId)].last4)}` : ''}`}
            </Text>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
              <View style={{ flex: 1 }}>
                <AppButton
                  title="Not a bill"
                  size="sm"
                  variant="secondary"
                  accessibilityLabel={`${s.name} is not a bill`}
                  onPress={() => run(() => dismissBillPayee(s.key))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton
                  title="Add"
                  size="sm"
                  accessibilityLabel={`Add ${s.name}`}
                  onPress={() => run(() => confirmSeries(s))}
                />
              </View>
            </View>
          </View>
        ))}
        {!found.length ? (
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 15 }}>All reviewed.</Text>
        ) : null}
      </Sheet>

      <Sheet t={t} visible={sheet === 'add' && !!form} title="Add a bill" onClose={() => setSheet(null)}>
        {form ? (
          <View>
            <TextInput
              accessibilityLabel="Bill name"
              placeholder="Name (Gym, Rent, Netflix)"
              placeholderTextColor={t.placeholder}
              value={form.name}
              onChangeText={(name) => setForm({ ...form, name })}
              style={input}
            />
            <TextInput
              accessibilityLabel="Amount"
              placeholder="Amount"
              placeholderTextColor={t.placeholder}
              keyboardType="decimal-pad"
              value={form.amount}
              onChangeText={(amount) => setForm({ ...form, amount })}
              style={input}
            />
            <Segmented
              style={{ marginBottom: space.md }}
              value={form.cadence}
              onChange={(cadence) => setForm({ ...form, cadence })}
              options={Object.entries(CADENCE_LABEL).map(([value, label]) => ({ value, label }))}
            />
            <AppButton
              title={`Next due: ${short(form.nextDate)}`}
              variant="secondary"
              icon="calendar-outline"
              onPress={() => setPicking(true)}
            />
            {picking ? (
              <DateTimePicker
                value={form.nextDate}
                mode="date"
                minimumDate={asOf}
                onChange={(_, picked) => {
                  setPicking(false);
                  if (picked) setForm({ ...form, nextDate: picked });
                }}
              />
            ) : null}
            <Text style={{ color: t.text2, fontFamily: fonts.medium, fontSize: 14, marginTop: space.md }}>
              Paid from
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm }}>
              {payable.map((a) => (
                <Chip
                  key={a.id}
                  label={shortAccountName(a.name, a.last4)}
                  selected={String(form.accountId) === String(a.id)}
                  onPress={() => setForm({ ...form, accountId: a.id })}
                />
              ))}
            </View>
            <AppSwitch
              label="Remind me 2 days before"
              value={form.reminder}
              onValueChange={(reminder) => setForm({ ...form, reminder })}
            />
            <AppButton
              title="Save bill"
              loading={busy}
              disabled={!form.name.trim() || !parseAmount(form.amount)}
              style={{ marginTop: space.md }}
              onPress={async () => {
                const ok = await run(() =>
                  saveBill(newBill({ ...form, amount: parseAmount(form.amount) }, new Date()))
                );
                if (ok) setSheet(null);
              }}
            />
          </View>
        ) : null}
      </Sheet>

      <Sheet t={t} visible={!!editing} title={editing?.name || ''} onClose={() => setSheet(null)}>
        {editing ? (
          <View>
            <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 15, marginBottom: space.sm }}>
              {`${formatMoney(editing.amount)} · ${CADENCE_LABEL[editing.cadence] || 'Repeats'} · ${editing.source === 'detected' ? 'found in SMS' : 'added by you'}`}
            </Text>
            <AppSwitch
              label="Remind me 2 days before"
              value={!!editing.reminder}
              onValueChange={(reminder) =>
                run(() => saveBill({ ...editing, reminder })).then(() =>
                  setSheet({ bill: { ...editing, reminder } })
                )
              }
            />
            <AppButton
              title="Delete bill"
              variant="danger"
              style={{ marginTop: space.md }}
              onPress={() => run(() => deleteBill(editing.id)).then((ok) => ok && setSheet(null))}
            />
          </View>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}
