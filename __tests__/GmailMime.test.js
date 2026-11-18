import { Buffer } from 'buffer';
import { extractEmailText } from '../utils/GmailMime';
const part = (mimeType, text) => ({ mimeType, body: { data: Buffer.from(text).toString('base64url') } });
test('walks nested alternatives and prefers plain text', () => {
  expect(extractEmailText({ parts: [{ parts: [part('text/html', '<p>Wrong</p>'), part('text/plain', 'INR 1200 debited')] }] })).toBe('INR 1200 debited');
});
test('HTML fallback removes scripts and decodes rupees', () => {
  expect(extractEmailText(part('text/html', '<script>bad</script><p>&#8377; 100 &amp; paid</p>'))).toBe('₹ 100 & paid');
});

