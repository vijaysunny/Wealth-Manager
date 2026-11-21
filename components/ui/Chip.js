/**
 * Chip (C3): account/tag/filter chip. The label and the optional remove control are sibling
 * buttons (never nested), the remove target is 28px with slop to 44.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { fonts, radius, space } from '../tokens';

export default function Chip({ label, selected = false, onPress, onRemove, icon, tone = 'default', testID }) {
  const t = useTokens();
  const tag = tone === 'tag';
  const bg = selected ? t.primary : tag ? t.primarySoft : t.card;
  const fg = selected ? t.onPrimary : tag ? t.primary : t.text;
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36 }}>
      {icon ? <Ionicons name={icon} size={16} color={fg} style={{ marginRight: space.xs }} /> : null}
      <Text numberOfLines={1} style={{ color: fg, fontFamily: fonts.medium, fontSize: 14 }}>
        {label}
      </Text>
    </View>
  );
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: space.md,
        paddingRight: onRemove ? space.xs : space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? t.primary : tag ? t.primarySoft : t.inputBorder,
        backgroundColor: bg,
        marginRight: space.sm,
        marginBottom: space.sm,
      }}
    >
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected }}
          onPress={onPress}
          hitSlop={{ top: 4, bottom: 4 }}
        >
          {inner}
        </Pressable>
      ) : (
        inner
      )}
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          onPress={onRemove}
          hitSlop={8}
          style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}
        >
          <Ionicons name="close" size={16} color={fg} />
        </Pressable>
      ) : null}
    </View>
  );
}
