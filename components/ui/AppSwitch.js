/** AppSwitch (C3): React Native Switch with token colours and an always-visible label. */
import React from 'react';
import { Switch, Text, View } from 'react-native';
import { useTokens } from '../Theme';
import { fonts, space, sizes } from '../tokens';

export default function AppSwitch({ value, onValueChange, label, sublabel, disabled = false, testID }) {
  const t = useTokens();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: sizes.row, paddingVertical: space.sm }}
    >
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={{ color: disabled ? t.muted : t.text, fontFamily: fonts.body, fontSize: 16 }}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13, marginTop: 2 }}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={!!value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: t.switchOff, true: t.primary }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={t.switchOff}
      />
    </View>
  );
}
