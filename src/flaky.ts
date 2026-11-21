// Flaky quarantine + trends + explanations for AITestNova's recorded API tests.
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
//  - explanations (0.4.3): why a flaky test is flaky, in plain words.
//    The recorder keeps the last 5 failures per test with the evidence
//    that matters — error text, duration, status vs body mismatch, what
//    the body differed by, and where in the batch the failure fell — and
//    the classifier reads that evidence instead of guessing. A test that
//    failed only once, or whose failures were recorded before 0.4.3 kept
//    the detail, honestly says there is not enough to tell yet.

export interface FlakyFailure {
  at: string; durationMs: number; error?: string;
  expectedStatus: number; actualStatus: number | null;
  statusMatch: boolean; bodyMatch: boolean; bodyDiff?: string;
  position: number; batchSize: number;
}

export interface FlakyStat { runs: number; fails: number; lastFail?: string; failures?: FlakyFailure[]; }

// A replay result, or the part of one the recorder needs. The extension
// passes full ReplayResult objects; the shape is kept open so plain-Node
// checks can build small fixtures without the whole record module.
export interface FlakyRunInput {
  id: string; pass: boolean; durationMs?: number; error?: string;
  expectedStatus?: number; actualStatus?: number | null;
  statusMatch?: boolean; bodyMatch?: boolean; bodyDiff?: string;
}

const MAX_FAILURES_KEPT = 5;

export function recordFlakyStats(
  stats: Record<string, FlakyStat>,
  results: FlakyRunInput[],
  at: string,
): Record<string, FlakyStat> {
  const next = { ...stats };
  results.forEach((r, i) => {
    const prev = next[r.id] ?? { runs: 0, fails: 0 };
    const failures = [...(prev.failures ?? [])];
    if (!r.pass) {
      failures.push({
        at,
        durationMs: r.durationMs ?? 0,
        error: r.error,
        expectedStatus: r.expectedStatus ?? 0,
        actualStatus: r.actualStatus ?? null,
        statusMatch: r.statusMatch ?? false,
        bodyMatch: r.bodyMatch ?? false,
        bodyDiff: r.bodyDiff,
        position: i,
        batchSize: results.length,
      });
    }
    next[r.id] = {
      runs: prev.runs + 1,
      fails: prev.fails + (r.pass ? 0 : 1),
      lastFail: r.pass ? prev.lastFail : at,
      failures: failures.slice(-MAX_FAILURES_KEPT),
    };
  });
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

// --- Explanations ---------------------------------------------------------

export type FlakyCause =
  | 'not-flaky' | 'not-enough-data' | 'connection' | 'timeout' | 'server-error'
  | 'volatile-body' | 'changing-body' | 'cold-start' | 'order-dependent'
  | 'slow-response' | 'mixed' | 'unknown';

export interface FlakyExplanation {
  cause: FlakyCause;
  headline: string;
  evidence: string[];
  fix: string;
  confidence: 'high' | 'medium' | 'low';
}

const CONNECTION_RE = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket hang up|fetch failed|Failed to fetch|network error|ERR_NETWORK/i;
const TIMEOUT_RE = /abort|timed out|timeout|ETIMEDOUT/i;
// AITestNova aborts a request after 30 seconds; a run that took nearly
// that long timed out even if the error text says something else.
const TIMEOUT_MS = 29_000;

function isConnectionError(err?: string): boolean { return !!err && CONNECTION_RE.test(err); }
function isTimeoutFailure(f: FlakyFailure): boolean {
  return (f.durationMs >= TIMEOUT_MS) || (!!f.error && TIMEOUT_RE.test(f.error));
}

// The last segment of a dotted key path, split on dots, underscores and
// camel-case boundaries — "items[0].createdAt" gives "at".
function lastKeySegment(diff?: string): string {
  if (!diff) { return ''; }
  const key = diff.split(' was ')[0].split(' has ')[0].trim();
  const tail = key.split('.').pop() ?? key;
  const parts = tail.replace(/\[.*?\]/g, '').split(/_|(?=[A-Z])/).filter(Boolean);
  return (parts.pop() ?? '').toLowerCase();
}

const VOLATILE_SEGMENTS = new Set([
  'timestamp', 'createdat', 'updatedat', 'date', 'time', 'at', 'id',
  'uuid', 'token', 'requestid', 'traceid', 'nonce', 'random', 'etag',
]);

function isVolatileDiff(diff?: string): boolean {
  return VOLATILE_SEGMENTS.has(lastKeySegment(diff));
}

function mostCommon(values: string[]): { value: string; count: number } | null {
  if (!values.length) { return null; }
  const counts = new Map<string, number>();
  for (const v of values) { counts.set(v, (counts.get(v) ?? 0) + 1); }
  let best: { value: string; count: number } | null = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) { best = { value, count }; }
  }
  return best;
}

