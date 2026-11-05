// Mutation score for AITestNova. No vscode import, so it can be
// smoke-tested with plain Node.
//
// Coverage only says lines ran. Mutation seeding says whether tests
// actually catch a bug: change one operator in the source, run the
// project's own test command, and see whether the tests fail.
//   killed   = tests failed with the mutant (good — the bug was caught)
//   survived = tests still passed with the mutant (bad — the bug slipped through)
//   unknown  = the run timed out or errored for another reason (excluded, never counted)
// If the baseline (unmutated) tests do not pass, no score is reported
// at all — a mutation score on a failing baseline would be invented.

import { maskStringsAndComments } from './textutil';

export interface Mutant {
  id: number; kind: string; description: string; line: number;
  originalLine: string; mutatedLine: string;
}

const REPLACEMENTS: { from: string; to: string; kind: string }[] = [
  { from: ' + ', to: ' - ', kind: 'arithmetic' },
  { from: ' - ', to: ' + ', kind: 'arithmetic' },
  { from: ' * ', to: ' / ', kind: 'arithmetic' },
  { from: ' / ', to: ' * ', kind: 'arithmetic' },
  { from: ' === ', to: ' !== ', kind: 'comparison' },
  { from: ' !== ', to: ' === ', kind: 'comparison' },
  { from: ' == ', to: ' != ', kind: 'comparison' },
  { from: ' < ', to: ' <= ', kind: 'comparison' },
  { from: ' > ', to: ' >= ', kind: 'comparison' },
  { from: ' && ', to: ' || ', kind: 'boolean' },
  { from: ' || ', to: ' && ', kind: 'boolean' },
  { from: ' and ', to: ' or ', kind: 'boolean' },
  { from: ' or ', to: ' and ', kind: 'boolean' },
  { from: 'true', to: 'false', kind: 'constant' },
  { from: 'false', to: 'true', kind: 'constant' },
  { from: 'True', to: 'False', kind: 'constant' },
  { from: 'False', to: 'True', kind: 'constant' },
];

export function generateMutants(sourceText: string, maxMutants = 8): Mutant[] {
  if (!Number.isFinite(maxMutants) || maxMutants <= 0) { return []; }
  const mutants: Mutant[] = [];
  // Mask the whole file first, not line by line, so an operator inside
  // a multi-line string or block comment is never mutated, and an
  // operator on a comment's continuation line is not mistaken for code.
  // The masked text keeps the original length, so an index found in it
  // applies to the original line too. Language is guessed from the
  // content (Python's "and"/"or"/True/False vs JS's &&/||/true/false);
  // both operator sets are checked, but only in code positions.
  const language = /\bdef\s+[A-Za-z_][\w]*\s*\(/.test(sourceText) && !/\bfunction\b/.test(sourceText) ? 'python' : 'javascript';
  const masked = maskStringsAndComments(sourceText, language);
  const maskedLines = masked.split(/\r?\n/);
  const lines = sourceText.split(/\r?\n/);
  const isWordChar = (ch: string | undefined): boolean => !!ch && /[A-Za-z0-9_$]/.test(ch);
  for (let i = 0; i < lines.length && mutants.length < maxMutants; i++) {
    const line = lines[i];
    const maskedLine = maskedLines[i] ?? '';
    if (!maskedLine.trim()) { continue; }
    for (const rep of REPLACEMENTS) {
      let idx = maskedLine.indexOf(rep.from);
      let found = -1;
      while (idx >= 0) {
        // Bare true/false/True/False must be whole words: "trueValue"
        // is a variable, not a constant to flip.
        if (!/^(true|false|True|False)$/.test(rep.from.trim()) || (!isWordChar(maskedLine[idx - 1]) && !isWordChar(maskedLine[idx + rep.from.length]))) {
          found = idx;
          break;
        }
        idx = maskedLine.indexOf(rep.from, idx + 1);
      }
      if (found >= 0) {
        const mutated = line.slice(0, found) + rep.to + line.slice(found + rep.from.length);
        mutants.push({
          id: mutants.length + 1, kind: rep.kind,
          description: `${rep.kind}: "${rep.from.trim()}" → "${rep.to.trim()}" on line ${i + 1}`,
          line: i + 1, originalLine: line, mutatedLine: mutated,
        });
        break; // one mutant per line, so the report stays readable
      }
    }
  }
  return mutants;
}

export function applyMutant(sourceText: string, mutant: Mutant): string {
  const lines = sourceText.split(/\r?\n/);
  if (mutant.line < 1 || mutant.line > lines.length) { return sourceText; }
  lines[mutant.line - 1] = mutant.mutatedLine;
  return lines.join('\n');
}

export function mutationScore(killed: number, survived: number): { score: number | null; total: number } {
  const total = killed + survived;
  if (total === 0) { return { score: null, total: 0 }; }
  return { score: Math.round((killed / total) * 1000) / 10, total };
}
