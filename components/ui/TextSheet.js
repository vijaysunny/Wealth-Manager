/** TextSheet: a bottom sheet with one text field (B5 Tag / Rename payee, E4 Add person). */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useTokens } from '../Theme';
import { fonts, radius, space } from '../tokens';
import AppButton from './AppButton';

export default function TextSheet({
  visible,
  title,
  label,
  placeholder,
  action,
  extra,
  onSubmit,
  onClose,
  initial = '',
  autoCapitalize = 'none',
}) {
  const t = useTokens();
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);
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
          padding: space.xl,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: t.text, fontFamily: fonts.display, fontSize: 20, marginBottom: space.md }}
        >
          {title}
        </Text>
        <TextInput
          accessibilityLabel={label}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={t.placeholder}
          autoCapitalize={autoCapitalize}
          autoFocus
          onSubmitEditing={() => text.trim() && onSubmit(text)}
          style={{
            minHeight: 48,
            borderWidth: 1,
            borderColor: t.inputBorder,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            color: t.text,
            fontFamily: fonts.body,
            fontSize: 16,
            marginBottom: space.md,
          }}
        />
        <AppButton title={action} disabled={!text.trim()} onPress={() => onSubmit(text)} />
        {extra}
      </View>
    </Modal>
  );
}
