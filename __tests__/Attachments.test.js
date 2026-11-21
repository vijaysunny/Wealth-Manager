import {
  safeFileName,
  addAttachment,
  removeAttachment,
  deleteAllFor,
  checkLimits,
  attachmentDir,
  backupKey,
  sizeLabel,
  attachmentsSize,
  readAttachmentFiles,
  restoreAttachmentFiles,
  hasFiles,
  AttachmentError,
  MAX_FILES,
} from '../utils/Attachments';

/** In-memory file system with the expo-file-system calls we use. */
const fakeFs = (files = {}) => {
  const fs = {
    documentDirectory: 'file:///doc/',
    files,
    makeDirectoryAsync: jest.fn(async () => {}),
    copyAsync: jest.fn(async ({ from, to }) => {
      if (!(from in files)) throw new Error('missing');
      files[to] = files[from];
    }),
    deleteAsync: jest.fn(async (uri) => {
      Object.keys(files).forEach((k) => k.startsWith(uri) && delete files[k]);
    }),
    getInfoAsync: jest.fn(async (uri) =>
      uri in files ? { exists: true, size: files[uri].length } : { exists: false }
    ),
    readAsStringAsync: jest.fn(async (uri) => {
      if (!(uri in files)) throw new Error('missing');
      return files[uri];
    }),
    writeAsStringAsync: jest.fn(async (uri, data) => {
      files[uri] = data;
    }),
  };
  return fs;
};

test('safeFileName', () => {
  expect(safeFileName('../../etc/passwd')).toBe('passwd');
  expect(safeFileName('C:\\bills\\Nov bill.pdf')).toBe('Nov bill.pdf');
  expect(safeFileName('a\u0000b<c>:d|e?.png')).toBe('abcde.png');
  expect(safeFileName('...hidden')).toBe('hidden');
  expect(safeFileName('')).toBe('file');
  expect(safeFileName(null)).toBe('file');
  const long = safeFileName(`${'x'.repeat(200)}.jpeg`);
  expect(long).toHaveLength(80);
  expect(long.endsWith('.jpeg')).toBe(true);
  expect(safeFileName('y'.repeat(100))).toHaveLength(80);
});

test('add copies into attachments/<txId>/ and records the entry', async () => {
  const fs = fakeFs({ 'file:///cache/p.jpg': 'abcd' });
  const tx = { id: 'g1', amount: 5 };
  const next = await addAttachment(tx, { uri: 'file:///cache/p.jpg', name: 'Google invoice.jpg' }, fs, {
    id: 'f1',
    now: new Date('2026-11-21T10:00:00Z'),
  });
  expect(next.attachments).toEqual([
    {
      id: 'f1',
      uri: 'file:///doc/attachments/g1/f1-Google invoice.jpg',
      name: 'Google invoice.jpg',
      mime: 'image/jpeg',
      size: 4,
      addedAt: '2026-11-21T10:00:00.000Z',
    },
  ]);
  expect(fs.files['file:///doc/attachments/g1/f1-Google invoice.jpg']).toBe('abcd');
  expect(tx.attachments).toBeUndefined(); // not mutated
  const pdf = await addAttachment(
    next,
    { uri: 'file:///cache/p.jpg', name: 'x.pdf', size: 10, mime: 'application/pdf' },
    fs,
    { id: 'f2' }
  );
  expect(pdf.attachments).toHaveLength(2);
  expect(pdf.attachments[1].mime).toBe('application/pdf');
  const other = await addAttachment(next, { uri: 'file:///cache/p.jpg', name: 'blob.zzz', size: 1 }, fs, {
    id: 'f3',
  });
  expect(other.attachments[1].mime).toBe('application/octet-stream');
});

test('limits: 25 MB per file and 10 files, clear messages', async () => {
  const fs = fakeFs({ 'file:///c/big': 'x' });
  await expect(
    addAttachment({ id: 1 }, { uri: 'file:///c/big', name: 'big.pdf', size: 26 * 1048576 }, fs)
  ).rejects.toThrow('This file is 26.0 MB. The limit is 25 MB per file.');
  const full = { id: 1, attachments: Array.from({ length: MAX_FILES }, (_, i) => ({ id: `a${i}` })) };
  expect(() => checkLimits(full, 1)).toThrow(AttachmentError);
  expect(() => checkLimits(full, 1)).toThrow('A transaction can hold 10 files. Remove one first.');
  expect(() => checkLimits({}, NaN)).not.toThrow();
  await expect(addAttachment({}, { uri: 'x' }, fs)).rejects.toThrow('Save the transaction first.');
  await expect(addAttachment({ id: 1 }, null, fs)).rejects.toThrow('No file was chosen.');
  expect(fs.copyAsync).not.toHaveBeenCalled();
});

