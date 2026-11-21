/** Segmented control (plan C3): options [{ value, label }], one selected. */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTokens } from '../Theme';
import { radius, space } from '../tokens';

export default function Segmented({ options, value, onChange, style }) {
  const t = useTokens();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        { flexDirection: 'row', backgroundColor: t.divider, borderRadius: radius.md, padding: space.xs },
        style,
      ]}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.sm,
              backgroundColor: selected ? t.card : 'transparent',
            }}
          >
            <Text
              style={{ color: selected ? (o.color ?? t.text) : t.muted, fontWeight: '600', fontSize: 15 }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
