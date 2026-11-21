/** EmptyState (C3): icon, title, readable body and an optional action. */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { fonts, radius, space } from '../tokens';
import AppButton from './AppButton';

export default function EmptyState({ icon = 'sparkles-outline', title, body, action, testID }) {
  const t = useTokens();
  return (
    <View
      testID={testID}
      style={{
        alignItems: 'center',
        backgroundColor: t.card,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: radius.lg,
        padding: space.xxl,
        marginBottom: space.md,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: t.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space.md,
        }}
      >
        <Ionicons name={icon} size={26} color={t.primary} />
      </View>
      {title ? (
        <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20, textAlign: 'center' }}>
          {title}
        </Text>
      ) : null}
      {body ? (
        <Text
          style={{
            color: t.text2,
            fontFamily: fonts.body,
            fontSize: 15,
            lineHeight: 22,
            textAlign: 'center',
            marginTop: space.sm,
          }}
        >
          {body}
        </Text>
      ) : null}
      {action ? (
        <AppButton
          title={action.label}
          icon={action.icon}
          style={{ marginTop: space.lg, alignSelf: 'stretch' }}
          onPress={action.onPress}
        />
      ) : null}
    </View>
  );
}