test('unknown size when the file is missing still copies (copy then fails)', async () => {
  const fs = fakeFs({});
  await expect(addAttachment({ id: 1 }, { uri: 'file:///gone', name: 'a.png' }, fs)).rejects.toThrow(
    'missing'
  );
});

test('remove deletes the file; deleteAllFor removes the folder', async () => {
  const fs = fakeFs({
    'file:///doc/attachments/g1/f1-a.png': '1',
    'file:///doc/attachments/g1/f2-b.png': '2',
  });
  const tx = {
    id: 'g1',
    attachments: [
      { id: 'f1', uri: 'file:///doc/attachments/g1/f1-a.png' },
      { id: 'f2', uri: 'file:///doc/attachments/g1/f2-b.png' },
    ],
  };
  const next = await removeAttachment(tx, 'f1', fs);
  expect(next.attachments.map((a) => a.id)).toEqual(['f2']);
  expect(Object.keys(fs.files)).toEqual(['file:///doc/attachments/g1/f2-b.png']);
  expect((await removeAttachment({ id: 'x' }, 'nope', fs)).attachments).toEqual([]);
  await deleteAllFor('g1', fs);
  expect(fs.files).toEqual({});
  await expect(deleteAllFor('g1', {})).resolves.toBeUndefined();
});

test('helpers', () => {
  expect(attachmentDir('file:///d/', 'a b')).toBe('file:///d/attachments/a%20b/');
  expect(backupKey('t', 'f')).toBe('attachments/t/f');
  expect(sizeLabel(120000)).toBe('117 KB');
  expect(sizeLabel(10)).toBe('1 KB');
  expect(sizeLabel(3 * 1048576)).toBe('3.0 MB');
  expect(sizeLabel(undefined)).toBe('');
  expect(hasFiles({ attachments: [{}] })).toBe(true);
  expect(hasFiles({})).toBe(false);
  expect(attachmentsSize([{ attachments: [{ size: 5 }, { size: null }] }, {}, null])).toBe(5);
  expect(attachmentsSize()).toBe(0);
});

test('backup round trip: files go in as base64 and come back under the new folder', async () => {
  const src = fakeFs({ 'file:///old/attachments/g1/f1-a.png': 'QUJD' });
  const txs = [
    {
      id: 'g1',
      attachments: [
        { id: 'f1', name: 'a.png', mime: 'image/png', uri: 'file:///old/attachments/g1/f1-a.png' },
        { id: 'f2', name: 'gone.pdf', uri: 'file:///old/x' },
      ],
    },
    { id: 'g2' },
  ];
  const { files, missing } = await readAttachmentFiles(txs, src);
  expect(missing).toBe(1);
  expect(files).toEqual({ 'attachments/g1/f1': { name: 'a.png', mime: 'image/png', data: 'QUJD' } });

  const dest = fakeFs({});
  const restored = await restoreAttachmentFiles(
    { app: 'WealthManager', transactions: txs, attachmentFiles: files },
    dest
  );
  expect(restored.attachmentFiles).toBeUndefined();
  expect(restored.transactions[0].attachments).toEqual([
    { id: 'f1', name: 'a.png', mime: 'image/png', uri: 'file:///doc/attachments/g1/f1-a.png' },
  ]);
  expect(dest.files['file:///doc/attachments/g1/f1-a.png']).toBe('QUJD');
  expect(restored.transactions[1]).toEqual({ id: 'g2' });
  expect(await restoreAttachmentFiles(null, dest)).toBeNull();
  expect(await restoreAttachmentFiles({ app: 'x' }, dest)).toEqual({ app: 'x' });
  expect(await readAttachmentFiles(undefined, src)).toEqual({ files: {}, missing: 0 });
});
