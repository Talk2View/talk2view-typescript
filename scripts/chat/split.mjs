// Split a selector list on top-level commas, respecting (), [], quotes and \escapes.
export function splitTopLevel(sel) {
  const out = []; let depth = 0, quote = null, buf = "";
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "\\") { buf += c + (sel[++i] ?? ""); continue; }
    if (quote) { buf += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
