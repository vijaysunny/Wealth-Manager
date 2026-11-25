/**
 * Payee rules (Phase 14 A6): Settings → Categories → Payee rules. One line per rule
 * ("SWIGGY INST → Swiggy Instamart · Food · #groceries · used 14 times"), ⋯ for Edit /
 * Apply to past transactions now / Delete, and an Add rule sheet (a recent payee or "contains text").
 */
import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import {
  AppButton,
  Card,
  Chip,
  EmptyState,
  IconButton,
  OptionSheet,
  ScreenHeader,
  Segmented,
} from '../components/ui';
import UpdateSimilarSheet from '../components/UpdateSimilarSheet';
import { loadCategories } from './CategoriesScreen';
import { mergeRule, recentPayees, ruleLine, rulePreview } from '../utils/PayeeRules';
import { bulkApply, undoLastBulk } from '../utils/FeatureService';
import { showSnackbar } from '../utils/Snackbar';
import { normalizeTag } from '../utils/Tags';

const readRules = async () => JSON.parse((await Storage.getItem('category_rules')) || '[]');
const writeRules = (rules) => Storage.setItem('category_rules', JSON.stringify(rules));
const parseTags = (s) => [
  ...new Set(
    String(s)
      .split(/[,\s]+/)
      .map(normalizeTag)
      .filter(Boolean)
  ),
];

/** The rule the form describes (without id/createdAt/hits), or an error message. */
export const formToRule = (f) => {
  const tagsAdd = parseTags(f.tags);
  const rule =
    f.mode === 'payee'
      ? { kind: 'payee', payeeKey: f.payeeKey, label: f.payeeName || f.payeeKey }
      : { kind: 'contains', pattern: String(f.pattern || '').trim() };
  if (f.mode === 'payee' && !f.payeeKey) return { error: 'Pick a payee.' };
  if (f.mode !== 'payee' && !rule.pattern) return { error: 'Enter the text to look for.' };
  const rename = String(f.rename || '').trim();
  if (f.mode === 'payee' && rename) rule.rename = rename;
  if (f.category) rule.category = f.category;
  if (tagsAdd.length) rule.tagsAdd = tagsAdd;
  if (!rule.rename && !rule.category && !rule.tagsAdd)
    return { error: 'Choose a new name, a category or a tag.' };
  return { rule };
};

const emptyForm = {
  mode: 'payee',
  payeeKey: null,
  payeeName: '',
  pattern: '',
  rename: '',
  category: null,
  tags: '',
};
const fromRule = (r) => ({
  id: r.id,
  mode: r.kind === 'payee' ? 'payee' : 'contains',
  payeeKey: r.payeeKey || null,
  payeeName: r.label || r.payeeKey || '',
  pattern: r.pattern || '',
  rename: r.rename || '',
  category: r.category || null,
  tags: (r.tagsAdd || []).join(', '),
});

function Field({ label, t, ...input }) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={{ color: t.text2, fontFamily: fonts.medium, fontSize: 14, marginBottom: space.xs }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.placeholder}
        style={{
          minHeight: 48,
          borderWidth: 1,
          borderColor: t.inputBorder,
          borderRadius: radius.md,
          paddingHorizontal: space.md,
          backgroundColor: t.card,
          color: t.text,
          fontFamily: fonts.body,
          fontSize: 16,
        }}
        {...input}
      />
    </View>
  );
}

function RuleSheet({ form, setForm, payees, cats, onSave, onClose }) {
  const t = useTokens();
  const editing = !!form?.id;
  if (!form) return null;
  const set = (k, v) => setForm({ ...form, [k]: v });
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
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
          maxHeight: '90%',
        }}
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text
            accessibilityRole="header"
            style={{ color: t.text, fontFamily: fonts.display, fontSize: 22, marginBottom: space.md }}
          >
            {editing ? 'Edit rule' : 'Add rule'}
          </Text>
          {!editing ? (
            <Segmented
              options={[
                { value: 'payee', label: 'Payee' },
                { value: 'contains', label: 'Contains text' },
              ]}
              value={form.mode}
              onChange={(v) => set('mode', v)}
              style={{ marginBottom: space.md }}
            />
          ) : null}
          {form.mode === 'payee' ? (
            editing ? (
              <Text
                style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16, marginBottom: space.md }}
              >
                {form.payeeName}
              </Text>
            ) : (
              <View style={{ marginBottom: space.md }}>
                <Text
                  style={{ color: t.text2, fontFamily: fonts.medium, fontSize: 14, marginBottom: space.xs }}
                >
                  Recent payees
                </Text>
                {payees.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {payees.map((p) => (
                      <Chip
                        key={p.key}
                        label={p.name}
                        selected={form.payeeKey === p.key}
                        onPress={() => setForm({ ...form, payeeKey: p.key, payeeName: p.name })}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={{ color: t.muted, fontFamily: fonts.body }}>No payees yet.</Text>
                )}
              </View>
            )
          ) : (
            <Field
              t={t}
              label="Merchant, UPI ID or text contains"
              testID="rule-pattern"
              value={form.pattern}
              onChangeText={(v) => set('pattern', v)}
            />
          )}
          {form.mode === 'payee' ? (
            <Field
              t={t}
              label="Rename to"
              testID="rule-rename"
              placeholder="Keep the name"
              value={form.rename}
              onChangeText={(v) => set('rename', v)}
            />
          ) : null}
          <Text style={{ color: t.text2, fontFamily: fonts.medium, fontSize: 14, marginBottom: space.xs }}>
            Category
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.md }}>
            {cats.map((c) => (
              <Chip
                key={c}
                label={c}
                selected={form.category === c}
                onPress={() => set('category', form.category === c ? null : c)}
              />
            ))}
          </View>
          <Field
            t={t}
            label="Tags to add"
            testID="rule-tags"
            placeholder="groceries, work"
            autoCapitalize="none"
            value={form.tags}
            onChangeText={(v) => set('tags', v)}
          />
        </ScrollView>
        <AppButton title="Save rule" size="lg" onPress={onSave} />
      </View>
    </Modal>
  );
}

