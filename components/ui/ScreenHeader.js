/** ScreenHeader: back/close button, title (Space Grotesk), optional right-side actions. */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { fonts, space } from '../tokens';

export const IconButton = ({ icon, label, onPress, color, testID }) => {
  const t = useTokens();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={24} color={color || t.text} />
    </Pressable>
  );
};

export default function ScreenHeader({
  title,
  onBack,
  backIcon = 'chevron-back',
  backLabel = 'Back',
  right,
}) {
  const t = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: space.md,
        paddingTop: space.sm,
        paddingBottom: space.sm,
      }}
    >
      {onBack ? <IconButton icon={backIcon} label={backLabel} onPress={onBack} /> : null}
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{
          flex: 1,
          color: t.text,
          fontFamily: fonts.display,
          fontSize: 24,
          marginLeft: onBack ? space.xs : space.sm,
        }}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}
