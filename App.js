/**
 * App.js  — WealthManager v3.0
 * Android 16 (API 36) compatible
 * - Added ImportScreen to navigation stack
 * - Added SavingsScreen to navigation stack
 * - Added RecurringScreen for recurring transactions
 * - Graceful permission handling for Android 16
 */

import React, { useEffect, useMemo, useState } from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import TabBar from './components/ui/TabBar';
import { AppState, InteractionManager } from 'react-native';

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
import ReviewAccountsScreen from './screens/ReviewAccountsScreen';
import ScanSmsScreen from './screens/ScanSmsScreen';
import BackupScreen from './screens/BackupScreen';
import CategoriesScreen from './screens/CategoriesScreen';

// --- UTILS ---
import { registerBackgroundSync } from './utils/BackgroundSync';
import { scheduleDailySummary } from './utils/NotificationService';
import { syncTrackingWithFlag, stopTracking } from './utils/SmsTracking';
import { syncSms } from './utils/SmsSync';
import { processRecurringTransactions } from './utils/RecurringEngine';

import Bootstrap from './components/Bootstrap';

import ToolsScreen from './screens/ToolsScreen';
import AiAssistantScreen from './screens/AiAssistantScreen';
import ErrorBoundary from './components/ErrorBoundary';
import AppLock from './components/AppLock';
import Onboarding from './components/Onboarding';
import { ThemeProvider, useAppTheme } from './components/Theme';
import Storage from './data/Storage';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { saveNetWorthSnapshot } from './utils/FeatureService';
import { getAll as getAllTransactions } from './data/TransactionRepo';
import { APP_VERSION } from './utils/appInfo';
import { loadNavState, makeNavSaver, refreshNavState, throttleAsync } from './utils/NavigationPersistence';

const CATCH_UP_EVERY_MS = 5 * 60 * 1000;

// A6.5: restore the screen the owner left if Android killed the app in the background.
const restoreNavigation = async () => {
  const saved = await loadNavState(Storage, APP_VERSION);
  if (!saved) return undefined;
  try {
    const txs = await getAllTransactions();
    const accounts = JSON.parse((await Storage.getItem('user_wealth_accounts')) || '[]');
    return refreshNavState(saved, {
      tx: new Map(txs.map((t) => [String(t.id), t])),
      account: new Map(accounts.map((a) => [String(a.id), a])),
    });
  } catch {
    return undefined;
  }
};
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// C4: five tabs with the shared TabBar. "Wealth" is now "Accounts"; Money tools hub removed.
function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="AccountsTab" component={WealthScreen} options={{ title: 'Accounts' }} />
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
    // A6.7: at most once per 5 minutes, and after the first frame so returning stays smooth.
    const catchUp = throttleAsync(async () => {
      try {
        if ((await Storage.getItem('onboarding_complete')) !== 'true') return;
        await syncTrackingWithFlag();
        await syncSms();
        await processRecurringTransactions();
        await saveNetWorthSnapshot();
      } catch (err) {
        console.warn('Catch-up error:', err);
      }
    }, CATCH_UP_EVERY_MS);

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
      if (state === 'active') InteractionManager.runAfterInteractions(() => catchUp());
    });

    return () => {
      appStateSub.remove();
      stopTracking();
    };
  }, []);

  const [navReady, setNavReady] = useState(false);
  const [initialNav, setInitialNav] = useState(undefined);
  const saveNav = useMemo(() => makeNavSaver(Storage, APP_VERSION), []);
  useEffect(() => {
    restoreNavigation()
      .then(setInitialNav)
      .finally(() => setNavReady(true));
  }, []);
  if (!navReady) return null;

  return (
    <NavigationContainer
      theme={dark ? DarkTheme : DefaultTheme}
      initialState={initialNav}
      onStateChange={saveNav}
    >
      <StatusBar style="auto" />
      <Stack.Navigator initialRouteName="Main">
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="MoneyTool" component={ToolsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="AiAssistant" component={AiAssistantScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Analytics" component={AnalyticsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Income" component={IncomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Expense" component={ExpenseScreen} options={{ headerShown: false }} />
        <Stack.Screen name="AddInvestment" component={AddAssetScreen} options={{ headerShown: false }} />
        <Stack.Screen name="EditAsset" component={EditAssetScreen} options={{ headerShown: false }} />
        <Stack.Screen name="SearchAsset" component={SearchAssetScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="Transactions"
          component={AllTransactionsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="TransactionDetail"
          component={EditTransactionScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen name="AddGoal" component={AddGoalScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Import" component={ImportScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Savings" component={SavingsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Recurring" component={RecurringScreen} options={{ headerShown: false }} />
        <Stack.Screen name="ScanSms" component={ScanSmsScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Backup" component={BackupScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Categories" component={CategoriesScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="ReviewAccounts"
          component={ReviewAccountsScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
export default function App() {
  // C1: load the fonts before the first screen. On a load error, carry on with system fonts.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });
  if (!fontsLoaded && !fontError) return null;
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
