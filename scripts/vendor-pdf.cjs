const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const version = require(path.join(pdfRoot, 'package.json')).version;
const main = fs.readFileSync(path.join(pdfRoot, 'legacy/build/pdf.min.mjs'), 'utf8');
const worker = fs.readFileSync(path.join(pdfRoot, 'legacy/build/pdf.worker.min.mjs'), 'utf8');
fs.writeFileSync(
  path.join(root, 'utils/PdfBundle.js'),
  `// PDF.js ${version}, Mozilla Foundation, Apache-2.0. See assets/pdfjs-LICENSE.txt.\nexport const PDF_SOURCE = ${JSON.stringify(main)};\nexport const PDF_WORKER = ${JSON.stringify(worker)};\n`
);
fs.copyFileSync(path.join(pdfRoot, 'LICENSE'), path.join(root, 'assets/pdfjs-LICENSE.txt'));