export default function PayeeRulesScreen({ navigation }) {
  const t = useTokens();
  const [rules, setRules] = useState([]);
  const [payees, setPayees] = useState([]);
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState(null);
  const [menu, setMenu] = useState(null); // the rule whose ⋯ menu is open
  const [preview, setPreview] = useState(null); // { rule, result } for "Apply to past transactions now"
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setRules(await readRules());
    setCats(await loadCategories());
    setPayees(recentPayees(await getAll()));
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => Alert.alert('Load error', e.message));
    }, [load])
  );

  const save = async () => {
    const { rule, error } = formToRule(form);
    if (error) return Alert.alert('Rule', error);
    const current = await readRules();
    let next;
    if (form.id)
      next = current.map((r) =>
        r.id === form.id ? { id: r.id, createdAt: r.createdAt, hits: r.hits || 0, ...rule } : r
      );
    else if (rule.kind === 'payee') next = mergeRule(current, rule).rules;
    else
      next = [
        ...current,
        { ...rule, id: `rule_${Date.now()}`, createdAt: new Date().toISOString(), hits: 0 },
      ];
    await writeRules(next);
    setRules(next);
    setForm(null);
  };

  const remove = (rule) =>
    Alert.alert('Delete rule?', 'Past transactions keep their names and categories.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const next = (await readRules()).filter((r) => r.id !== rule.id);
          await writeRules(next);
          setRules(next);
        },
      },
    ]);

  const applyPast = async (rule) => {
    const result = rulePreview(rule, await getAll());
    if (!result.matches.length)
      return Alert.alert('Nothing to change', 'Past transactions already match this rule.');
    setPreview({ rule, result });
  };
  const runApply = async ({ ids, changes }) => {
    setApplying(true);
    try {
      const { updated } = await bulkApply(ids, changes);
      setPreview(null);
      showSnackbar({
        text: `Updated ${updated} transaction${updated === 1 ? '' : 's'}`,
        duration: 10000,
        action: {
          label: 'Undo',
          onPress: async () => {
            const r = await undoLastBulk().catch(() => null);
            showSnackbar({
              text: !r
                ? 'Nothing to undo'
                : r.skipped
                  ? `Undone · ${r.skipped} changed since, kept`
                  : 'Undone',
            });
          },
        },
      });
    } catch (e) {
      Alert.alert('Could not update', e.message);
    } finally {
      setApplying(false);
    }
  };

  const onMenu = (action) => {
    const rule = menu;
    setMenu(null);
    if (action === 'edit') setForm(fromRule(rule));
    if (action === 'apply') applyPast(rule).catch((e) => Alert.alert('Could not load', e.message));
    if (action === 'delete') remove(rule);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        title="Payee rules"
        onBack={() => navigation.goBack()}
        right={<IconButton icon="add" label="Add rule" onPress={() => setForm({ ...emptyForm })} />}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginBottom: space.md }}>
          New SMS, statement and recurring transactions from these payees are renamed, categorised and tagged.
          A category or name you set by hand is never changed.
        </Text>
        {rules.length ? (
          <Card padding={0}>
            {rules.map((r, i) => (
              <View
                key={String(r.id ?? i)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingLeft: space.lg,
                  minHeight: 56,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: t.divider,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    color: t.text,
                    fontFamily: fonts.body,
                    fontSize: 15,
                    paddingVertical: space.md,
                  }}
                >
                  {ruleLine(r)}
                </Text>
                <IconButton
                  icon="ellipsis-vertical"
                  label={`Rule actions for ${r.label || r.payeeKey || r.pattern}`}
                  onPress={() => setMenu(r)}
                />
              </View>
            ))}
          </Card>
        ) : (
          <EmptyState
            icon="git-branch-outline"
            title="No payee rules yet"
            body="Change a transaction's payee, category or tags and keep “Also for future SMS” on, or add a rule here."
            action={{ label: 'Add rule', icon: 'add', onPress: () => setForm({ ...emptyForm }) }}
          />
        )}
      </ScrollView>
      <OptionSheet
        visible={!!menu}
        title={menu ? menu.label || menu.payeeKey || menu.pattern : ''}
        options={[
          { value: 'edit', label: 'Edit' },
          { value: 'apply', label: 'Apply to past transactions now' },
          { value: 'delete', label: 'Delete' },
        ]}
        onSelect={onMenu}
        onClose={() => setMenu(null)}
      />
      <RuleSheet
        form={form}
        setForm={setForm}
        payees={payees}
        cats={cats}
        onSave={save}
        onClose={() => setForm(null)}
      />
      <UpdateSimilarSheet
        visible={!!preview}
        result={preview?.result}
        oldName={preview ? preview.rule.label || preview.rule.pattern || '' : ''}
        showFuture={false}
        busy={applying}
        onOnlyThis={() => setPreview(null)}
        onUpdate={runApply}
      />
    </SafeAreaView>
  );
}
