/** OptionSheet: bottom sheet with a title and a list of choices (account, category, …). */
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { fonts, radius, space } from '../tokens';

export default function OptionSheet({ visible, title, options = [], value, onSelect, onClose, footer }) {
  const t = useTokens();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(14,23,38,0.45)' }}
      />
      <View
        style={{
          backgroundColor: t.card,
          borderTopLeftRadius: radius.xxl,
          borderTopRightRadius: radius.xxl,
          paddingHorizontal: space.xl,
          paddingTop: space.lg,
          paddingBottom: space.xxl,
          maxHeight: '70%',
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: t.text, fontFamily: fonts.display, fontSize: 20, marginBottom: space.sm }}
        >
          {title}
        </Text>
        <ScrollView>
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <Pressable
                key={String(o.value)}
                accessibilityRole="button"
                accessibilityLabel={o.label}
                accessibilityState={{ selected }}
                onPress={() => onSelect(o.value)}
                style={{
                  minHeight: 52,
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderBottomWidth: 1,
                  borderColor: t.divider,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: t.text,
                      fontFamily: selected ? fonts.semibold : fonts.body,
                      fontSize: 16,
                    }}
                  >
                    {o.label}
                  </Text>
                  {o.sublabel ? (
                    <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}>{o.sublabel}</Text>
                  ) : null}
                </View>
                {selected ? <Ionicons name="checkmark" size={22} color={t.primary} /> : null}
              </Pressable>
            );
          })}
          {footer}
        </ScrollView>
      </View>
    </Modal>
  );
}