export function explainFlaky(testName: string, stat: FlakyStat): FlakyExplanation {
  const runs = stat.runs;
  const fails = stat.fails;
  const failures = stat.failures ?? [];
  const base = `Failed ${fails} of ${runs} run${runs === 1 ? '' : 's'}.`;

  if (fails === 0) {
    return {
      cause: 'not-flaky',
      headline: `"${testName}" has not failed in any recorded run — there is nothing to explain.`,
      evidence: [base],
      fix: 'No action needed. If it starts failing, run the stability check (5×) and ask again.',
      confidence: 'high',
    };
  }
  if (!failures.length) {
    return {
      cause: 'not-enough-data',
      headline: `"${testName}" failed ${fails} time${fails === 1 ? '' : 's'}, but those failures were recorded before AITestNova kept the details — so the cause cannot be read from them.`,
      evidence: [base, 'No failure details were saved for those runs (recorded before version 0.4.3).'],
      fix: 'Run the stability check (5×) on this test, then ask for an explanation again — the new runs will carry the evidence.',
      confidence: 'low',
    };
  }
  if (failures.length === 1) {
    return {
      cause: 'not-enough-data',
      headline: `"${testName}" failed once out of ${runs} run${runs === 1 ? '' : 's'} — one failure is not enough to say why.`,
      evidence: [base, singleFailureLine(failures[0])],
      fix: 'Run the stability check (5×) on this test to collect more runs, then ask again. A pattern needs at least two failures to read.',
      confidence: 'low',
    };
  }

  const conn = failures.filter((f) => isConnectionError(f.error));
  const timeouts = failures.filter((f) => isTimeoutFailure(f));
  const serverErr = failures.filter((f) => f.actualStatus !== null && f.actualStatus >= 500);
  const volatile = failures.filter((f) => f.statusMatch && !f.bodyMatch && isVolatileDiff(f.bodyDiff));
  const changing = failures.filter((f) => f.statusMatch && !f.bodyMatch && !isVolatileDiff(f.bodyDiff));
  const positional = failures.some((f) => f.batchSize > 1);
  const coldStart = positional && failures.every((f) => f.position === 0);
  const orderDependent = positional && failures.every((f) => f.position > 0);
  const durations = failures.map((f) => f.durationMs).filter((d) => d > 0);
  const slowSpread = durations.length >= 2 && Math.max(...durations) > 1000
    && Math.max(...durations) > 3 * Math.min(...durations);

  // Each strong pattern is a cause; more than one means mixed.
  // Exception: when every failure was the first run of its batch, the
  // warm-up is the cause and the error text is only the mechanism — a
  // server that was down would fail the later runs too, not just the
  // first one. So cold-start replaces the other causes, and its evidence
  // still names what the first run actually said.
  const causes: FlakyCause[] = [];
  if (conn.length) { causes.push('connection'); }
  if (timeouts.length) { causes.push('timeout'); }
  if (serverErr.length) { causes.push('server-error'); }
  if (volatile.length) { causes.push('volatile-body'); }
  if (changing.length) { causes.push('changing-body'); }
  if (coldStart) { causes.push('cold-start'); }
  if (orderDependent) { causes.push('order-dependent'); }
  const finalCauses = coldStart ? (['cold-start'] as FlakyCause[]) : causes;
  const causesList = finalCauses;

  const evidence: string[] = [base];
  if (causesList.length === 1) {
    return { ...singleCause(testName, causesList[0], failures, { conn, timeouts, serverErr, volatile, changing, durations }), evidence: [...evidence, ...singleCauseEvidence(causesList[0], failures, { conn, timeouts, serverErr, volatile, changing, durations })], confidence: 'high' };
  }
  if (causesList.length > 1) {
    const names = causesList.map(causeLabel).join(', ');
    for (const c of causesList) { evidence.push(...singleCauseEvidence(c, failures, { conn, timeouts, serverErr, volatile, changing, durations })); }
    return {
      cause: 'mixed',
      headline: `"${testName}" is flaky for more than one reason — ${names}.`,
      evidence,
      fix: 'Fix the first one below, then run the stability check again to see what is left. One cause often hides another.',
      confidence: 'medium',
    };
  }
  if (slowSpread) {
    return {
      cause: 'slow-response',
      headline: `"${testName}" sometimes answers much slower than usual — the slow runs are the ones that fail.`,
      evidence: [...evidence, `Failed runs took between ${Math.min(...durations)} ms and ${Math.max(...durations)} ms.`],
      fix: 'Check what makes the server slow sometimes — a cold cache, a big response, or a busy machine. The test itself is probably fine.',
      confidence: 'medium',
    };
  }
  return {
    cause: 'unknown',
    headline: `"${testName}" failed ${fails} time${fails === 1 ? '' : 's'}, but the failures do not match a pattern I know.`,
    evidence: [...evidence, ...failures.map(singleFailureLine)],
    fix: 'Run the stability check (5×) again to collect more runs — a pattern usually shows up with a few more failures. The failure times are above, so you can check the server logs for them.',
    confidence: 'low',
  };
}

