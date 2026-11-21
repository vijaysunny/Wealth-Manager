/**
 * MoneyText (C3): signed rupee amount with Indian grouping. expense → "−₹1,998.19" in red,
 * income → "+₹500" in green, transfer → "₹12,511.38" muted (transfers are not spending).
 */
import React from 'react';
import { Text } from 'react-native';
import { useTokens } from '../Theme';
import { fonts } from '../tokens';
import { formatMoney } from '../../utils/Format';

export const moneyLabel = (amount, type) => {
  const body = formatMoney(Math.abs(Number(amount) || 0));
  if (type === 'expense') return `−${body}`;
  if (type === 'income') return `+${body}`;
  return Number(amount) < 0 ? `−${body}` : body;
};

export default function MoneyText({ amount, type, style, size = 16, testID }) {
  const t = useTokens();
  const color =
    type === 'expense' ? t.expense : type === 'income' ? t.income : type === 'transfer' ? t.muted : t.text;
  return (
    <Text
      testID={testID}
      numberOfLines={1}
      style={[{ color, fontFamily: fonts.semibold, fontSize: size }, style]}
    >
      {moneyLabel(amount, type)}
    </Text>
  );
}
