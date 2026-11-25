// Fix a failing test (0.4.4). Pure functions, no vscode import, so they
// can be smoke-tested with plain Node.
//
// The flow: the user runs their tests (the extension runs the configured
// test command once and reads the output), parseTestFailure pulls the
// first failure out of Jest / Vitest / node:test / pytest output, and
// suggestTestFix either rewrites the stale expectation in the test
// (the one fix that is safe to make from the test alone) or says plainly
// that the failure looks like a bug in the source, not the test. The AI
// path (buildFixTestPrompt) handles the rest; when neither can fix it,
// the caller shows the failure summary instead of inventing a fix.

export interface TestFailure {
  testName: string | null;
  message: string | null;
  expected: string | null;
  actual: string | null;
  file: string | null;
  line: number | null;
  framework: 'jest' | 'vitest' | 'node' | 'pytest' | 'unknown';
}

// Pull the first failure out of test-runner output. Jest, Vitest and
// node:test all print "Expected: X / Received: Y" (or the AssertionError
// "X !== Y" form); pytest prints "assert a == b" with an "E  ..." line
// and a "FAILED file.py::test_name" line. Returns null when the output
// has no recognisable failure — the caller then says so instead of
// guessing which test failed.
export function parseTestFailure(output: string): TestFailure | null {
  const text = String(output || '');
  if (!text.trim()) { return null; }
  const failure: TestFailure = { testName: null, message: null, expected: null, actual: null, file: null, line: null, framework: 'unknown' };
  // Test name: Jest/Vitest "✕ name" or "× name", node "✖ name",
  // pytest "FAILED path::name".
  const jestName = /[✕×✖]\s+(.+?)\s*(?:\(|$)/m.exec(text);
  const pytestName = /^FAILED\s+\S+::([A-Za-z_][A-Za-z0-9_]*)/m.exec(text);
  if (pytestName) { failure.testName = pytestName[1]; failure.framework = 'pytest'; }
  else if (jestName) { failure.testName = jestName[1].trim(); }
  // Expected / Received (Jest, Vitest, node:test).
  const expected = /Expected:\s*(.+)/.exec(text);
  const received = /Received:\s*(.+)/.exec(text);
  if (expected) { failure.expected = expected[1].trim(); }
  if (received) { failure.actual = received[1].trim(); }
  // Node AssertionError: "Expected values to be strictly equal:\n3 !== 4"
  // or "3 !== 4" on its own line.
  if (!failure.expected || !failure.actual) {
    const strict = /Expected values to be strictly[^\n]*\n\s*(.+?)\s*!==\s*(.+?)\s*(?:\n|$)/.exec(text);
    if (strict) { failure.actual = failure.actual ?? strict[1].trim(); failure.expected = failure.expected ?? strict[2].trim(); }
  }
  // pytest assertion detail: "E       assert 3 == 4" or "E       AssertionError: ..."
  if (!failure.expected || !failure.actual) {
    const pyAssert = /E\s+assert\s+(.+?)\s*==\s*(.+?)\s*(?:\n|$)/.exec(text);
    if (pyAssert) { failure.actual = failure.actual ?? pyAssert[1].trim(); failure.expected = failure.expected ?? pyAssert[2].trim(); }
  }
  // First message line: Jest "Error: ..." / "AssertionError: ...",
  // pytest "E   ..." lines, node "AssertionError [ERR_ASSERTION]: ...".
  const msgLine = text.split(/\r?\n/).find((l) => /^(?:\s*(?:Error|AssertionError)|E\s{2,}\S|.*AssertionError)/.test(l) && l.trim().length > 3);
  if (msgLine) { failure.message = msgLine.replace(/^E\s+/, '').trim().slice(0, 300); }
  // File + line of the failing assertion: "(src/add.test.js:12:15)" or
  // "test_add.py:7" in a traceback.
  const loc = /\(([^()\s]+\.(?:js|ts|tsx|jsx|py)):(\d+):\d+\)/.exec(text)
    || /File "([^"]+\.py)", line (\d+)/.exec(text);
  if (loc) { failure.file = loc[1]; failure.line = Number(loc[2]); }
  if (failure.framework === 'unknown') {
    if (/vitest/i.test(text)) { failure.framework = 'vitest'; }
    else if (/jest/i.test(text) || failure.expected !== null) { failure.framework = 'jest'; }
    else if (/AssertionError/.test(text)) { failure.framework = 'node'; }
  }
  // A failure needs at least a test name or an expected/actual pair or
  // a message — bare output with none of those is not a failure.
  if (!failure.testName && !failure.expected && !failure.actual && !failure.message) { return null; }
  return failure;
}

export interface TestFix {
  fixedTest: string | null;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  kind: 'stale-expectation' | 'source-bug' | 'missing-import' | 'unknown';
}

