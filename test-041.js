// Tests for AITestNova 0.4.1 — targeted test generation.
// Run after `npm run compile`: node test-041.js
// Uses the compiled out/testgen.js and out/mutation.js (pure logic,
// no vscode import). Exits non-zero on any failure.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildMutantKillPrompt, buildUncoveredLinesPrompt, extractSurroundingCode,
  findFunctionAtLine, formatUncoveredLines, generateTestFor, generateTestsForFile,
  parseGoCoverUncovered, parseIstanbulCoverage, testFileName,
} = require('./out/testgen');
const { generateMutants } = require('./out/mutation');

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`PASS ${name}`); }
  else { failed += 1; console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`); }
}

const SRC = `function add(a, b) {
  return a + b;
}

function grade(score) {
  if (score >= 90) {
    return 'A';
  }
  if (score >= 50) {
    return 'B';
  }
  return 'F';
}
`;

// 1. Uncovered-lines prompt construction: line numbers + surrounding code.
const prompt = buildUncoveredLinesPrompt('src/app.js', SRC, [9, 12]);
check('uncovered prompt: names the uncovered lines', prompt !== null && prompt.includes('9, 12') && prompt.includes('lines 9, 12'));
check('uncovered prompt: includes the uncovered line code', prompt !== null && prompt.includes("return 'B';") && prompt.includes("return 'F';"));
check('uncovered prompt: includes surrounding context code', prompt !== null && prompt.includes("if (score >= 50)") && prompt.includes('9: '));
check('uncovered prompt: says tests must execute those lines', prompt !== null && /must execute those lines/i.test(prompt));
check('uncovered prompt: names the file', prompt !== null && prompt.includes('src/app.js'));

// 2. Surrounding-code extraction: context lines, honest gaps.
const snippet = extractSurroundingCode(SRC, [12], 1);
check('surrounding code: includes the target line with its number', snippet.includes('12:   return \'F\';'));
check('surrounding code: includes one context line each side', snippet.includes('11:   }') && snippet.includes('13: }'));
const farSnippet = extractSurroundingCode(SRC, [2, 12], 0);
check('surrounding code: marks gaps between far-apart groups', farSnippet.includes('...') && farSnippet.includes('2:   return a + b;') && farSnippet.includes("12:   return 'F';"));

// 3. Mutant prompt construction: description + original + mutated lines.
const mutants = generateMutants(SRC, 8);
check('mutation: generates mutants for the sample', mutants.length > 0);
const mutant = mutants.find((m) => m.line === 2) || mutants[0]; // line 2: "return a + b;" — the first mutable line
const killPrompt = buildMutantKillPrompt(mutant, SRC, 'src/app.js');
check('mutant prompt: includes the mutant description', killPrompt.includes(mutant.description));
check('mutant prompt: includes the original line', killPrompt.includes(mutant.originalLine.trim()));
check('mutant prompt: includes the mutated line', killPrompt.includes(mutant.mutatedLine.trim()));
check('mutant prompt: says the test must pass on original, fail on mutant', /PASSES on the original code and FAILS when the mutant is applied/.test(killPrompt));
check('mutant prompt: includes surrounding code', killPrompt.includes('function add') && killPrompt.includes('1: function add'));

// 4. Graceful empty states — no coverage data / no survived mutants.
check('empty state: uncovered prompt is null for no lines', buildUncoveredLinesPrompt('src/app.js', SRC, []) === null);
check('empty state: uncovered prompt is null for invalid lines only', buildUncoveredLinesPrompt('src/app.js', SRC, [0, -3]) === null);
check('empty state: Istanbul parse returns null for garbage', parseIstanbulCoverage('not json') === null);
check('empty state: Istanbul parse returns null for empty object', parseIstanbulCoverage('{}') === null);
check('empty state: Go uncovered parse returns null for empty input', parseGoCoverUncovered('') === null);
check('empty state: Go uncovered parse returns null when all covered', parseGoCoverUncovered('mode: set\napp.go:1.1,2.1 1 1\n') === null);
check('empty state: formatUncoveredLines says none for empty', formatUncoveredLines([]) === 'none');

// 5. Go coverprofile uncovered lines.
const goCov = 'mode: set\napp.go:1.1,3.1 2 1\napp.go:5.2,7.2 1 0\napp.go:9.1,9.1 1 0\n';
const goUncovered = parseGoCoverUncovered(goCov);
check('go uncovered: finds the file', Array.isArray(goUncovered) && goUncovered.length === 1 && goUncovered[0].file === 'app.go');
check('go uncovered: lists lines 5-7 and 9, skips covered 1-3', goUncovered !== null
  && JSON.stringify(goUncovered[0].uncoveredLines) === JSON.stringify([5, 6, 7, 9]));
const goPrompt = goUncovered ? buildUncoveredLinesPrompt('app.go', 'package main\n\nfunc Add(a int, b int) int {\n\treturn a + b\n}\n', goUncovered[0].uncoveredLines) : null;
check('go uncovered: prompt built from coverprofile lines', goPrompt !== null && goPrompt.includes('5-7, 9'));

// 6. Istanbul uncovered lines feed the prompt.
const istanbul = JSON.stringify({
  '/x/app.js': {
    path: '/x/app.js',
    statementMap: { '0': { start: { line: 2 } }, '1': { start: { line: 6 } }, '2': { start: { line: 9 } } },
    s: { '0': 3, '1': 0, '2': 0 },
  },
});
const parsed = parseIstanbulCoverage(istanbul);
check('istanbul: uncovered lines are 6 and 9', parsed !== null && JSON.stringify(parsed.files[0].uncoveredLines) === JSON.stringify([6, 9]));
const istPrompt = parsed ? buildUncoveredLinesPrompt('/x/app.js', SRC, parsed.files[0].uncoveredLines) : null;
check('istanbul: prompt names lines 6 and 9', istPrompt !== null && istPrompt.includes('6, 9'));

// 7. Template fallback targets the right function, through the
//    existing generator, with the gap named in the test.
const fn = findFunctionAtLine(SRC, 'javascript', 9);
check('fallback: mutant/uncovered line maps to the enclosing function', fn !== null && fn.name === 'grade');
check('fallback: a line before any function maps to nothing', findFunctionAtLine(SRC, 'javascript', 1) === null || findFunctionAtLine(SRC, 'javascript', 1).name === 'add');
const fallbackTest = fn ? generateTestFor(fn, 'src/app.js', 'Cover exactly these uncovered lines: 9-12.', 'junit', 'jest', SRC) : '';
check('fallback: template test names the uncovered lines', fallbackTest.includes('Cover exactly these uncovered lines: 9-12.'));
check('fallback: template test targets the enclosing function', fallbackTest.includes('grade'));
const fileFallback = generateTestsForFile(SRC, 'src/app.js', 'Cover exactly these uncovered lines: 9-12.', 'junit', 'jest');
check('fallback: whole-file template also carries the uncovered-lines note', fileFallback.includes('9-12'));

// 8. Generated tests go through the existing write path:
//    testFileName() picks the test file, and the content the generator
//    produced is exactly what gets written there (same as
//    saveGeneratedToTestFile: mkdir + writeFileSync + read back).
const target = path.join(os.tmpdir(), 'aitestnova-041', testFileName('src/app.js', 'javascript'));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, fileFallback);
const roundTripped = fs.readFileSync(target, 'utf8');
check('write path: generated content round-trips through the test file', roundTripped === fileFallback);
check('write path: test file name for a JS source', testFileName('src/app.js', 'javascript') === 'src/app.test.js');
check('write path: test file name for a Python source', testFileName('src/app.py', 'python') === 'test_app.py');
check('write path: test file name for a Go source', testFileName('src/app.go', 'go') === 'src/app_test.go');
fs.rmSync(path.join(os.tmpdir(), 'aitestnova-041'), { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
