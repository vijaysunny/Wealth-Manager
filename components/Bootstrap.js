/**
 * Bootstrap.js (plan B5) - the ONE place the app waits for the database (open + legacy
 * migration, B2 tag clean-up). Children render only after it is ready; a failure shows the error with Retry.
 * `open` is injectable for tests.
 */
import React, { useCallback, useEffect, useState } from 'react';
import AppButton from './ui/AppButton';
import { Text, View } from 'react-native';
import { tokens, type } from './tokens';
import { getDatabase } from '../data/Database';
import { migrateTags } from '../data/TagMigration';

// Database open plus the one-time data migrations (B2 tags). Each is safe to run twice.
const openAndMigrate = async () => {
  await getDatabase();
  await migrateTags();
};

export default function Bootstrap({ children, open = openAndMigrate }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const start = useCallback(() => {
    setError('');
    open()
      .then(() => setReady(true))
      .catch((e) => setError(e?.message || String(e)));
  }, [open]);
  useEffect(() => {
    start();
  }, [start]);
  if (!ready)
    return (
      // A3: outside ThemeProvider, so it pins the light palette with its own background.
      <View
        testID="bootstrap-root"
        style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: tokens.light.bg }}
      >
        <Text style={[type.body, { color: tokens.light.text }]}>{error || 'Preparing your saved data…'}</Text>
        {error ? <AppButton title="Retry migration" onPress={start} /> : null}
      </View>
    );
  return children;
}
