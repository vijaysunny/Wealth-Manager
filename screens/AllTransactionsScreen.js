/**
 * Transactions (Phase 14 B2, docs/design/19-transactions-sorted-filtered.png).
 * Back · title · export. Search + Filter button (badge = active filters), removable filter chips,
 * "N transactions · spent ₹X" with a sort menu, then the list: day headers with day totals for
 * Newest/Oldest, a flat list with dates for the other sorts. Opened with { query } from Home,
 * Budget and Card detail ({ accountId } still works). The sort is remembered across restarts;
 * filters last while the app is open.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { exportHistory } from '../utils/HistoryExport';
import { groupByDay, shortAccountName } from '../utils/TransactionList';
import {
  SORTS,
  SORT_LABELS,
  activeCount,
  activeFilterChips,
  defaultQuery,
  removeChip,
  runQuery,
} from '../utils/TransactionQuery';
import { formatMoney } from '../utils/Format';
import { useTokens } from '../components/Theme';
import { fonts, radius, space, type } from '../components/tokens';
import {
  AppButton,
  Chip,
  EmptyState,
  IconButton,
  OptionSheet,
  ScreenHeader,
  TransactionRow,
} from '../components/ui';
import FilterSheet from '../components/FilterSheet';
import { loadCategories } from './CategoriesScreen';
import { bulkApply, bulkDelete, bulkSet, undoLastBulk } from '../utils/FeatureService';
import {
  eligibleFor,
  reportsAction,
  selectedRows,
  selectionTotal,
  sharedTags,
  tagChange,
} from '../utils/BulkSelect';
import { showSnackbar } from '../utils/Snackbar';
import { normalizeTag } from '../utils/Tags';

const SPENDABLE = ['Bank Account', 'Credit Card', 'Cash', 'Wallet'];

/** A small sheet with one text field (B5: Tag, Rename payee). */
function TextSheet({ visible, title, label, placeholder, action, extra, onSubmit, onClose }) {
  const t = useTokens();
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);
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
          {title}
        </Text>
        <TextInput
          accessibilityLabel={label}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={t.placeholder}
          autoCapitalize="none"
          autoFocus
          onSubmitEditing={() => text.trim() && onSubmit(text)}
          style={{
            minHeight: 48,
            borderWidth: 1,
            borderColor: t.inputBorder,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            color: t.text,
            fontFamily: fonts.body,
            fontSize: 16,
            marginBottom: space.md,
          }}
        />
        <AppButton title={action} disabled={!text.trim()} onPress={() => onSubmit(text)} />
        {extra}
      </View>
    </Modal>
  );
}

function ActionBar({ actions, t }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderColor: t.border,
        backgroundColor: t.card,
        paddingVertical: space.sm,
      }}
    >
      {actions.map((a) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          accessibilityState={{ disabled: a.disabled }}
          disabled={a.disabled}
          onPress={a.onPress}
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 56,
            opacity: a.disabled ? 0.4 : 1,
          }}
        >
          <Ionicons name={a.icon} size={22} color={a.danger ? t.expense : t.text} />
          <Text
            numberOfLines={2}
            style={{
              color: a.danger ? t.expense : t.text,
              fontFamily: fonts.medium,
              fontSize: 12,
              textAlign: 'center',
              marginTop: 2,
            }}
          >
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export const SORT_KEY = 'tx_list_sort';
const dayTotalLabel = (n) => (n === 0 ? '' : `${n < 0 ? '−' : '+'}${formatMoney(Math.abs(n))}`);

/** The query a screen opened with: { query } (partial) or the { accountId } shortcut. */
export const queryFromParams = (params, sort) => {
  const base = { ...defaultQuery(), sort: sort || 'newest' };
  if (params?.query) return { ...base, ...params.query, sort: params.query.sort || base.sort };
  if (params?.accountId != null) return { ...base, accountIds: [String(params.accountId)] };
  return base;
};

