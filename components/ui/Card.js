/** Card (plan C3): white surface, token border, radius 16. */
import React from 'react';
import { View } from 'react-native';
import { useTokens } from '../Theme';
import { radius, space } from '../tokens';

export default function Card({ children, padding = space.lg, style, testID }) {
  const t = useTokens();
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: t.card,
          borderColor: t.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          padding,
          marginBottom: space.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
