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
  const mutants: Mutant[] = [];
  const lines = sourceText.split(/\r?\n/);
  for (let i = 0; i < lines.length && mutants.length < maxMutants; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) { continue; }
    for (const rep of REPLACEMENTS) {
      const idx = line.indexOf(rep.from);
      if (idx >= 0) {
        const mutated = line.slice(0, idx) + rep.to + line.slice(idx + rep.from.length);
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
  lines[mutant.line - 1] = mutant.mutatedLine;
  return lines.join('\n');
}

export function mutationScore(killed: number, survived: number): { score: number | null; total: number } {
  const total = killed + survived;
  if (total === 0) { return { score: null, total: 0 }; }
  return { score: Math.round((killed / total) * 1000) / 10, total };
}
