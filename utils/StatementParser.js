import { PDF_SOURCE, PDF_WORKER } from './PdfBundle';
/**
 * StatementParser.js  — v3.0
 * Parse bank statements from:
 *   • Excel/CSV (HDFC, SBI, ICICI, Axis, Kotak, Yes Bank, IDFC, etc.)
 *   • PDF (via WebView + PDF.js extraction)
 *   • UPI transaction exports (PhonePe, GPay, Paytm, CRED)
 *
 * All outputs go through DeduplicationEngine.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';
import { parseStatementRows, parsePdfText } from './TransactionParser';

// Parsing logic (categories, dates, amounts, column detection, row/PDF-line parsing)
// lives in the shared, unit-tested TransactionParser module.
const parseExcelBuffer = (buffer, bankHint = '') => {
  const wb = xlsxRead(buffer, {
    type: 'array',
    cellDates: true,
  });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = xlsxUtils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  return parseStatementRows(rawRows, bankHint);
};

/** First sheet as CSV text (for the AI fallback when no rows were recognised). */
const sheetText = (buffer) => {
  try {
    const wb = xlsxRead(buffer, { type: 'array', cellDates: true });
    return xlsxUtils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
  } catch {
    return null;
  }
};

// ── PDF.js HTML builder ───────────────────────────────────────────────────

export const buildPdfParserHtml = (base64) => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: sans-serif; font-size: 12px; margin: 0; padding: 10px; background: #fafafa; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 11px; background: #fff; padding: 10px; border-radius: 6px; }
    .status { color: #2196F3; font-weight: bold; padding: 10px; }
  </style>
</head>
<body>
  <div class="status" id="status">Extracting text...</div>
  <pre id="output"></pre>
  <script type="module">
    try {
      const libraryUrl = URL.createObjectURL(new Blob([${JSON.stringify(PDF_SOURCE).replace(/<\/script/gi, '<\\/script')}], { type:'text/javascript' }));
      const workerUrl = URL.createObjectURL(new Blob([${JSON.stringify(PDF_WORKER).replace(/<\/script/gi, '<\\/script')}], { type:'text/javascript' }));
      const pdfjsLib = await import(libraryUrl);
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

      const base64 = '${base64}';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      let allText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        // Group text items into visual rows by Y position, then order by X
        const rows = [];
        for (const it of tc.items) {
          if (!it.str || !it.str.trim()) continue;
          const y = it.transform[5], x = it.transform[4];
          let row = rows.find(r => Math.abs(r.y - y) < 3);
          if (!row) { row = { y, cells: [] }; rows.push(row); }
          row.cells.push({ x, str: it.str.trim() });
        }
        rows.sort((a, b) => b.y - a.y);
        for (const r of rows) {
          r.cells.sort((a, b) => a.x - b.x);
          allText += r.cells.map(c => c.str).join(' ') + '\\n';
        }
      }
      document.getElementById('output').textContent = allText;
      document.getElementById('status').textContent = 'Extraction complete — ' + pdf.numPages + ' pages';
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PDF_TEXT', text: allText }));
    } catch (e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'error',
        msg: 'Could not read this PDF. Use a text-based PDF and an up-to-date Android System WebView. (' + (e && e.message ? e.message : e) + ')'
      }));
    }
  </script>
</body>
</html>
`;

// ── PDF text → transactions ───────────────────────────────────────────────

export { parsePdfText };

// ── File picker ───────────────────────────────────────────────────────────

export const pickAndParseStatement = async (onPdfPicked) => {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/comma-separated-values',
    ],
    copyToCacheDirectory: true,
  });
  if (result.canceled)
    return {
      canceled: true,
    };
  const asset = result.assets[0];
  const uri = asset.uri;
  const name = asset.name || uri.split('/').pop();
  const ext = name.split('.').pop().toLowerCase();

  // PDF path
  if (ext === 'pdf') {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    onPdfPicked(base64, uri);
    return {
      type: 'pdf',
      canceled: false,
    };
  }

  // Excel / CSV path
  const bankHint = detectBankFromName(name);
  try {
    let buffer;
    if (ext === 'csv') {
      const text = await FileSystem.readAsStringAsync(uri);
      const wb = xlsxRead(text, {
        type: 'string',
      });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = xlsxUtils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
      });
      buffer = xlsxUtils.aoa_to_sheet(rows);
      // Re-wrap in workbook
      const wb2 = {
        SheetNames: ['Sheet1'],
        Sheets: {
          Sheet1: buffer,
        },
      };
      const out = xlsxUtils.sheet_to_csv(wb2.Sheets.Sheet1);
      const transactions = parseExcelBuffer(new TextEncoder().encode(out).buffer, bankHint);
      return {
        type: 'excel',
        canceled: false,
        transactions,
        bankHint,
        rawText: transactions.length ? null : out, // AI fallback input
      };
    } else {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const transactions = parseExcelBuffer(bytes.buffer, bankHint);
      return {
        type: 'excel',
        canceled: false,
        transactions,
        bankHint,
        rawText: transactions.length ? null : sheetText(bytes.buffer), // AI fallback input
      };
    }
  } catch (err) {
    return {
      type: 'excel',
      canceled: false,
      error: err.message,
      transactions: [],
    };
  }
};
const detectBankFromName = (name = '') => {
  const n = name.toLowerCase();
  if (n.includes('hdfc')) return 'HDFC Bank';
  if (n.includes('icici')) return 'ICICI Bank';
  if (n.includes('sbi') || n.includes('state bank')) return 'SBI';
  if (n.includes('axis')) return 'Axis Bank';
  if (n.includes('kotak')) return 'Kotak Bank';
  if (n.includes('yes')) return 'Yes Bank';
  if (n.includes('idfc')) return 'IDFC First Bank';
  if (n.includes('pnb')) return 'PNB';
  if (n.includes('canara')) return 'Canara Bank';
  if (n.includes('bob') || n.includes('baroda')) return 'Bank of Baroda';
  if (n.includes('phonepe')) return 'PhonePe';
  if (n.includes('gpay') || n.includes('google')) return 'Google Pay';
  if (n.includes('paytm')) return 'Paytm';
  if (n.includes('cred')) return 'CRED';
  return '';
};

// ── Save with dedup ───────────────────────────────────────────────────────

export const saveStatementTransactions = async (transactions, options) => {
  const { saveWithDedup } = await import('./DeduplicationEngine');
  return await saveWithDedup(transactions, options);
};
