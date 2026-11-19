/**
 * AiConfig.js - where AI settings live.
 *
 *  - API keys: expo-secure-store (Android Keystore). They are typed in Settings and are
 *    NEVER put in .env: every EXPO_PUBLIC_ value is bundled into the APK in plain text.
 *  - Preferences (on/off, provider order, model overrides, per-feature toggles): AsyncStorage.
 *  - .env only carries non-secret build defaults (EXPO_PUBLIC_ENABLE_AI, EXPO_PUBLIC_AI_PROVIDER_ORDER).
 */
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '../../data/Storage';
import { PROVIDERS, parseOrder } from './AiProviders';
import { isAiAvailable, aiProviderOrder } from '../Features';

export const AI_SETTINGS_KEY = 'ai_settings';
const keyName = (id) => `ai_key_${id}`;
const modelCacheKey = (id) => `ai_model_${id}`;

export const AI_FEATURES = ['sms', 'categorize', 'statements', 'insights'];

export const defaultSettings = () => ({
  enabled: false, // opt-in: AI sends text to a cloud provider
  order: parseOrder(aiProviderOrder()),
  models: {}, // { gemini: 'gemini-x-flash' } manual overrides
  features: { sms: true, categorize: true, statements: true, insights: true },
});

export const normalizeSettings = (raw) => {
  const d = defaultSettings();
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: s.enabled === true,
    order: Array.isArray(s.order) ? parseOrder(s.order.join(',')) : d.order,
    models: { ...(s.models || {}) },
    features: { ...d.features, ...(s.features || {}) },
  };
};

export const loadAiSettings = async () => {
  try {
    return normalizeSettings(JSON.parse((await AsyncStorage.getItem(AI_SETTINGS_KEY)) || 'null'));
  } catch {
    return defaultSettings();
  }
};

export const saveAiSettings = async (settings) => {
  const s = normalizeSettings(settings);
  await AsyncStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(s));
  return s;
};

export const getApiKey = async (id) => {
  if (!PROVIDERS[id]) return null;
  try {
    return (await SecureStore.getItemAsync(keyName(id))) || null;
  } catch {
    return null;
  }
};

export const setApiKey = async (id, value) => {
  if (!PROVIDERS[id]) throw new Error(`Unknown AI provider: ${id}`);
  const v = String(value || '').trim();
  if (v) await SecureStore.setItemAsync(keyName(id), v);
  else await SecureStore.deleteItemAsync(keyName(id));
  await AsyncStorage.removeItem(modelCacheKey(id)); // new key → re-pick the model
};

export const getCachedModel = async (id) => (await AsyncStorage.getItem(modelCacheKey(id))) || null;
export const setCachedModel = async (id, model) =>
  model ? AsyncStorage.setItem(modelCacheKey(id), model) : AsyncStorage.removeItem(modelCacheKey(id));

/** True when AI is built in, switched on, the feature is on and at least one key is saved. */
export const isAiReady = async (feature) => {
  if (!isAiAvailable()) return false;
  const s = await loadAiSettings();
  if (!s.enabled || (feature && s.features[feature] === false)) return false;
  for (const id of s.order) if (await getApiKey(id)) return true;
  return false;
};