/** Sections for the list: day groups for Newest/Oldest, one untitled section otherwise. */
export const sectionsFor = (rows, sort) => {
  if (sort === 'newest') return groupByDay(rows);
  if (sort === 'oldest')
    return groupByDay(rows)
      .reverse()
      .map((g) => ({ ...g, data: g.data.slice().reverse() }));
  return rows.length ? [{ key: 'flat', title: null, total: 0, data: rows }] : [];
};

export default function AllTransactionsScreen({ navigation, route }) {
  const t = useTokens();
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState(() => queryFromParams(route?.params));
  const [sheet, setSheet] = useState(null); // 'filters' | 'sort' | 'bulk-…'
  const [selected, setSelected] = useState(null); // B5: Set of ids in select mode, null otherwise
  const [asOf, setAsOf] = useState(() => new Date()); // "today" for date filters, renewed on each load

  // The remembered sort (B2); filters reset on restart. Once, on mount.
  const openedWithSort = !!route?.params?.query?.sort;
  useEffect(() => {
    if (openedWithSort) return;
    Storage.getItem(SORT_KEY)
      .then((s) => s && SORTS.includes(s) && setQuery((q) => ({ ...q, sort: s })))
      .catch(() => {});
  }, [openedWithSort]);
  // Opened again from a shortcut while mounted: take its filters, keep the sort.
  const paramQuery = route?.params?.query;
  const paramAccount = route?.params?.accountId;
  useEffect(() => {
    if (paramQuery || paramAccount != null)
      setQuery((q) => queryFromParams({ query: paramQuery, accountId: paramAccount }, q.sort));
  }, [paramQuery, paramAccount]);

  const load = useCallback(async () => {
    setAccounts(JSON.parse((await Storage.getItem('user_wealth_accounts')) || '[]'));
    setCategories(await loadCategories());
    setRows(await getAll());
    setAsOf(new Date());
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Load error', e.message));
    }, [load])
  );

  const accountsById = useMemo(() => Object.fromEntries(accounts.map((a) => [String(a.id), a])), [accounts]);
  const result = useMemo(() => runQuery(rows, query, asOf, { accounts }), [rows, query, asOf, accounts]);
  const sections = useMemo(() => sectionsFor(result.rows, query.sort), [result.rows, query.sort]);
  const chips = activeFilterChips(query, accounts, asOf);
  const nFilters = activeCount(query);
  const flat = query.sort !== 'newest' && query.sort !== 'oldest';

  const setSort = (sort) => {
    setQuery((q) => ({ ...q, sort }));
    Storage.setItem(SORT_KEY, sort).catch(() => {});
  };
  const clearFilters = () => setQuery((q) => ({ ...defaultQuery(), text: q.text, sort: q.sort }));

  const shown = result.rows;
  const onExport = () =>
    Alert.alert('Export', `${shown.length} transaction${shown.length === 1 ? '' : 's'} shown`, [
      {
        text: 'CSV',
        onPress: () => exportHistory(shown).catch((e) => Alert.alert('Export failed', e.message)),
      },
      {
        text: 'Excel',
        onPress: () => exportHistory(shown, 'xlsx').catch((e) => Alert.alert('Export failed', e.message)),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const { count, spent, income } = result.totals;
  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View
          style={{
            flex: 1,
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
            value={query.text}
            onChangeText={(text) => setQuery((q) => ({ ...q, text }))}
            placeholder="Payee, amount or #tag"
            placeholderTextColor={t.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, marginLeft: space.md, color: t.text, fontFamily: fonts.body, fontSize: 16 }}
          />
          {query.text ? (
            <IconButton
              icon="close-circle"
              label="Clear search"
              color={t.muted}
              onPress={() => setQuery((q) => ({ ...q, text: '' }))}
            />
          ) : null}
        </View>
        <Pressable
          testID="filter-button"
          accessibilityRole="button"
          accessibilityLabel={`Filters, ${nFilters} active`}
          onPress={() => setSheet('filters')}
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.lg,
            backgroundColor: t.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="filter" size={22} color="#FFFFFF" />
          {nFilters ? (
            <View
              style={{
                position: 'absolute',
                top: -6,
                right: -6,
                minWidth: 22,
                height: 22,
                borderRadius: 11,
                paddingHorizontal: 5,
                backgroundColor: t.primary,
                borderWidth: 2,
                borderColor: t.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: t.onPrimary, fontFamily: fonts.bold, fontSize: 12 }}>{nFilters}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {chips.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: space.md }}
          contentContainerStyle={{ alignItems: 'center' }}
        >
          {chips.map((c) => (
            <Chip
              key={c.key}
              tone="tag"
              label={c.label}
              removeLabel={`Remove filter ${c.label}`}
              onRemove={() => setQuery((q) => removeChip(q, c.key))}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={clearFilters}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md }}
          >
            <Text style={{ color: t.primary, fontFamily: fonts.semibold, fontSize: 15 }}>Clear all</Text>
          </Pressable>
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.md, gap: space.sm }}>
        <Text testID="tx-summary" style={{ flex: 1, color: t.text2, fontFamily: fonts.body, fontSize: 15 }}>
          <Text style={{ color: t.text, fontFamily: fonts.semibold }}>{count}</Text>
          {` transaction${count === 1 ? '' : 's'} · spent `}
          <Text style={{ color: t.expense, fontFamily: fonts.semibold }}>{formatMoney(spent)}</Text>
          {income > 0 ? ' · income ' : ''}
          {income > 0 ? (
            <Text style={{ color: t.income, fontFamily: fonts.semibold }}>{formatMoney(income)}</Text>
          ) : null}
        </Text>
        <Pressable
          testID="sort-button"
          accessibilityRole="button"
          accessibilityLabel={`Sort: ${SORT_LABELS[query.sort]}`}
          onPress={() => setSheet('sort')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 44,
            borderWidth: 1,
            borderColor: t.border,
            borderRadius: radius.md,
            backgroundColor: t.card,
            paddingHorizontal: space.md,
          }}
        >
          <Ionicons name="swap-vertical" size={18} color={t.text} />
          <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 14, marginLeft: space.xs }}>
            {SORT_LABELS[query.sort]}
          </Text>
        </Pressable>
      </View>
      {flat ? <View style={{ height: space.md }} /> : null}
    </View>
  );

  const filtered = nFilters > 0 || !!query.text.trim();

  // ── B5: select mode ──────────────────────────────────────────────────────
  const selecting = selected !== null;
  const ids = selecting ? [...selected] : [];
  const nSel = ids.length;
  const exitSelect = () => setSelected(null);
  const toggle = (id) =>
    setSelected((cur) => {
      const next = new Set(cur || []);
      const k = String(id);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  // Android Back and leaving the screen exit select mode first
  useEffect(() => {
    if (!selecting) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      return true;
    });
    const off = navigation.addListener?.('beforeRemove', (e) => {
      e.preventDefault();
      setSelected(null);
    });
    return () => {
      sub.remove();
      if (typeof off === 'function') off();
    };
  }, [selecting, navigation]);

  const finish = async (updated, note = '') => {
    exitSelect();
    await load();
    showSnackbar({
      text: `Updated ${updated} transaction${updated === 1 ? '' : 's'}${note ? ` · ${note}` : ''}`,
      duration: 10000,
      action: {
        label: 'Undo',
        onPress: async () => {
          const r = await undoLastBulk().catch(() => null);
          await load();
          showSnackbar({
            text: !r ? 'Nothing to undo' : r.skipped ? `Undone · ${r.skipped} changed since, kept` : 'Undone',
          });
        },
      },
    });
  };
  const runBulk = async (task) => {
    setSheet(null);
    try {
      await task();
    } catch (e) {
      Alert.alert('Could not update', e.message);
    }
  };
  const setCategoryAll = (category) =>
    runBulk(async () => {
      const el = eligibleFor(rows, ids);
      const { updated } = await bulkApply(
        el.ids,
        { category: { from: '', to: category } },
        { force: true, kind: 'category' }
      );
      await finish(updated, el.note);
    });
  const setAccountAll = (accId) =>
    runBulk(async () => {
      const acc = accounts.find((a) => String(a.id) === String(accId));
      const el = eligibleFor(rows, ids);
      const { updated } = await bulkSet(el.ids, { accountId: acc.id, account: acc.name }, 'account');
      await finish(updated, el.note);
    });
  const tagAll = (text, remove = false) =>
    runBulk(async () => {
      const change = tagChange(text, remove);
      if (!change) return;
      const { updated } = await bulkApply(ids, change, { kind: 'tag' });
      await finish(updated);
    });
  const renameAll = (name) =>
    runBulk(async () => {
      const { updated } = await bulkApply(
        ids,
        { name: { from: '', to: name.trim() } },
        { force: true, kind: 'name' }
      );
      await finish(updated);
    });
  const reports = reportsAction(rows, ids);
  const toggleReports = () =>
    runBulk(async () => {
      const { updated } = await bulkSet(ids, { excludeFromReports: reports.exclude }, 'reports');
      await finish(updated);
    });
  const deleteAll = () =>
    Alert.alert(`Delete ${nSel} transaction${nSel === 1 ? '' : 's'}?`, 'Their files are deleted too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          runBulk(async () => {
            await bulkDelete(ids);
            exitSelect();
            await load();
            showSnackbar({ text: `Deleted ${nSel} transaction${nSel === 1 ? '' : 's'}` });
          }),
      },
    ]);
  const onMore = (v) => {
    setSheet(v === 'rename' ? 'bulk-rename' : null);
    if (v === 'csv' || v === 'xlsx')
      exportHistory(selectedRows(rows, ids), v === 'xlsx' ? 'xlsx' : undefined).catch((e) =>
        Alert.alert('Export failed', e.message)
      );
  };
  const shared = selecting ? sharedTags(rows, ids) : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {selecting ? (
        <ScreenHeader
          title={`${nSel} selected · ${formatMoney(selectionTotal(rows, ids))}`}
          backIcon="close"
          backLabel="Exit select mode"
          onBack={exitSelect}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelected(new Set(shown.map((x) => String(x.id))))}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm }}
              >
                <Text
                  style={{ color: t.primary, fontFamily: fonts.semibold, fontSize: 16 }}
                >{`Select all ${shown.length}`}</Text>
              </Pressable>
              <IconButton
                icon="ellipsis-vertical"
                label="More actions"
                onPress={() => setSheet('bulk-more')}
              />
            </View>
          }
        />
      ) : (
        <ScreenHeader
          title="Transactions"
          onBack={() => navigation.goBack()}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelected(new Set())}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm }}
              >
                <Text style={{ color: t.primary, fontFamily: fonts.semibold, fontSize: 16 }}>Select</Text>
              </Pressable>
              <IconButton icon="share-outline" label="Export transactions" onPress={onExport} />
            </View>
          }
        />
      )}
      <SectionList
        sections={sections}
        keyExtractor={(tx) => String(tx.id)}
        initialNumToRender={20}
        windowSize={10}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ marginTop: space.lg }}>
            {rows.length && filtered ? (
              <EmptyState
                icon="search-outline"
                title="No transactions match these filters"
                action={{
                  label: 'Clear filters',
                  onPress: () => setQuery((q) => ({ ...defaultQuery(), sort: q.sort })),
                }}
              />
            ) : (
              <EmptyState
                icon="search-outline"
                title="No transactions yet"
                body="Add one from Home, or turn on bank SMS in Settings."
              />
            )}
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.title ? (
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
          ) : null
        }
        renderItem={({ item, index, section }) => {
          const first = index === 0;
          const last = index === section.data.length - 1;
          return (
            <View
              style={{
                backgroundColor: selecting && selected.has(String(item.id)) ? t.primarySoft : t.card,
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
                showDate={flat}
                selected={selecting ? selected.has(String(item.id)) : null}
                onPress={() =>
                  selecting
                    ? toggle(item.id)
                    : navigation.navigate('TransactionDetail', { transaction: item })
                }
                onLongPress={() => (selecting ? toggle(item.id) : setSelected(new Set([String(item.id)])))}
              />
            </View>
          );
        }}
      />
      <FilterSheet
        visible={sheet === 'filters'}
        query={query}
        rows={rows}
        accounts={accounts}
        categories={categories}
        asOf={asOf}
        onClose={() => setSheet(null)}
        onApply={(q) => {
          setSheet(null);
          if (q.sort !== query.sort) Storage.setItem(SORT_KEY, q.sort).catch(() => {});
          setQuery(q);
        }}
      />
      <OptionSheet
        visible={sheet === 'sort'}
        title="Sort by"
        value={query.sort}
        options={SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
        onSelect={(s) => {
          setSheet(null);
          setSort(s);
        }}
        onClose={() => setSheet(null)}
      />
      {selecting ? (
        <ActionBar
          t={t}
          actions={[
            {
              label: 'Category',
              icon: 'grid-outline',
              disabled: !nSel,
              onPress: () => setSheet('bulk-category'),
            },
            { label: 'Tag', icon: 'pricetags-outline', disabled: !nSel, onPress: () => setSheet('bulk-tag') },
            {
              label: 'Account',
              icon: 'card-outline',
              disabled: !nSel,
              onPress: () => setSheet('bulk-account'),
            },
            { label: reports.label, icon: 'ban-outline', disabled: !nSel, onPress: toggleReports },
            { label: 'Delete', icon: 'trash-outline', danger: true, disabled: !nSel, onPress: deleteAll },
          ]}
        />
      ) : null}
      <OptionSheet
        visible={sheet === 'bulk-category'}
        title={`Category for ${nSel}`}
        options={categories.map((c) => ({ value: c, label: c }))}
        onSelect={setCategoryAll}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'bulk-account'}
        title={`Account for ${nSel}`}
        options={accounts
          .filter((a) => SPENDABLE.includes(a.type))
          .map((a) => ({ value: String(a.id), label: shortAccountName(a.name, a.last4), sublabel: a.type }))}
        onSelect={setAccountAll}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'bulk-more'}
        title="More"
        options={[
          { value: 'rename', label: 'Rename payee…' },
          { value: 'csv', label: 'Export selected (CSV)' },
          { value: 'xlsx', label: 'Export selected (Excel)' },
        ]}
        onSelect={onMore}
        onClose={() => setSheet(null)}
      />
      <TextSheet
        visible={sheet === 'bulk-tag'}
        title={`Tag ${nSel} transaction${nSel === 1 ? '' : 's'}`}
        label="Tag to add"
        placeholder="#tax-2026"
        action="Add tag"
        onSubmit={(text) => tagAll(text)}
        onClose={() => setSheet(null)}
        extra={
          shared.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.md }}>
              {shared.map((g) => (
                <Chip
                  key={g}
                  tone="tag"
                  label={`Remove #${normalizeTag(g)}`}
                  onPress={() => tagAll(g, true)}
                />
              ))}
            </View>
          ) : null
        }
      />
      <TextSheet
        visible={sheet === 'bulk-rename'}
        title={`Rename payee for ${nSel}`}
        label="Payee name"
        placeholder="Swiggy Instamart"
        action="Rename"
        onSubmit={renameAll}
        onClose={() => setSheet(null)}
      />
    </SafeAreaView>
  );
}
