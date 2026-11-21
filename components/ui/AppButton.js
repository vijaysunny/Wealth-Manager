/**
 * AppButton (plan C3/A10): replaces React Native's Button, which on Android renders as an
 * uppercase block with no margin. Normal case, 600 weight, token colours, min 44px tap target.
 */
import React from 'react';
import { Pressable, ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../Theme';
import { tokens, radius, space } from '../tokens';

const HEIGHT = { lg: 52, md: 44, sm: 36 };
const FONT = { lg: 16, md: 15, sm: 14 };

export const buttonColors = (variant, t) => {
  switch (variant) {
    case 'secondary':
      return { bg: t.card, pressed: t.primarySoft, border: t.inputBorder, fg: t.primary };
    case 'dashed':
      return { bg: t.card, pressed: t.primarySoft, border: t.primary, fg: t.primary, dashed: true };
    case 'danger':
      return { bg: t.dangerBg, pressed: t.dangerBorder, border: t.dangerBorder, fg: t.dangerText };
    default:
      return { bg: t.primary, pressed: t.primaryPressed, border: t.primary, fg: t.onPrimary };
  }
};

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  style,
  accessibilityLabel,
  testID,
}) {
  const { dark } = useAppTheme();
  const t = dark ? tokens.dark : tokens.light;
  const c = buttonColors(variant, t);
  const off = disabled || loading;
  const h = HEIGHT[size] || HEIGHT.md;
  // Small buttons stay 36 tall visually but get a 44px tap area.
  const slop = h < 44 ? Math.ceil((44 - h) / 2) : 0;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: off, busy: loading }}
      disabled={off}
      onPress={onPress}
      hitSlop={slop ? { top: slop, bottom: slop } : undefined}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: h,
          backgroundColor: pressed ? c.pressed : c.bg,
          borderColor: c.border,
          borderStyle: c.dashed ? 'dashed' : 'solid',
          opacity: off ? 0.5 : 1,
          paddingHorizontal: size === 'sm' ? space.md : space.lg,
        },
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator size="small" color={c.fg} style={styles.icon} />
        ) : icon ? (
          <Ionicons name={icon} size={size === 'sm' ? 16 : 20} color={c.fg} style={styles.icon} />
        ) : null}
        <Text style={[styles.label, { color: c.fg, fontSize: FONT[size] || FONT.md }]} numberOfLines={2}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: space.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  icon: { marginRight: space.sm },
  label: { fontWeight: '600', textAlign: 'center' },
});
