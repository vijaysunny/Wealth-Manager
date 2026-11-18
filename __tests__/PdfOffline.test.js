import { buildPdfParserHtml } from '../utils/StatementParser';
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
test('PDF extractor embeds library and worker with no CDN imports', () => {
  const html = buildPdfParserHtml('JVBERg==');
  expect(html).toContain('URL.createObjectURL');
  expect(html).toContain('workerSrc = workerUrl');
  expect(html).toContain('isEvalSupported: false');
  expect(html).not.toContain("await import('https://");
  expect(html).not.toContain('cdnjs.cloudflare.com');
  expect(html).toContain("type: 'PDF_TEXT'");
});