// The one template fix that is safe to make from the test alone: the
// test asserts a literal expected value and the code returned something
// else. Rewrite that literal to the actual value and say so in plain
// words — including the warning to check the actual value is right
// before keeping it, because a wrong actual is a source bug wearing a
// test's clothes. Anything else is reported, not rewritten:
// "X is not a function" / "Cannot read property" means the source is
// probably broken; "Cannot find module" names the missing import.
export function suggestTestFix(testText: string, failure: TestFailure): TestFix {
  const msg = `${failure.message ?? ''} ${failure.expected ?? ''} ${failure.actual ?? ''}`;
  if (/Cannot find module|Module not found|No module named/.test(msg)) {
    const mod = /Cannot find module '([^']+)'|Module not found:.*?['"]([^'"]+)['"]|No module named '([^']+)'/.exec(msg);
    const name = mod?.[1] ?? mod?.[2] ?? mod?.[3] ?? 'the module';
    return { fixedTest: null, confidence: 'medium', kind: 'missing-import', explanation: `The test failed because it cannot find the module "${name}". This is an import problem, not a wrong expectation — check the import path in the test file, or install the module, then re-run. AITestNova did not change the test.` };
  }
  if (/is not a function|Cannot read propert|Cannot read properties of undefined|is not defined|NoneType.*has no attribute|has no attribute/.test(msg)) {
    return { fixedTest: null, confidence: 'medium', kind: 'source-bug', explanation: `This looks like a bug in the source code, not in the test: ${failure.message ?? 'the code tried to use something that does not exist'}. Fixing the test would hide it. Check that the function is exported with the name the test imports, and that the value it is called on is not undefined, then re-run.` };
  }
  if (failure.expected !== null && failure.actual !== null && failure.expected !== failure.actual) {
    const expected = failure.expected;
    // Only rewrite a literal expectation: expect(x).toBe(3),
    // assert x == 3, assertEqual(x, 3). A computed expectation is
    // not rewritten — changing it would be guessing.
    const literal = /^(?:"[^"]*"|'[^']*'|`[^`]*`|-?\d+(?:\.\d+)?|true|false|null|undefined)$/.test(expected.trim());
    if (!literal) {
      return { fixedTest: null, confidence: 'low', kind: 'unknown', explanation: `The test expected ${expected} but got ${failure.actual}. The expectation is not a plain literal, so AITestNova will not rewrite it — changing a computed expectation would be guessing. Check whether the code or the expectation is wrong, then update the test by hand or ask the AI to fix it.` };
    }
    const esc = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Lazy match up to the assertion: expect(add(1, 2)) has nested
    // parens, so [^)]* stops at the wrong one.
    const jsRe = new RegExp(`(expect\\(.+?\\)\\.(?:toBe|toEqual|toStrictEqual)\\s*\\()${esc}(\\))`);
    const pyRe = new RegExp(`(assert\\s+.+?\\s*==\\s*)${esc}(\\s*(?:\n|$))`);
    const junitRe = new RegExp(`(assertEquals\\s*\\()${esc}(\\s*,)`);
    // node:test assert.equal / strictEqual / deepEqual: the expected
    // value is the second argument.
    const nodeAssertRe = new RegExp(`(assert\\.(?:strictEqual|equal|deepEqual|deepStrictEqual)\\s*\\(.+?,\\s*)${esc}(\\s*\\))`);
    let fixed = testText.replace(jsRe, `$1${failure.actual}$2`);
    if (fixed === testText) { fixed = testText.replace(pyRe, `$1${failure.actual}$2`); }
    if (fixed === testText) { fixed = testText.replace(junitRe, `$1${failure.actual}$2`); }
    if (fixed === testText) { fixed = testText.replace(nodeAssertRe, `$1${failure.actual}$2`); }
    if (fixed !== testText) {
      return { fixedTest: fixed, confidence: 'medium', kind: 'stale-expectation', explanation: `The test expected ${expected} but the code returned ${failure.actual}. AITestNova updated the expectation in the test to ${failure.actual}. Check first that ${failure.actual} is the right answer — if it is not, the bug is in the source code and the test was right all along.` };
    }
    return { fixedTest: null, confidence: 'low', kind: 'unknown', explanation: `The test expected ${expected} but got ${failure.actual}, and the expectation could not be found as a literal in the test file. Update the expectation by hand, or ask the AI to fix it — AITestNova will not guess where it lives.` };
  }
  return { fixedTest: null, confidence: 'low', kind: 'unknown', explanation: `AITestNova could not work out a safe fix from this failure${failure.message ? `: ${failure.message}` : ''}. It will not rewrite the test on a guess — ask the AI to fix it, or fix it by hand.` };
}

// Prompt for the AI path: the failing test, the failure as parsed, and
// the source around it. The model must return only the fixed test.
export function buildFixTestPrompt(testText: string, sourceText: string, failure: TestFailure): string {
  const lines: string[] = [];
  lines.push('Fix this failing test. Return only the complete fixed test file, no explanation.');
  if (failure.testName) { lines.push(`Failing test: ${failure.testName}`); }
  if (failure.message) { lines.push(`Failure: ${failure.message}`); }
  if (failure.expected !== null && failure.actual !== null) { lines.push(`Expected: ${failure.expected} — got: ${failure.actual}`); }
  lines.push('Rules: if the expectation in the test is stale, update it to the correct value. If the bug is in the source code, do NOT change the test to match the bug — instead keep the test as it is and say so in a comment at the top. Do not invent behaviour the source does not have.');
  if (sourceText.trim()) { lines.push(`\nSource code under test:\n${sourceText.slice(0, 4000)}`); }
  lines.push(`\nFailing test file:\n${testText.slice(0, 6000)}`);
  return lines.join('\n');
}
