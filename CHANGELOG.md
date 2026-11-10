# Changelog — AITestNova

## 0.4.1

- **Targeted test generation:** two new commands. “AITestNova: Generate Tests for Uncovered Lines” reads the open file's uncovered lines from `coverage/coverage-final.json` (JS/TS) or `coverage/coverage.out` (Go) and generates tests that execute exactly those lines, with the surrounding code in the prompt. “AITestNova: Generate Tests to Kill Surviving Mutants” generates, for each mutant the last mutation run recorded as survived, a test that passes on the original code and fails on the mutant. Both use the configured provider/models (up to 3 models, best-scoring output wins) and the existing test-writing path, with the template generator as fallback. No coverage data, a fully covered file, or no survived mutants is reported as a plain message, not an error. Survived mutants are now stored per file after each mutation run.
- Tests: `test-041.js` (35 checks) covers uncovered-lines and mutant prompt construction, Go/Istanbul uncovered-line parsing, graceful empty states, template fallback targeting, and the existing write path.

## 0.4.0

- **JS/TS coverage per file (Health tab):** reads `coverage/coverage-final.json` and shows every file's coverage %, worst file first, with its uncovered lines and an overall %.
- **CI workflow generation, extended:** the generated workflow now uploads coverage as an artifact, can be run by hand (`workflow_dispatch`), and respects `aitestnova.testCommand` when set.
