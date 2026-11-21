/** D3/A10: importing Button from react-native must fail lint. Runs the real ESLint CLI. */
const { spawnSync } = require('child_process');
const path = require('path');

jest.setTimeout(120000);
const ROOT = path.join(__dirname, '..');

const lint = (code) => {
  const res = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'),
      '--stdin',
      '--stdin-filename',
      'screens/Fake.js',
      '--format',
      'json',
    ],
    { cwd: ROOT, input: code, encoding: 'utf8' }
  );
  const [file] = JSON.parse(res.stdout);
  return file.messages.filter((m) => m.ruleId === 'no-restricted-imports');
};

test('Button from react-native is blocked', () => {
  const msgs = lint("import { View, Button } from 'react-native';\nexport { View, Button };\n");
  expect(msgs).toHaveLength(1);
  expect(msgs[0].message).toMatch(/AppButton/);
});

test('other react-native imports are allowed', () => {
  expect(lint("import { View, Switch } from 'react-native';\nexport { View, Switch };\n")).toHaveLength(0);
});
