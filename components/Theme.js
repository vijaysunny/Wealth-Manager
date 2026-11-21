import React, { createContext, useContext, useMemo, useState } from 'react';
import Storage from '../data/Storage';
import {
  View as NativeView,
  Text as NativeText,
  TextInput as NativeInput,
  ScrollView as NativeScroll,
  TouchableOpacity as NativeTouch,
  StyleSheet,
} from 'react-native';
import { SafeAreaView as NativeSafeArea } from 'react-native-safe-area-context';
import { tokens } from './tokens';
const ThemeContext = createContext({ dark: false, setDark: () => {}, t: null });
export const ThemeProvider = ({ children }) => {
  const [dark, setValue] = useState(false);
  React.useEffect(() => {
    Storage.getItem('dark_mode')
      .then((value) => setValue(value === 'true'))
      .catch(() => {});
  }, []);
  const setDark = async (value) => {
    await Storage.setItem('dark_mode', String(value));
    setValue(value);
  };
  const value = useMemo(() => ({ dark, setDark, t: dark ? tokens.dark : tokens.light }), [dark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
/**
 * { dark, setDark, t }: t is the token palette for the current mode (C2). Dark mode is opt-in
 * from Settings; the phone's system setting does not leak in (app.json pins light).
 */
export const useAppTheme = () => {
  const ctx = useContext(ThemeContext);
  return ctx.t ? ctx : { ...ctx, t: ctx.dark ? tokens.dark : tokens.light };
};
// LEGACY: guesses dark colours from the hard-coded light ones. The nine C5 screens use tokens;
// screens outside C5 (Expense, Income, Add/Edit asset, Import, Analytics, Recurring, Savings,
// MoneyTool, AddGoal, SearchAsset, Onboarding, AppLock, ...) still rely on it for dark mode.
// Delete it once those are moved to tokens.
const shade = (value, key) => {
  if (typeof value !== 'string' || !/^#[\da-f]{3,8}$/i.test(value)) return value;
  const full =
    value.length === 4
      ? value
          .slice(1)
          .split('')
          .map((c) => c + c)
          .join('')
      : value.slice(1, 7);
  if (full.length !== 6) return value;
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const neutral = Math.max(...channels) - Math.min(...channels) < 40;
  if (key.toLowerCase().includes('background') && Math.min(...channels) > 170) return '#20242B';
  if (key === 'color' && neutral && channels[0] < 180) return '#E4E7EB';
  if (key.toLowerCase().includes('border') && neutral) return '#555B66';
  return value;
};
export const useThemeStyles = (base) => {
  const { dark } = useAppTheme();
  return useMemo(
    () =>
      dark
        ? Object.fromEntries(
            Object.entries(base).map(([name, style]) => [
              name,
              Object.fromEntries(Object.entries(style).map(([key, value]) => [key, shade(value, key)])),
            ])
          )
        : base,
    [dark, base]
  );
};
const themed = (Component) =>
  function ThemedPrimitive(props) {
    const { dark } = useAppTheme();
    const map = (style) => {
      const flat = StyleSheet.flatten(style) || {};
      return dark
        ? Object.fromEntries(Object.entries(flat).map(([key, value]) => [key, shade(value, key)]))
        : flat;
    };
    const t = dark ? tokens.dark : tokens.light;
    const isText = Component === NativeText || Component === NativeInput;
    // Always set a text colour: with no colour, Android in system dark mode draws near-white text (A1).
    const defaults = isText ? { color: t.text } : {};
    return (
      <Component
        {...props}
        style={[defaults, map(props.style)]}
        contentContainerStyle={props.contentContainerStyle ? map(props.contentContainerStyle) : undefined}
        placeholderTextColor={
          Component === NativeInput ? (props.placeholderTextColor ?? t.placeholder) : undefined
        }
      />
    );
  };
export const Text = themed(NativeText),
  View = themed(NativeView),
  TextInput = themed(NativeInput),
  ScrollView = themed(NativeScroll),
  TouchableOpacity = themed(NativeTouch),
  SafeAreaView = themed(NativeSafeArea);
/** Token palette for the current theme (Phase 12 C2). */
export const useTokens = () => useAppTheme().t;
