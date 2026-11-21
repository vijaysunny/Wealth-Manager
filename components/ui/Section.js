/** Section (C3): overline title with an optional action on the right, then children. */
import React from 'react';
import { Text, View } from 'react-native';
import { useTokens } from '../Theme';
import { type, space } from '../tokens';

export default function Section({ title, action, children, style }) {
  const t = useTokens();
  return (
    <View style={[{ marginTop: space.lg }, style]}>
      {title || action ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: space.sm,
            paddingHorizontal: space.sm,
          }}
        >
          <Text accessibilityRole="header" style={[type.overline, { color: t.muted }]}>
            {title}
          </Text>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}
