/**
 * Bootstrap.js (plan B5) - the ONE place the app waits for the database (open + legacy
 * migration). Children render only after it is ready; a failure shows the error with Retry.
 * `open` is injectable for tests.
 */
import React, { useCallback, useEffect, useState } from 'react';
import AppButton from './ui/AppButton';
import { View, Text } from './Theme';
import { getDatabase } from '../data/Database';

export default function Bootstrap({ children, open = getDatabase }) {
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
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text>{error || 'Preparing your saved data…'}</Text>
        {error ? <AppButton title="Retry migration" onPress={start} /> : null}
      </View>
    );
  return children;
}
