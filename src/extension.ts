import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import * as path from 'path';
import * as vscode from 'vscode';
import { coverageDelta, generateTestFor, generateTestsForFile, languageFromFile, parseCoverageXml, parseFunctions, parseJestCoverageJson, testFileName } from './testgen';
import { dedupRecorded, newId, replayTest, sendRequest, stabilityCheck, RecordedTest, ReplayResult } from './record';
import { detectStack, generateCIWorkflow } from './ci';

interface State { recorded: RecordedTest[]; extraPrompt: string; baselineCoverage?: number; lastCoverage?: number; lastReplay?: { pass: number; total: number; at: string }; normalizeVolatile?: boolean; }
function nonce(): string { return Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join(''); }

async function tryAI(context: vscode.ExtensionContext, fnCode: string, fileName: string): Promise<string | null> {
  const cfg = vscode.workspace.getConfiguration('aitestnova');
  const provider = cfg.get<string>('aiProvider') || 'template';
  if (provider === 'ollama') {
    const url = (cfg.get<string>('ollamaUrl') || 'http://localhost:11434').replace(/\/$/, '');
    const model = cfg.get<string>('ollamaModel') || 'qwen2.5-coder:7b';
    try {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${url}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt: `Write only unit tests for this code from ${fileName}. Include normal, empty and error cases. Do not explain.\n\n${fnCode}`, stream: false }), signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) { return null; }
      const data = await res.json() as { response?: string };
      return data.response?.trim() ? data.response : null;
    } catch { return null; }
  }
  if (provider === 'openai') {
    const key = await context.secrets.get('aitestnova.aiApiKey');
    if (!key) { vscode.window.showWarningMessage('AITestNova: no AI API key saved. Run "AITestNova: Set AI API Key" first — it is stored in the OS keychain, never in a file.'); return null; }
    const baseUrl = (cfg.get<string>('openaiBaseUrl') || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = cfg.get<string>('openaiModel') || 'gpt-4o-mini';
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: `Write only unit tests for this code from ${fileName}. Include normal, empty and error cases. Do not explain.\n\n${fnCode}` }] }) });
      if (!res.ok) { return null; }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }
  return null;
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
  postRecorded(): void { this.post('recorded', { tests: this.state.recorded }); }
  private readCoverageValue(folder: string): { value: number; rel: string } | null {
    const candidates = ['coverage/coverage.xml', 'coverage/cobertura-coverage.xml', 'coverage/coverage-final.json', 'coverage/coverage-summary.json'];
    for (const rel of candidates) {
      const p = path.join(folder, rel);
      if (!fs.existsSync(p)) { continue; }
      const text = fs.readFileSync(p, 'utf8');
      const xml = rel.endsWith('.xml') ? parseCoverageXml(text) : null;
      if (xml) { return { value: xml.lineRate, rel }; }
      const jest = rel.endsWith('.json') ? parseJestCoverageJson(text) : null;
      if (jest) { return { value: jest.pct, rel }; }
      return null;
    }
    return null;
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
    if (m.type === 'ready') { this.postRecorded(); return; }
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
        const results: ReplayResult[] = [];
        for (const t of this.state.recorded) { results.push(await replayTest(t, mock, Boolean(m.normalize))); }
        this.state.lastReplay = { pass: results.filter((r) => r.pass).length, total: results.length, at: new Date().toISOString() }; await this.save();
        this.post('apiResult', { text: this.summary(results) });
      } else {
        const runs = vscode.workspace.getConfiguration('aitestnova').get<number>('stabilityRuns') || 5;
        const lines: string[] = [];
        for (const t of this.state.recorded) { const s = await stabilityCheck(t, runs, mock, Boolean(m.normalize)); lines.push(`${s.stable ? 'STABLE' : 'FLAKY'} ${t.name} — ${s.results.filter((r) => r.pass).length}/${runs} passed`); }
        this.post('apiResult', { text: lines.join('\n') || 'No recorded tests.' });
      }
      return;
    }
    if (m.type === 'replayOne') {
      const t = this.state.recorded.find((x) => x.id === m.id);
      if (t) { const r = await replayTest(t, Boolean(m.mock), Boolean(m.normalize)); this.post('apiResult', { text: this.summary([r]) }); }
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
      this.state.lastCoverage = found.value; await this.save();
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

async function detectTestCommand(folder: string): Promise<string> {
  const cfg = vscode.workspace.getConfiguration('aitestnova').get<string>('testCommand');
  if (cfg) { return cfg; }
  if (fs.existsSync(path.join(folder, 'package.json'))) { return 'npm test'; }
  if (fs.existsSync(path.join(folder, 'go.mod'))) { return 'go test ./...'; }
  if (fs.existsSync(path.join(folder, 'pom.xml'))) { return 'mvn -B test'; }
  if (fs.existsSync(path.join(folder, 'requirements.txt')) || fs.existsSync(path.join(folder, 'pyproject.toml'))) { return 'pytest'; }
  return 'npm test';
}

async function runUnitStability(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) { vscode.window.showWarningMessage('AITestNova: open a workspace folder first.'); return; }
  const cmd = await detectTestCommand(folder);
  const runs = vscode.workspace.getConfiguration('aitestnova').get<number>('stabilityRuns') || 5;
  const out = vscode.window.createOutputChannel('AITestNova Unit Stability');
  out.show(); out.appendLine(`Running: ${cmd} (${runs} times)`);
  let passed = 0;
  for (let i = 1; i <= runs; i++) {
    try { await execAsync(cmd, { cwd: folder, timeout: 120000 }); passed += 1; out.appendLine(`Run ${i}: PASS`); }
    catch (e) { out.appendLine(`Run ${i}: FAIL — ${(e as Error).message.split('\n')[0]}`); }
  }
  const stable = passed === runs;
  vscode.window.showInformationMessage(`AITestNova unit stability: ${passed}/${runs} passed — ${stable ? 'STABLE' : 'FLAKY'}. See the AITestNova output channel for details.`);
}

