/**
 * Snackbar bus (Phase 14 A3) - pure. A screen can show a message after navigating away:
 * showSnackbar({ text, action: { label, onPress }, duration }). One host listens (App root).
 */
let listener = null;
let pending = null;

export const showSnackbar = (msg) => {
  const m = { duration: 4000, ...msg, key: Date.now() + Math.random() };
  if (listener) listener(m);
  else pending = m;
};

/** The host subscribes; a message sent before it mounted is delivered at once. */
export const subscribeSnackbar = (fn) => {
  listener = fn;
  if (pending) {
    fn(pending);
    pending = null;
  }
  return () => {
    if (listener === fn) listener = null;
  };
};
