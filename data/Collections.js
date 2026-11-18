import { atomic } from './Database';
import { readValue, writeValue } from './Storage';
export const mutateList = (key, task) =>
  atomic(async (db) => {
    const rows = JSON.parse((await readValue(db, key)) || '[]');
    const updated = task(rows);
    await writeValue(db, key, JSON.stringify(updated));
    return updated;
  });
export const putAccount = (account) =>
  atomic((db) =>
    db.runAsync(
      'INSERT OR REPLACE INTO accounts(id,data) VALUES (?,?)',
      String(account.id),
      JSON.stringify(account)
    )
  );
export const deleteAccount = (id) =>
  atomic((db) => db.runAsync('DELETE FROM accounts WHERE id=?', String(id)));
