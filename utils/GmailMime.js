const decode = (data) => {
  const encoded = data.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
  try { return decodeURIComponent(Array.from(bytes, c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')); }
  catch { return bytes; }
};
export const stripHtml = (html) => html
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<\/(?:p|div|tr)>|<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&#(x[\da-f]+|\d+);/gi, (_, value) => String.fromCodePoint(value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)))
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
export const extractEmailText = (payload) => {
  const plain = [], html = [];
  const visit = (part) => {
    if (!part || part.filename) return;
    if (part.body?.data) {
      if (part.mimeType === 'text/plain') plain.push(decode(part.body.data));
      if (part.mimeType === 'text/html') html.push(stripHtml(decode(part.body.data)));
    }
    (part.parts || []).forEach(visit);
  };
  visit(payload);
  return (plain.length ? plain : html).join('\n').trim();
};