async function openGenerated(content: string, fileName: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: fileName.endsWith('.py') ? 'python' : fileName.endsWith('.go') ? 'go' : fileName.endsWith('.java') ? 'java' : 'typescript', content });
  await vscode.window.showTextDocument(doc);
  providerRef?.post('preview', { text: content });
}

async function generateForFunctionAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('AITestNova: open a code file first.'); return; }
  const doc = editor.document; const lang = languageFromFile(doc.fileName);
  const fns = parseFunctions(doc.getText(), lang);
  if (!fns.length) { vscode.window.showWarningMessage('AITestNova: no functions found in this file.'); return; }
  const line = editor.selection.active.line;
  const fn = [...fns].sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0];
  const state = await currentState();
  const ai = extContext ? await tryAI(extContext, doc.getText().split('\n').slice(fn.line, fn.line + 40).join('\n'), doc.fileName) : null;
  const javaFramework = vscode.workspace.getConfiguration('aitestnova').get<string>('javaFramework') || 'junit';
  const content = ai ?? generateTestFor(fn, doc.fileName, state.extraPrompt, javaFramework);
  await openGenerated(content, testFileName(doc.fileName, lang));
  vscode.window.showInformationMessage(`AITestNova: test for ${fn.name} ready — review it, then save it where you want it.`);
}

async function generateForFile(extra = ''): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('AITestNova: open a code file first.'); return; }
  const doc = editor.document; const lang = languageFromFile(doc.fileName);
  const javaFramework = vscode.workspace.getConfiguration('aitestnova').get<string>('javaFramework') || 'junit';
  const content = generateTestsForFile(doc.getText(), doc.fileName, extra || (await currentState()).extraPrompt, javaFramework);
  await openGenerated(content, testFileName(doc.fileName, lang));
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
  providerRef = new AITestNovaProvider(context, stateCache);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('aitestnova.main', providerRef),
    vscode.languages.registerCodeLensProvider([{ language: 'javascript' }, { language: 'typescript' }, { language: 'python' }, { language: 'java' }, { language: 'go' }], new LensProvider()),
    vscode.commands.registerCommand('aitestnova.open', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); }),
    vscode.commands.registerCommand('aitestnova.generateFunction', generateForFunctionAtCursor),
    vscode.commands.registerCommand('aitestnova.generateFile', () => generateForFile()),
    vscode.commands.registerCommand('aitestnova.recordApi', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); vscode.window.showInformationMessage('AITestNova: use the Record & Replay tab — enter a URL and click Send & Record.'); }),
    vscode.commands.registerCommand('aitestnova.replayAll', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); }),
    vscode.commands.registerCommand('aitestnova.runStableCheck', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); }),
    vscode.commands.registerCommand('aitestnova.runUnitStability', runUnitStability),
    vscode.commands.registerCommand('aitestnova.setAiApiKey', async () => {
      const key = await vscode.window.showInputBox({ prompt: 'AITestNova AI API key (OpenAI-compatible)', password: true, ignoreFocusOut: true });
      if (key) { await context.secrets.store('aitestnova.aiApiKey', key); vscode.window.showInformationMessage('AITestNova: API key saved to the OS keychain. It is never written to a file.'); }
    }),
    vscode.commands.registerCommand('aitestnova.clearAiApiKey', async () => { await context.secrets.delete('aitestnova.aiApiKey'); vscode.window.showInformationMessage('AITestNova: API key removed from the keychain.'); }),
    vscode.commands.registerCommand('aitestnova.setCoverageBaseline', async () => { await vscode.commands.executeCommand('aitestnova.main.focus'); }),
    vscode.commands.registerCommand('aitestnova.addCIWorkflow', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) { vscode.window.showWarningMessage('AITestNova: open a workspace folder first.'); return; }
      const target = path.join(folder, '.github', 'workflows', 'aitestnova.yml');
      if (fs.existsSync(target)) { vscode.window.showWarningMessage('AITestNova: .github/workflows/aitestnova.yml already exists. Delete it first if you want to regenerate it.'); return; }
      const files = fs.readdirSync(folder);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, generateCIWorkflow(detectStack(files)));
      vscode.window.showInformationMessage('AITestNova: CI workflow created at .github/workflows/aitestnova.yml — review it before committing.');
    }),
  );
}
export function deactivate(): void { /* nothing to clean up */ }
