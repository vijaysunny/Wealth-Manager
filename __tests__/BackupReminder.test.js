import { backupStatus } from '../utils/BackupReminder';
const NOW = new Date('2026-11-18T10:00:00Z');
test('never / fresh / stale after 30 days', () => {
  expect(backupStatus(null, NOW)).toMatchObject({ days: null, stale: true });
  expect(backupStatus('2026-11-18T01:00:00Z', NOW)).toMatchObject({
    days: 0,
    stale: false,
    label: 'Last backup: today',
  });
  expect(backupStatus('2026-10-19T10:00:00Z', NOW)).toMatchObject({ days: 30, stale: false });
  expect(backupStatus('2026-10-18T09:00:00Z', NOW)).toMatchObject({ days: 31, stale: true });
  expect(backupStatus('garbage', NOW).stale).toBe(true);
});
