/**
 * CardMigration.js (Phase 13 B2): one-time card data migration, run by Bootstrap. A card's old
 * `dueDay` becomes due: { mode: 'fixedDay', day }. Safe to run twice: normalizeCard leaves a
 * card that already has `due` unchanged, and only changed accounts are written.
 */
import { atomic } from './Database';
import { readValue, writeValue } from './Storage';
import { normalizeCard } from '../utils/CardMath';

export const migrateCards = () =>
  atomic(async (db) => {
    const accounts = JSON.parse((await readValue(db, 'user_wealth_accounts')) || '[]');
    let changed = 0;
    const next = accounts.map((a) => {
      const n = normalizeCard(a);
      if (n !== a) changed += 1;
      return n;
    });
    if (changed) await writeValue(db, 'user_wealth_accounts', JSON.stringify(next));
    return { changed };
  });
