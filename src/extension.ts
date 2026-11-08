import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import * as path from 'path';
import * as vscode from 'vscode';
import { coverageDelta, detectTestFramework, formatUncoveredLines, generateTestFor, generateTestsForFile, generateTestsFromSpec, languageFromFile, parseCoverageXml, parseFunctions, parseGoCoverprofile, parseIstanbulCoverage, parseJestCoverageJson, pickBestCandidate, testFileName } from './testgen';
import { ApiSuite, dedupRecorded, newId, recordedTestsToYaml, replayTest, sendRequest, stabilityCheck, RecordedTest, ReplayResult } from './record';
import { detectStack, generateCIWorkflow } from './ci';
import { checkSnapshots, heuristicCheck, TestSnapshot } from './stale';
import { applyMutant, generateMutants, mutationScore } from './mutation';
import { flakyTestIds, FlakyStat, quarantineSuiteName, recordFlakyStats, trendLines } from './flaky';
import { escapeHtml } from './textutil';

interface State { recorded: RecordedTest[]; extraPrompt: string; baselineCoverage?: number; lastCoverage?: number; lastReplay?: { pass: number; total: number; at: string }; normalizeVolatile?: boolean; suites?: ApiSuite[]; replayHistory?: { at: string; pass: number; total: number }[]; coverageHistory?: { at: string; value: number; rel: string }[]; stabilityHistory?: { at: string; pass: number; total: number }[]; testSnapshots?: TestSnapshot[]; flakyStats?: Record<string, FlakyStat>; quarantinedIds?: string[]; mutationHistory?: { at: string; file: string; score: number | null; killed: number; survived: number; unknown: number }[]; }
function nonce(): string { return Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join(''); }

