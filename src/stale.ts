// Stale-test detection for AITestNova. No vscode import, so it can be
// smoke-tested with plain Node.
//
// Two layers, kept deliberately separate in the report:
//  1. Definite: a snapshot taken when AITestNova generated a test. The
//     snapshot records the function name and its parameter names. If the
//     function is gone, or its parameters changed, the test is STALE.
//  2. Possible: a heuristic for saved test files. If a test calls a
//     function with a different number of arguments than the function
//     now takes, or calls a function that no longer exists, it is
//     flagged as POSSIBLE STALE — never as definite, because mocks,
//     overloads and wrappers can legitimately differ.

import { ParsedFunction } from './testgen';

export interface TestSnapshot {
  sourceFile: string; functionName: string; params: string[];
  testFile: string; at: string;
}

export type StaleStatus = 'ok' | 'stale' | 'possible-stale' | 'source-missing' | 'test-not-saved';

export interface StaleResult {
  functionName: string; sourceFile: string; testFile: string;
  status: StaleStatus; detail: string;
}

export function compareSignature(snapshot: TestSnapshot, current: ParsedFunction | undefined): StaleStatus {
  if (!current) { return 'stale'; }
  if (current.params.length !== snapshot.params.length) { return 'stale'; }
  for (let i = 0; i < snapshot.params.length; i++) {
    if (current.params[i] !== snapshot.params[i]) { return 'stale'; }
  }
  return 'ok';
}

export function checkSnapshots(
  snapshots: TestSnapshot[],
  readSource: (file: string) => { text: string; language: string } | null,
  testExists: (file: string) => boolean,
  parse: (text: string, language: string) => ParsedFunction[],
): StaleResult[] {
  return snapshots.map((snap) => {
    if (!testExists(snap.testFile)) {
      return { functionName: snap.functionName, sourceFile: snap.sourceFile, testFile: snap.testFile, status: 'test-not-saved', detail: 'Test file has not been saved yet — generate it, save it, then re-check.' };
    }
    const src = readSource(snap.sourceFile);
    if (!src) {
      return { functionName: snap.functionName, sourceFile: snap.sourceFile, testFile: snap.testFile, status: 'source-missing', detail: 'Source file not found in this workspace.' };
    }
    const current = parse(src.text, src.language).find((f) => f.name === snap.functionName);
    const status = compareSignature(snap, current);
    if (status === 'ok') {
      return { functionName: snap.functionName, sourceFile: snap.sourceFile, testFile: snap.testFile, status, detail: `Signature unchanged: ${snap.functionName}(${snap.params.join(', ')})` };
    }
    if (!current) {
      return { functionName: snap.functionName, sourceFile: snap.sourceFile, testFile: snap.testFile, status, detail: `Function ${snap.functionName} no longer exists in ${snap.sourceFile} — regenerate its test.` };
    }
    return { functionName: snap.functionName, sourceFile: snap.sourceFile, testFile: snap.testFile, status, detail: `Signature changed: was ${snap.functionName}(${snap.params.join(', ')}), now ${current.name}(${current.params.join(', ')}) — regenerate its test.` };
  });
}

// Heuristic: count the arguments in each call to a known function inside
// a test file. A mismatch is only "possible" staleness.
export function heuristicCheck(sourceFunctions: ParsedFunction[], testText: string): StaleResult[] {
  const results: StaleResult[] = [];
  for (const fn of sourceFunctions) {
    const re = new RegExp(`\\b${fn.name}\\s*\\(([^)]*)\\)`, 'g');
    let m: RegExpExecArray | null;
    let sawCall = false;
    while ((m = re.exec(testText)) !== null) {
      sawCall = true;
      const args = m[1].trim() ? m[1].split(',').map((a) => a.trim()).filter(Boolean) : [];
      if (args.length !== fn.params.length) {
        results.push({ functionName: fn.name, sourceFile: '', testFile: '', status: 'possible-stale', detail: `Test calls ${fn.name} with ${args.length} argument(s), but it now takes ${fn.params.length} (${fn.params.join(', ')}) — check whether the test is outdated.` });
        break;
      }
    }
    void sawCall;
  }
  // Calls to names that are not functions in the source any more.
  const called = new Set<string>();
  const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(testText)) !== null) { called.add(cm[1]); }
  const known = new Set(sourceFunctions.map((f) => f.name));
  const ignored = new Set(['test', 'it', 'describe', 'expect', 'assert', 'assertTrue', 'assertNotNull', 'assertDoesNotThrow', 'console', 'require', 'print', 'len', 'range']);
  for (const name of called) {
    if (!known.has(name) && !ignored.has(name) && /^[a-z]/.test(name)) {
      // Only flag names that look like project functions: they appear in
      // an import/from line of the test file.
      if (new RegExp(`import[^\\n]*\\b${name}\\b|from[^\\n]*import[^\\n]*\\b${name}\\b`).test(testText)) {
        results.push({ functionName: name, sourceFile: '', testFile: '', status: 'possible-stale', detail: `Test imports/calls ${name}, which is not a function in the source file any more — check whether the test is outdated.` });
      }
    }
  }
  return results;
}
