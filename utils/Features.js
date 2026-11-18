/**
 * Features.js - build-time feature flags (pure).
 * Gmail sync is OFF: the owner relies on SMS + statements (plan B1). The code is kept;
 * set EXPO_PUBLIC_ENABLE_GMAIL=true (plus EXPO_PUBLIC_GOOGLE_CLIENT_ID) to bring it back.
 * Read at call time so tests can toggle it.
 */
export const isGmailEnabled = () => process.env.EXPO_PUBLIC_ENABLE_GMAIL === 'true';