async function tryAIMulti(context: vscode.ExtensionContext, fnCode: string, fileName: string): Promise<{ content: string; model: string; tried: string[] } | { failed: true; errors: string[] } | null> {
  const cfg = vscode.workspace.getConfiguration('aitestnova');
  const provider = cfg.get<string>('aiProvider') || 'template';
  if (provider !== 'ollama' && provider !== 'openai') { return null; }
  const listed = (cfg.get<string>('aiModels') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const fallback = provider === 'ollama' ? (cfg.get<string>('ollamaModel') || 'qwen2.5-coder:7b') : (cfg.get<string>('openaiModel') || 'gpt-4o-mini');
  const models = listed.length ? listed : [fallback];
  const prompt = `Write only unit tests for this code from ${fileName}. Include normal, empty and error cases. Do not explain.\n\n${fnCode}`;
  const candidates: { model: string; text: string }[] = [];
  const errors: string[] = [];
  if (provider === 'ollama') {
    const url = (cfg.get<string>('ollamaUrl') || 'http://localhost:11434').replace(/\/$/, '');
    for (const model of models) {
      try {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(`${url}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt, stream: false }), signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) { errors.push(`${model}: Ollama returned HTTP ${res.status}`); continue; }
        const data = await res.json() as { response?: string };
        if (data.response?.trim()) { candidates.push({ model, text: data.response }); }
        else { errors.push(`${model}: Ollama returned no text`); }
      } catch (e) { errors.push(`${model}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`); }
    }
  } else {
    const key = await context.secrets.get('aitestnova.aiApiKey');
    if (!key) { return { failed: true, errors: ['No AI API key saved. Run "AITestNova: Set AI API Key" first — it is stored in the OS keychain, never in a file.'] }; }
    const baseUrl = (cfg.get<string>('openaiBaseUrl') || 'https://api.openai.com/v1').replace(/\/$/, '');
    for (const model of models) {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }) });
        if (!res.ok) { errors.push(`${model}: API returned HTTP ${res.status}`); continue; }
        const data = await res.json() as { choices?: { message?: { content?: string } }[] };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) { candidates.push({ model, text }); }
        else { errors.push(`${model}: API returned no text`); }
      } catch (e) { errors.push(`${model}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`); }
    }
  }
  const best = pickBestCandidate(candidates);
  if (best) { return { content: best.text, model: best.model, tried: models }; }
  // No silent fallback: the caller tells the user the AI did not run
  // and why, then uses the template.
  return { failed: true, errors: errors.length ? errors : ['All models returned no text.'] };
}

class AITestNovaProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private context: vscode.ExtensionContext, private state: State) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    view.webview.html = fs.readFileSync(path.join(this.context.extensionPath, 'media', 'webview.html'), 'utf8').replace(/__NONCE__/g, nonce());
    view.webview.onDidReceiveMessage((m) => { void this.handle(m); });
  }
  post(type: string, extra: Record<string, unknown> = {}): void { this.view?.webview.postMessage({ type, ...extra }); }
  private async postDownloads(): Promise<void> {
    try {
      const res = await fetch('https://open-vsx.org/api/aitestnova/aitestnova');
      if (!res.ok) { this.post('downloads', { text: 'Open VSX downloads: unavailable right now' }); return; }
      const data = await res.json() as { downloadCount?: number; version?: string };
      this.post('downloads', { text: typeof data.downloadCount === 'number' ? `Open VSX downloads: ${data.downloadCount.toLocaleString()}${data.version ? ` · latest ${data.version}` : ''}` : 'Open VSX downloads: unavailable right now' });
    } catch { this.post('downloads', { text: 'Open VSX downloads: unavailable right now (offline?)' }); }
  }
  postRecorded(): void { this.post('recorded', { tests: this.state.recorded, quarantinedIds: this.state.quarantinedIds ?? [], flakyIds: flakyTestIds(this.state.flakyStats ?? {}) }); }
  postSuites(): void { this.post('suites', { suites: this.state.suites ?? [] }); }
  private async recordFlaky(results: ReplayResult[]): Promise<void> {
    if (!results.length) { return; }
    this.state.flakyStats = recordFlakyStats(this.state.flakyStats ?? {}, results, new Date().toISOString());
    await this.save();
  }
  private healthText(text: string): void {
    this.post('healthResult', { text });
    const out = vscode.window.createOutputChannel('AITestNova Health');
    out.show(); out.appendLine(text);
  }
  private async checkStale(): Promise<void> {
    const snaps = this.state.testSnapshots ?? [];
    if (!snaps.length) {
      this.healthText('Stale-test check: no snapshots yet.\nAITestNova records a snapshot (function name + parameters) every time it generates a test, starting with version 0.3.4. Generate a test, save it, change the function signature, then run this check again.\n\nOlder tests generated before 0.3.4 have no snapshot, so they cannot be checked definitely — the check below would be a guess, and AITestNova does not guess.');
      return;
    }
    const results = checkSnapshots(snaps,
      (file) => fs.existsSync(file) ? { text: fs.readFileSync(file, 'utf8'), language: languageFromFile(file) } : null,
      (file) => fs.existsSync(file),
      (text, language) => parseFunctions(text, language));
    const lines: string[] = [];
    for (const r of results) {
      lines.push(`${r.status === 'ok' ? 'OK' : r.status === 'stale' ? 'STALE' : r.status.toUpperCase()}  ${r.functionName} — ${r.detail}`);
      // Heuristic second opinion for saved test files.
      if (fs.existsSync(r.testFile) && fs.existsSync(r.sourceFile)) {
        const src = parseFunctions(fs.readFileSync(r.sourceFile, 'utf8'), languageFromFile(r.sourceFile));
        for (const h of heuristicCheck(src, fs.readFileSync(r.testFile, 'utf8'))) {
          lines.push(`  POSSIBLE STALE (heuristic)  ${h.functionName} — ${h.detail}`);
        }
      }
    }
    const staleCount = results.filter((r) => r.status === 'stale').length;
    const okCount = results.filter((r) => r.status === 'ok').length;
    const text = `Stale-test check: ${okCount} up to date, ${staleCount} stale, ${results.length - okCount - staleCount} other (not saved / source missing).\n\n${lines.join('\n')}\n\nStale tests are definite: their recorded signature no longer matches the code. Regenerate those tests. "Possible stale" lines are only a heuristic — mocks and wrappers can differ legitimately, so check them by hand.`;
    this.healthText(text);
    vscode.window.showInformationMessage(`AITestNova stale check: ${staleCount} stale test(s) out of ${results.length} snapshot(s). See the Health tab / output channel.`);
  }
  private async runMutation(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { this.healthText('Mutation score: open a code file first.'); return; }
    const doc = editor.document;
    if (doc.isDirty) { vscode.window.showWarningMessage('AITestNova: save the file first — mutation testing temporarily swaps the file on disk and must start from the saved version.'); return; }
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) { this.healthText('Mutation score: open a workspace folder first.'); return; }
    const original = doc.getText();
    const limit = vscode.workspace.getConfiguration('aitestnova').get<number>('mutationLimit') || 8;
    const mutants = generateMutants(original, limit);
    if (!mutants.length) { this.healthText('Mutation score: no mutable operators found in this file (no + - * / comparisons, boolean operators, or true/false constants on their own lines). Nothing to measure, so no score is reported.'); return; }
    const cmd = await detectTestCommand(folder);
    if (!cmd) {
      this.healthText('Mutation score: no test command detected and none is set.\nThis folder has no package.json, go.mod, pom.xml, requirements.txt or pyproject.toml. Set your test command in Settings → AITestNova: Test Command (e.g. "npm test" or "pytest"), then re-run. AITestNova will not guess a command for an unknown stack.');
      return;
    }
    const runOnce = async (timeoutMs: number): Promise<'pass' | 'fail' | 'unknown'> => {
      try { await execAsync(cmd, { cwd: folder, timeout: timeoutMs }); return 'pass'; }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if ((e as { signal?: string }).signal || /timed out/i.test(msg)) { return 'unknown'; }
        return 'fail';
      }
    };
    this.healthText(`Mutation score: running baseline first (${cmd})…`);
    if (await runOnce(120000) !== 'pass') {
      this.healthText(`Mutation score: ABORTED — the baseline test run failed (${cmd}). A mutation score on a failing baseline would be invented, so no score is reported. Fix the baseline tests first, then re-run.`);
      return;
    }
    let killed = 0; let survived = 0; let unknown = 0;
    const lines: string[] = [];
    for (const mutant of mutants) {
      try { fs.writeFileSync(doc.uri.fsPath, applyMutant(original, mutant)); } catch (e) { lines.push(`Mutant ${mutant.id}: SKIPPED — could not write file: ${e instanceof Error ? e.message : String(e)}`); unknown += 1; continue; }
      let outcome: 'pass' | 'fail' | 'unknown';
      try { outcome = await runOnce(60000); } finally { try { fs.writeFileSync(doc.uri.fsPath, original); } catch { /* restored below */ } }
      if (outcome === 'fail') { killed += 1; lines.push(`Mutant ${mutant.id}: KILLED — ${mutant.description}`); }
      else if (outcome === 'pass') { survived += 1; lines.push(`Mutant ${mutant.id}: SURVIVED — ${mutant.description} (tests still passed — this bug would slip through)`); }
      else { unknown += 1; lines.push(`Mutant ${mutant.id}: UNKNOWN — run timed out, excluded from the score`); }
    }
    if (fs.readFileSync(doc.uri.fsPath, 'utf8') !== original) {
      fs.writeFileSync(doc.uri.fsPath, original);
      lines.push('WARNING: the file was restored after the run — check it before continuing.');
    }
    const { score } = mutationScore(killed, survived);
    this.state.mutationHistory = [...(this.state.mutationHistory ?? []), { at: new Date().toISOString(), file: doc.fileName, score, killed, survived, unknown }].slice(-20);
    await this.save();
    const text = `Mutation score for ${path.basename(doc.fileName)} (${cmd}):\n${score === null ? 'No score — no mutant produced a clear killed/survived result.' : `Score: ${score}% (${killed} killed, ${survived} survived${unknown ? `, ${unknown} unknown excluded` : ''})`}\n\n${lines.join('\n')}\n\nScope, honestly: this score covers only the ${mutants.length} mutant(s) actually run in this file, not the whole codebase. A survived mutant means your tests did not catch that small change — add an assertion for it. The file was restored to its original content after every mutant.`;
    this.healthText(text);
    vscode.window.showInformationMessage(score === null ? 'AITestNova mutation: no score — no clear mutant results.' : `AITestNova mutation score: ${score}% (${killed} killed, ${survived} survived). See the Health tab / output channel.`);
  }
  private async quarantineFlaky(): Promise<void> {
    const ids = flakyTestIds(this.state.flakyStats ?? {});
    if (!ids.length) {
      this.healthText('Quarantine flaky tests: no flaky tests recorded yet.\nRun a Stability check (5×) or Replay all first — AITestNova only quarantines tests that have actually failed at least once, it does not guess which ones are flaky.');
      return;
    }
    const existing = new Set(this.state.quarantinedIds ?? []);
    ids.forEach((id) => existing.add(id));
    this.state.quarantinedIds = [...existing];
    const qName = quarantineSuiteName();
    const existingSuite = (this.state.suites ?? []).find((s) => s.name === qName);
    if (existingSuite) { existingSuite.testIds = [...new Set([...existingSuite.testIds, ...ids])]; }
    else { this.state.suites = [...(this.state.suites ?? []), { id: newId('suite'), name: qName, testIds: ids, stopOnFailure: false, createdAt: new Date().toISOString() }]; }
    await this.save(); this.postSuites(); this.postRecorded();
    const names = ids.map((id) => this.state.recorded.find((r) => r.id === id)?.name ?? id).join('\n- ');
    this.healthText(`Quarantined ${ids.length} flaky test(s) into the "${qName}" suite. They are now excluded from Replay all — run that suite on its own when you want to check them.\n\n- ${names}\n\nUse "Restore quarantined" to put them back into normal runs.`);
  }
  private async restoreQuarantined(): Promise<void> {
    const count = (this.state.quarantinedIds ?? []).length;
    this.state.quarantinedIds = [];
    this.state.suites = (this.state.suites ?? []).filter((s) => s.name !== quarantineSuiteName());
    await this.save(); this.postSuites(); this.postRecorded();
    this.healthText(`Restored ${count} quarantined test(s) to normal runs and removed the "${quarantineSuiteName()}" suite.`);
  }
  private showTrends(): void {
    const hist = this.state.replayHistory ?? [];
    const trend = hist.length ? trendLines(hist).join('\n') : 'No replay runs yet — run Replay all to start a trend.';
    const cov = (this.state.coverageHistory ?? []).slice(-10).map((h) => `${h.at.slice(0, 16)}: ${h.value}% (${h.rel})`).join('\n') || 'No coverage reads yet.';
    const flaky = Object.entries(this.state.flakyStats ?? {})
      .filter(([, s]) => s.fails > 0)
      .map(([id, s]) => `- ${(this.state.recorded.find((r) => r.id === id)?.name ?? id)}: ${s.fails}/${s.runs} failed${s.lastFail ? `, last fail ${s.lastFail.slice(0, 16)}` : ''}`)
      .join('\n') || 'No flaky tests recorded yet.';
    const quarantined = (this.state.quarantinedIds ?? []).map((id) => `- ${this.state.recorded.find((r) => r.id === id)?.name ?? id}`).join('\n') || 'None quarantined.';
    const mut = (this.state.mutationHistory ?? []).slice(-5).map((m) => `${m.at.slice(0, 16)}: ${path.basename(m.file)} — ${m.score === null ? 'no score' : `${m.score}%`} (${m.killed} killed, ${m.survived} survived)`).join('\n') || 'No mutation runs yet.';
    this.healthText(`Trends (last ${hist.length} replay run(s), dashboard keeps 20):\n${trend}\n\nCoverage trend:\n${cov}\n\nFlaky tests (failed at least once):\n${flaky}\n\nQuarantined:\n${quarantined}\n\nRecent mutation scores:\n${mut}`);
  }
  private readCoverageValue(folder: string): { value: number; rel: string } | { error: string; rel: string } | null {
    const candidates = ['coverage/coverage.xml', 'coverage/cobertura-coverage.xml', 'coverage/coverage-final.json', 'coverage/coverage-summary.json', 'coverage/coverage.out'];
    for (const rel of candidates) {
      const p = path.join(folder, rel);
      if (!fs.existsSync(p)) { continue; }
      try {
        const text = fs.readFileSync(p, 'utf8');
        const xml = rel.endsWith('.xml') ? parseCoverageXml(text) : null;
        if (xml) { return { value: xml.lineRate, rel }; }
        const jest = rel.endsWith('.json') ? parseJestCoverageJson(text) : null;
        if (jest) { return { value: jest.pct, rel }; }
        const go = rel.endsWith('.out') ? parseGoCoverprofile(text) : null;
        if (go) { return { value: go.pct, rel }; }
        return { error: 'found but could not be read', rel };
      } catch (e) { return { error: e instanceof Error ? e.message.split('\n')[0] : String(e), rel }; }
    }
    return null;
  }
  // JS/TS per-file coverage (0.4.0): parse the Istanbul coverage-final.json
  // the runner already wrote and show each file's % plus its uncovered
  // lines, worst file first — the same read-only, never-invent-numbers
  // rule as the Go coverprofile reader, and reported through the Health
  // tab like the stale check, mutation score and trends.
  private async showJsCoverage(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) { this.healthText('JS/TS coverage per file: open a workspace folder first.'); return; }
    const rel = 'coverage/coverage-final.json';
    const p = path.join(folder, rel);
    if (!fs.existsSync(p)) {
      this.healthText(`JS/TS coverage per file: no ${rel} found.\nRun your JS/TS tests with coverage first, e.g. jest --coverage or npx nyc npm test — AITestNova reads the file your runner writes, it does not measure coverage itself.`);
      return;
    }
    let parsed;
    try { parsed = parseIstanbulCoverage(fs.readFileSync(p, 'utf8')); } catch (e) { parsed = null; this.healthText(`JS/TS coverage per file: ${rel} was found but could not be read (${e instanceof Error ? e.message.split('\n')[0] : String(e)}). Re-run your tests with coverage to regenerate it.`); return; }
    if (!parsed) {
      this.healthText(`JS/TS coverage per file: ${rel} was found but contained no usable per-file statement data. Re-run your tests with coverage (jest --coverage) to regenerate it — AITestNova will not invent a number from a broken file.`);
      return;
    }
    const lines = parsed.files.map((f) => `${f.pct}%  ${path.relative(folder, f.file) || f.file}  (${f.covered}/${f.total} statements)${f.uncoveredLines.length ? `\n    uncovered lines: ${formatUncoveredLines(f.uncoveredLines)}` : '\n    fully covered'}`);
    this.healthText(`JS/TS coverage per file (${rel}) — overall ${parsed.overallPct}%:\n\n${lines.join('\n')}\n\nWorst file first. Uncovered lines are the statement starts Istanbul recorded with 0 hits.`);
  }
  private async save(): Promise<void> { await this.context.globalState.update('aitestnova.state', this.state); }
  private parseHeaders(text: string): { key: string; value: string }[] {
    return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(':'); return i > 0 ? { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim() } : { key: l, value: '' }; });
  }
  private summary(results: ReplayResult[]): string {
    const pass = results.filter((r) => r.pass).length;
    return `Replay: ${pass}/${results.length} passed` + results.map((r) => `\n${r.pass ? 'PASS' : 'FAIL'} ${r.name} — expected ${r.expectedStatus}, got ${r.actualStatus ?? 'error'}${r.error ? ` (${r.error})` : ''}${r.mocked ? ' [mock]' : ''}`).join('');
  }
  async handle(m: { type: string; [k: string]: unknown }): Promise<void> {
    if (m.type === 'ready') { this.postRecorded(); this.postSuites(); return; }
    if (m.type === 'downloads') { void this.postDownloads(); return; }
    if (m.type === 'stale') { await this.checkStale(); return; }
    if (m.type === 'jsCoverage') { await this.showJsCoverage(); return; }
    if (m.type === 'addCI') { await addCIWorkflow(); return; }
    if (m.type === 'mutation') { await this.runMutation(); return; }
    if (m.type === 'trends') { this.showTrends(); return; }
    if (m.type === 'quarantineFlaky') { await this.quarantineFlaky(); return; }
    if (m.type === 'restoreQuarantined') { await this.restoreQuarantined(); return; }
    if (m.type === 'saveGenerated') { await saveGeneratedToTestFile(); return; }
    if (m.type === 'updateExpected') {
      const t = this.state.recorded.find((x) => x.id === m.id);
      if (!t) { this.post('apiResult', { text: 'Test not found.' }); return; }
      try {
        const res = await sendRequest(t.method, t.url, t.headers, t.body);
        t.expectedStatus = res.status;
        t.expectedBody = res.bodyText;
        await this.save(); this.postRecorded();
        this.post('apiResult', { text: `Updated "${t.name}": expected status is now ${res.status} and the expected body was replaced with the latest response (${res.bodyText.length} characters). Replays will compare against the new response from now on.` });
      } catch (e) { this.post('apiResult', { text: `Could not re-send "${t.name}": ${e instanceof Error ? e.message : String(e)} Expected values were not changed.` }); }
      return;
    }
    if (m.type === 'saveExtra') { this.state.extraPrompt = String(m.extra || ''); await this.save(); return; }
    if (m.type === 'generateFile') { await generateForFile(this.state.extraPrompt); return; }
    if (m.type === 'sendRecord') {
      const method = String(m.method || 'GET') as RecordedTest['method']; const url = String(m.url || '');
      if (!url) { this.post('apiResult', { text: 'Enter a URL first.' }); return; }
      try {
        const res = await sendRequest(method, url, this.parseHeaders(String(m.headers || '')), String(m.body || ''));
        if (m.record) {
          this.state.recorded.push({ id: newId('rec'), name: `${method} ${url}`, method, url, headers: this.parseHeaders(String(m.headers || '')), body: String(m.body || ''), expectedStatus: res.status, expectedBody: res.bodyText, recordedAt: new Date().toISOString() });
          await this.save(); this.postRecorded();
        }
        this.post('apiResult', { text: `Status ${res.status} in ${res.timeMs} ms\n${res.bodyText.slice(0, 2000)}` });
      } catch (e) { this.post('apiResult', { text: `Error: ${e instanceof Error ? e.message : String(e)}` }); }
      return;
    }
    if (m.type === 'replayAll' || m.type === 'stability') {
      const mock = Boolean(m.mock);
      if (m.type === 'replayAll') {
        const quarantined = new Set(this.state.quarantinedIds ?? []);
        const toRun = this.state.recorded.filter((t) => !quarantined.has(t.id));
        const skipped = this.state.recorded.length - toRun.length;
        const results: ReplayResult[] = [];
        for (const t of toRun) { results.push(await replayTest(t, mock, Boolean(m.normalize))); }
        await this.recordFlaky(results);
        this.state.lastReplay = { pass: results.filter((r) => r.pass).length, total: results.length, at: new Date().toISOString() };
        this.state.replayHistory = [...(this.state.replayHistory ?? []), this.state.lastReplay].slice(-20); await this.save();
        this.post('apiResult', { text: this.summary(results) + (skipped ? `\nSkipped ${skipped} quarantined (flaky) test(s) — run the "${quarantineSuiteName()}" suite to check them.` : '') });
      } else {
        const runs = Math.max(1, vscode.workspace.getConfiguration('aitestnova').get<number>('stabilityRuns') || 5);
        const lines: string[] = [];
        for (const t of this.state.recorded) { const s = await stabilityCheck(t, runs, mock, Boolean(m.normalize)); await this.recordFlaky(s.results); lines.push(`${s.stable ? 'STABLE' : 'FLAKY'} ${t.name} — ${s.results.filter((r) => r.pass).length}/${runs} passed`); }
        this.post('apiResult', { text: lines.join('\n') || 'No recorded tests.' });
      }
      return;
    }
    if (m.type === 'replayOne') {
      const t = this.state.recorded.find((x) => x.id === m.id);
      if (t) { const r = await replayTest(t, Boolean(m.mock), Boolean(m.normalize)); await this.recordFlaky([r]); this.post('apiResult', { text: this.summary([r]) }); }
      return;
    }
    if (m.type === 'deleteRecorded') { this.state.recorded = this.state.recorded.filter((x) => x.id !== m.id); await this.save(); this.postRecorded(); return; }
    if (m.type === 'dedup') {
      const { deduped, removed } = dedupRecorded(this.state.recorded);
      this.state.recorded = deduped; await this.save(); this.postRecorded();
      this.post('apiResult', { text: `Removed ${removed} duplicate recorded test(s). ${deduped.length} remain.` });
      return;
    }
    if (m.type === 'coverage' || m.type === 'coverageBaseline' || m.type === 'coverageDelta') {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) { this.post('covResult', { text: 'Open a workspace folder first.' }); return; }
      const found = this.readCoverageValue(folder);
      if (!found) { this.post('covResult', { text: 'No coverage file found in coverage/. Run your tests with coverage first, e.g. jest --coverage or pytest --cov.' }); return; }
      if ('error' in found) { this.post('covResult', { text: `Coverage file ${found.rel} was found but could not be read (${found.error}). Re-run your tests with coverage to regenerate it — AITestNova will not invent a number from a broken file.` }); return; }
      this.state.lastCoverage = found.value;
      this.state.coverageHistory = [...(this.state.coverageHistory ?? []), { at: new Date().toISOString(), value: found.value, rel: found.rel }].slice(-20); await this.save();
      if (m.type === 'coverageBaseline') { this.state.baselineCoverage = found.value; await this.save(); this.post('covResult', { text: `Baseline set: ${found.value}% from ${found.rel}. Generate or change tests, re-run with coverage, then check the delta.` }); return; }
      if (m.type === 'coverageDelta') {
        if (this.state.baselineCoverage === undefined) { this.state.baselineCoverage = found.value; await this.save(); this.post('covResult', { text: `No baseline yet — set this ${found.value}% as baseline. Re-run with coverage after your new tests and check again.` }); return; }
        const d = coverageDelta(this.state.baselineCoverage, found.value);
        this.post('covResult', { text: `Baseline ${this.state.baselineCoverage}% → now ${found.value}% (delta ${d.delta >= 0 ? '+' : ''}${d.delta}%). ${d.improved ? 'Coverage improved — keep the new tests.' : 'No coverage improvement — review whether to keep the new tests; AITestNova does not delete them automatically.'}` });
        return;
      }
      this.post('covResult', { text: `${found.rel}: lines ${found.value}%${this.state.baselineCoverage !== undefined ? ` (baseline ${this.state.baselineCoverage}%)` : ''}` });
      return;
    }
    if (m.type === 'createSuite') {
      const name = String(m.name || '').trim() || `Suite ${((this.state.suites ?? []).length + 1)}`;
      const suite: ApiSuite = { id: newId('suite'), name, testIds: this.state.recorded.map((r) => r.id), stopOnFailure: true, createdAt: new Date().toISOString() };
      this.state.suites = [...(this.state.suites ?? []), suite]; await this.save(); this.postSuites();
      this.post('apiResult', { text: `Suite "${name}" created with ${suite.testIds.length} recorded test(s). Run it from the suite list.` });
      return;
    }
    if (m.type === 'deleteSuite') { this.state.suites = (this.state.suites ?? []).filter((s) => s.id !== m.id); await this.save(); this.postSuites(); return; }
    if (m.type === 'runSuite') {
      const suite = (this.state.suites ?? []).find((s) => s.id === m.id);
      if (!suite) { this.post('apiResult', { text: 'Suite not found.' }); return; }
      const results: ReplayResult[] = [];
      for (const id of suite.testIds) {
        const test = this.state.recorded.find((r) => r.id === id);
        if (!test) { continue; }
        const r = await replayTest(test, Boolean(m.mock), Boolean(m.normalize));
        results.push(r);
        if (!r.pass && suite.stopOnFailure) { break; }
      }
      await this.recordFlaky(results);
      this.post('apiResult', { text: `Suite "${suite.name}": ${this.summary(results)}` });
      return;
    }
    if (m.type === 'exportTests') {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) { this.post('apiResult', { text: 'Open a workspace folder first.' }); return; }
      try {
        fs.writeFileSync(path.join(folder, 'aitestnova-tests.json'), JSON.stringify(this.state.recorded, null, 2));
        fs.writeFileSync(path.join(folder, 'aitestnova-tests.yml'), recordedTestsToYaml(this.state.recorded));
      } catch (e) { this.post('apiResult', { text: `Could not export tests: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}` }); return; }
      this.post('apiResult', { text: `Exported ${this.state.recorded.length} recorded test(s) to aitestnova-tests.json and aitestnova-tests.yml in the workspace. Edit them, then use Command Palette → AITestNova: Import API Tests to load the JSON back.` });
      return;
    }
    if (m.type === 'generateFromSelection') { await generateFromSelection(); return; }
    if (m.type === 'dashboard') {
      const hist = (this.state.replayHistory ?? []).slice(-5).map((h) => `${h.at.slice(0, 16)}: ${h.pass}/${h.total}`).join('<br>') || 'no replays yet';
      const cov = (this.state.coverageHistory ?? []).slice(-5).map((h) => `${h.at.slice(0, 16)}: ${h.value}% (${escapeHtml(h.rel)})`).join('<br>') || 'no coverage reads yet';
      const stab = (this.state.stabilityHistory ?? []).slice(-5).map((h) => `${h.at.slice(0, 16)}: ${h.pass}/${h.total}`).join('<br>') || 'no unit stability runs yet';
      const trends = trendLines(this.state.replayHistory ?? []).slice(-10).join('<br>') || 'no replays yet — run Replay all to start a trend';
      const flaky = Object.entries(this.state.flakyStats ?? {}).filter(([, s]) => s.fails > 0).map(([id, s]) => `${escapeHtml(this.state.recorded.find((r) => r.id === id)?.name ?? id)}: ${s.fails}/${s.runs} failed`).join('<br>') || 'no flaky tests recorded yet';
      const quarantined = (this.state.quarantinedIds ?? []).map((id) => escapeHtml(this.state.recorded.find((r) => r.id === id)?.name ?? id)).join('<br>') || 'none';
      const totalReplays = (this.state.replayHistory ?? []).reduce((a, h) => a + h.total, 0);
      const totalPass = (this.state.replayHistory ?? []).reduce((a, h) => a + h.pass, 0);
      this.post('dashboard', { html: `<p>Recorded API tests: <b>${this.state.recorded.length}</b> · Suites: <b>${(this.state.suites ?? []).length}</b><br>All replays: <b>${totalPass}/${totalReplays} passed</b><br>Last replay: <b>${this.state.lastReplay ? `${this.state.lastReplay.pass}/${this.state.lastReplay.total}` : 'none'}</b> · Last coverage: <b>${this.state.lastCoverage !== undefined ? `${this.state.lastCoverage}%` : 'none'}</b></p><p><b>Recent replays</b><br>${hist}</p><p><b>Trend (pass rate per run)</b><br>${trends}</p><p><b>Flaky tests</b><br>${flaky}</p><p><b>Quarantined</b><br>${quarantined}</p><p><b>Recent coverage</b><br>${cov}</p><p><b>Recent unit stability</b><br>${stab}</p><p><small>Local dashboard only — no cloud, no telemetry. Use the Health tab to check stale tests, run a mutation score, or quarantine flaky tests.</small></p>` });
      return;
    }
    if (m.type === 'summary') {
      const total = this.state.recorded.length;
      const last = this.state.lastReplay ? `${this.state.lastReplay.pass}/${this.state.lastReplay.total} passed at ${this.state.lastReplay.at}` : 'no replay yet';
      const cov = this.state.lastCoverage !== undefined ? `${this.state.lastCoverage}%` : 'no coverage read yet';
      const base = this.state.baselineCoverage !== undefined ? `${this.state.baselineCoverage}%` : 'not set';
      this.post('summary', { html: `<p>Recorded API tests: <b>${total}</b><br>Last replay: <b>${last}</b><br>Last coverage: <b>${cov}</b> (baseline ${base})</p><p><small>Summary is local only. AITestNova has no dashboard or cloud reporting.</small></p>` });
      return;
    }
  }
}

let providerRef: AITestNovaProvider | undefined;
let extContext: vscode.ExtensionContext | undefined;

async function detectTestCommand(folder: string): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration('aitestnova').get<string>('testCommand');
  if (cfg) { return cfg; }
  if (fs.existsSync(path.join(folder, 'package.json'))) { return 'npm test'; }
  if (fs.existsSync(path.join(folder, 'go.mod'))) { return 'go test ./...'; }
  if (fs.existsSync(path.join(folder, 'pom.xml'))) { return 'mvn -B test'; }
  if (fs.existsSync(path.join(folder, 'requirements.txt')) || fs.existsSync(path.join(folder, 'pyproject.toml'))) { return 'pytest'; }
  return null;
}

async function runUnitStability(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) { vscode.window.showWarningMessage('AITestNova: open a workspace folder first.'); return; }
  const cmd = await detectTestCommand(folder);
  if (!cmd) { vscode.window.showWarningMessage('AITestNova: no test command detected for this folder and none is set. Set one in Settings → AITestNova: Test Command, then re-run.'); return; }
  const runs = Math.max(1, vscode.workspace.getConfiguration('aitestnova').get<number>('stabilityRuns') || 5);
  const out = vscode.window.createOutputChannel('AITestNova Unit Stability');
  out.show(); out.appendLine(`Running: ${cmd} (${runs} times)`);
  let passed = 0;
  for (let i = 1; i <= runs; i++) {
    try { await execAsync(cmd, { cwd: folder, timeout: 120000 }); passed += 1; out.appendLine(`Run ${i}: PASS`); }
    catch (e) { out.appendLine(`Run ${i}: FAIL — ${(e as Error).message.split('\n')[0]}`); }
  }
  const stable = passed === runs;
  if (stateCache) { stateCache.stabilityHistory = [...(stateCache.stabilityHistory ?? []), { at: new Date().toISOString(), pass: passed, total: runs }].slice(-20); if (extContext) { await extContext.globalState.update('aitestnova.state', stateCache); } }
  vscode.window.showInformationMessage(`AITestNova unit stability: ${passed}/${runs} passed — ${stable ? 'STABLE' : 'FLAKY'}. See the AITestNova output channel for details.`);
}

let lastGenerated: { content: string; fileName: string } | undefined;
async function openGenerated(content: string, fileName: string): Promise<void> {
  lastGenerated = { content, fileName };
  const doc = await vscode.workspace.openTextDocument({ language: fileName.endsWith('.py') ? 'python' : fileName.endsWith('.go') ? 'go' : fileName.endsWith('.java') ? 'java' : 'typescript', content });
  await vscode.window.showTextDocument(doc);
  providerRef?.post('preview', { text: content });
}

async function saveGeneratedToTestFile(): Promise<void> {
  if (!lastGenerated) { vscode.window.showWarningMessage('AITestNova: nothing generated yet in this session. Generate a test first, then save it.'); return; }
  const target = lastGenerated.fileName;
  if (fs.existsSync(target)) {
    const choice = await vscode.window.showWarningMessage(`AITestNova: ${path.basename(target)} already exists. Replace it with the newly generated test?`, 'Replace', 'Cancel');
    if (choice !== 'Replace') { return; }
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, lastGenerated.content);
    vscode.window.showInformationMessage(`AITestNova: test saved to ${target}. The stale check will find it there.`);
  } catch (e) { vscode.window.showErrorMessage(`AITestNova: could not save the test file — ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`); }
}

async function recordSnapshots(doc: vscode.TextDocument, fns: { name: string; params: string[] }[]): Promise<void> {
  if (!extContext) { return; }
  const state = await currentState();
  const existing = state.testSnapshots ?? [];
  for (const fn of fns) {
    const snap: TestSnapshot = { sourceFile: doc.fileName, functionName: fn.name, params: fn.params, testFile: testFileName(doc.fileName, languageFromFile(doc.fileName)), at: new Date().toISOString() };
    const idx = existing.findIndex((s) => s.sourceFile === snap.sourceFile && s.functionName === snap.functionName);
    if (idx >= 0) { existing[idx] = snap; } else { existing.push(snap); }
  }
  state.testSnapshots = existing;
  await extContext.globalState.update('aitestnova.state', state);
}

function resolveTestFramework(): 'jest' | 'vitest' | 'mocha' | 'node' | 'jasmine' {
  const configured = vscode.workspace.getConfiguration('aitestnova').get<string>('testFramework') || 'auto';
  if (configured !== 'auto') { return configured as 'jest' | 'vitest' | 'mocha' | 'node' | 'jasmine'; }
  // Auto: read the project's package.json and config files, if any.
  try {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!folder) { return 'jest'; }
    const root = folder.uri.fsPath;
    let pkg = '';
    try { pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8'); } catch { pkg = ''; }
    const configs: string[] = [];
    for (const name of ['vitest.config.ts', 'vitest.config.js', 'jest.config.js', 'jest.config.ts', '.mocharc.json', '.mocharc.yml', 'jasmine.json']) {
      try { if (fs.existsSync(path.join(root, name))) { configs.push(name); } } catch { /* ignore */ }
    }
    return detectTestFramework(pkg, configs);
  } catch { return 'jest'; }
}

async function generateForFunctionAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('AITestNova: open a code file first.'); return; }
  const doc = editor.document; const lang = languageFromFile(doc.fileName);
  if (lang === 'unknown') { vscode.window.showWarningMessage('AITestNova: this file type is not supported yet. Supported: JavaScript/TypeScript, Python, Java, Go, C, C++, C#, Rust, Ruby, PHP, Kotlin, Swift.'); return; }
  const fns = parseFunctions(doc.getText(), lang);
  if (!fns.length) { vscode.window.showWarningMessage('AITestNova: no functions found in this file.'); return; }
  const line = editor.selection.active.line;
  const fn = [...fns].sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0];
  const state = await currentState();
  const ai = extContext ? await tryAIMulti(extContext, doc.getText().split('\n').slice(fn.line, fn.line + 40).join('\n'), doc.fileName) : null;
  if (ai && 'failed' in ai) { vscode.window.showWarningMessage(`AITestNova: AI generation failed — ${ai.errors[0]}${ai.errors.length > 1 ? ` (+${ai.errors.length - 1} more)` : ''} Used the template instead.`); }
  const javaFramework = vscode.workspace.getConfiguration('aitestnova').get<string>('javaFramework') || 'junit';
  const content = ai && 'content' in ai ? ai.content : generateTestFor(fn, doc.fileName, state.extraPrompt, javaFramework, resolveTestFramework(), doc.getText());
  await openGenerated(content, testFileName(doc.fileName, lang));
  await recordSnapshots(doc, [fn]);
  vscode.window.showInformationMessage(ai && 'content' in ai ? `AITestNova: test for ${fn.name} ready — best of ${ai.tried.length} model(s): ${ai.model}. Review it, then save it.` : `AITestNova: test for ${fn.name} ready — review it, then save it where you want it.`);
}

async function generateForFile(extra = ''): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('AITestNova: open a code file first.'); return; }
  const doc = editor.document; const lang = languageFromFile(doc.fileName);
  const javaFramework = vscode.workspace.getConfiguration('aitestnova').get<string>('javaFramework') || 'junit';
  const content = generateTestsForFile(doc.getText(), doc.fileName, extra || (await currentState()).extraPrompt, javaFramework, resolveTestFramework());
  await openGenerated(content, testFileName(doc.fileName, lang));
  await recordSnapshots(doc, parseFunctions(doc.getText(), lang));
}

async function generateFromSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) { vscode.window.showWarningMessage('AITestNova: select a comment or spec in a code file first.'); return; }
  const doc = editor.document; const lang = languageFromFile(doc.fileName);
  const content = generateTestsFromSpec(editor.document.getText(editor.selection), lang);
  await openGenerated(content, testFileName(doc.fileName, lang));
  vscode.window.showInformationMessage('AITestNova: tests from your selection are ready — replace "target" with your real function and fill in the assertions.');
}

async function importTests(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'AITestNova JSON': ['json'] } });
  if (!picked?.length) { return; }
  try {
    const parsed = JSON.parse(fs.readFileSync(picked[0].fsPath, 'utf8')) as RecordedTest[];
    if (!Array.isArray(parsed)) { throw new Error('Not a list of tests'); }
    const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    const valid = parsed.filter((r) => r && methods.has(r.method) && typeof r.url === 'string' && r.url && typeof r.expectedStatus === 'number');
    const skipped = parsed.length - valid.length;
    const state = await currentState();
    const { deduped } = dedupRecorded([...state.recorded, ...valid]);
    state.recorded = deduped;
    if (extContext) { await extContext.globalState.update('aitestnova.state', state); }
    providerRef?.postRecorded();
    vscode.window.showInformationMessage(`AITestNova: imported tests — ${state.recorded.length} recorded test(s) now.${skipped ? ` ${skipped} invalid entr${skipped === 1 ? 'y' : 'ies'} skipped (bad method, missing URL, or non-numeric status).` : ''}`);
  } catch (e) { vscode.window.showErrorMessage(`AITestNova: could not import that file — ${e instanceof Error ? e.message : String(e)}`); }
}

async function commitGeneratedTests(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('AITestNova: open a saved test file first.'); return; }
  const doc = editor.document;
  if (doc.isUntitled) { vscode.window.showWarningMessage('AITestNova: save the generated test file first, then commit it.'); return; }
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  if (!folder) { vscode.window.showWarningMessage('AITestNova: that file is not in a workspace folder.'); return; }
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: folder });
    await execAsync(`git add ${JSON.stringify(path.relative(folder, doc.uri.fsPath))}`, { cwd: folder });
    await execAsync(`git commit -m ${JSON.stringify(`AITestNova: add tests for ${path.basename(doc.uri.fsPath)}`)}`, { cwd: folder });
    vscode.window.showInformationMessage('AITestNova: test file committed locally. Push is NOT done automatically — push from your Git client when you are ready.');
  } catch (e) { vscode.window.showErrorMessage(`AITestNova: could not commit — ${e instanceof Error ? e.message.split('\n')[0] : String(e)} (is this a git repo, and is there anything to commit?)`); }
}

async function addCIWorkflow(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) { vscode.window.showWarningMessage('AITestNova: open a workspace folder first.'); return; }
  const target = path.join(folder, '.github', 'workflows', 'aitestnova.yml');
  if (fs.existsSync(target)) { vscode.window.showWarningMessage('AITestNova: .github/workflows/aitestnova.yml already exists. Delete it first if you want to regenerate it.'); return; }
  const files = fs.readdirSync(folder);
  const testCommand = vscode.workspace.getConfiguration('aitestnova').get<string>('testCommand') || undefined;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generateCIWorkflow(detectStack(files), testCommand));
  vscode.window.showInformationMessage('AITestNova: CI workflow created at .github/workflows/aitestnova.yml — review it before committing.');
}

async function createPRDescription(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) { vscode.window.showWarningMessage('AITestNova: open a workspace folder first.'); return; }
  const state = await currentState();
  const last = state.lastReplay ? `${state.lastReplay.pass}/${state.lastReplay.total} passed` : 'no replay yet';
  const cov = state.lastCoverage !== undefined ? `${state.lastCoverage}%` : 'not measured';
  const body = `# AITestNova test PR\n\n- Recorded API tests: ${state.recorded.length}\n- Suites: ${(state.suites ?? []).length}\n- Last replay: ${last}\n- Last coverage: ${cov} (baseline: ${state.baselineCoverage !== undefined ? `${state.baselineCoverage}%` : 'not set'})\n\nGenerated with AITestNova. Review the tests before merging — template tests are starting points, not proof.\n`;
  fs.writeFileSync(path.join(folder, 'aitestnova-pr.md'), body);
  vscode.window.showInformationMessage('AITestNova: PR description written to aitestnova-pr.md — paste it into your pull request.');
}

let stateCache: State | undefined;
async function currentState(): Promise<State> { return stateCache ?? { recorded: [], extraPrompt: '' }; }

class LensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const lang = languageFromFile(doc.fileName);
    if (!['javascript', 'python', 'java', 'go'].includes(lang)) { return []; }
    return parseFunctions(doc.getText(), lang).map((f) => new vscode.CodeLens(new vscode.Range(f.line, 0, f.line, 0), { title: 'AITestNova: Generate test', command: 'aitestnova.generateFunction', tooltip: `Generate a unit test for ${f.name}` }));
  }
}

export function activate(context: vscode.ExtensionContext): void {
  extContext = context;
  const stored = context.globalState.get<State>('aitestnova.state');
  stateCache = stored && Array.isArray(stored.recorded) ? stored : { recorded: [], extraPrompt: '' };
  stateCache.suites = stateCache.suites ?? [];
  stateCache.replayHistory = stateCache.replayHistory ?? [];
  stateCache.coverageHistory = stateCache.coverageHistory ?? [];
  stateCache.stabilityHistory = stateCache.stabilityHistory ?? [];
  stateCache.testSnapshots = stateCache.testSnapshots ?? [];
  stateCache.flakyStats = stateCache.flakyStats ?? {};
  stateCache.quarantinedIds = stateCache.quarantinedIds ?? [];
  stateCache.mutationHistory = stateCache.mutationHistory ?? [];
  providerRef = new AITestNovaProvider(context, stateCache);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('aitestnova.main', providerRef),
    vscode.languages.registerCodeLensProvider([{ language: 'javascript' }, { language: 'typescript' }, { language: 'python' }, { language: 'java' }, { language: 'go' }, { language: 'c' }, { language: 'cpp' }, { language: 'csharp' }, { language: 'rust' }, { language: 'ruby' }, { language: 'php' }, { language: 'kotlin' }, { language: 'swift' }, { language: 'vue' }], new LensProvider()),
    vscode.commands.registerCommand('aitestnova.open', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); }),
    vscode.commands.registerCommand('aitestnova.generateFunction', generateForFunctionAtCursor),
    vscode.commands.registerCommand('aitestnova.generateFile', () => generateForFile()),
    vscode.commands.registerCommand('aitestnova.saveGeneratedTest', saveGeneratedToTestFile),
    vscode.commands.registerCommand('aitestnova.recordApi', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); vscode.window.showInformationMessage('AITestNova: use the Record & Replay tab — enter a URL and click Send & Record.'); }),
    vscode.commands.registerCommand('aitestnova.replayAll', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); }),
    vscode.commands.registerCommand('aitestnova.runStableCheck', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); }),
    vscode.commands.registerCommand('aitestnova.runUnitStability', runUnitStability),
    vscode.commands.registerCommand('aitestnova.checkStaleTests', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); await providerRef?.handle({ type: 'stale' }); }),
    vscode.commands.registerCommand('aitestnova.runMutationScore', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); await providerRef?.handle({ type: 'mutation' }); }),
    vscode.commands.registerCommand('aitestnova.quarantineFlakyTests', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); await providerRef?.handle({ type: 'quarantineFlaky' }); }),
    vscode.commands.registerCommand('aitestnova.showTrends', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); await providerRef?.handle({ type: 'trends' }); }),
    vscode.commands.registerCommand('aitestnova.generateFromSelection', generateFromSelection),
    vscode.commands.registerCommand('aitestnova.importTests', importTests),
    vscode.commands.registerCommand('aitestnova.exportTests', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); }),
    vscode.commands.registerCommand('aitestnova.commitTests', commitGeneratedTests),
    vscode.commands.registerCommand('aitestnova.createPRDescription', createPRDescription),
    vscode.commands.registerCommand('aitestnova.setAiApiKey', async () => {
      const key = await vscode.window.showInputBox({ prompt: 'AITestNova AI API key (OpenAI-compatible)', password: true, ignoreFocusOut: true });
      if (key) { await context.secrets.store('aitestnova.aiApiKey', key); vscode.window.showInformationMessage('AITestNova: API key saved to the OS keychain. It is never written to a file.'); }
    }),
    vscode.commands.registerCommand('aitestnova.clearAiApiKey', async () => { await context.secrets.delete('aitestnova.aiApiKey'); vscode.window.showInformationMessage('AITestNova: API key removed from the keychain.'); }),
    vscode.commands.registerCommand('aitestnova.setCoverageBaseline', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); }),
    vscode.commands.registerCommand('aitestnova.addCIWorkflow', addCIWorkflow),
  );
}
export function deactivate(): void { /* nothing to clean up */ }
