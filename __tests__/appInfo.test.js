import { APP_VERSION, BACKUP_VERSION } from '../utils/appInfo';
import pkg from '../package.json';

describe('appInfo', () => {
  test('app.json and package.json versions agree', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  test('backup version is major.minor of the app version', () => {
    expect(BACKUP_VERSION).toBe('3.0');
  });
});
