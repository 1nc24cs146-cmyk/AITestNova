// Shared text helpers for AITestNova's pure modules. No vscode import.
// These exist because the old code split signatures on plain commas and
// searched for operators with plain indexOf — both break on real code:
// defaults like (1, 2), generics like Map<String, Integer>, strings like
// "a + b", and nested calls like add(foo(1), 2).

// Replace every character inside a string literal or comment with a
// space, keeping newlines and length intact, so offsets into the masked
// text still line up with the original text. Language matters: '#' is a
// comment in Python but a private-field prefix in JS, and '//' is a
// comment in JS/Java/Go but division in Python.
export function maskStringsAndComments(text: string, language: string): string {
  const isPython = language === 'python';
  const out = text.split('');
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) { if (out[k] !== '\n' && out[k] !== '\r') { out[k] = ' '; } }
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1] ?? '';
    if (!isPython && ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      blank(i, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (!isPython && ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (isPython && ch === '#') {
      const end = text.indexOf('\n', i);
      blank(i, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const triple = isPython && text.slice(i, i + 3) === ch.repeat(3);
      const quote = triple ? ch.repeat(3) : ch;
      let j = i + quote.length;
      let closed = false;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text.slice(j, j + quote.length) === quote) { j += quote.length; closed = true; break; }
        // A single-quoted string never runs past its line (except a
        // backslash continuation, handled above); an unclosed quote is
        // a syntax error anyway — stop masking at the line end.
        if (!triple && quote !== '`' && text[j] === '\n') { break; }
        j += 1;
      }
      blank(i, closed ? j : (text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i)));
      i = closed ? j : (text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i));
      continue;
    }
    i += 1;
  }
  return out.join('');
}

// Split on top-level commas only: commas inside (), [], {}, <> or
// quotes do not split. Used for parameter lists and call arguments.
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depthRound = 0; let depthSquare = 0; let depthCurly = 0; let depthAngle = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) { quote = ''; }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') { depthRound += 1; }
    else if (ch === ')') { depthRound = Math.max(0, depthRound - 1); }
    else if (ch === '[') { depthSquare += 1; }
    else if (ch === ']') { depthSquare = Math.max(0, depthSquare - 1); }
    else if (ch === '{') { depthCurly += 1; }
    else if (ch === '}') { depthCurly = Math.max(0, depthCurly - 1); }
    else if (ch === '<') { depthAngle += 1; }
    else if (ch === '>') { depthAngle = Math.max(0, depthAngle - 1); }
    else if (ch === ',' && depthRound === 0 && depthSquare === 0 && depthCurly === 0 && depthAngle === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Read a balanced (...) starting at openIdx (the '(' itself), in the
// original text, skipping strings and comments. Returns the text inside
// the parens and the index just past the closing paren, or null.
export function readBalancedParens(text: string, openIdx: number, language: string): { inside: string; end: number } | null {
  const masked = maskStringsAndComments(text, language);
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    if (masked[i] === '(') { depth += 1; }
    else if (masked[i] === ')') {
      depth -= 1;
      if (depth === 0) { return { inside: text.slice(openIdx + 1, i), end: i + 1 }; }
    }
  }
  return null;
}

// Escape a string for use inside a RegExp.
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Escape user-controlled text for insertion into HTML (dashboard,
// webview lists). A recorded test name or URL must never become markup.
export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
