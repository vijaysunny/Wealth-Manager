/**
 * Attachments.js (Phase 12 B1) - bills, receipts and any file on a transaction.
 * tx.attachments = [{ id, uri, name, mime, size, addedAt }]
 * uri = <documentDirectory>attachments/<txId>/<id>-<safeName>
 * The pure parts (names, limits, backup keys) take no file system; the rest take an `fs`
 * object ({ documentDirectory, makeDirectoryAsync, copyAsync, deleteAsync, getInfoAsync,
 * readAsStringAsync, writeAsStringAsync }) so tests pass fakes. Default: expo-file-system.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 10;
export const BACKUP_WARN_BYTES = 50 * 1024 * 1024;

export class AttachmentError extends Error {}

const defaultFs = () => require('expo-file-system/legacy');

/** Strip path separators and control characters, max 80 characters, keep the extension. */
export const safeFileName = (name) => {
  const base =
    String(name ?? '')
      .split(/[\\/]/)
      .pop()
      .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '') || 'file';
  if (base.length <= 80) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : '';
  return base.slice(0, 80 - ext.length) + ext;
};

export const attachmentDir = (docDir, txId) => `${docDir}attachments/${encodeURIComponent(String(txId))}/`;

/** Key used for a file inside a backup. */
export const backupKey = (txId, id) => `attachments/${txId}/${id}`;

export const sizeLabel = (bytes) =>
  !Number.isFinite(bytes)
    ? ''
    : bytes >= 1048576
      ? `${(bytes / 1048576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Throws a readable AttachmentError when a limit would be broken. */
export const checkLimits = (tx, size) => {
  const count = Array.isArray(tx?.attachments) ? tx.attachments.length : 0;
  if (count >= MAX_FILES)
    throw new AttachmentError(`A transaction can hold ${MAX_FILES} files. Remove one first.`);
  if (Number.isFinite(size) && size > MAX_FILE_BYTES)
    throw new AttachmentError(`This file is ${sizeLabel(size)}. The limit is 25 MB per file.`);
};

const guessMime = (name) => {
  const ext = String(name).toLowerCase().split('.').pop();
  return (
    {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      heic: 'image/heic',
      pdf: 'application/pdf',
    }[ext] || 'application/octet-stream'
  );
};

const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Copy a picked file ({ uri, name, mime, size }) into the app's attachments folder.
 * Returns the new tx (the caller saves it).
 */
export const addAttachment = async (
  tx,
  picked,
  fs = defaultFs(),
  { id = newId(), now = new Date() } = {}
) => {
  if (!tx || tx.id == null) throw new AttachmentError('Save the transaction first.');
  if (!picked?.uri) throw new AttachmentError('No file was chosen.');
  let size = Number(picked.size);
  if (!Number.isFinite(size)) {
    const info = await fs.getInfoAsync(picked.uri, { size: true });
    size = info?.exists ? Number(info.size) : NaN;
  }
  checkLimits(tx, size);
  const name = safeFileName(picked.name || picked.uri);
  const dir = attachmentDir(fs.documentDirectory, tx.id);
  await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const uri = `${dir}${id}-${name}`;
  await fs.copyAsync({ from: picked.uri, to: uri });
  const entry = {
    id,
    uri,
    name,
    mime: picked.mime || guessMime(name),
    size: Number.isFinite(size) ? size : null,
    addedAt: now.toISOString(),
  };
  return { ...tx, attachments: [...(tx.attachments || []), entry] };
};

/** Delete one file and drop its entry. A file already gone is fine. */
export const removeAttachment = async (tx, id, fs = defaultFs()) => {
  const entry = (tx.attachments || []).find((a) => a.id === id);
  if (entry?.uri) await fs.deleteAsync(entry.uri, { idempotent: true }).catch(() => {});
  return { ...tx, attachments: (tx.attachments || []).filter((a) => a.id !== id) };
};

/** Delete every file of a transaction (called when the transaction is deleted). */
export const deleteAllFor = async (txId, fs = defaultFs()) => {
  if (!fs?.documentDirectory) return;
  await fs.deleteAsync(attachmentDir(fs.documentDirectory, txId), { idempotent: true }).catch(() => {});
};

// ── Backup ──────────────────────────────────────────────────────────────

export const hasFiles = (tx) => Array.isArray(tx?.attachments) && tx.attachments.length > 0;

/** Total bytes of all attachments (unknown sizes count as 0). */
export const attachmentsSize = (txs = []) =>
  txs.reduce((s, tx) => s + (tx?.attachments || []).reduce((a, f) => a + (Number(f?.size) || 0), 0), 0);

/** { [backupKey]: { name, mime, data(base64) } } for every readable file. Missing files are skipped. */
export const readAttachmentFiles = async (txs = [], fs = defaultFs()) => {
  const out = {};
  let missing = 0;
  for (const tx of txs) {
    for (const f of tx?.attachments || []) {
      try {
        out[backupKey(tx.id, f.id)] = {
          name: f.name,
          mime: f.mime,
          data: await fs.readAsStringAsync(f.uri, { encoding: 'base64' }),
        };
      } catch {
        missing += 1;
      }
    }
  }
  return { files: out, missing };
};

/**
 * Write a backup's files into this phone's attachments folder and point every transaction's
 * uri at the new copy. Entries whose file is not in the backup are dropped (nothing to open).
 * Returns the backup with rewritten transactions and no attachmentFiles.
 */
export const restoreAttachmentFiles = async (data, fs = defaultFs()) => {
  if (!data || !Array.isArray(data.transactions)) return data;
  const files = data.attachmentFiles || {};
  const transactions = [];
  for (const tx of data.transactions) {
    if (!hasFiles(tx)) {
      transactions.push(tx);
      continue;
    }
    const kept = [];
    for (const f of tx.attachments) {
      const file = files[backupKey(tx.id, f.id)];
      if (!file?.data) continue;
      const dir = attachmentDir(fs.documentDirectory, tx.id);
      await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const uri = `${dir}${f.id}-${safeFileName(f.name)}`;
      await fs.writeAsStringAsync(uri, file.data, { encoding: 'base64' });
      kept.push({ ...f, uri });
    }
    transactions.push({ ...tx, attachments: kept });
  }
  const { attachmentFiles, ...rest } = data;
  void attachmentFiles;
  return { ...rest, transactions };
};
