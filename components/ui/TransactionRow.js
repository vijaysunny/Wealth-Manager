/**
 * TransactionRow (C5.1/C5.2): icon, payee, account chip, category, paperclip when files are
 * attached, user tags (blue, one line), amount. Transfers are muted and show "from → to";
 * a possible self-transfer shows a hint.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { fonts, radius, space } from '../tokens';
import MoneyText from './MoneyText';
import { getCategoryIcon } from '../../utils/icons';
import { visibleTags } from '../../utils/Tags';
import { shortAccountName } from '../../utils/TransactionList';
import { payeeOf } from '../../utils/PayeeMatch';

// A5: the payee comes first (shared with PayeeMatch, which groups rows by it).
export { payeeOf };

/** The outline variant of an Ionicons name when the font has one (design: outline icons). */
export const outlineIcon = (name) => {
  const map = Ionicons.glyphMap || {};
  const base = String(name || 'pricetag').replace(/-outline$/, '');
  return map[`${base}-outline`] !== undefined ? `${base}-outline` : base;
};

/** Account chip text: "Axis ••0973", or "Axis ••0973 → UPI Lite" for a transfer. */
export const accountChip = (tx, accountsById = {}) => {
  const acc = accountsById[String(tx.accountId)];
  const from = shortAccountName(acc?.name || tx.account, acc?.last4 || tx.last4);
  if (tx.type !== 'transfer' || !tx.toAccount) return from;
  const toAcc = accountsById[String(tx.toAccountId)];
  return `${from} → ${shortAccountName(toAcc?.name || tx.toAccount, toAcc?.last4)}`;
};

const shortDate = (tx) => {
  const d = new Date(tx.fullDate);
  return Number.isNaN(d.getTime())
    ? tx.date
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export default function TransactionRow({ tx, onPress, accountsById, showDate = false, divider = true }) {
  const t = useTokens();
  const transfer = tx.type === 'transfer';
  const icon = tx.customIcon ? { name: tx.customIcon } : getCategoryIcon(tx.category);
  const tags = visibleTags(tx.tags);
  const files = Array.isArray(tx.attachments) ? tx.attachments.length : 0;
  const chip = accountChip(tx, accountsById);
  const payee = payeeOf(tx);
  // B2: a flat list (sorted by amount or payee) shows the date first: "9 Nov · Food"
  const sub = [showDate ? shortDate(tx) : null, transfer ? null : tx.category].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${payee}, ${tx.amount}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: space.md,
        borderBottomWidth: divider ? 1 : 0,
        borderColor: t.divider,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.md,
          backgroundColor: transfer ? t.divider : t.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: space.md,
        }}
      >
        {transfer ? (
          <Ionicons name="swap-horizontal" size={20} color={t.muted} />
        ) : tx.category || tx.customIcon ? (
          <Ionicons name={outlineIcon(icon.name)} size={20} color={t.primary} />
        ) : (
          <Text style={{ color: t.primary, fontFamily: fonts.semibold, fontSize: 16 }}>
            {payee.charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, paddingRight: space.sm }}>
        <Text numberOfLines={1} style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}>
          {payee}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
          {chip ? (
            <View
              style={{
                backgroundColor: t.divider,
                borderRadius: 6,
                paddingHorizontal: 6,
                paddingVertical: 2,
                marginRight: space.sm,
                maxWidth: '100%',
              }}
            >
              <Text numberOfLines={1} style={{ color: t.text2, fontFamily: fonts.medium, fontSize: 12 }}>
                {chip}
              </Text>
            </View>
          ) : null}
          {sub ? (
            <Text numberOfLines={1} style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>
              {sub}
            </Text>
          ) : null}
          {files > 0 ? (
            <Ionicons
              testID="has-file"
              accessibilityLabel={`${files} file${files === 1 ? '' : 's'}`}
              name="attach"
              size={16}
              color={t.muted}
              style={{ marginLeft: space.xs }}
            />
          ) : null}
        </View>
        {tags.length ? (
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: t.primary, fontFamily: fonts.medium, fontSize: 13, marginTop: 4 }}
          >
            {tags.map((g) => `#${g}`).join(' ')}
          </Text>
        ) : null}
        {tx.transferCandidate && tx.type === 'expense' ? (
          <Text style={{ color: t.warnText, fontFamily: fonts.medium, fontSize: 12, marginTop: 4 }}>
            Self-transfer?
          </Text>
        ) : null}
      </View>
      <MoneyText amount={tx.amount} type={tx.type} />
    </Pressable>
  );
}
