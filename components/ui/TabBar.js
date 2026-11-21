/**
 * TabBar (C3/C4): custom bottom tab bar for @react-navigation/bottom-tabs. 5 tabs, height 80,
 * outline icons, active colour = primary. Pass as <Tab.Navigator tabBar={(p) => <TabBar {...p} />}>.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../Theme';
import { fonts, sizes } from '../tokens';

export const TAB_ICONS = {
  HomeTab: 'home-outline',
  AccountsTab: 'card-outline',
  BudgetTab: 'pie-chart-outline',
  GoalTab: 'flag-outline',
  SettingsTab: 'settings-outline',
};

export default function TabBar({ state, descriptors, navigation }) {
  const t = useTokens();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        height: sizes.tabBar,
        backgroundColor: t.card,
        borderTopWidth: 1,
        borderColor: t.border,
        paddingBottom: 8,
      }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = options.title || route.name;
        const color = focused ? t.primary : t.muted;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            onPress={onPress}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={TAB_ICONS[route.name] || 'ellipse-outline'} size={22} color={color} />
            <Text
              style={{
                color,
                fontFamily: focused ? fonts.semibold : fonts.medium,
                fontSize: 12,
                marginTop: 4,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
