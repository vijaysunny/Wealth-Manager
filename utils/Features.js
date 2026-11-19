/**
 * Features.js - build-time feature flags (pure).
 * Gmail sync is OFF: the owner relies on SMS + statements (plan B1). The code is kept;
 * set EXPO_PUBLIC_ENABLE_GMAIL=true (plus EXPO_PUBLIC_GOOGLE_CLIENT_ID) to bring it back.
 * AI (Gemini Flash / Groq / Grok) is built in unless EXPO_PUBLIC_ENABLE_AI=false; it still
 * stays off until switched on in Settings with an API key. Keys never go in .env.
 * Read at call time so tests can toggle it.
 */
export const isGmailEnabled = () => process.env.EXPO_PUBLIC_ENABLE_GMAIL === 'true';
export const isAiAvailable = () => process.env.EXPO_PUBLIC_ENABLE_AI !== 'false';
export const aiProviderOrder = () => process.env.EXPO_PUBLIC_AI_PROVIDER_ORDER || 'gemini,groq,xai';