function singleFailureLine(f: FlakyFailure): string {
  if (f.error) { return `One failure at ${f.at.slice(0, 16)}: ${f.error.slice(0, 120)}`; }
  if (f.actualStatus !== null) { return `One failure at ${f.at.slice(0, 16)}: expected status ${f.expectedStatus}, got ${f.actualStatus}${f.bodyDiff ? ` — ${f.bodyDiff}` : ''}`; }
  return `One failure at ${f.at.slice(0, 16)}: the response did not match the recording${f.bodyDiff ? ` — ${f.bodyDiff}` : ''}.`;
}

function causeLabel(c: FlakyCause): string {
  switch (c) {
    case 'connection': return 'the server was not reachable';
    case 'timeout': return 'requests timed out';
    case 'server-error': return 'the server sometimes answered with an error';
    case 'volatile-body': return 'the response contains a value that changes every time';
    case 'changing-body': return 'the response data changes between runs';
    case 'cold-start': return 'it only fails on the first run';
    case 'order-dependent': return 'it only fails after other tests have run';
    default: return c;
  }
}

interface CauseGroups {
  conn: FlakyFailure[]; timeouts: FlakyFailure[]; serverErr: FlakyFailure[];
  volatile: FlakyFailure[]; changing: FlakyFailure[]; durations: number[];
}

function singleCause(testName: string, cause: FlakyCause, _failures: FlakyFailure[], _g: CauseGroups): { cause: FlakyCause; headline: string; fix: string; confidence: 'high' | 'medium' | 'low' } {
  switch (cause) {
    case 'connection':
      return {
        cause,
        headline: `"${testName}" is flaky because the server was not reachable when it failed — the test never got an answer, so it is not a wrong answer.`,
        fix: 'Make sure the server is running before you replay, and wait for it to finish starting. If the server starts slowly, replay once to warm it up first.',
        confidence: 'high',
      };
    case 'timeout':
      return {
        cause,
        headline: `"${testName}" is flaky because the request sometimes takes longer than AITestNova waits — it gives up after 30 seconds.`,
        fix: 'Check the server logs for the failure times — the endpoint is slow sometimes. If the endpoint is meant to be slow, split the work so one request answers faster; AITestNova stops waiting at 30 seconds.',
        confidence: 'high',
      };
    case 'server-error':
      return {
        cause,
        headline: `"${testName}" is flaky because the server itself sometimes answers with an error instead of the recorded status.`,
        fix: 'Check the server logs around the failure times — the test is fine, the server is the flaky part. Fix the server error and the test will stop failing.',
        confidence: 'high',
      };
    case 'volatile-body':
      return {
        cause,
        headline: `"${testName}" is flaky because the response contains a value that changes every time — the replay compares the whole body, so it fails even though the API is fine.`,
        fix: 'Turn on "Normalize volatile fields" in the Record & Replay tab before replaying — it ignores timestamps and ids when comparing bodies. Or click "Update expected" to re-record the latest response.',
        confidence: 'high',
      };
    case 'changing-body':
      return {
        cause,
        headline: `"${testName}" is flaky because the response data itself changes between runs — the recording no longer matches what the API returns.`,
        fix: 'If the data is supposed to change, click "Update expected" to re-record the latest response. If it is not supposed to change, the API is returning different data each time — check the server.',
        confidence: 'high',
      };
    case 'cold-start':
      return {
        cause,
        headline: `"${testName}" is flaky because it only fails on the first run — the server is still warming up, and later runs pass.`,
        fix: 'Replay once to warm the server up, then run the stability check. The first run after a start is the one that fails.',
        confidence: 'high',
      };
    case 'order-dependent':
      return {
        cause,
        headline: `"${testName}" is flaky because it never fails when it runs first — only after other tests have run, so something an earlier test does (or leaves behind) breaks it.`,
        fix: 'Run this test on its own — if it passes alone, check what the tests before it create, change or delete on the server. A test that depends on another test\'s leftovers is the usual cause.',
        confidence: 'high',
      };
    default:
      return { cause, headline: '', fix: '', confidence: 'low' };
  }
}

