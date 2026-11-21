/**
 * TagMigration.js (Phase 12 B2): one-time tag clean-up, run by Bootstrap after the database
 * opens. 'Auto-SMS' → 'auto-sms', 'Auto-Sync' → 'auto-sync', 'AI' → 'ai', and every tag goes
 * through normalizeTag (lowercase slug, no duplicates). Safe to run twice: it only rewrites
 * rows whose tags change, and a settings flag skips the scan after the first success.
 */
import { atomic, decodeRow } from './Database';
import { writeRow } from './TransactionRepo';
import { readValue, writeValue } from './Storage';
import { normalizeTag } from '../utils/Tags';

export const TAG_MIGRATION_KEY = 'tags_normalized_v1';

/** Pure: the normalised tag list, or null when nothing changes. */
export const normalizedTags = (tags) => {
  if (!Array.isArray(tags)) return null;
  const out = [];
  tags.forEach((g) => {
    const n = normalizeTag(g);
    if (n && !out.includes(n)) out.push(n);
  });
  return out.length === tags.length && out.every((g, i) => g === tags[i]) ? null : out;
};

export const migrateTags = () =>
  atomic(async (db) => {
    if ((await readValue(db, TAG_MIGRATION_KEY)) === 'true') return { changed: 0, skipped: true };
    let changed = 0;
    for (const row of await db.getAllAsync('SELECT data FROM transactions')) {
      const tx = decodeRow(row);
      const tags = normalizedTags(tx.tags);
      if (!tags) continue;
      await writeRow(db, { ...tx, tags });
      changed += 1;
    }
    await writeValue(db, TAG_MIGRATION_KEY, 'true');
    return { changed, skipped: false };
  });
