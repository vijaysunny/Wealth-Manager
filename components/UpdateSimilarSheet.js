/**
 * UpdateSimilarSheet (Phase 14 A3, docs/design/18-update-similar.png).
 * After the owner changes a transaction's payee, category or tags: copy the ticked changes to the
 * same payee's other transactions (and, optionally, future ones). Back = "Only this one".
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from './Theme';
import { fonts, radius, space } from './tokens';
import { AppButton, AppSwitch } from './ui';
import { willChangeFor } from '../utils/PayeeMatch';
import { visibleTags } from '../utils/Tags';
import { formatMoney } from '../utils/Format';

const PREVIEW = 3;
const FIELD_LABEL = { name: 'Payee', category: 'Category', tags: 'Tags' };

/** The changes still ticked. */
export const tickedChanges = (changes, ticked) =>
  Object.fromEntries(Object.entries(changes).filter(([k]) => ticked[k]));

/** Ids of ticked rows that at least one ticked change would alter. */
export const rowsToUpdate = (matches, changes, ticked, unticked) => {
  const ch = tickedChanges(changes, ticked);
  return matches.filter((m) => !unticked.has(String(m.id)) && willChangeFor(m, ch).length).map((m) => m.id);
};

/** "SWIGGY INST: rename to Swiggy Instamart · Food · #groceries" */
export const ruleSummary = (oldName, ch) =>
  `${oldName}: ${[
    ch.name ? `rename to ${ch.name.to}` : null,
    ch.category ? ch.category.to : null,
    ...(ch.tags ? ch.tags.add.map((g) => `#${g}`) : []),
    ...(ch.tags ? ch.tags.remove.map((g) => `no #${g}`) : []),
  ]
    .filter(Boolean)
    .join(' · ')}`;

const Check = ({ on, round, label, onPress, t }) => (
  <Pressable
    accessibilityRole="checkbox"
    accessibilityLabel={label}
    accessibilityState={{ checked: on }}
    hitSlop={8}
    onPress={onPress}
    style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
  >
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: round ? 12 : 6,
        borderWidth: 2,
        borderColor: on ? t.primary : t.inputBorder,
        backgroundColor: on ? t.primary : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? <Ionicons name="checkmark" size={16} color={t.onPrimary} /> : null}
    </View>
  </Pressable>
);

export default function UpdateSimilarSheet({
  visible,
  result,
  oldName,
  onOnlyThis,
  onUpdate,
  busy = false,
  showFuture = true, // false: "Apply to past transactions now" from the rules screen (the rule exists)
}) {
  const t = useTokens();
  const changes = useMemo(() => result?.changes || {}, [result]);
  const matches = useMemo(() => result?.matches || [], [result]);
  const [ticked, setTicked] = useState({});
  const [unticked, setUnticked] = useState(new Set());
  const [expanded, setExpanded] = useState(false);
  const [future, setFuture] = useState(true);
  useEffect(() => {
    setTicked(Object.fromEntries(Object.keys(changes).map((k) => [k, true])));
    setUnticked(new Set());
    setExpanded(false);
    setFuture(true);
  }, [changes]);

  const ids = rowsToUpdate(matches, changes, ticked, unticked);
  const n = ids.length;
  const ch = tickedChanges(changes, ticked);
  const anyTicked = Object.keys(ch).length > 0;
  const shown = expanded ? matches : matches.slice(0, PREVIEW);
  const more = matches.length - shown.length;
  const loans = (result?.skipped || []).filter((s) => s.reason === 'loan').length;
  const kept = ch.category ? result?.keptCategory || 0 : 0;
  const notes = [
    more > 0 ? `+ ${more} more` : null,
    kept ? `${kept} with a category you set by hand keeps it` : null,
    loans ? `${loans} skipped (loan payments)` : null,
  ].filter(Boolean);

  const toggleRow = (id) => {
    const next = new Set(unticked);
    if (next.has(String(id))) next.delete(String(id));
    else next.add(String(id));
    setUnticked(next);
  };

  const changeValue = (k) => {
    const c = changes[k];
    if (k === 'tags')
      return (
        <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16, flexShrink: 1 }}>
          {[...c.add.map((g) => `+ #${g}`), ...c.remove.map((g) => `− #${g}`)].join('  ')}
        </Text>
      );
    return (
      <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16, flexShrink: 1 }}>
        {c.from ? (
          <Text style={{ color: t.muted, fontFamily: fonts.body, textDecorationLine: 'line-through' }}>
            {c.from}{' '}
          </Text>
        ) : null}
        {c.to}
      </Text>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onOnlyThis}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onOnlyThis}
        style={{ flex: 1, backgroundColor: 'rgba(14,23,38,0.45)' }}
      />
      <View
        style={{
          backgroundColor: t.card,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
          paddingHorizontal: space.xl,
          paddingTop: space.lg,
          paddingBottom: space.xxl,
          maxHeight: '90%',
        }}
      >
        <ScrollView>
          <Text
            accessibilityRole="header"
            style={{ color: t.text, fontFamily: fonts.display, fontSize: 22, marginBottom: space.xs }}
          >
            {showFuture ? `Apply to ${n} more from this payee?` : `Apply to ${n} past transactions?`}
          </Text>
          <Text style={{ color: t.text2, fontFamily: fonts.body, fontSize: 15, marginBottom: space.lg }}>
            Other transactions from <Text style={{ fontFamily: fonts.semibold }}>{oldName}</Text>. Pick which
            of your changes to copy.
          </Text>

          <View
            style={{
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: radius.lg,
              paddingHorizontal: space.md,
              marginBottom: space.md,
            }}
          >
            {Object.keys(changes).map((k) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52 }}>
                <Check
                  t={t}
                  on={!!ticked[k]}
                  label={`Copy ${FIELD_LABEL[k].toLowerCase()} change`}
                  onPress={() => setTicked({ ...ticked, [k]: !ticked[k] })}
                />
                <Text style={{ width: 84, color: t.text2, fontFamily: fonts.medium, fontSize: 15 }}>
                  {FIELD_LABEL[k]}
                </Text>
                {changeValue(k)}
              </View>
            ))}
          </View>

          <View
            style={{
              backgroundColor: t.bg,
              borderRadius: radius.lg,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              marginBottom: space.md,
            }}
          >
            {shown.map((m) => {
              const tags = visibleTags(m.tags).map((g) => `#${g}`);
              return (
                <View
                  key={String(m.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52 }}
                >
                  <Check
                    t={t}
                    round
                    on={!unticked.has(String(m.id))}
                    label={`${m.date || ''} ${formatMoney(m.amount)}`}
                    onPress={() => toggleRow(m.id)}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 15 }}>{m.date}</Text>
                    <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }} numberOfLines={1}>
                      {['now ' + (m.category || '—'), ...tags].join(' · ')}
                    </Text>
                  </View>
                  <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 15 }}>
                    {formatMoney(m.amount)}
                  </Text>
                </View>
              );
            })}
            {notes.length ? (
              <Pressable
                accessibilityRole="button"
                disabled={more <= 0}
                onPress={() => setExpanded(true)}
                style={{ minHeight: 36, justifyContent: 'center' }}
              >
                <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>
                  {notes.join(' · ')}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {showFuture ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: t.border,
                borderRadius: radius.lg,
                paddingHorizontal: space.md,
                marginBottom: space.lg,
              }}
            >
              <AppSwitch
                testID="future-switch"
                label="Also for future SMS"
                sublabel={anyTicked ? ruleSummary(oldName, ch) : null}
                value={future && anyTicked}
                disabled={!anyTicked}
                onValueChange={setFuture}
              />
            </View>
          ) : null}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <AppButton
              title={showFuture ? 'Only this one' : 'Not now'}
              variant="secondary"
              size="lg"
              onPress={onOnlyThis}
            />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton
              title={`Update ${n}`}
              size="lg"
              loading={busy}
              disabled={!anyTicked || n === 0}
              onPress={() => onUpdate({ ids, changes: ch, future: showFuture && future && anyTicked })}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
