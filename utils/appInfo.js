// utils/appInfo.js
// Single source of truth for app/backup versions (read from app.json).
import appJson from '../app.json';

export const APP_VERSION = appJson.expo.version;
// Backup schema version = major.minor of the app version
export const BACKUP_VERSION = APP_VERSION.split('.').slice(0, 2).join('.');
