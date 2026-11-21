/**
 * Banner (plan C3): tone 'warn' | 'danger' | 'info', title, body, optional action
 * { label, onPress }. Used for backup, SMS-blocked and review notices.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { radius, space } from '../tokens';
import AppButton from './AppButton';

const TONES = {
  warn: { bg: 'warnBg', border: 'warnBorder', fg: 'warnText', icon: 'warning-outline' },
  danger: { bg: 'dangerBg', border: 'dangerBorder', fg: 'dangerText', icon: 'alert-circle-outline' },
  info: { bg: 'primarySoft', border: 'border', fg: 'text', icon: 'information-circle-outline' },
};

export default function Banner({ tone = 'info', title, body, action, testID, style }) {
  const t = useTokens();
  const c = TONES[tone] || TONES.info;
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[
        {
          backgroundColor: t[c.bg],
          borderColor: t[c.border],
          borderWidth: 1,
          borderRadius: radius.lg,
          padding: space.lg,
          marginBottom: space.md,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row' }}>
        <Ionicons name={c.icon} size={22} color={t[c.fg]} style={{ marginRight: space.md, marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          {title ? <Text style={{ color: t[c.fg], fontSize: 17, fontWeight: '700' }}>{title}</Text> : null}
          {body ? (
            <Text style={{ color: t[c.fg], fontSize: 15, lineHeight: 21, marginTop: 2 }}>{body}</Text>
          ) : null}
        </View>
      </View>
      {action ? (
        <AppButton
          title={action.label}
          variant={tone === 'danger' ? 'dangerSolid' : 'primary'}
          style={{ marginTop: space.md }}
          onPress={action.onPress}
        />
      ) : null}
    </View>
  );
}
