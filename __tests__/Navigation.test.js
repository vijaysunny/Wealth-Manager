/**
 * C4: navigation map. Every navigate('X') / { screen: 'X' } in the app points at a registered
 * route, the five tabs are Home · Accounts · Budget · Goals · Settings, and the Money tools hub
 * route is gone.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8');
const registered = new Set([...app.matchAll(/name="([A-Za-z]+)"/g)].map((m) => m[1]));
const sources = ['screens', 'components']
  .flatMap((d) =>
    fs
      .readdirSync(path.join(ROOT, d))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join(ROOT, d, f))
  )
  .concat(path.join(ROOT, 'components', 'ui', 'TabBar.js'));

test('tabs are Home, Accounts, Budget, Goals, Settings in that order', () => {
  const tabs = [...app.matchAll(/<Tab\.Screen name="(\w+)"[^>]*title: '([^']+)'/g)].map((m) => m[2]);
  expect(tabs).toEqual(['Home', 'Accounts', 'Budget', 'Goals', 'Settings']);
  expect(app).toMatch(/tabBar=\{\(props\) => <TabBar/);
});

test('the Money tools hub route is gone; its sections are single screens', () => {
  expect(registered.has('Tools')).toBe(false);
  expect(registered.has('WealthTab')).toBe(false);
  [
    'Transactions',
    'TransactionDetail',
    'ReviewAccounts',
    'AiAssistant',
    'AddInvestment',
    'MoneyTool',
  ].forEach((r) => expect(registered.has(r)).toBe(true));
});

test('every navigate target in screens/components is registered', () => {
  const missing = [];
  for (const file of sources) {
    const src = fs.readFileSync(file, 'utf8');
    const targets = [
      ...[...src.matchAll(/navigate\(\s*'([A-Za-z]+)'/g)].map((m) => m[1]),
      ...[...src.matchAll(/screen:\s*'([A-Za-z]+)'/g)].map((m) => m[1]),
      ...[...src.matchAll(/route:\s*'([A-Za-z]+)'/g)].map((m) => m[1]),
    ];
    targets.forEach((t) => {
      if (!registered.has(t)) missing.push(`${path.basename(file)} → ${t}`);
    });
  }
  expect(missing).toEqual([]);
});
