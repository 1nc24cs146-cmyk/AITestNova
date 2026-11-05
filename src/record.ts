// Pure record/replay logic for AITestNova. No vscode import.
// Record = a real request sent from the panel, saved with its response.
// Replay = send the same request again and diff status + body against the
// recording. Mock mode = return the recorded response without calling the
// server, like Keploy's dependency virtualization, but at API level only.
// This is NOT kernel/eBPF capture: it only records requests made through
// this panel, not all traffic of a running app.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface RecordedTest {
  id: string; name: string; method: HttpMethod; url: string;
  headers: { key: string; value: string }[]; body: string;
  expectedStatus: number; expectedBody: string; recordedAt: string;
}
export interface ApiSuite { id: string; name: string; testIds: string[]; stopOnFailure: boolean; createdAt: string; }
export interface ReplayResult {
  id: string; name: string; pass: boolean; expectedStatus: number;
  actualStatus: number | null; statusMatch: boolean; bodyMatch: boolean;
  durationMs: number; error?: string; mocked?: boolean;
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export async function sendRequest(method: HttpMethod, url: string, headers: { key: string; value: string }[], body: string): Promise<{ status: number; bodyText: string; timeMs: number }> {
  // Fail fast with a readable message instead of letting fetch throw a
  // generic error for a mistyped URL or a non-HTTP scheme.
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { throw new Error(`Only http:// and https:// URLs can be sent, not ${parsed.protocol}`); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: headers.map((h) => [h.key, h.value] as [string, string]),
      body: method === 'GET' || method === 'DELETE' ? undefined : body,
      signal: controller.signal,
    });
    return { status: res.status, bodyText: await res.text(), timeMs: Date.now() - started };
  } finally { clearTimeout(timer); }
}

const VOLATILE_KEYS = new Set(['timestamp', 'createdat', 'updatedat', 'date', 'time', 'id', 'uuid', 'token', '_id', 'requestid', 'traceid']);
export function compareBodies(expected: string, actual: string, normalizeVolatile = false): boolean {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) { return v.map(canon); }
    if (v && typeof v === 'object') { return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !(normalizeVolatile && VOLATILE_KEYS.has(k.toLowerCase()))).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, canon(val)])); }
    return v;
  };
  try { return JSON.stringify(canon(JSON.parse(expected))) === JSON.stringify(canon(JSON.parse(actual))); }
  catch { return expected.trim() === actual.trim(); }
}

export function dedupRecorded(tests: RecordedTest[]): { deduped: RecordedTest[]; removed: number } {
  const seen = new Set<string>(); const deduped: RecordedTest[] = [];
  for (const test of tests) {
    // Headers are part of the identity: two tests that differ only by
    // an Authorization header are different tests, not duplicates.
    const headers = (test.headers ?? []).map((h) => `${h.key}:${h.value}`).sort().join('|');
    const key = `${test.method} ${test.url} ${test.body} ${headers}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(test); }
  }
  return { deduped, removed: tests.length - deduped.length };
}

export async function replayTest(test: RecordedTest, mockMode: boolean, normalizeVolatile = false): Promise<ReplayResult> {
  const started = Date.now();
  if (mockMode) {
    return {
      id: test.id, name: test.name, pass: true, expectedStatus: test.expectedStatus,
      actualStatus: test.expectedStatus, statusMatch: true, bodyMatch: true,
      durationMs: Date.now() - started, mocked: true,
    };
  }
  try {
    const res = await sendRequest(test.method, test.url, test.headers, test.body);
    const statusMatch = res.status === test.expectedStatus;
    const bodyMatch = compareBodies(test.expectedBody, res.bodyText, normalizeVolatile);
    return {
      id: test.id, name: test.name, pass: statusMatch && bodyMatch,
      expectedStatus: test.expectedStatus, actualStatus: res.status,
      statusMatch, bodyMatch, durationMs: res.timeMs,
    };
  } catch (err) {
    return {
      id: test.id, name: test.name, pass: false, expectedStatus: test.expectedStatus,
      actualStatus: null, statusMatch: false, bodyMatch: false,
      durationMs: Date.now() - started, error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Stability check: replay N times, keep only tests that pass every time.
// This mirrors Keploy's flake filtering, at API-replay level.
export async function stabilityCheck(test: RecordedTest, runs: number, mockMode: boolean, normalizeVolatile = false): Promise<{ stable: boolean; results: ReplayResult[] }> {
  // A run count of 0 (or a negative/garbage setting) used to report
  // "stable" with zero results — a vacuous pass. Clamp to at least 1.
  const safeRuns = Number.isFinite(runs) ? Math.max(1, Math.floor(runs)) : 1;
  const results: ReplayResult[] = [];
  for (let i = 0; i < safeRuns; i++) { results.push(await replayTest(test, mockMode, normalizeVolatile)); }
  return { stable: results.every((r) => r.pass), results };
}

// Readable, editable export: one YAML-ish block per recorded test.
// This is deliberately simple (no YAML library in the extension) and
// round-trips through the JSON import, not through YAML parsing.
export function recordedTestsToYaml(tests: RecordedTest[]): string {
  const esc = (s: string) => JSON.stringify(s);
  return tests.map((t) => `- name: ${esc(t.name)}\n  method: ${t.method}\n  url: ${esc(t.url)}\n  expectedStatus: ${t.expectedStatus}\n  body: ${esc(t.body)}\n  expectedBody: ${esc(t.expectedBody)}`).join('\n') + (tests.length ? '\n' : '');
}
