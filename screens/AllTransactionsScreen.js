/**
 * Transactions (Phase 12 C5.2, docs/design/Transactions.png).
 * Back · title · export. Search ("payee, amount or #tag", utils/Tags.parseSearch), account
 * chips, tag chips + Has file, list grouped by day with the day total (transfers not counted).
 * Bulk edit lives in MoneyTool?tab=History (reachable from the export menu).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, SectionList, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { exportHistory } from '../utils/HistoryExport';
import { parseSearch, matchesSearch, recentTags } from '../utils/Tags';
import { groupByDay, touchesAccount, shortAccountName } from '../utils/TransactionList';
import { formatMoney } from '../utils/Format';
import { useTokens } from '../components/Theme';
import { fonts, radius, space, type } from '../components/tokens';
import { Chip, EmptyState, IconButton, ScreenHeader, TransactionRow } from '../components/ui';

const dayTotalLabel = (n) => (n === 0 ? '' : `${n < 0 ? '−' : '+'}${formatMoney(Math.abs(n))}`);

export default function AllTransactionsScreen({ navigation, route }) {
  const t = useTokens();
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [query, setQuery] = useState('');
  const [accountId, setAccountId] = useState(null);
  const [hasFile, setHasFile] = useState(false);

  const load = useCallback(async () => {
    setAccounts(JSON.parse((await Storage.getItem('user_wealth_accounts')) || '[]'));
    setRows(await getAll());
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Load error', e.message));
    }, [load])
  );

  const accountsById = useMemo(() => Object.fromEntries(accounts.map((a) => [String(a.id), a])), [accounts]);
  const tags = useMemo(() => recentTags(rows), [rows]);
  const parsed = useMemo(() => parseSearch(query), [query]);
  const account = accountId ? accountsById[accountId] : null;
  const filtered = useMemo(
    () =>
      rows.filter(
        (tx) =>
          matchesSearch(tx, parsed) &&
          touchesAccount(tx, account) &&
          (!hasFile || (Array.isArray(tx.attachments) && tx.attachments.length > 0))
      ),
    [rows, parsed, account, hasFile]
  );
  const sections = useMemo(() => groupByDay(filtered), [filtered]);

  const toggleTag = (tag) => {
    const token = `#${tag}`;
    const words = query.split(/\s+/).filter(Boolean);
    setQuery(
      words.includes(token) ? words.filter((w) => w !== token).join(' ') : [...words, token].join(' ')
    );
  };

  const onExport = () =>
    Alert.alert('Export', `${filtered.length} transaction${filtered.length === 1 ? '' : 's'} shown`, [
      {
        text: 'CSV',
        onPress: () => exportHistory(filtered).catch((e) => Alert.alert('Export failed', e.message)),
      },
      {
        text: 'Excel',
        onPress: () => exportHistory(filtered, 'xlsx').catch((e) => Alert.alert('Export failed', e.message)),
      },
      { text: 'Bulk edit…', onPress: () => navigation.navigate('MoneyTool', { tab: 'History' }) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const header = (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: t.card,
          borderColor: t.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          paddingHorizontal: space.lg,
          minHeight: 52,
        }}
      >
        <Ionicons name="search-outline" size={20} color={t.muted} />
        <TextInput
          testID="tx-search"
          accessibilityLabel="Search transactions"
          autoFocus={!!route?.params?.focusSearch}
          value={query}
          onChangeText={setQuery}
          placeholder="Search payee, amount or #tag"
          placeholderTextColor={t.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, marginLeft: space.md, color: t.text, fontFamily: fonts.body, fontSize: 16 }}
        />
        {query ? (
          <IconButton icon="close-circle" label="Clear search" color={t.muted} onPress={() => setQuery('')} />
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.md }}>
        <Chip label="All accounts" selected={!accountId} onPress={() => setAccountId(null)} />
        {accounts.map((a) => (
          <Chip
            key={a.id}
            label={shortAccountName(a.name, a.last4)}
            selected={accountId === String(a.id)}
            onPress={() => setAccountId(accountId === String(a.id) ? null : String(a.id))}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center' }}
      >
        <Text style={[type.meta, { color: t.muted, marginRight: space.sm, marginBottom: space.sm }]}>
          Tags
        </Text>
        {tags.map((g) => (
          <Chip
            key={g}
            tone="tag"
            label={`#${g}`}
            selected={parsed.tags.includes(g)}
            onPress={() => toggleTag(g)}
          />
        ))}
        <Chip label="Has file" icon="attach" selected={hasFile} onPress={() => setHasFile(!hasFile)} />
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        title="Transactions"
        onBack={() => navigation.goBack()}
        right={<IconButton icon="share-outline" label="Export transactions" onPress={onExport} />}
      />
      <SectionList
        sections={sections}
        keyExtractor={(tx) => String(tx.id)}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ marginTop: space.lg }}>
            <EmptyState
              icon="search-outline"
              title={rows.length ? 'Nothing matches' : 'No transactions yet'}
              body={
                rows.length
                  ? 'Try another word, amount or tag.'
                  : 'Add one from Home, or turn on bank SMS in Settings.'
              }
            />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginTop: space.xl,
              marginBottom: space.sm,
              paddingHorizontal: space.xs,
            }}
          >
            <Text accessibilityRole="header" style={[type.overline, { color: t.muted }]}>
              {section.title}
            </Text>
            <Text style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 13 }}>
              {dayTotalLabel(section.total)}
            </Text>
          </View>
        )}
        renderItem={({ item, index, section }) => {
          const first = index === 0;
          const last = index === section.data.length - 1;
          return (
            <View
              style={{
                backgroundColor: t.card,
                borderColor: t.border,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderTopWidth: first ? 1 : 0,
                borderBottomWidth: last ? 1 : 0,
                borderTopLeftRadius: first ? radius.lg : 0,
                borderTopRightRadius: first ? radius.lg : 0,
                borderBottomLeftRadius: last ? radius.lg : 0,
                borderBottomRightRadius: last ? radius.lg : 0,
                paddingHorizontal: space.lg,
              }}
            >
              <TransactionRow
                tx={item}
                accountsById={accountsById}
                divider={!last}
                onPress={() => navigation.navigate('TransactionDetail', { transaction: item })}
              />
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
