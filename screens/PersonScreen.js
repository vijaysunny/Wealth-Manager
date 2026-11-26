/**
 * PersonScreen (Phase 14 E4): one person's items. Remind shares a text through the share sheet
 * ("Hi Ravi, ₹500 for Amazon (12 Nov). UPI: <your UPI ID from Settings>"); Mark settled per item.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, ScreenHeader } from '../components/ui';
import { setIouSettled } from '../utils/FeatureService';
import { balanceOf, remindText } from '../utils/People';
import { formatMoney } from '../utils/Format';
import { suppressNextLock } from '../utils/LockSuppress';
import { loadPeople, Avatar } from './PeopleScreen';

const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const newestFirst = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

export default function PersonScreen({ navigation, route }) {
  const t = useTokens();
  const personId = route.params?.personId;
  const [person, setPerson] = useState(null);
  const [ious, setIous] = useState([]);
  const [txs, setTxs] = useState([]);
  const [upi, setUpi] = useState('');
  const [showSettled, setShowSettled] = useState(false);

  const load = useCallback(async () => {
    const p = await loadPeople();
    setPerson(p.people.find((x) => String(x.id) === String(personId)) || null);
    setIous(p.ious.filter((i) => String(i.personId) === String(personId)));
    setUpi((await Storage.getItem('owner_upi_id')) || '');
    setTxs(await getAll());
  }, [personId]);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Load error', e.message));
    }, [load])
  );

  const open = useMemo(() => ious.filter((i) => !i.settledAt).sort(newestFirst), [ious]);
  const settled = useMemo(() => ious.filter((i) => i.settledAt).sort(newestFirst), [ious]);
  if (!person) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;
  const b = balanceOf(open);

  const toggle = (iou, value) =>
    setIouSettled(iou.id, value)
      .then(load)
      .catch((e) => Alert.alert('Cannot save', e.message));
  const remind = async () => {
    suppressNextLock();
    await Share.share({ message: remindText(person, open, upi, formatMoney) });
  };
  const openTx = (iou) => {
    const tx = iou.txId != null && txs.find((x) => String(x.id) === String(iou.txId));
    if (tx) navigation.navigate('TransactionDetail', { transaction: tx });
  };

  const item = (iou, last) => {
    const owe = iou.direction === 'iOwe';
    const linked = iou.txId != null && txs.some((x) => String(x.id) === String(iou.txId));
    return (
      <View
        key={iou.id}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderBottomWidth: last ? 0 : 1,
          borderColor: t.divider,
        }}
      >
        <Pressable
          accessibilityRole={linked ? 'button' : 'text'}
          disabled={!linked}
          onPress={() => openTx(iou)}
          style={{ flex: 1 }}
        >
          <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}>{iou.note || 'IOU'}</Text>
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>
            {[
              day(iou.date),
              owe ? 'you owe' : 'owes you',
              iou.settledAt ? `settled ${day(iou.settledAt)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Pressable>
        <Text
          style={{
            color: iou.settledAt ? t.muted : owe ? t.expense : t.income,
            fontFamily: fonts.bold,
            fontSize: 16,
            marginHorizontal: space.md,
          }}
        >
          {formatMoney(iou.amount)}
        </Text>
        <AppButton
          title={iou.settledAt ? 'Reopen' : 'Mark settled'}
          size="sm"
          variant="secondary"
          accessibilityLabel={`${iou.settledAt ? 'Reopen' : 'Mark settled'}: ${iou.note || 'IOU'}`}
          onPress={() => toggle(iou, !iou.settledAt)}
        />
      </View>
    );
  };

  const card = (children) => (
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
      {children}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title={person.name} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.lg }}>
          <Avatar name={person.name} owe={b.net < 0} t={t} />
          <Text
            testID="person-net"
            style={{ color: t.text, fontFamily: fonts.display, fontSize: 22, flex: 1 }}
          >
            {b.net > 0
              ? `Owes you ${formatMoney(b.net)}`
              : b.net < 0
                ? `You owe ${formatMoney(-b.net)}`
                : 'All settled'}
          </Text>
        </View>
        {b.owedToMe > 0 ? (
          <AppButton
            title="Remind"
            icon="share-social-outline"
            style={{ marginBottom: space.md }}
            onPress={() => remind().catch((e) => Alert.alert('Cannot share', e.message))}
          />
        ) : null}
        {b.owedToMe > 0 && !upi ? (
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13, marginBottom: space.md }}>
            Add your UPI ID in Settings and reminders include it.
          </Text>
        ) : null}
        {open.length ? card(open.map((i, n) => item(i, n === open.length - 1))) : null}
        {settled.length ? (
          <AppButton
            title={showSettled ? 'Hide settled' : `Show settled (${settled.length})`}
            variant="secondary"
            size="sm"
            style={{ alignSelf: 'flex-start', marginBottom: space.md }}
            onPress={() => setShowSettled(!showSettled)}
          />
        ) : null}
        {showSettled ? card(settled.map((i, n) => item(i, n === settled.length - 1))) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
