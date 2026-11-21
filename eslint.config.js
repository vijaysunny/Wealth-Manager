// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { files: ['scripts/**/*.cjs'], languageOptions: { globals: { __dirname: 'readonly' } } },
  {
    // A10: React Native's Button is an unstyled uppercase block on Android. Use components/ui/AppButton.
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Button'],
              message: 'Use AppButton from components/ui/AppButton instead of the React Native Button.',
            },
          ],
        },
      ],
    },
  },
  { ignores: ['node_modules/*', 'android/*', 'ios/*', 'dist/*', '.cache/**', '*.cjs'] },
  {
    files: ['__tests__/**/*.js', 'jest.setup.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
]);
