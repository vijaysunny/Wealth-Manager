/**
 * TransactionRow (C5.1/C5.2): icon, payee, account chip, category, paperclip when files are
 * attached, user tags (blue, one line), amount. Transfers are muted; a possible self-transfer
 * shows a hint.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { fonts, radius, space } from '../tokens';
import MoneyText from './MoneyText';
import { getCategoryIcon } from '../../utils/icons';
import { visibleTags } from '../../utils/Tags';

export const payeeOf = (tx) =>
  tx.merchant ||
  tx.counterparty ||
  tx.title ||
  tx.category ||
  (tx.type === 'transfer' ? 'Transfer' : 'Transaction');

/** The outline variant of an Ionicons name when the font has one (design: outline icons). */
export const outlineIcon = (name) => {
  const map = Ionicons.glyphMap || {};
  const base = String(name || 'pricetag').replace(/-outline$/, '');
  return map[`${base}-outline`] !== undefined ? `${base}-outline` : base;
};

const shortAccount = (name = '') => name.replace(/\s+Bank\b/i, '').replace(/\s+Credit Card\b/i, ' Card');

export default function TransactionRow({ tx, onPress, showDate = true, divider = true }) {
  const t = useTokens();
  const transfer = tx.type === 'transfer';
  const icon = tx.customIcon ? { name: tx.customIcon } : getCategoryIcon(tx.category);
  const tags = visibleTags(tx.tags);
  const files = Array.isArray(tx.attachments) ? tx.attachments.length : 0;
  const route =
    transfer && tx.toAccount ? `${shortAccount(tx.account)} → ${shortAccount(tx.toAccount)}` : null;
  const meta = [
    route || (tx.account ? shortAccount(tx.account) : null),
    transfer ? 'Transfer' : tx.category,
    showDate ? tx.date || String(tx.fullDate || '').slice(0, 10) : null,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${payeeOf(tx)}, ${tx.amount}`}
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
        <Ionicons
          name={transfer ? 'swap-horizontal' : outlineIcon(icon.name)}
          size={20}
          color={transfer ? t.muted : t.primary}
        />
      </View>
      <View style={{ flex: 1, paddingRight: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}
          >
            {payeeOf(tx)}
          </Text>
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
        <Text
          numberOfLines={1}
          style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13, marginTop: 2 }}
        >
          {meta.join(' · ')}
        </Text>
        {tags.length ? (
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: t.primary, fontFamily: fonts.medium, fontSize: 13, marginTop: 2 }}
          >
            {tags.map((g) => `#${g}`).join(' ')}
          </Text>
        ) : null}
        {tx.transferCandidate && tx.type === 'expense' ? (
          <Text style={{ color: t.warnText, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 }}>
            Self-transfer?
          </Text>
        ) : null}
      </View>
      <MoneyText amount={tx.amount} type={tx.type} />
    </Pressable>
  );
}
