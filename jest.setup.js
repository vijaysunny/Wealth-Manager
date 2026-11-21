jest.mock('expo-sqlite', () => {
  const { DatabaseSync } = require('node:sqlite');
  return {
    openDatabaseAsync: async () => {
      const db = new DatabaseSync(':memory:');
      const api = {
        execAsync: async (sql) => db.exec(sql),
        runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
        getAllAsync: async (sql, ...params) => db.prepare(sql).all(...params),
        getFirstAsync: async (sql, ...params) => db.prepare(sql).get(...params) || null,
        withExclusiveTransactionAsync: async (callback) => {
          db.exec('BEGIN IMMEDIATE');
          try {
            await callback(api);
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        },
      };
      return api;
    },
  };
});

// @expo/vector-icons pulls in expo-font/expo-asset, which jest-expo does not provide. Icons render
// as an empty View so screens using shared UI components can be tested.
jest.mock('@expo/vector-icons', () => {
  const R = require('react');
  const { View } = require('react-native');
  const Icon = ({ testID, accessibilityLabel }) => R.createElement(View, { testID, accessibilityLabel });
  return new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : Icon) });
});
