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
const modelCacheKey = (id, fast = false) => `ai_model_${id}${fast ? '_fast' : ''}`;
const modelListKey = (id) => `ai_models_${id}`;

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
  // new key → re-pick the models and list them again
  await AsyncStorage.removeItem(modelCacheKey(id));
  await AsyncStorage.removeItem(modelCacheKey(id, true));
  await AsyncStorage.removeItem(modelListKey(id));
};

// A2: two picks per provider (normal and fast) and the listed models with a timestamp.
export const getCachedModel = async (id, fast = false) =>
  (await AsyncStorage.getItem(modelCacheKey(id, fast))) || null;
export const setCachedModel = async (id, model, fast = false) =>
  model
    ? AsyncStorage.setItem(modelCacheKey(id, fast), model)
    : AsyncStorage.removeItem(modelCacheKey(id, fast));
export const getCachedModelList = async (id) => {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(modelListKey(id))) || 'null');
    return v && Number.isFinite(v.at) && Array.isArray(v.ids) ? v : null;
  } catch {
    return null;
  }
};
export const setCachedModelList = (id, value) =>
  AsyncStorage.setItem(modelListKey(id), JSON.stringify(value));

/** True when AI is built in, switched on, the feature is on and at least one key is saved. */
export const isAiReady = async (feature) => {
  if (!isAiAvailable()) return false;
  const s = await loadAiSettings();
  if (!s.enabled || (feature && s.features[feature] === false)) return false;
  for (const id of s.order) if (await getApiKey(id)) return true;
  return false;
};

export const SHORT_NAMES = { gemini: 'Gemini', groq: 'Groq', xai: 'Grok' };

/** One line for Settings → AI assistant: "Gemini key saved · AI is off", "On · Gemini", "No key yet". */
export const aiSummary = (settings, hasKey = {}) => {
  const s = normalizeSettings(settings);
  const withKey = s.order.filter((id) => hasKey[id] && PROVIDERS[id]);
  if (!withKey.length) return s.enabled ? 'On · no key yet' : 'No key yet · AI is off';
  const names = withKey.map((id) => SHORT_NAMES[id] || id);
  if (!s.enabled) return `${names.join(', ')} key${names.length === 1 ? '' : 's'} saved · AI is off`;
  return `On · ${names[0]}`;
};
