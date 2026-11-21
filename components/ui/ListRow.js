/**
 * ListRow (C3): label on the left, value/right on the right; min height 52; optional chevron.
 * Use `divider` for an inset (16) divider under the row inside a Card.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { fonts, space, sizes } from '../tokens';

export default function ListRow({
  label,
  value,
  sublabel,
  left,
  right,
  onPress,
  chevron = !!onPress,
  divider = false,
  labelWidth,
  accessibilityLabel,
  testID,
}) {
  const t = useTokens();
  const body = (
    <View
      style={{
        minHeight: sizes.row,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: space.md,
        borderBottomWidth: divider ? 1 : 0,
        borderColor: t.divider,
      }}
    >
      {left ? <View style={{ marginRight: space.md }}>{left}</View> : null}
      <View style={labelWidth ? { width: labelWidth } : { flex: 1, paddingRight: space.sm }}>
        <Text style={{ color: labelWidth ? t.muted : t.text, fontFamily: fonts.body, fontSize: 16 }}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13, marginTop: 2 }}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      {value !== undefined && value !== null ? (
        typeof value === 'string' || typeof value === 'number' ? (
          <Text
            numberOfLines={1}
            style={{
              flex: labelWidth ? 1 : 0,
              color: labelWidth ? t.text : t.muted,
              fontFamily: labelWidth ? fonts.semibold : fonts.body,
              fontSize: 16,
            }}
          >
            {value}
          </Text>
        ) : (
          <View style={{ flex: labelWidth ? 1 : 0 }}>{value}</View>
        )
      ) : null}
      {right}
      {chevron ? (
        <Ionicons name="chevron-forward" size={20} color={t.muted} style={{ marginLeft: space.sm }} />
      ) : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel || [label, typeof value === 'string' ? value : null].filter(Boolean).join(', ')
      }
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}
