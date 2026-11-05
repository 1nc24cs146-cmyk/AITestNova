// Pure test-generation logic for AITestNova. No vscode import, so it can be
// smoke-tested with plain Node. Generated tests are templates with real
// cases (normal, empty, null, error) — the user reviews them before saving.
// They are NOT copied from Keploy; they are original templates.

import { maskStringsAndComments, readBalancedParens, splitTopLevel } from './textutil';

export interface ParsedFunction { name: string; params: string[]; line: number; language: string; rawParams?: string[]; }

export function languageFromFile(fileName: string): string {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(fileName)) { return 'javascript'; }
  if (/\.py$/.test(fileName)) { return 'python'; }
  if (/\.java$/.test(fileName)) { return 'java'; }
  if (/\.go$/.test(fileName)) { return 'go'; }
  return 'javascript';
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'new', 'class', 'function', 'def', 'func']);

// Names for one raw parameter, per language. This is where the old
// code broke: it stripped every non-word character, so "int a" became
// "inta" and "List<String> items" became "ListStringitems". A typed
// parameter's name is the last identifier (Java) or the first (Go);
// a JS/TS/Python parameter's name survives its type annotation and
// default value. Destructuring expands to its field names.
export function paramNamesFor(raw: string, language: string): string[] {
  let p = raw.trim();
  if (!p) { return []; }
  p = p.replace(/^\.\.\./, '').replace(/^\*+/, '');
  if (p.startsWith('{') || p.startsWith('[')) {
    const eq = splitTopLevel(p);
    void eq;
    // Split off a default value at the top level: "{a, b} = {}".
    let pattern = p;
    let depth = 0; let quote = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (quote) { if (ch === '\\') { i += 1; } else if (ch === quote) { quote = ''; } continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { depth += 1; }
      else if (ch === ')' || ch === ']' || ch === '}') { depth -= 1; if (depth === 0 && (p[i] === '}' || p[i] === ']')) { pattern = p.slice(0, i + 1); break; } }
      else if (ch === '=' && depth === 0) { pattern = p.slice(0, i).trim(); break; }
    }
    const inner = pattern.slice(1, -1);
    const names: string[] = [];
    for (const field of splitTopLevel(inner)) {
      let f = field.trim().replace(/^\.\.\./, '').replace(/^\*+/, '');
      if (!f) { continue; }
      // "{a, b: c, d = 1}" -> a, c, d. A nested pattern recurses.
      if (f.startsWith('{') || f.startsWith('[')) { names.push(...paramNamesFor(f, language)); continue; }
      const beforeColon = splitTopLevel(f).length ? f : f;
      void beforeColon;
      let cut = f;
      let d2 = 0; let q2 = '';
      for (let i = 0; i < f.length; i++) {
        const ch = f[i];
        if (q2) { if (ch === '\\') { i += 1; } else if (ch === q2) { q2 = ''; } continue; }
        if (ch === "'" || ch === '"' || ch === '`') { q2 = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{' || ch === '<') { d2 += 1; }
        else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') { d2 = Math.max(0, d2 - 1); }
        else if ((ch === ':' || ch === '=') && d2 === 0) { cut = f.slice(0, i); break; }
      }
      const m = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(cut.trim());
      if (m) { names.push(m[0]); }
    }
    return names;
  }
  // Drop a default value, then a type annotation, at the top level.
  let left = p;
  {
    let depth = 0; let quote = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (quote) { if (ch === '\\') { i += 1; } else if (ch === quote) { quote = ''; } continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{' || ch === '<') { depth += 1; }
      else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') { depth = Math.max(0, depth - 1); }
      else if (ch === '=' && depth === 0) { left = p.slice(0, i).trim(); break; }
    }
  }
  if (language !== 'java' && language !== 'go') {
    let depth = 0; let quote = '';
    for (let i = 0; i < left.length; i++) {
      const ch = left[i];
      if (quote) { if (ch === '\\') { i += 1; } else if (ch === quote) { quote = ''; } continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{' || ch === '<') { depth += 1; }
      else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') { depth = Math.max(0, depth - 1); }
      else if (ch === ':' && depth === 0) { left = left.slice(0, i).trim(); break; }
    }
  }
  if (language === 'java') {
    left = left.replace(/@[A-Za-z_][A-Za-z0-9_.]*(\([^)]*\))?\s*/g, '').replace(/\bfinal\s+/g, '').replace(/\.\.\./g, '').trim();
    const ids = left.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
    return ids && ids.length ? [ids[ids.length - 1]] : [];
  }
  if (language === 'go') {
    const ids = left.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    return ids && ids.length ? [ids[0]] : [];
  }
  const ids = left.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
  return ids && ids.length ? [ids[ids.length - 1]] : [];
}

export function parseFunctions(text: string, language: string): ParsedFunction[] {
  const masked = maskStringsAndComments(text, language);
  const out: ParsedFunction[] = [];
  const lineOf = (idx: number): number => text.slice(0, idx).split('\n').length - 1;
  const nameStartBefore = (open: number): number => {
    let s = open;
    while (s > 0 && /\s/.test(masked[s - 1])) { s -= 1; }
    while (s > 0 && /[A-Za-z0-9_$]/.test(masked[s - 1])) { s -= 1; }
    return s;
  };
  const push = (name: string, paramsText: string, offset: number): void => {
    if (!name || KEYWORDS.has(name)) { return; }
    let raws = splitTopLevel(paramsText);
    let names = raws.flatMap((r) => paramNamesFor(r, language));
    if (language === 'python' && (names[0] === 'self' || names[0] === 'cls')) {
      names = names.slice(1);
      raws = raws.slice(1);
    }
    const line = lineOf(offset);
    if (!out.some((f) => f.name === name && f.line === line)) {
      out.push({ name, params: names, line, language, rawParams: raws });
    }
  };
  // After the closing paren, the next thing (ignoring a return-type
  // annotation) must be a body brace or, for a JS arrow, "=>".
  // A call statement ends in ";" instead, so this is what stops a
  // call like foo(a); from being mistaken for a method definition.
  const followsBody = (end: number): boolean => {
    const rest = masked.slice(end, end + 120);
    const semi = rest.indexOf(';');
    const brace = rest.indexOf('{');
    return brace !== -1 && (semi === -1 || brace < semi);
  };
  const followsArrow = (end: number): boolean => /^\s*(?::[^=\n]*?)?=>/.test(masked.slice(end, end + 120));
  let m: RegExpExecArray | null;
  if (language === 'python') {
    const re = /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
    while ((m = re.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
  } else if (language === 'java') {
    const re = /(?:public|private|protected|static|final|abstract|synchronized|native|\s)+([A-Za-z_][A-Za-z0-9_<>\[\],\s\?]*?)\s+([A-Za-z_][A-Za-z0-9_$]*)\s*\(/g;
    while ((m = re.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const nameStart = masked.lastIndexOf(m[2], open);
      if (nameStart > 0 && masked[nameStart - 1] === '.') { continue; }
      const bal = readBalancedParens(text, open, language);
      if (!bal) { continue; }
      const after = masked.slice(bal.end, bal.end + 200);
      if (!/^\s*(?:throws\s+[^{]+?)?\{/.test(after)) { continue; }
      push(m[2], bal.inside, nameStart);
    }
    const ctor = /(?:public|private|protected)\s+([A-Z][A-Za-z0-9_$]*)\s*\(/g;
    while ((m = ctor.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal && followsBody(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
  } else if (language === 'go') {
    const re = /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
    while ((m = re.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
  } else {
    const fnRe = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_][A-Za-z0-9_$]*)\s*\(/g;
    while ((m = fnRe.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal && followsBody(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
    const varRe = /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:function\s*\*?\s*)?\(/g;
    while ((m = varRe.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (!bal) { continue; }
      if (masked.slice(m.index, open).includes('function')) { if (followsBody(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); } }
      else if (followsArrow(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
    const singleRe = /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?([A-Za-z_][A-Za-z0-9_$]*)\s*=>/g;
    while ((m = singleRe.exec(masked)) !== null) { push(m[1], m[2], nameStartBefore(m.index + m[0].length - 2)); }
    const methodRe = /(?:^|[{\n,;])\s*(?:static\s+|async\s+|get\s+|set\s+|\*\s*)*([A-Za-z_][A-Za-z0-9_$]*)\s*\(/g;
    while ((m = methodRe.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal && followsBody(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
  }
  return out;
}

function sampleValue(param: string): string {
  const p = param.toLowerCase();
  if (/(count|num|age|qty|quantity|amount|price|total|index)/.test(p)) { return '2'; }
  if (/(name|title|email|text|msg|message|str|string)/.test(p)) { return '"hello"'; }
  if (/(flag|enabled|active|valid|is)/.test(p)) { return 'true'; }
  if (/(list|arr|items|data)/.test(p)) { return '[1, 2]'; }
  return '1';
}

export function testFileName(sourceFile: string, language: string): string {
  const base = sourceFile.replace(/\.[^.]+$/, '');
  if (language === 'python') { return `test_${base.split('/').pop()}.py`; }
  if (language === 'java') { return `${base}Test.java`; }
  if (language === 'go') { return `${base}_test.go`; }
  return `${base}.test.${sourceFile.split('.').pop() === 'ts' || sourceFile.endsWith('.tsx') ? 'ts' : 'js'}`;
}

export function generateTestFor(fn: ParsedFunction, sourceFile: string, extraPrompt = '', javaFramework = 'junit'): string {
  // Args come from the raw parameter text when the parser kept it, so
  // a destructured parameter becomes one object/array argument instead
  // of one argument per field, and a typed parameter keeps its name.
  const argFor = (raw: string): string => {
    const t = raw.trim();
    if (t.startsWith('{')) { const fields = paramNamesFor(t, fn.language); return `{ ${fields.map((f) => `${f}: ${sampleValue(f)}`).join(', ')} }`; }
    if (t.startsWith('[')) { const fields = paramNamesFor(t, fn.language); return `[${fields.map(sampleValue).join(', ')}]`; }
    return sampleValue(paramNamesFor(t, fn.language)[0] ?? t);
  };
  const rawList = fn.rawParams ?? fn.params;
  const args = fn.rawParams ? rawList.map(argFor).join(', ') : fn.params.map(sampleValue).join(', ');
  const nullArgs = rawList.map(() => 'null').join(', ');
  const undefArgs = rawList.map(() => 'undefined').join(', ');
  const nilArgs = rawList.map(() => 'nil').join(', ');
  const call = `${fn.name}(${args})`;
  const extra = extraPrompt.trim()
    ? `\n  // Extra case requested by the user: ${extraPrompt.trim().replace(/\n/g, ' ')}\n`
    : '';
  if (fn.language === 'python') {
    return `# Generated by AITestNova for ${fn.name} in ${sourceFile}\n# Review and edit before committing. Mock external calls as needed.\nimport pytest\nfrom ${sourceFile.replace(/\.py$/, '').split('/').pop()} import ${fn.name}\n\n\ndef test_${fn.name}_normal():\n    result = ${call}\n    assert result is not None\n\n\ndef test_${fn.name}_empty_and_none():\n${rawList.length === 0 ? `    ${fn.name}()` : `    for value in ([], "", None):\n        try:\n            ${fn.name}(*([value] * ${rawList.length}))\n        except (TypeError, ValueError):\n            pass`}\n${extra}`;
  }
  if (fn.language === 'java') {
    if (javaFramework === 'testng') {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Mock dependencies as needed.\nimport org.testng.annotations.Test;\nimport static org.testng.Assert.*;\n\npublic class ${fn.name}Test {\n  @Test public void normal() {\n    var result = ${call};\n    assertNotNull(result);\n  }\n  @Test public void edgeCases() {\n    ${fn.name}(${nullArgs});\n  }\n${extra}}\n`;
    }
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Mock dependencies as needed.\nimport org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass ${fn.name}Test {\n  @Test void normal() {\n    var result = ${call};\n    assertNotNull(result);\n  }\n  @Test void edgeCases() {\n    assertDoesNotThrow(() -> ${fn.name}(${nullArgs}));\n  }\n${extra}}\n`;
  }
  if (fn.language === 'go') {
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Mock dependencies as needed.\npackage main\n\nimport "testing"\n\nfunc Test${(fn.name[0] ?? 'F').toUpperCase()}${fn.name.slice(1)}_Normal(t *testing.T) {\n  got := ${call}\n  _ = got\n}\n\nfunc Test${(fn.name[0] ?? 'F').toUpperCase()}${fn.name.slice(1)}_Edge(t *testing.T) {\n  defer func() { _ = recover() }()\n  _ = ${fn.name}(${nilArgs})\n}\n${extra}`;
  }
  return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Mock dependencies as needed.\nimport { ${fn.name} } from './${sourceFile.split('/').pop()}';\n\ndescribe('${fn.name}', () => {\n  test('normal case', () => {\n    const result = ${call};\n    expect(result).not.toBeNull();\n  });\n  test('edge cases', () => {\n    expect(() => ${fn.name}(${nullArgs})).not.toThrow();\n    expect(() => ${fn.name}(${undefArgs})).not.toThrow();\n  });\n${extra}});\n`;
}

export function generateTestsForFile(text: string, sourceFile: string, extraPrompt = '', javaFramework = 'junit'): string {
  const lang = languageFromFile(sourceFile);
  const fns = parseFunctions(text, lang);
  if (fns.length === 0) { return `// AITestNova: no functions found in ${sourceFile}.\n`; }
  return fns.map((f) => generateTestFor(f, sourceFile, extraPrompt, javaFramework)).join('\n');
}

export function coverageDelta(baseline: number, current: number): { delta: number; improved: boolean } {
  const delta = Math.round((current - baseline) * 10) / 10;
  return { delta, improved: delta > 0 };
}

// Coverage: read the coverage files tools already produce, never invent numbers.
export function parseCoverageXml(xml: string): { lineRate: number; branchRate: number } | null {
  const line = /line-rate="([0-9.]+)"/.exec(xml);
  const branch = /branch-rate="([0-9.]+)"/.exec(xml);
  if (!line) { return null; }
  return { lineRate: Math.round(parseFloat(line[1]) * 1000) / 10, branchRate: branch ? Math.round(parseFloat(branch[1]) * 1000) / 10 : 0 };
}

export function parseJestCoverageJson(jsonText: string): { pct: number } | null {
  try {
    const data = JSON.parse(jsonText) as { total?: { lines?: { pct?: number } } };
    if (typeof data.total?.lines?.pct === 'number') { return { pct: data.total.lines.pct }; }
  } catch { /* not jest coverage */ }
  return null;
}

// Go coverprofile (what "go test -coverprofile=coverage.out" writes):
// one line per block, "file.go:line.col,line.col numStatements count".
// A block with count > 0 ran. Percentage = covered statements / total.
export function parseGoCoverprofile(text: string): { pct: number } | null {
  let total = 0; let covered = 0;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^[^:]+\.go:\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)\s*$/.exec(raw.trim());
    if (!m) { continue; }
    const stmts = Number(m[1]); const count = Number(m[2]);
    total += stmts;
    if (count > 0) { covered += stmts; }
  }
  if (!total) { return null; }
  return { pct: Math.round((covered / total) * 1000) / 10 };
}

// Multi-model evaluation scoring: count real test signals, not length alone.
// A candidate with more tests, assertions and edge cases scores higher;
// unbalanced braces are penalised. Deterministic, so it can be unit-tested.
export function scoreGeneratedTest(text: string): number {
  const testCount = (text.match(/test\(|it\(|def test_|@Test|func Test/g) || []).length;
  const assertCount = (text.match(/assert|expect\(/g) || []).length;
  const edgeCount = (text.match(/empty|null|undefined|edge|error/gi) || []).length;
  const opens = (text.match(/\{/g) || []).length;
  const closes = (text.match(/\}/g) || []).length;
  return testCount * 10 + assertCount * 3 + Math.min(edgeCount, 5) * 2 - Math.abs(opens - closes) * 5;
}

export function pickBestCandidate(candidates: { model: string; text: string }[]): { model: string; text: string; score: number } | null {
  let best: { model: string; text: string; score: number } | null = null;
  for (const c of candidates) {
    if (!c.text.trim()) { continue; }
    const score = scoreGeneratedTest(c.text);
    if (!best || score > best.score) { best = { model: c.model, text: c.text, score }; }
  }
  return best;
}

// Generate tests from a comment / spec selection, not from code.
// Case names come from the spec lines; the target is the first `code`
// identifier in the spec, or "target" as an explicit placeholder to replace.
export function generateTestsFromSpec(spec: string, language: string): string {
  const fnMatch = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(spec);
  const target = fnMatch ? fnMatch[1] : 'target';
  const cases: string[] = [];
  for (const raw of spec.split(/\r?\n/)) {
    let line = raw.replace(/^\s*(?:\/\/|#|\*)\s*/, '').replace(/`/g, '').trim()
      .replace(/^[-*•\d.)]+\s*/, '')
      .replace(/^(?:should|must|when|test|case)\s*:?\s*/i, '').trim();
    if (line.length < 3 || line.length > 90) { continue; }
    if (!cases.includes(line)) { cases.push(line); }
    if (cases.length >= 8) { break; }
  }
  if (cases.length === 0) { cases.push('handles a normal input'); }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'case';
  if (language === 'python') {
    return `# Generated by AITestNova from a comment/spec — target: ${target}\n# Replace 'target' with your real function and fill in the assertions.\nimport pytest\n\n${cases.map((c) => `def test_${slug(c)}():\n    # Spec: ${c}\n    # TODO: call ${target}() and assert the expected result\n    assert True\n`).join('\n')}`;
  }
  if (language === 'java') {
    return `// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real method and fill in the assertions.\nimport org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass SpecTest {\n${cases.map((c) => `  @Test void ${slug(c)}() {\n    // Spec: ${c}\n    // TODO: call target() and assert the expected result\n    assertTrue(true);\n  }\n`).join('')}}\n`;
  }
  return `// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real function and fill in the assertions.\ndescribe('${target}', () => {\n${cases.map((c) => `  test('${c.replace(/'/g, "\\'")}', () => {\n    // TODO: call ${target}() and assert the expected result\n    expect(true).toBe(true);\n  });\n`).join('')}});\n`;
}
