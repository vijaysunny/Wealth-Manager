// Phase 13 A6: our own system screens (pickers, camera, share sheet, biometric prompt, Android
// settings) send the app to the background. Call suppressNextLock() before opening one so the
// app lock doesn't trigger when the owner comes back from it.
// The suppression only covers a trip to the background that starts within SUPPRESS_MS (the time
// it takes to open the system screen); AppLock consumes it there and forgives that trip for at
// most FORGIVE_MS. A share sheet dismissed in-app followed later by Home locks as usual.
export const SUPPRESS_MS = 60 * 1000;
export const FORGIVE_MS = 10 * 60 * 1000;
let suppressUntil = 0;
export const suppressNextLock = (now = Date.now()) => {
  suppressUntil = now + SUPPRESS_MS;
};
export const isLockSuppressed = (now = Date.now()) => suppressUntil > now;
export const clearLockSuppress = () => {
  suppressUntil = 0;
};

// A system prompt (biometrics) that we await: background events while it is open are ignored,
// and nothing lingers after it closes.
let promptDepth = 0;
export const whilePrompting = async (fn) => {
  promptDepth += 1;
  try {
    return await fn();
  } finally {
    promptDepth -= 1;
  }
};
export const isPrompting = () => promptDepth > 0;
