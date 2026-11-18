/**
 * App.js  — WealthManager v3.0
 * Android 16 (API 36) compatible
 * - Added ImportScreen to navigation stack
 * - Added SavingsScreen to navigation stack
 * - Added RecurringScreen for recurring transactions
 * - Graceful permission handling for Android 16
 */

import React, { useEffect } from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { AppState } from 'react-native';

// --- SCREENS ---
import HomeScreen from './screens/HomeScreen';
import IncomeScreen from './screens/IncomeScreen';
import ExpenseScreen from './screens/ExpenseScreen';
import WealthScreen from './screens/WealthScreen';
import AddAssetScreen from './screens/AddAssetScreen';
import SearchAssetScreen from './screens/SearchAssetScreen';
import AllTransactionsScreen from './screens/AllTransactionsScreen';
import EditTransactionScreen from './screens/EditTransactionScreen';
import SettingsScreen from './screens/SettingsScreen';
import BudgetScreen from './screens/BudgetScreen';
import GoalScreen from './screens/GoalScreen';
import AddGoalScreen from './screens/AddGoalScreen';
import AnalyticsScreen from './screens/AnalyticsScreen';
import EditAssetScreen from './screens/EditAssetScreen';
import ImportScreen from './screens/ImportScreen';
import SavingsScreen from './screens/SavingsScreen';
import RecurringScreen from './screens/RecurringScreen';

// --- UTILS ---
import { registerBackgroundSync } from './utils/BackgroundSync';
import { scheduleDailySummary } from './utils/NotificationService';
import { syncTrackingWithFlag, stopTracking } from './utils/SmsTracking';
import { syncSms } from './utils/SmsSync';
import { processRecurringTransactions } from './utils/RecurringEngine';

import Bootstrap from './components/Bootstrap';

import ToolsScreen from './screens/ToolsScreen';
import ErrorBoundary from './components/ErrorBoundary';
import AppLock from './components/AppLock';
import Onboarding from './components/Onboarding';
import { ThemeProvider, useAppTheme } from './components/Theme';
import Storage from './data/Storage';
import { saveNetWorthSnapshot } from './utils/FeatureService';
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#2196F3',
        tabBarInactiveTintColor: 'gray',
        tabBarStyle: { paddingBottom: 5, height: 60 },
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'HomeTab') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'WealthTab') iconName = focused ? 'wallet' : 'wallet-outline';
          else if (route.name === 'BudgetTab') iconName = focused ? 'pie-chart' : 'pie-chart-outline';
          else if (route.name === 'GoalTab') iconName = focused ? 'flag' : 'flag-outline';
          else if (route.name === 'SettingsTab') iconName = focused ? 'settings' : 'settings-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="WealthTab" component={WealthScreen} options={{ title: 'Wealth' }} />
      <Tab.Screen name="BudgetTab" component={BudgetScreen} options={{ title: 'Budget' }} />
      <Tab.Screen name="GoalTab" component={GoalScreen} options={{ title: 'Goals' }} />
      <Tab.Screen name="SettingsTab" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

function AppContent() {
  const { dark } = useAppTheme();
  // The database is already open: Bootstrap (outermost) is the only startup gate (B5).
  useEffect(() => {
    // Foreground catch-up: the real-time listener misses messages while the app is killed,
    // so every time the app starts or returns to the foreground we re-apply the saved
    // Auto-Tracking flag and scan from last_bg_sync_time.
    const catchUp = async () => {
      try {
        if ((await Storage.getItem('onboarding_complete')) !== 'true') return;
        await syncTrackingWithFlag();
        await syncSms();
        await processRecurringTransactions();
        await saveNetWorthSnapshot();
      } catch (err) {
        console.warn('Catch-up error:', err);
      }
    };

    async function setupApp() {
      // Schedule daily summary notification
      scheduleDailySummary();

      // Register background sync (polls Gmail + processes budgets)
      registerBackgroundSync();

      // Listener flag + SMS catch-up + due recurring transactions
      await catchUp();
    }

    setupApp().catch((error) => console.warn('Startup tasks failed:', error?.message || error));

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });

    return () => {
      appStateSub.remove();
      stopTracking();
    };
  }, []);

  return (
    <NavigationContainer theme={dark ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <Stack.Navigator initialRouteName="Main">
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Tools" component={ToolsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Analytics" component={AnalyticsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Income" component={IncomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Expense" component={ExpenseScreen} options={{ headerShown: false }} />
        <Stack.Screen name="AddAsset" component={AddAssetScreen} options={{ headerShown: false }} />
        <Stack.Screen name="EditAsset" component={EditAssetScreen} options={{ headerShown: false }} />
        <Stack.Screen name="SearchAsset" component={SearchAssetScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="AllTransactions"
          component={AllTransactionsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="EditTransaction"
          component={EditTransactionScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen name="AddGoal" component={AddGoalScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Import" component={ImportScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Savings" component={SavingsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Recurring" component={RecurringScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <Bootstrap>
        <ThemeProvider>
          <AppLock>
            <Onboarding>
              <AppContent />
            </Onboarding>
          </AppLock>
        </ThemeProvider>
      </Bootstrap>
    </ErrorBoundary>
  );
}
