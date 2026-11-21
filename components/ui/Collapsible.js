/**
 * Collapsible (C3): a card whose header row is a button. Closed by default; the content is not
 * rendered while closed. The chevron turns 180° when open; the height change is animated.
 */
import React, { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { fonts, radius, space } from '../tokens';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental)
  UIManager.setLayoutAnimationEnabledExperimental(true);

export default function Collapsible({
  title,
  summary,
  badge,
  left,
  defaultOpen = false,
  children,
  testID,
  style,
}) {
  const t = useTokens();
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: t.card,
          borderColor: t.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          marginBottom: space.md,
        },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, padding: space.lg }}
      >
        {left ? <View style={{ marginRight: space.md }}>{left}</View> : null}
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 17 }}>{title}</Text>
          {summary ? (
            <Text
              numberOfLines={1}
              style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}
            >
              {summary}
            </Text>
          ) : null}
        </View>
        {badge !== undefined && badge !== null && badge !== '' ? (
          <View
            style={{
              backgroundColor: t.primarySoft,
              borderRadius: radius.pill,
              paddingHorizontal: space.sm,
              minWidth: 28,
              height: 24,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: space.sm,
            }}
          >
            <Text style={{ color: t.primary, fontFamily: fonts.semibold, fontSize: 13 }}>{badge}</Text>
          </View>
        ) : null}
        <Ionicons
          name="chevron-down"
          size={20}
          color={t.muted}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {open ? <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>{children}</View> : null}
    </View>
  );
}
