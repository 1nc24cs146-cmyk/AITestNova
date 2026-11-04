// Flaky quarantine + trends for AITestNova's recorded API tests.
// No vscode import, so it can be smoke-tested with plain Node.
//
// The dashboard already keeps the last 20 replay/coverage/stability
// runs, but only as totals. This module adds:
//  - per-test history: how many times each recorded test ran and failed
//  - trends: a pass-rate line for each of the last runs, as text bars
//  - quarantine: tests that failed at least once are flaky candidates;
//    quarantining them moves them into a "Quarantined (flaky)" suite
//    and excludes them from the normal "Replay all" run, so a flaky
//    test stops failing the whole suite. Quarantine is reversible.

export interface FlakyStat { runs: number; fails: number; lastFail?: string; }

export function recordFlakyStats(
  stats: Record<string, FlakyStat>,
  results: { id: string; pass: boolean }[],
  at: string,
): Record<string, FlakyStat> {
  const next = { ...stats };
  for (const r of results) {
    const prev = next[r.id] ?? { runs: 0, fails: 0 };
    next[r.id] = {
      runs: prev.runs + 1,
      fails: prev.fails + (r.pass ? 0 : 1),
      lastFail: r.pass ? prev.lastFail : at,
    };
  }
  return next;
}

export function flakyTestIds(stats: Record<string, FlakyStat>): string[] {
  return Object.entries(stats).filter(([, s]) => s.fails > 0).map(([id]) => id);
}

export function trendLines(history: { at: string; pass: number; total: number }[]): string[] {
  return history.map((h) => {
    const pct = h.total ? Math.round((h.pass / h.total) * 100) : 0;
    const bars = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    return `${h.at.slice(0, 16)}  ${bars} ${pct}% (${h.pass}/${h.total})`;
  });
}

export function quarantineSuiteName(): string { return 'Quarantined (flaky)'; }
