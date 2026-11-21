/**
 * Review accounts (Phase 12 A2, design C5.4 / docs/design/Review new accounts found.png).
 * "New accounts": one card per account found in SMS. Add creates it and moves every matching
 * capture to it; Link to existing assigns them to an account the owner already has.
 * "Check": the other review items (pick account, pick wallet, possible self-transfer …).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Storage from '../data/Storage';
import { getAll, update } from '../data/TransactionRepo';
import {
  addAllDiscoveredAccounts,
  pickCaptureWallet,
  rejectCapture,
  resolveCaptureAccount,
} from '../utils/FeatureService';
import { discoverAccounts, checkItems } from '../utils/AccountDiscovery';
import { describeCapture, reviewHint, debitCardQuestion } from '../utils/ReviewText';
import { formatMoney } from '../utils/Format';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import ScreenHeader from '../components/ui/ScreenHeader';
import AppButton from '../components/ui/AppButton';
import Card from '../components/ui/Card';
import Segmented from '../components/ui/Segmented';

const SPENDABLE = ['Bank Account', 'Credit Card', 'Cash', 'Wallet'];

const initials = (name = '') =>
  name
    .replace(/[^A-Za-z ]/g, ' ')
    .trim()
    .slice(0, 2)
    .toUpperCase();

export const groupSubtitle = (g) => {
  const n = `${g.count} transaction${g.count === 1 ? '' : 's'}`;
  if (g.suggested.type === 'Credit Card')
    return Number.isFinite(g.availableLimit)
      ? `Credit card · limit seen ${formatMoney(g.availableLimit, { maximumFractionDigits: 0 })} · ${n}`
      : `Credit card · ${n}`;
  if (g.suggested.type === 'Wallet') return `Wallet · ${n}`;
  return `Savings account · ${n}`;
};

export default function ReviewAccountsScreen({ navigation, route }) {
  const t = useTokens();
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [tab, setTab] = useState(route?.params?.tab || 'new');
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(null); // group being linked to an existing account

  const load = useCallback(async () => {
    setAccounts(JSON.parse((await Storage.getItem('user_wealth_accounts')) || '[]'));
    setRows(await getAll());
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Load error', e.message));
    }, [load])
  );

  const groups = useMemo(() => discoverAccounts(rows), [rows]);
  const checks = useMemo(() => checkItems(rows), [rows]);

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (e) {
      Alert.alert('Cannot complete', e.message);
    } finally {
      setBusy(false);
    }
  };

  // linking = { name, type, txId, allowCreate }: a discovered group, or a debit card (A11)
  const linkChoices = linking
    ? accounts.filter((a) => SPENDABLE.includes(a.type) && a.type === linking.type)
    : [];
  const linkGroup = (g) => setLinking({ name: g.suggested.name, type: g.suggested.type, txId: g.firstTxId });

  const renderGroup = ({ item: g }) => {
    const isCard = g.suggested.type === 'Credit Card';
    return (
      <Card testID={`group-${g.signature}`}>
        <View style={styles.groupHead}>
          <View style={[styles.badge, { backgroundColor: isCard ? t.primarySoft : t.dangerBg }]}>
            {isCard ? (
              <Ionicons name="card-outline" size={22} color={t.primary} />
            ) : (
              <Text style={{ color: t.dangerText, fontFamily: fonts.bold }}>
                {initials(g.suggested.name)}
              </Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.groupName, { color: t.text }]}>{g.suggested.name}</Text>
            <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>
              {groupSubtitle(g)}
            </Text>
          </View>
        </View>
        <View style={styles.buttons}>
          <AppButton
            title={isCard ? 'Add card' : 'Add account'}
            accessibilityLabel={`Add ${g.suggested.name}`}
            disabled={busy}
            style={{ flex: 1 }}
            onPress={() => run(() => resolveCaptureAccount(g.firstTxId, { create: true }))}
          />
          <AppButton
            title="Link to existing"
            accessibilityLabel={`Link ${g.suggested.name} to an existing account`}
            variant="secondary"
            disabled={busy}
            style={{ flex: 1 }}
            onPress={() => linkGroup(g)}
          />
        </View>
      </Card>
    );
  };

  const renderDebitCard = (tx) => {
    const candidates = accounts.filter((a) =>
      (tx.accountCandidates || []).map(String).includes(String(a.id))
    );
    const only = candidates.length === 1 ? candidates[0] : null;
    const other = () =>
      setLinking({
        name: `Debit Card ••${tx.cardLast4}`,
        type: 'Bank Account',
        txId: tx.id,
        allowCreate: true,
      });
    return (
      <View style={{ marginTop: space.sm }}>
        <Text style={{ color: t.text, fontSize: 15, fontFamily: fonts.semibold }}>
          {debitCardQuestion(tx, only)}
        </Text>
        {tx.groupCount > 1 && (
          <Text style={{ color: t.muted, marginTop: 2 }}>{tx.groupCount} transactions with this card</Text>
        )}
        <View style={styles.buttons}>
          {only ? (
            <AppButton
              title="Yes"
              size="sm"
              style={{ flex: 1 }}
              accessibilityLabel={`Yes, Debit Card ••${tx.cardLast4} is linked to ${only.name}`}
              onPress={() => run(() => resolveCaptureAccount(tx.id, { accountId: only.id }))}
            />
          ) : (
            candidates.map((a) => (
              <AppButton
                key={a.id}
                title={a.name}
                size="sm"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => run(() => resolveCaptureAccount(tx.id, { accountId: a.id }))}
              />
            ))
          )}
          <AppButton
            title="Different account"
            size="sm"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={other}
          />
        </View>
      </View>
    );
  };

  const renderCheck = ({ item: tx }) => (
    <Card>
      <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 15 }}>{describeCapture(tx)}</Text>
      <Text style={{ color: t.muted, marginTop: 2 }}>
        {tx.category} · {tx.date || String(tx.fullDate || '').slice(0, 10)}
      </Text>
      {reviewHint(tx) ? <Text style={{ color: t.warnText, marginTop: 4 }}>{reviewHint(tx)}</Text> : null}
      {tx.reviewReason === 'link_debit_card' && tx.accountUnresolved && renderDebitCard(tx)}
      {tx.reviewReason === 'pick_account' && (
        <View style={styles.chips}>
          {accounts
            .filter((a) => (tx.accountCandidates || []).map(String).includes(String(a.id)))
            .map((a) => (
              <AppButton
                key={a.id}
                title={a.name}
                size="sm"
                variant="secondary"
                style={{ marginRight: space.sm }}
                onPress={() => run(() => resolveCaptureAccount(tx.id, { accountId: a.id }))}
              />
            ))}
        </View>
      )}
      {tx.reviewReason === 'pick_wallet' && (
        <View style={styles.chips}>
          {accounts
            .filter((a) => a.type === 'Wallet')
            .map((a) => (
              <AppButton
                key={a.id}
                title={a.name}
                size="sm"
                variant="secondary"
                style={{ marginRight: space.sm }}
                onPress={() => run(() => pickCaptureWallet(tx.id, a.id))}
              />
            ))}
        </View>
      )}
      <View style={styles.buttons}>
        {!tx.accountUnresolved && (
          <AppButton
            title="Confirm"
            size="sm"
            style={{ flex: 1 }}
            onPress={() => run(() => update(tx.id, { reviewStatus: 'confirmed' }))}
          />
        )}
        <AppButton
          title="Edit"
          size="sm"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => navigation.navigate('TransactionDetail', { transaction: tx })}
        />
        <AppButton
          title="Undo"
          size="sm"
          variant="danger"
          style={{ flex: 1 }}
          accessibilityLabel="Undo capture"
          onPress={() =>
            Alert.alert('Undo capture?', 'Delete this transaction and reverse its balance change?', [
              { text: 'Cancel' },
              { text: 'Undo', onPress: () => run(() => rejectCapture(tx.id)) },
            ])
          }
        />
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Review" onBack={() => navigation.goBack()} />
      <Text style={[styles.intro, { color: t.text2 }]}>
        We read these accounts from your bank SMS. Add each one once and every matching transaction moves to
        it.
      </Text>
      <Segmented
        style={{ marginHorizontal: space.xl, marginBottom: space.md }}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'new', label: `New accounts · ${groups.length}` },
          { value: 'check', label: `Check · ${checks.length}` },
        ]}
      />
      {tab === 'new' ? (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.signature}
          renderItem={renderGroup}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={{ color: t.muted, textAlign: 'center', marginTop: space.xxl }}>
              No new accounts in your SMS.
            </Text>
          }
        />
      ) : (
        <FlatList
          data={checks}
          keyExtractor={(tx) => String(tx.id)}
          renderItem={renderCheck}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={{ color: t.muted, textAlign: 'center', marginTop: space.xxl }}>
              Nothing to check.
            </Text>
          }
        />
      )}
      {tab === 'new' && groups.length > 0 && (
        <View style={[styles.footer, { borderColor: t.border, backgroundColor: t.bg }]}>
          <AppButton
            title={`Add all ${groups.length} account${groups.length === 1 ? '' : 's'}`}
            size="lg"
            variant="ink"
            loading={busy}
            onPress={() => run(() => addAllDiscoveredAccounts())}
          />
        </View>
      )}

      <Modal visible={!!linking} transparent animationType="slide" onRequestClose={() => setLinking(null)}>
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { backgroundColor: t.card }]}>
            <Text style={[styles.groupName, { color: t.text, marginBottom: space.sm }]}>
              Link {linking?.name} to
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {linkChoices.length === 0 ? (
                <Text style={{ color: t.muted }}>
                  You have no {linking?.type === 'Credit Card' ? 'credit cards' : 'accounts of this type'}{' '}
                  yet.
                  {linking?.allowCreate ? '' : ' Use Add instead.'}
                </Text>
              ) : (
                linkChoices.map((a) => (
                  <AppButton
                    key={a.id}
                    title={a.name}
                    variant="secondary"
                    onPress={() => {
                      const { txId } = linking;
                      setLinking(null);
                      run(() => resolveCaptureAccount(txId, { accountId: a.id }));
                    }}
                  />
                ))
              )}
            </ScrollView>
            {linking?.allowCreate && (
              <AppButton
                title="Add as a new account"
                variant="dashed"
                icon="add"
                onPress={() => {
                  const { txId } = linking;
                  setLinking(null);
                  run(() => resolveCaptureAccount(txId, { create: true }));
                }}
              />
            )}
            <AppButton title="Cancel" variant="secondary" onPress={() => setLinking(null)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: space.xl,
    marginVertical: space.md,
  },
  list: { paddingHorizontal: space.xl, paddingBottom: 120 },
  groupHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  groupName: { fontFamily: fonts.semibold, fontSize: 17 },
  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.xl,
    borderTopWidth: 1,
  },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { padding: space.xl, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
});