function singleCauseEvidence(cause: FlakyCause, failures: FlakyFailure[], g: CauseGroups): string[] {
  switch (cause) {
    case 'connection': {
      const common = mostCommon(g.conn.map((f) => f.error ?? '').filter(Boolean));
      return [`${g.conn.length} of ${failures.length} failure${failures.length === 1 ? '' : 's'} could not reach the server${common ? ` — most often: "${common.value.slice(0, 120)}"` : ''}.`];
    }
    case 'timeout': {
      const slowest = Math.max(...g.timeouts.map((f) => f.durationMs));
      return [`${g.timeouts.length} of ${failures.length} failure${failures.length === 1 ? '' : 's'} timed out — the slowest took ${slowest} ms (AITestNova gives up after 30,000 ms).`];
    }
    case 'server-error': {
      const statuses = [...new Set(g.serverErr.map((f) => f.actualStatus))].join(', ');
      const expected = g.serverErr[0]?.expectedStatus;
      return [`The server answered ${statuses} instead of ${expected} on ${g.serverErr.length} of ${failures.length} failure${failures.length === 1 ? '' : 's'}.`];
    }
    case 'volatile-body': {
      const diff = g.volatile[0]?.bodyDiff;
      return [`${g.volatile.length} of ${failures.length} failure${failures.length === 1 ? '' : 's'} had the right status but a body that differed only in a changing value${diff ? ` — ${diff}` : ''}.`];
    }
    case 'changing-body': {
      const diff = g.changing[0]?.bodyDiff;
      return [`${g.changing.length} of ${failures.length} failure${failures.length === 1 ? '' : 's'} had the right status but different response data${diff ? ` — ${diff}` : ''}.`];
    }
    case 'cold-start': {
      const mechanism = mostCommon(failures.map((f) => f.error ?? '').filter(Boolean));
      if (mechanism) { return ['Every failure was the first run of its batch; the later runs passed.', `What the first run said: "${mechanism.value.slice(0, 120)}".`]; }
      const diff = failures.find((f) => f.bodyDiff)?.bodyDiff;
      if (diff) { return ['Every failure was the first run of its batch; the later runs passed.', `What the first run returned: ${diff}.`]; }
      const status = failures.find((f) => f.actualStatus !== null)?.actualStatus;
      if (status !== undefined) { return ['Every failure was the first run of its batch; the later runs passed.', `The first run answered ${status} instead of the recorded status.`]; }
      return ['Every failure was the first run of its batch; the later runs passed.'];
    }
    case 'order-dependent':
      return ['It never failed when it ran first — only after other tests had already run.'];
    default:
      return [];
  }
}

export function formatFlakyExplanation(testName: string, stat: FlakyStat): string {
  const e = explainFlaky(testName, stat);
  const conf = e.confidence === 'high' ? 'High — every failure looked the same.'
    : e.confidence === 'medium' ? 'Medium — the pattern is there, but more runs would confirm it.'
    : 'Low — there is not enough evidence yet to be sure.';
  return `Why "${testName}" is flaky\n\n${e.headline}\n\nWhat I saw:\n${e.evidence.map((l) => `- ${l}`).join('\n')}\n\nWhat to do:\n${e.fix}\n\nConfidence: ${conf}`;
}
