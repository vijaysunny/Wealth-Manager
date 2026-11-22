/** Plan C3: no emoji in the UI. Guards the screens cleaned so far and the shared components. */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const EMOJI = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const FILES = [
  'screens/SavingsScreen.js',
  'screens/RecurringScreen.js',
  ...fs.readdirSync(path.join(ROOT, 'components/ui')).map((f) => `components/ui/${f}`),
].filter((f) => f.endsWith('.js'));

test.each(FILES)('%s has no emoji', (file) => {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const hits = lines.map((l, i) => (EMOJI.test(l) ? `${i + 1}: ${l.trim()}` : null)).filter(Boolean);
  expect(hits).toEqual([]);
});
