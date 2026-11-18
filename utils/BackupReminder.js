/** BackupReminder.js (plan B2) - pure. */
export const LAST_BACKUP_KEY = 'last_backup_at';
export const BACKUP_STALE_DAYS = 30;

/** { days: number|null, stale: boolean, label } for the stored ISO date (null = never). */
export const backupStatus = (lastIso, now = new Date()) => {
  const t = lastIso ? new Date(lastIso).getTime() : NaN;
  if (!Number.isFinite(t)) return { days: null, stale: true, label: 'No backup yet' };
  const days = Math.max(0, Math.floor((now.getTime() - t) / 86400000));
  return {
    days,
    stale: days > BACKUP_STALE_DAYS,
    label: days === 0 ? 'Last backup: today' : `Last backup: ${days} day${days === 1 ? '' : 's'} ago`,
  };
};
