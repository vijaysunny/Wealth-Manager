// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { files: ['scripts/**/*.cjs'], languageOptions: { globals: { __dirname: 'readonly' } } },
  { ignores: ['node_modules/*', 'android/*', 'ios/*', 'dist/*', '.cache/**', '*.cjs'] },
  {
    files: ['__tests__/**/*.js', 'jest.setup.js'],
    languageOptions: {
      globals: { describe: 'readonly', test: 'readonly', it: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', jest: 'readonly', beforeAll: 'readonly', afterAll: 'readonly' },
    },
  },
]);



