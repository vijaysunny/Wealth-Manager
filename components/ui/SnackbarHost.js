/** SnackbarHost (Phase 14 A3): one message at a time at the bottom of the app, with an optional action. */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTokens } from '../Theme';
import { fonts, radius, space } from '../tokens';
import { subscribeSnackbar } from '../../utils/Snackbar';

export default function SnackbarHost() {
  const t = useTokens();
  const [msg, setMsg] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    const off = subscribeSnackbar((m) => {
      clearTimeout(timer.current);
      setMsg(m);
      timer.current = setTimeout(() => setMsg(null), m.duration);
    });
    return () => {
      off();
      clearTimeout(timer.current);
    };
  }, []);
  if (!msg) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: 96 }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          backgroundColor: t.ink,
          borderRadius: radius.md,
          paddingHorizontal: space.lg,
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text style={{ flex: 1, color: '#FFFFFF', fontFamily: fonts.body, fontSize: 15 }}>{msg.text}</Text>
        {msg.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={msg.action.label}
            hitSlop={8}
            onPress={() => {
              clearTimeout(timer.current);
              setMsg(null);
              msg.action.onPress();
            }}
            style={{ minHeight: 44, justifyContent: 'center', paddingLeft: space.lg }}
          >
            <Text style={{ color: t.inkMuted, fontFamily: fonts.semibold, fontSize: 15 }}>
              {msg.action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
