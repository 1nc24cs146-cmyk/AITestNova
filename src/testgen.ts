// Pure test-generation logic for AITestNova. No vscode import, so it can be
// smoke-tested with plain Node. Generated tests are templates with real
// cases (normal, empty, null, error) — the user reviews them before saving.
// They are NOT copied from Keploy; they are original templates.

import { maskStringsAndComments, readBalancedParens, splitTopLevel } from './textutil';

export interface ParsedFunction { name: string; params: string[]; line: number; language: string; rawParams?: string[]; }

export function languageFromFile(fileName: string): string {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(fileName)) { return 'javascript'; }
  if (/\.py$/.test(fileName)) { return 'python'; }
  if (/\.java$/.test(fileName)) { return 'java'; }
  if (/\.go$/.test(fileName)) { return 'go'; }
  if (/\.c$/.test(fileName) || /\.h$/.test(fileName)) { return 'c'; }
  if (/\.(cpp|cc|cxx|hpp|hh)$/.test(fileName)) { return 'cpp'; }
  if (/\.cs$/.test(fileName)) { return 'csharp'; }
  if (/\.rs$/.test(fileName)) { return 'rust'; }
  if (/\.rb$/.test(fileName)) { return 'ruby'; }
  if (/\.php$/.test(fileName)) { return 'php'; }
  if (/\.(kt|kts)$/.test(fileName)) { return 'kotlin'; }
  if (/\.swift$/.test(fileName)) { return 'swift'; }
  if (/\.vue$/.test(fileName)) { return 'vue'; }
  return 'unknown';
}

// The languages AITestNova genuinely parses and generates tests for.
// Anything else is "unknown": generation says so instead of treating
// the file as JavaScript, which is what the old fallback did.
export const SUPPORTED_LANGUAGES = ['javascript', 'python', 'java', 'go', 'c', 'cpp', 'csharp', 'rust', 'ruby', 'php', 'kotlin', 'swift'];

// ---- JavaScript library training (0.3.7 source, no version bump yet) ----
// A plain function, a React component, a hook and an Express route all
// need different tests, and a project on Vitest does not want Jest
// syntax. These helpers recognise what the code actually is, so the
// generator writes the right kind of test instead of one shape for all.
export type TestFramework = 'jest' | 'vitest' | 'mocha' | 'node' | 'jasmine';

export function detectTestFramework(pkgJsonText = '', configFiles: string[] = []): TestFramework {
  const hay = `${pkgJsonText}\n${configFiles.join('\n')}`.toLowerCase();
  if (hay.includes('vitest')) { return 'vitest'; }
  if (hay.includes('jest')) { return 'jest'; }
  if (hay.includes('mocha')) { return 'mocha'; }
  if (hay.includes('jasmine') || hay.includes('karma')) { return 'jasmine'; }
  if (hay.includes('ts-node') || hay.includes('tsx') || hay.includes('node:test') || hay.includes("node --test")) { return 'node'; }
  // Angular's own default runner is Karma + Jasmine.
  if (hay.includes('@angular/core')) { return 'jasmine'; }
  return 'jest';
}

export function detectModuleSystem(sourceText: string, fileName: string, pkgType = ''): 'esm' | 'cjs' {
  if (fileName.endsWith('.mjs')) { return 'esm'; }
  if (fileName.endsWith('.cjs')) { return 'cjs'; }
  if (pkgType === 'module') { return 'esm'; }
  if (/\brequire\s*\(/.test(sourceText) || /module\.exports/.test(sourceText)) { return 'cjs'; }
  if (/^\s*import\s/m.test(sourceText) || /^\s*export\s/m.test(sourceText)) { return 'esm'; }
  return 'cjs';
}

export function isDefaultExport(sourceText: string, name: string): boolean {
  const re = new RegExp(`export\\s+default\\s+(?:function\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return re.test(sourceText);
}

export type ComponentKind = 'function' | 'component' | 'hook';

export function detectComponentKind(sourceText: string, fn: ParsedFunction): ComponentKind {
  if (/^use[A-Z]/.test(fn.name)) { return 'hook'; }
  if (!/^[A-Z]/.test(fn.name)) { return 'function'; }
  // A component is a capitalised function whose body returns JSX.
  const lines = sourceText.split('\n');
  const body = lines.slice(fn.line, fn.line + 120).join('\n');
  if (/return\s*\(?\s*</.test(body) || /return\s+<[A-Za-z]/.test(body)) { return 'component'; }
  return 'function';
}

export interface ExpressRoute { method: string; path: string; }

export function parseExpressRoutes(sourceText: string): ExpressRoute[] {
  const out: ExpressRoute[] = [];
  const re = /(?:app|router)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) {
    const route = { method: m[1].toUpperCase(), path: m[2] };
    if (!out.some((r) => r.method === route.method && r.path === route.path)) { out.push(route); }
  }
  return out;
}

export function generateRouteTests(routes: ExpressRoute[], sourceFile: string, framework: TestFramework = 'jest', moduleSystem: 'esm' | 'cjs' = 'esm'): string {
  const base = sourceFile.replace(/\.[^.]+$/, '').split('/').pop();
  const appImport = moduleSystem === 'cjs'
    ? `const request = require('supertest');\nconst app = require('./${base}');`
    : `import request from 'supertest';\nimport app from './${base}';`;
  const cases = routes.map((r) => {
    const samplePath = r.path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '1');
    const body = r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH'
      ? `await request(app).${r.method.toLowerCase()}('${samplePath}').send({});`
      : `await request(app).${r.method.toLowerCase()}('${samplePath}');`;
    if (framework === 'mocha') {
      return `  it('${r.method} ${r.path} responds', async () => {\n    const res = ${body}\n    assert.ok(res.status < 500);\n  });`;
    }
    if (framework === 'node') {
      return `  test('${r.method} ${r.path} responds', async () => {\n    const res = ${body}\n    assert.ok(res.status < 500);\n  });`;
    }
    return `  test('${r.method} ${r.path} responds', async () => {\n    const res = ${body}\n    expect(res.status).toBeLessThan(500);\n  });`;
  }).join('\n');
  if (framework === 'mocha') {
    return `// Generated by AITestNova for the Express routes in ${sourceFile}\n// Review and edit before committing. Requires supertest.\n${appImport}\nimport assert from 'node:assert/strict';\n\ndescribe('API routes', () => {\n${cases}\n});\n`;
  }
  if (framework === 'node') {
    return `// Generated by AITestNova for the Express routes in ${sourceFile}\n// Review and edit before committing. Requires supertest.\n${appImport}\nimport { describe, test } from 'node:test';\nimport assert from 'node:assert/strict';\n\ndescribe('API routes', () => {\n${cases}\n});\n`;
  }
  if (framework === 'vitest') {
    return `// Generated by AITestNova for the Express routes in ${sourceFile}\n// Review and edit before committing. Requires supertest.\n${appImport}\nimport { describe, test, expect } from 'vitest';\n\ndescribe('API routes', () => {\n${cases}\n});\n`;
  }
  return `// Generated by AITestNova for the Express routes in ${sourceFile}\n// Review and edit before committing. Requires supertest.\n${appImport}\n\ndescribe('API routes', () => {\n${cases}\n});\n`;
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'new', 'class', 'function', 'def', 'func']);

// Names for one raw parameter, per language. This is where the old
// code broke: it stripped every non-word character, so "int a" became
// "inta" and "List<String> items" became "ListStringitems". A typed
// parameter's name is the last identifier (Java) or the first (Go);
// a JS/TS/Python parameter's name survives its type annotation and
// default value. Destructuring expands to its field names.
export function paramNamesFor(raw: string, language: string): string[] {
  let p = raw.trim();
  if (!p) { return []; }
  p = p.replace(/^\.\.\./, '').replace(/^\*+/, '');
  if (language === 'php') { p = p.replace(/^\$/, ''); }
  if (language === 'rust') {
    // "&self" / "&mut self" -> self (dropped by the caller, like Python);
    // "mut a: i32" -> a; "a: &str" -> a.
    const r = p.replace(/^&+/, '').replace(/^mut\s+/, '').trim();
    if (r === 'self') { return ['self']; }
    const ids = r.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    return ids && ids.length ? [ids[0]] : [];
  }
  if (p.startsWith('{') || p.startsWith('[')) {
    const eq = splitTopLevel(p);
    void eq;
    // Split off a default value at the top level: "{a, b} = {}".
    let pattern = p;
    let depth = 0; let quote = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (quote) { if (ch === '\\') { i += 1; } else if (ch === quote) { quote = ''; } continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { depth += 1; }
      else if (ch === ')' || ch === ']' || ch === '}') { depth -= 1; if (depth === 0 && (p[i] === '}' || p[i] === ']')) { pattern = p.slice(0, i + 1); break; } }
      else if (ch === '=' && depth === 0) { pattern = p.slice(0, i).trim(); break; }
    }
    const inner = pattern.slice(1, -1);
    const names: string[] = [];
    for (const field of splitTopLevel(inner)) {
      let f = field.trim().replace(/^\.\.\./, '').replace(/^\*+/, '');
      if (!f) { continue; }
      // "{a, b: c, d = 1}" -> a, c, d. A nested pattern recurses.
      if (f.startsWith('{') || f.startsWith('[')) { names.push(...paramNamesFor(f, language)); continue; }
      const beforeColon = splitTopLevel(f).length ? f : f;
      void beforeColon;
      let cut = f;
      let d2 = 0; let q2 = '';
      for (let i = 0; i < f.length; i++) {
        const ch = f[i];
        if (q2) { if (ch === '\\') { i += 1; } else if (ch === q2) { q2 = ''; } continue; }
        if (ch === "'" || ch === '"' || ch === '`') { q2 = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{' || ch === '<') { d2 += 1; }
        else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') { d2 = Math.max(0, d2 - 1); }
        else if ((ch === ':' || ch === '=') && d2 === 0) { cut = f.slice(0, i); break; }
      }
      const m = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(cut.trim());
      if (m) { names.push(m[0]); }
    }
    return names;
  }
  // Drop a default value, then a type annotation, at the top level.
  let left = p;
  {
    let depth = 0; let quote = '';
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (quote) { if (ch === '\\') { i += 1; } else if (ch === quote) { quote = ''; } continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{' || ch === '<') { depth += 1; }
      else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') { depth = Math.max(0, depth - 1); }
      else if (ch === '=' && depth === 0) { left = p.slice(0, i).trim(); break; }
    }
  }
  if (language !== 'java' && language !== 'go') {
    let depth = 0; let quote = '';
    for (let i = 0; i < left.length; i++) {
      const ch = left[i];
      if (quote) { if (ch === '\\') { i += 1; } else if (ch === quote) { quote = ''; } continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{' || ch === '<') { depth += 1; }
      else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') { depth = Math.max(0, depth - 1); }
      else if (ch === ':' && depth === 0) { left = left.slice(0, i).trim(); break; }
    }
  }
  if (language === 'java' || language === 'c' || language === 'cpp' || language === 'csharp') {
    left = left.replace(/@[A-Za-z_][A-Za-z0-9_.]*(\([^)]*\))?\s*/g, '').replace(/\bfinal\s+/g, '').replace(/\bconst\s+/g, '').replace(/\*/g, '').replace(/&/g, '').replace(/\.\.\./g, '').trim();
    const ids = left.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
    return ids && ids.length ? [ids[ids.length - 1]] : [];
  }
  if (language === 'go' || language === 'kotlin') {
    const ids = left.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    return ids && ids.length ? [ids[0]] : [];
  }
  if (language === 'swift') {
    const ids = left.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (!ids || !ids.length) { return []; }
    if (ids[0] === '_') { return ids.length > 1 ? [ids[1]] : []; }
    return [ids[ids.length - 1]];
  }
  const ids = left.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
  return ids && ids.length ? [ids[ids.length - 1]] : [];
}

// ---- TypeScript framework training (0.3.7 source, no version bump) ----

export function isAsyncFunction(sourceText: string, fn: ParsedFunction): boolean {
  const line = sourceText.split('\n')[fn.line] ?? '';
  if (/\basync\b/.test(line.slice(0, line.indexOf(fn.name) === -1 ? undefined : line.indexOf(fn.name)))) { return true; }
  return /\basync\s+(function\s+)?\*?\s*\(/.test(line) || /=\s*async\b/.test(line);
}

export function returnsObservable(sourceText: string, fn: ParsedFunction): boolean {
  const lines = sourceText.split('\n');
  const decl = lines.slice(fn.line, fn.line + 3).join('\n');
  const afterName = decl.slice(decl.indexOf(fn.name) + fn.name.length);
  const head = afterName.slice(0, afterName.indexOf('{') === -1 ? afterName.length : afterName.indexOf('{'));
  return /:\s*Observable\s*</.test(head);
}

export function paramType(raw: string): string {
  let p = raw.trim();
  const eq = p.indexOf('=');
  if (eq !== -1) { p = p.slice(0, eq).trim(); }
  const colon = p.indexOf(':');
  if (colon === -1) { return ''; }
  const type = p.slice(colon + 1).trim().replace(/^\s*(public|private|protected|readonly)\s+/, '');
  const m = /[A-Za-z_][A-Za-z0-9_]*/.exec(type);
  return m ? m[0] : '';
}

export interface AngularClass { decorator: string; name: string; methods: ParsedFunction[]; deps: string[]; }

export function parseAngularClasses(sourceText: string): AngularClass[] {
  const masked = maskStringsAndComments(sourceText, 'javascript');
  const out: AngularClass[] = [];
  const re = /@(\w+)\s*\((?:[^()]|\([^()]*\))*\)\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const decorator = m[1];
    if (!['Component', 'Injectable', 'Directive', 'Pipe'].includes(decorator)) { continue; }
    const name = m[2];
    const brace = masked.indexOf('{', m.index + m[0].length);
    if (brace === -1) { continue; }
    let depth = 0; let end = -1;
    for (let i = brace; i < masked.length; i++) {
      if (masked[i] === '{') { depth += 1; }
      else if (masked[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) { continue; }
    const startLine = sourceText.slice(0, brace).split('\n').length - 1;
    const methods = parseFunctions(sourceText.slice(brace, end + 1), 'javascript')
      .filter((f) => f.name !== 'constructor')
      .map((f) => ({ ...f, line: f.line + startLine }));
    const bodyText = sourceText.slice(brace, end + 1);
    const ctor = /constructor\s*\(([^)]*)\)/.exec(bodyText);
    const deps = ctor ? splitTopLevel(ctor[1]).map(paramType).filter(Boolean) : [];
    out.push({ decorator, name, methods, deps });
  }
  return out;
}

export function generateAngularTest(cls: AngularClass, sourceFile: string, framework: TestFramework = 'jest'): string {
  const base = (sourceFile.split('/').pop() ?? '').replace(/\.(ts|tsx|js|jsx)$/, '');
  const vitestImport = framework === 'vitest' ? `import { describe, it, expect, beforeEach } from 'vitest';\n` : '';
  if (cls.decorator === 'Component' || cls.decorator === 'Directive') {
    return `// Generated by AITestNova for ${cls.name} in ${sourceFile}\n// Review and edit before committing. Requires Angular TestBed.\n${vitestImport}import { ComponentFixture, TestBed } from '@angular/core/testing';\nimport { ${cls.name} } from './${base}';\n\ndescribe('${cls.name}', () => {\n  let component: ${cls.name};\n  let fixture: ComponentFixture<${cls.name}>;\n\n  beforeEach(async () => {\n    await TestBed.configureTestingModule({\n      imports: [${cls.name}],\n    }).compileComponents();\n    fixture = TestBed.createComponent(${cls.name});\n    component = fixture.componentInstance;\n    fixture.detectChanges();\n  });\n\n  it('should create', () => {\n    expect(component).toBeTruthy();\n  });\n${cls.methods.slice(0, 4).map((f) => `\n  it('${f.name} runs', () => {\n    expect(() => (component as any).${f.name}(${f.params.map(sampleValue).join(', ')})).not.toThrow();\n  });`).join('')}\n});\n`;
  }
  return `// Generated by AITestNova for ${cls.name} in ${sourceFile}\n// Review and edit before committing. Requires Angular TestBed.\n${vitestImport}import { TestBed } from '@angular/core/testing';\nimport { ${cls.name} } from './${base}';\n\ndescribe('${cls.name}', () => {\n  let service: ${cls.name};\n\n  beforeEach(() => {\n    TestBed.configureTestingModule({});\n    service = TestBed.inject(${cls.name});\n  });\n\n  it('should be created', () => {\n    expect(service).toBeTruthy();\n  });\n${cls.methods.slice(0, 4).map((f) => `\n  it('${f.name} runs', () => {\n    expect(() => (service as any).${f.name}(${f.params.map(sampleValue).join(', ')})).not.toThrow();\n  });`).join('')}\n});\n`;
}

export interface NestRoute { method: string; path: string; handler: string; }
export interface NestController { name: string; basePath: string; routes: NestRoute[]; deps: string[]; }

export function parseNestControllers(sourceText: string): NestController[] {
  const masked = maskStringsAndComments(sourceText, 'javascript');
  const out: NestController[] = [];
  // Match decorators on the RAW text: the mask blanks string contents, so
  // a path like 'users' would come back as spaces.
  const re = /@Controller\s*\(\s*['"`]([^'"`]*)['"`]\s*\)\s*(?:export\s+)?class\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) {
    const basePath = m[1];
    const name = m[2];
    const brace = masked.indexOf('{', m.index + m[0].length);
    if (brace === -1) { continue; }
    let depth = 0; let end = -1;
    for (let i = brace; i < masked.length; i++) {
      if (masked[i] === '{') { depth += 1; }
      else if (masked[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) { continue; }
    const body = sourceText.slice(brace, end + 1);
    const routes: NestRoute[] = [];
    const routeRe = /@(Get|Post|Put|Patch|Delete|All)\s*\(\s*(?:['"`]([^'"`]*)['"`]\s*)?\)\s*(?:async\s+)?([A-Za-z_]\w*)\s*\(/g;
    let r: RegExpExecArray | null;
    while ((r = routeRe.exec(body)) !== null) {
      routes.push({ method: r[1].toUpperCase(), path: r[2] ?? '', handler: r[3] });
    }
    const ctor = /constructor\s*\(([^)]*)\)/.exec(body);
    const deps = ctor ? splitTopLevel(ctor[1]).map(paramType).filter(Boolean) : [];
    out.push({ name, basePath, routes, deps });
  }
  return out;
}

export function generateNestControllerTest(ctrl: NestController, sourceFile: string): string {
  const base = (sourceFile.split('/').pop() ?? '').replace(/\.(ts|tsx|js|jsx)$/, '');
  const full = (p: string) => {
    const joined = [ctrl.basePath, p].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/\/$/, '');
    return joined ? (joined.startsWith('/') ? joined : '/' + joined) : '/';
  };
  return `// Generated by AITestNova for ${ctrl.name} in ${sourceFile}\n// Review and edit before committing. Requires @nestjs/testing and supertest.\n// TODO: add providers for the controller's dependencies (${ctrl.deps.join(', ') || 'none detected'}) if the module needs them.\nimport { Test, TestingModule } from '@nestjs/testing';\nimport { INestApplication } from '@nestjs/common';\nimport * as request from 'supertest';\nimport { ${ctrl.name} } from './${base}';\n\ndescribe('${ctrl.name} (e2e)', () => {\n  let app: INestApplication;\n\n  beforeEach(async () => {\n    const moduleFixture: TestingModule = await Test.createTestingModule({\n      controllers: [${ctrl.name}],\n    }).compile();\n    app = moduleFixture.createNestApplication();\n    await app.init();\n  });\n${ctrl.routes.map((r) => `\n  it('${r.method} ${full(r.path)}', () => {\n    return request(app.getHttpServer()).${r.method.toLowerCase()}('${full(r.path).replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '1')}')${r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH' ? `.send({})` : ''}.expect((res: any) => {\n      if (res.status >= 500) { throw new Error('Server error: ' + res.status); }\n    });\n  });`).join('')}\n});\n`;
}

export function generateNestServiceTest(cls: AngularClass, sourceFile: string): string {
  const base = (sourceFile.split('/').pop() ?? '').replace(/\.(ts|tsx|js|jsx)$/, '');
  const mocks = cls.deps.map((d) => `        { provide: ${d}, useValue: {} },`).join('\n');
  return `// Generated by AITestNova for ${cls.name} in ${sourceFile}\n// Review and edit before committing. Requires @nestjs/testing.\n// TODO: replace each useValue mock with a real fake for that dependency.\nimport { Test, TestingModule } from '@nestjs/testing';\nimport { ${cls.name} } from './${base}';\n\ndescribe('${cls.name}', () => {\n  let service: ${cls.name};\n\n  beforeEach(async () => {\n    const module: TestingModule = await Test.createTestingModule({\n      providers: [${cls.name},${mocks ? '\n' + mocks : ''}\n      ],\n    }).compile();\n    service = module.get<${cls.name}>(${cls.name});\n  });\n\n  it('should be defined', () => {\n    expect(service).toBeDefined();\n  });\n${cls.methods.slice(0, 4).map((f) => `\n  it('${f.name} runs', async () => {\n    const result = await (service as any).${f.name}(${f.params.map(sampleValue).join(', ')});\n    expect(result).not.toBeUndefined();\n  });`).join('')}\n});\n`;
}

export function parseZodSchemas(sourceText: string): string[] {
  const out: string[] = [];
  const re = /const\s+([A-Za-z_]\w*)\s*=\s*z\.object\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) { out.push(m[1]); }
  return out;
}

export function generateZodTest(schemaName: string, sourceFile: string): string {
  const base = (sourceFile.split('/').pop() ?? '').replace(/\.(ts|tsx|js|jsx)$/, '');
  return `// Generated by AITestNova for ${schemaName} in ${sourceFile}\n// Review and edit before committing. Fill in real valid data for the schema.\nimport { ${schemaName} } from './${base}';\n\ndescribe('${schemaName}', () => {\n  test('accepts valid data', () => {\n    expect(() => ${schemaName}.parse({})).not.toThrow(); // TODO: fill in valid data\n  });\n\n  test('rejects invalid data', () => {\n    expect(() => ${schemaName}.parse(null)).toThrow();\n  });\n});\n`;
}

export function parseNextHandlers(sourceText: string): string[] {
  const out: string[] = [];
  const re = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) { out.push(m[1]); }
  return out;
}

export function generateNextHandlerTest(methods: string[], sourceFile: string): string {
  const base = (sourceFile.split('/').pop() ?? '').replace(/\.(ts|tsx|js|jsx)$/, '');
  return `// Generated by AITestNova for the Next.js route handlers in ${sourceFile}\n// Review and edit before committing. The request URL is a placeholder.\nimport { ${methods.join(', ')} } from './${base}';\n\ndescribe('route handlers', () => {\n${methods.map((m) => `  test('${m} returns a response', async () => {\n    const res = await ${m}(new Request('http://localhost/api'));\n    expect(res.status).toBeLessThan(500);\n  });`).join('\n')}\n});\n`;
}

// ---- Python library training (0.3.7 source, no version bump) ----

export type PythonFramework = 'flask' | 'django' | 'fastapi' | 'plain';

export function detectPythonFramework(sourceText: string): PythonFramework {
  if (/from\s+fastapi\s+import|import\s+fastapi/.test(sourceText)) { return 'fastapi'; }
  if (/from\s+flask\s+import|import\s+flask/.test(sourceText)) { return 'flask'; }
  if (/from\s+django|import\s+django/.test(sourceText)) { return 'django'; }
  return 'plain';
}

export function detectPythonTestStyle(sourceText: string): 'pytest' | 'unittest' {
  return /import\s+unittest|from\s+unittest/.test(sourceText) ? 'unittest' : 'pytest';
}

export interface WebRoute { method: string; path: string; }

export function parseFlaskRoutes(sourceText: string): WebRoute[] {
  const out: WebRoute[] = [];
  const re = /@(?:\w+\.)?route\s*\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*methods\s*=\s*\[([^\]]*)\])?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) {
    const methods = m[2] ? m[2].split(',').map((s) => s.replace(/['"\s]/g, '').toUpperCase()).filter(Boolean) : ['GET'];
    const path = m[1];
    for (const method of methods) {
      if (!out.some((r) => r.method === method && r.path === path)) { out.push({ method, path }); }
    }
  }
  const shortRe = /@(?:\w+\.)?(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = shortRe.exec(sourceText)) !== null) {
    const route = { method: m[1].toUpperCase(), path: m[2] };
    if (!out.some((r) => r.method === route.method && r.path === route.path)) { out.push(route); }
  }
  return out;
}

export function parseDjangoPaths(sourceText: string): string[] {
  const out: string[] = [];
  const re = /path\s*\(\s*['"`]([^'"`]*)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) {
    const p = '/' + m[1].replace(/^\/+|\/+$/g, '');
    if (!out.includes(p)) { out.push(p); }
  }
  return out;
}

export function generatePythonWebTests(routes: WebRoute[], sourceFile: string, framework: 'flask' | 'fastapi'): string {
  const module = sourceFile.replace(/\.py$/, '').split('/').pop();
  if (framework === 'fastapi') {
    return `# Generated by AITestNova for the FastAPI routes in ${sourceFile}\n# Review and edit before committing. Requires fastapi + httpx (TestClient).\nfrom fastapi.testclient import TestClient\nfrom ${module} import app\n\nclient = TestClient(app)\n\n${routes.map((r) => `def test_${r.method.toLowerCase()}_${r.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root'}():\n    res = client.${r.method.toLowerCase()}("${r.path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '1')}")\n    assert res.status_code < 500\n`).join('\n')}`;
  }
  return `# Generated by AITestNova for the Flask routes in ${sourceFile}\n# Review and edit before committing.\nimport pytest\nfrom ${module} import app\n\n@pytest.fixture\ndef client():\n    app.config["TESTING"] = True\n    with app.test_client() as c:\n        yield c\n\n${routes.map((r) => `def test_${r.method.toLowerCase()}_${r.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root'}(client):\n    res = client.${r.method.toLowerCase()}("${r.path.replace(/<[^>]+>/g, '1')}")\n    assert res.status_code < 500\n`).join('\n')}`;
}

export function generateDjangoTests(paths: string[], sourceFile: string): string {
  void sourceFile;
  return `# Generated by AITestNova for the Django URL patterns in ${sourceFile}\n# Review and edit before committing. Run with Django's test runner.\nfrom django.test import TestCase\n\nclass UrlTests(TestCase):\n${paths.map((p) => `    def test_get_${p.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root'}(self):\n        res = self.client.get("${p}")\n        self.assertLess(res.status_code, 500)\n`).join('\n')}`;
}

export function parsePydanticModels(sourceText: string): string[] {
  const out: string[] = [];
  const re = /class\s+([A-Za-z_]\w*)\s*\(\s*(?:BaseModel|.*BaseModel)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) { out.push(m[1]); }
  const dcRe = /@dataclass\s*\nclass\s+([A-Za-z_]\w*)/g;
  while ((m = dcRe.exec(sourceText)) !== null) { if (!out.includes(m[1])) { out.push(m[1]); } }
  return out;
}

export function generatePydanticTest(modelName: string, sourceFile: string): string {
  const module = sourceFile.replace(/\.py$/, '').split('/').pop();
  return `# Generated by AITestNova for ${modelName} in ${sourceFile}\n# Review and edit before committing. Fill in real field values.\nimport pytest\nfrom pydantic import ValidationError\nfrom ${module} import ${modelName}\n\ndef test_${modelName.toLowerCase()}_valid():\n    obj = ${modelName}(**{})  # TODO: fill in real field values\n    assert obj is not None\n\ndef test_${modelName.toLowerCase()}_invalid():\n    with pytest.raises(ValidationError):\n        ${modelName}(**{"__invalid_field__": 1})\n`;
}

// ---- Java library training (0.3.7 source, no version bump) ----

export interface SpringRoute { method: string; path: string; handler: string; }
export interface SpringController { name: string; basePath: string; routes: SpringRoute[]; }

export function parseSpringControllers(sourceText: string): SpringController[] {
  const masked = maskStringsAndComments(sourceText, 'javascript');
  const out: SpringController[] = [];
  const re = /@(RestController|Controller)\s*(?:\([^)]*\))?\s*(?:@[A-Za-z_][A-Za-z0-9_.]*\s*(?:\([^)]*\))?\s*)*(?:public\s+)?(?:final\s+)?class\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) {
    const name = m[2];
    const brace = masked.indexOf('{', m.index + m[0].length);
    if (brace === -1) { continue; }
    let depth = 0; let end = -1;
    for (let i = brace; i < masked.length; i++) {
      if (masked[i] === '{') { depth += 1; }
      else if (masked[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) { continue; }
    // @RequestMapping sits between @RestController and the class, so it
    // is inside the match itself, not before it.
    const baseMatch = /@RequestMapping\s*\(\s*(?:"([^"]*)"|value\s*=\s*"([^"]*)")/.exec(m[0]);
    const basePath = baseMatch ? (baseMatch[1] ?? baseMatch[2] ?? '') : '';
    const body = sourceText.slice(brace, end + 1);
    const routes: SpringRoute[] = [];
    const routeRe = /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\s*\(\s*(?:"([^"]*)"|value\s*=\s*"([^"]*)")?\s*\)\s*(?:public\s+|private\s+|protected\s+)?[A-Za-z_<>\[\],\s\?]*?\s+([A-Za-z_]\w*)\s*\(/g;
    let r: RegExpExecArray | null;
    while ((r = routeRe.exec(body)) !== null) {
      routes.push({ method: r[1].replace('Mapping', '').toUpperCase(), path: r[2] ?? r[3] ?? '', handler: r[4] });
    }
    out.push({ name, basePath, routes });
  }
  return out;
}

export function generateSpringControllerTest(ctrl: SpringController, sourceFile: string): string {
  const full = (p: string) => {
    const joined = [ctrl.basePath, p].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/\/$/, '');
    return joined ? (joined.startsWith('/') ? joined : '/' + joined) : '/';
  };
  return `// Generated by AITestNova for ${ctrl.name} in ${sourceFile}\n// Review and edit before committing. Requires Spring Boot Test + MockMvc.\nimport org.junit.jupiter.api.Test;\nimport org.springframework.beans.factory.annotation.Autowired;\nimport org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;\nimport org.springframework.boot.test.context.SpringBootTest;\nimport org.springframework.test.web.servlet.MockMvc;\nimport static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;\nimport static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;\n\n@SpringBootTest\n@AutoConfigureMockMvc\nclass ${ctrl.name}Test {\n  @Autowired MockMvc mockMvc;\n${ctrl.routes.map((r) => `\n  @Test void ${r.handler}() throws Exception {\n    mockMvc.perform(${r.method.toLowerCase()}("${full(r.path).replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '1')}")${r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH' ? `.content("{}").contentType("application/json")` : ''}).andExpect(status().is2xxSuccessful());\n  }`).join('')}\n}\n`;
}

export function parseSpringServices(sourceText: string): { name: string; methods: ParsedFunction[]; deps: string[] }[] {
  const masked = maskStringsAndComments(sourceText, 'javascript');
  const out: { name: string; methods: ParsedFunction[]; deps: string[] }[] = [];
  const re = /@Service\s*(?:\([^)]*\))?\s*(?:public\s+)?(?:final\s+)?class\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const name = m[1];
    const brace = masked.indexOf('{', m.index + m[0].length);
    if (brace === -1) { continue; }
    let depth = 0; let end = -1;
    for (let i = brace; i < masked.length; i++) {
      if (masked[i] === '{') { depth += 1; }
      else if (masked[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) { continue; }
    const startLine = sourceText.slice(0, brace).split('\n').length - 1;
    const methods = parseFunctions(sourceText.slice(brace, end + 1), 'java')
      .filter((f) => f.name !== name)
      .map((f) => ({ ...f, line: f.line + startLine }));
    const bodyText = sourceText.slice(brace, end + 1);
    const ctor = /([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(bodyText);
    const deps = ctor && ctor[1] === name ? splitTopLevel(ctor[2]).map((r) => {
      const s = r.trim().replace(/@[A-Za-z_][A-Za-z0-9_.]*(\([^)]*\))?\s*/g, '').replace(/\bfinal\s+/g, '');
      const ids = s.match(/[A-Za-z_][A-Za-z0-9_$.]*/g);
      const ty = ids && ids.length >= 2 ? ids[0] : '';
      return ['String', 'Integer', 'Long', 'Boolean', 'Double', 'Float', 'int', 'long', 'boolean', 'double', 'float'].includes(ty) ? '' : ty;
    }).filter(Boolean) : [];
    out.push({ name, methods, deps });
  }
  return out;
}

export function generateMockitoServiceTest(svc: { name: string; methods: ParsedFunction[]; deps: string[] }, sourceFile: string): string {
  return `// Generated by AITestNova for ${svc.name} in ${sourceFile}\n// Review and edit before committing. Requires Mockito + JUnit 5.\nimport org.junit.jupiter.api.Test;\nimport org.junit.jupiter.api.extension.ExtendWith;\nimport org.mockito.InjectMocks;\nimport org.mockito.Mock;\nimport org.mockito.junit.jupiter.MockitoExtension;\nimport static org.junit.jupiter.api.Assertions.*;\n\n@ExtendWith(MockitoExtension.class)\nclass ${svc.name}Test {\n${svc.deps.map((d) => `  @Mock ${d} ${d[0].toLowerCase() + d.slice(1)};`).join('\n')}\n  @InjectMocks ${svc.name} service;\n\n  @Test void serviceIsWired() {\n    assertNotNull(service);\n  }\n${svc.methods.slice(0, 4).map((f) => `\n  @Test void ${f.name}Runs() {\n    assertDoesNotThrow(() -> service.${f.name}(${f.params.map(sampleValue).join(', ')}));\n  }`).join('')}\n}\n`;
}

// ---- Go / C / C++ / C# / Rust / Ruby / PHP / Kotlin / Swift training ----

export function parseGinRoutes(sourceText: string): WebRoute[] {
  const out: WebRoute[] = [];
  const re = /\b(GET|POST|PUT|PATCH|DELETE)\s*\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) {
    const route = { method: m[1], path: m[2] };
    if (!out.some((r) => r.method === route.method && r.path === route.path)) { out.push(route); }
  }
  return out;
}

export function generateGinTest(routes: WebRoute[], sourceFile: string): string {
  return `// Generated by AITestNova for the Gin routes in ${sourceFile}\n// Review and edit before committing. Wire up your real router where marked.\npackage main\n\nimport (\n  "net/http"\n  "net/http/httptest"\n  "testing"\n)\n\nfunc TestRoutes(t *testing.T) {\n  r := setupRouter() // TODO: replace with your router setup (e.g. gin.Default() + routes)\n${routes.map((r) => `  {\n    req, _ := http.NewRequest("${r.method}", "${r.path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '1')}", nil)\n    w := httptest.NewRecorder()\n    r.ServeHTTP(w, req)\n    if w.Code >= 500 {\n      t.Fatalf("${r.method} ${r.path} returned %d", w.Code)\n    }\n  }`).join('\n')}\n}\n`;
}

export function goParamType(raw: string): string {
  const parts = raw.trim().split(',');
  const last = parts[parts.length - 1].trim();
  const tokens = last.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) { return parts.length > 1 ? '' : last; }
  return tokens.slice(1).join(' ');
}

export type CSharpFramework = 'xunit' | 'nunit' | 'mstest';

export function detectCSharpFramework(sourceText: string): CSharpFramework {
  if (/using\s+NUnit\.Framework/.test(sourceText)) { return 'nunit'; }
  if (/using\s+Microsoft\.VisualStudio\.TestTools\.UnitTesting/.test(sourceText)) { return 'mstest'; }
  return 'xunit';
}

export function parseAspNetRoutes(sourceText: string): WebRoute[] {
  const out: WebRoute[] = [];
  const masked = maskStringsAndComments(sourceText, 'javascript');
  const classRoute = /\[Route\s*\(\s*"([^"]*)"\s*\)\]/.exec(masked);
  const base = classRoute ? classRoute[1] : '';
  const re = /\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete)(?:\s*\(\s*"([^"]*)"\s*\))?\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const path = '/' + [base, m[2] ?? ''].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    const route = { method: m[1].replace('Http', '').toUpperCase(), path };
    if (!out.some((r) => r.method === route.method && r.path === route.path)) { out.push(route); }
  }
  return out;
}

export function generateAspNetTest(routes: WebRoute[], sourceFile: string): string {
  void sourceFile;
  return `// Generated by AITestNova for the ASP.NET Core routes in ${sourceFile}\n// Review and edit before committing. Requires Microsoft.AspNetCore.Mvc.Testing.\nusing Microsoft.AspNetCore.Mvc.Testing;\nusing Xunit;\n\npublic class ApiTests : IClassFixture<WebApplicationFactory<Program>>\n{\n    private readonly HttpClient _client;\n\n    public ApiTests(WebApplicationFactory<Program> factory)\n    {\n        _client = factory.CreateClient();\n    }\n${routes.map((r) => `\n    [Fact]\n    public async Task ${r.method}${r.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Root'}_ReturnsSuccess()\n    {\n        var res = await _client.${r.method === 'GET' ? 'GetAsync' : r.method === 'POST' ? 'PostAsync' : r.method === 'PUT' ? 'PutAsync' : r.method === 'DELETE' ? 'DeleteAsync' : 'SendAsync'}("${r.path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '1')}"${r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH' ? `, new StringContent("{}", System.Text.Encoding.UTF8, "application/json")` : ''});\n        Assert.True(res.IsSuccessStatusCode);\n    }`).join('')}\n}\n`;
}

export function parseSerdeStructs(sourceText: string): string[] {
  const out: string[] = [];
  const re = /#\[derive\([^\]]*(?:Serialize|Deserialize)[^\]]*\)\]\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) { out.push(m[1]); }
  return out;
}

export function generateSerdeTest(structName: string, sourceFile: string): string {
  return `// Generated by AITestNova for ${structName} in ${sourceFile}\n// Review and edit before committing. Fill in real field values.\n#[test]\nfn test_${structName.toLowerCase()}_serde_roundtrip() {\n    let value = ${structName} { /* TODO: fill in fields */ };\n    let json = serde_json::to_string(&value).unwrap();\n    let back: ${structName} = serde_json::from_str(&json).unwrap();\n    assert_eq!(format!("{:?}", value), format!("{:?}", back));\n}\n`;
}

export function detectRubyFramework(sourceText: string): 'rspec' | 'minitest' {
  return /rspec|rails_helper|spec_helper/i.test(sourceText) ? 'rspec' : 'minitest';
}

export function parseLaravelRoutes(sourceText: string): WebRoute[] {
  const out: WebRoute[] = [];
  const re = /Route\s*::\s*(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) {
    const route = { method: m[1].toUpperCase(), path: m[2].startsWith('/') ? m[2] : '/' + m[2] };
    if (!out.some((r) => r.method === route.method && r.path === route.path)) { out.push(route); }
  }
  return out;
}

export function generateLaravelTest(routes: WebRoute[], sourceFile: string): string {
  void sourceFile;
  return `<?php\n// Generated by AITestNova for the Laravel routes in ${sourceFile}\n// Review and edit before committing. Run with php artisan test.\nnamespace Tests\\Feature;\n\nuse Tests\\TestCase;\n\nclass RouteTest extends TestCase\n{\n${routes.map((r) => `    public function test_${r.method.toLowerCase()}_${r.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root'}(): void\n    {\n        $response = $this->${r.method.toLowerCase()}("${r.path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '1')}");\n        $response->assertStatus(200);\n    }\n`).join('\n')}\n}\n`;
}

export function parseKtorRoutes(sourceText: string): WebRoute[] {
  const out: WebRoute[] = [];
  const re = /\b(get|post|put|patch|delete)\s*\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) {
    const route = { method: m[1].toUpperCase(), path: m[2] };
    if (!out.some((r) => r.method === route.method && r.path === route.path)) { out.push(route); }
  }
  return out;
}

export function generateKtorTest(routes: WebRoute[], sourceFile: string): string {
  void sourceFile;
  return `// Generated by AITestNova for the Ktor routes in ${sourceFile}\n// Review and edit before committing. Requires ktor-server-test-host.\nimport io.ktor.client.request.*\nimport io.ktor.client.statement.*\nimport io.ktor.http.*\nimport io.ktor.server.testing.*\nimport org.junit.jupiter.api.Test\nimport org.junit.jupiter.api.Assertions.*\n\nclass RouteTest {\n${routes.map((r) => `    @Test\n    fun ${r.method.toLowerCase()}${r.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Root'}() = testApplication {\n        val response = client.${r.method.toLowerCase()}("${r.path}")\n        assertEquals(HttpStatusCode.OK, response.status)\n    }\n`).join('\n')}\n}\n`;
}

export function parseVaporRoutes(sourceText: string): WebRoute[] {
  const out: WebRoute[] = [];
  const re = /\bapp\.(get|post|put|patch|delete)\s*\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceText)) !== null) {
    const route = { method: m[1].toUpperCase(), path: '/' + m[2] };
    if (!out.some((r) => r.method === route.method && r.path === route.path)) { out.push(route); }
  }
  return out;
}

export function generateVaporTest(routes: WebRoute[], sourceFile: string): string {
  void sourceFile;
  return `// Generated by AITestNova for the Vapor routes in ${sourceFile}\n// Review and edit before committing. Requires XCTVapor.\nimport XCTVapor\n@testable import App\n\nfinal class RouteTests: XCTestCase {\n${routes.map((r) => `    func test${r.method}${r.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Root'}() throws {\n        let app = Application(.testing)\n        defer { app.shutdown() }\n        try configure(app)\n        try app.test(.${r.method}, "${r.path}") { res in\n            XCTAssertLessThan(res.status.code, 500)\n        }\n    }\n`).join('\n')}\n}\n`;
}

export function generateSpringKotlinTest(ctrl: SpringController, sourceFile: string): string {
  const full = (p: string) => {
    const joined = [ctrl.basePath, p].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/\/$/, '');
    return joined ? (joined.startsWith('/') ? joined : '/' + joined) : '/';
  };
  return `// Generated by AITestNova for ${ctrl.name} in ${sourceFile}\n// Review and edit before committing. Requires Spring Boot Test + MockMvc.\nimport org.junit.jupiter.api.Test\nimport org.springframework.beans.factory.annotation.Autowired\nimport org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc\nimport org.springframework.boot.test.context.SpringBootTest\nimport org.springframework.test.web.servlet.MockMvc\nimport org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*\nimport org.springframework.test.web.servlet.result.MockMvcResultMatchers.status\n\n@SpringBootTest\n@AutoConfigureMockMvc\nclass ${ctrl.name}Test {\n    @Autowired\n    lateinit var mockMvc: MockMvc\n${ctrl.routes.map((r) => `\n    @Test\n    fun ${r.handler}() {\n        mockMvc.perform(${r.method.toLowerCase()}("${full(r.path).replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '1')}")${r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH' ? `.content("{}").contentType("application/json")` : ''}).andExpect(status().is2xxSuccessful)\n    }`).join('')}\n}\n`;
}

export function generateRailsRequestSpec(controllerName: string, sourceFile: string): string {
  const resource = controllerName.replace(/Controller$/, '').replace(/([A-Z])/g, (c) => '_' + c.toLowerCase()).replace(/^_/, '');
  return `# Generated by AITestNova for ${controllerName} in ${sourceFile}\n# Review and edit before committing. Requires RSpec + Rails.\nrequire 'rails_helper'\n\nRSpec.describe '${controllerName}', type: :request do\n  it 'GET /${resource} responds' do\n    get '/${resource}'\n    expect(response.status).to be < 500\n  end\nend\n`;
}

// ---- Real-world training (0.3.8 source, no version bump) ----
// Toy functions are pure: they take values and return values. Real code
// calls the network, a database, the file system, the clock, or config,
// and it fails. A test that calls the real thing is not a test — it is a
// side effect. So the generator detects those dependencies and writes
// tests that mock them, plus tests for the error paths.

export type RealWorldDepKind = 'http' | 'db' | 'fs' | 'time' | 'env';
export interface RealWorldDep { kind: RealWorldDepKind; name: string; }

export function detectRealWorldDeps(sourceText: string): RealWorldDep[] {
  const out: RealWorldDep[] = [];
  const add = (kind: RealWorldDepKind, name: string) => {
    if (!out.some((d) => d.kind === kind && d.name === name)) { out.push({ kind, name }); }
  };
  // Network
  if (/\bfetch\s*\(/.test(sourceText)) { add('http', 'fetch'); }
  if (/\baxios\s*\./.test(sourceText)) { add('http', 'axios'); }
  if (/requests\.(get|post|put|patch|delete)\s*\(/.test(sourceText)) { add('http', 'requests'); }
  if (/\bhttp\.(Get|Post|Do)\s*\(/.test(sourceText)) { add('http', 'net/http'); }
  if (/HttpClient|httpClient\.(Get|Post)Async|RestTemplate|WebClient/.test(sourceText)) { add('http', 'HttpClient'); }
  if (/URLSession/.test(sourceText)) { add('http', 'URLSession'); }
  if (/ktor.*HttpClient|HttpClient\(/.test(sourceText)) { add('http', 'KtorClient'); }
  // Database
  if (/prisma\./.test(sourceText)) { add('db', 'prisma'); }
  if (/mongoose|Model\.(find|findOne|save|create)\s*\(/.test(sourceText)) { add('db', 'mongoose'); }
  if (/\bdb\.(query|execute|get|all)\s*\(|pool\.query|client\.query/.test(sourceText)) { add('db', 'db'); }
  if (/cursor\.execute|session\.query|\.objects\.(get|filter|all)\s*\(/.test(sourceText)) { add('db', 'orm'); }
  if (/EntityManager|repository\.|\.save\(\)|JdbcTemplate/.test(sourceText)) { add('db', 'repository'); }
  if (/sqlx|gorm\.|db\.First|db\.Find/.test(sourceText)) { add('db', 'gorm'); }
  // File system
  if (/fs\.(readFile|writeFile|existsSync|createReadStream)/.test(sourceText)) { add('fs', 'fs'); }
  if (/\bopen\s*\(/.test(sourceText)) { add('fs', 'open'); }
  if (/Files\.(read|write)|File\.(Read|Write|Exists)/.test(sourceText)) { add('fs', 'Files'); }
  if (/os\.path|Path\(|FileManager/.test(sourceText)) { add('fs', 'path'); }
  // Clock
  if (/Date\.now|new Date\(\)/.test(sourceText)) { add('time', 'Date'); }
  if (/datetime\.now|time\.time\(\)|datetime\.today/.test(sourceText)) { add('time', 'datetime'); }
  if (/time\.Now\(\)/.test(sourceText)) { add('time', 'time'); }
  if (/LocalDateTime\.now|System\.currentTimeMillis|Instant\.now/.test(sourceText)) { add('time', 'clock'); }
  // Config / environment
  if (/process\.env/.test(sourceText)) { add('env', 'process.env'); }
  if (/os\.environ|os\.getenv/.test(sourceText)) { add('env', 'os.environ'); }
  if (/System\.getenv|Environment\.GetEnvironmentVariable|getenv\s*\(/.test(sourceText)) { add('env', 'env'); }
  return out;
}

export function detectErrorPaths(sourceText: string): boolean {
  return /throw\s+new|throw\s+\w|raise\s+\w|panic!\s*\(|panic\s*\(|return\s+.*\berr\b|throws\s+\w|Result<|Option<|Err\(/.test(sourceText);
}

export function detectPaginationParams(fns: ParsedFunction[]): string[] {
  const out: string[] = [];
  for (const fn of fns) {
    for (const p of fn.params) {
      if (/^(page|limit|offset|pageSize|perPage)$/i.test(p) && !out.includes(p)) { out.push(p); }
    }
  }
  return out;
}

export function generateRealWorldJsTests(deps: RealWorldDep[], hasError: boolean, pagination: string[], fns: ParsedFunction[], sourceFile: string, testFramework: TestFramework): string {
  const base = (sourceFile.split('/').pop() ?? '').replace(/\.(ts|tsx|js|jsx|vue)$/, '');
  const first = fns[0];
  const call = first ? `${first.name}(${first.params.map(sampleValue).join(', ')})` : 'fn()';
  const mockFn = testFramework === 'vitest' ? 'vi.fn' : testFramework === 'jest' ? 'jest.fn' : null;
  const timers = testFramework === 'vitest' ? 'vi.useFakeTimers' : testFramework === 'jest' ? 'jest.useFakeTimers' : null;
  const has = (k: RealWorldDepKind) => deps.some((d) => d.kind === k);
  const lines: string[] = [];
  lines.push(`// Generated by AITestNova — real-world tests for ${sourceFile}`);
  lines.push(`// These tests mock the outside world (${deps.map((d) => d.name).join(', ') || 'no external calls detected'}). Nothing here hits the network, disk, or a database.`);
  if (testFramework === 'vitest') { lines.push(`import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';`); }
  else if (testFramework === 'jest') { lines.push(`import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';`); }
  lines.push(`import { ${first ? first.name : 'fn'} } from './${base}';`);
  lines.push('');
  lines.push(`describe('real world', () => {`);
  if (has('http') && deps.some((d) => d.name === 'fetch')) {
    lines.push(`  beforeEach(() => {`);
    lines.push(mockFn ? `    global.fetch = ${mockFn}().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as any);` : `    global.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any;`);
    lines.push(`  });`);
  }
  if (has('http') && deps.some((d) => d.name === 'axios')) {
    lines.push(`  // TODO: mock axios with jest.mock('axios') / vi.mock('axios') at the top of this file.`);
  }
  if (has('time') && timers) {
    lines.push(`  beforeEach(() => { ${timers}(); ${testFramework === 'vitest' ? 'vi.setSystemTime(new Date(\'2026-01-01T00:00:00Z\'));' : 'jest.setSystemTime(new Date(\'2026-01-01T00:00:00Z\'));'} });`);
    lines.push(`  afterEach(() => { ${testFramework === 'vitest' ? 'vi.useRealTimers();' : 'jest.useRealTimers();'} });`);
  }
  if (has('env')) {
    lines.push(`  beforeEach(() => { process.env.API_KEY = 'test-key'; process.env.NODE_ENV = 'test'; });`);
    lines.push(`  afterEach(() => { delete process.env.API_KEY; });`);
  }
  if (has('http')) {
    lines.push(`  test('does not call the real network', async () => {`);
    lines.push(`    const result = await ${call};`);
    lines.push(`    expect(result).not.toBeNull(); // TODO: assert on the canned response above`);
    lines.push(`  });`);
    lines.push(`  test('a failed request surfaces an error, not a crash', async () => {`);
    lines.push(mockFn ? `    (global.fetch as any).mockRejectedValueOnce(new Error('network down'));` : `    global.fetch = (async () => { throw new Error('network down'); }) as any;`);
    lines.push(`    await expect((async () => ${call})()).rejects.toThrow(); // TODO: adjust if this function handles the failure itself`);
    lines.push(`  });`);
  }
  if (has('fs')) {
    lines.push(`  // TODO: mock the file system (jest.mock('fs') / vi.mock('fs')) — this file reads or writes files.`);
  }
  if (has('db')) {
    lines.push(`  // TODO: mock the database client (${deps.filter((d) => d.kind === 'db').map((d) => d.name).join(', ')}) — this file queries a database.`);
  }
  if (hasError && first) {
    lines.push(`  test('error path', async () => {`);
    lines.push(`    await expect((async () => ${call})()).rejects.toThrow(); // TODO: pass the input that actually triggers the error`);
    lines.push(`  });`);
  }
  if (pagination.length > 0 && first) {
    const pageArgs = first.params.map((p) => /page/i.test(p) ? '1' : /limit|perPage|pageSize/i.test(p) ? '10' : /offset/i.test(p) ? '0' : sampleValue(p)).join(', ');
    lines.push(`  test('pagination', async () => {`);
    lines.push(`    const firstPage = await ${first.name}(${pageArgs});`);
    lines.push(`    expect(firstPage).not.toBeNull(); // TODO: assert the page has at most the requested number of items`);
    lines.push(`  });`);
  }
  lines.push(`});`);
  return lines.join('\n') + '\n';
}

export function generateRealWorldPythonTests(deps: RealWorldDep[], hasError: boolean, pagination: string[], fns: ParsedFunction[], sourceFile: string): string {
  const module = sourceFile.replace(/\.py$/, '').split('/').pop();
  const first = fns[0];
  const call = first ? `${first.name}(${first.params.map(sampleValue).join(', ')})` : 'fn()';
  const has = (k: RealWorldDepKind) => deps.some((d) => d.kind === k);
  const lines: string[] = [];
  lines.push(`# Generated by AITestNova — real-world tests for ${sourceFile}`);
  lines.push(`# These tests mock the outside world (${deps.map((d) => d.name).join(', ') || 'no external calls detected'}). Nothing here hits the network, disk, or a database.`);
  lines.push(`import pytest`);
  lines.push(`from unittest.mock import patch, mock_open, MagicMock`);
  lines.push(`import os`);
  lines.push(`from ${module} import ${first ? first.name : 'fn'}`);
  lines.push(``);
  if (has('http')) {
    lines.push(`def test_does_not_call_the_real_network():`);
    lines.push(`    with patch('requests.get') as mock_get:  # TODO: patch the client this file actually uses`);
    lines.push(`        mock_get.return_value.status_code = 200`);
    lines.push(`        mock_get.return_value.json.return_value = {}`);
    lines.push(`        result = ${call}`);
    lines.push(`        assert result is not None`);
    lines.push(``);
    lines.push(`def test_a_failed_request_surfaces_an_error():`);
    lines.push(`    with patch('requests.get', side_effect=Exception('network down')):`);
    lines.push(`        with pytest.raises(Exception):  # TODO: narrow to the error this function actually raises`);
    lines.push(`            ${call}`);
    lines.push(``);
  }
  if (has('fs')) {
    lines.push(`def test_reads_a_file_without_touching_disk():`);
    lines.push(`    with patch('builtins.open', mock_open(read_data='test data')):`);
    lines.push(`        result = ${call}`);
    lines.push(`        assert result is not None`);
    lines.push(``);
  }
  if (has('time')) {
    lines.push(`def test_uses_a_fixed_clock():`);
    lines.push(`    with patch('datetime.datetime') as mock_dt:  # TODO: patch where it is used, e.g. 'mymodule.datetime'`);
    lines.push(`        mock_dt.now.return_value = mock_dt(2026, 1, 1)`);
    lines.push(`        result = ${call}`);
    lines.push(`        assert result is not None`);
    lines.push(``);
  }
  if (has('env')) {
    lines.push(`def test_reads_config_from_the_environment():`);
    lines.push(`    with patch.dict(os.environ, {'API_KEY': 'test-key'}):`);
    lines.push(`        result = ${call}`);
    lines.push(`        assert result is not None`);
    lines.push(``);
  }
  if (has('db')) {
    lines.push(`# TODO: mock the database (${deps.filter((d) => d.kind === 'db').map((d) => d.name).join(', ')}) — patch the cursor/session this file uses.`);
    lines.push(``);
  }
  if (hasError && first) {
    lines.push(`def test_error_path():`);
    lines.push(`    with pytest.raises(Exception):  # TODO: pass the input that actually triggers the error, and narrow the exception type`);
    lines.push(`        ${call}`);
    lines.push(``);
  }
  if (pagination.length > 0 && first) {
    const pageArgs = first.params.map((p) => /page/i.test(p) ? 'page=1' : /limit|perPage|pageSize/i.test(p) ? 'limit=10' : /offset/i.test(p) ? 'offset=0' : `${p}=${sampleValue(p)}`).join(', ');
    lines.push(`def test_pagination():`);
    lines.push(`    result = ${first.name}(${pageArgs})`);
    lines.push(`    assert result is not None  # TODO: assert the page has at most 10 items`);
    lines.push(``);
  }
  return lines.join('\n');
}

export function generateRealWorldJavaTests(deps: RealWorldDep[], hasError: boolean, pagination: string[], fns: ParsedFunction[], sourceFile: string): string {
  const first = fns[0];
  const call = first ? `${first.name}(${first.params.map(sampleValue).join(', ')})` : 'fn()';
  const has = (k: RealWorldDepKind) => deps.some((d) => d.kind === k);
  const lines: string[] = [];
  lines.push(`// Generated by AITestNova — real-world tests for ${sourceFile}`);
  lines.push(`// These tests mock the outside world (${deps.map((d) => d.name).join(', ') || 'no external calls detected'}). Nothing here hits the network, disk, or a database.`);
  lines.push(`import org.junit.jupiter.api.Test;`);
  lines.push(`import org.junit.jupiter.api.extension.ExtendWith;`);
  lines.push(`import org.mockito.Mock;`);
  lines.push(`import org.mockito.junit.jupiter.MockitoExtension;`);
  lines.push(`import static org.junit.jupiter.api.Assertions.*;`);
  lines.push(``);
  lines.push(`@ExtendWith(MockitoExtension.class)`);
  lines.push(`class RealWorldTest {`);
  if (has('db')) {
    lines.push(`  @Mock Object repository; // TODO: replace Object with the real repository/client type`);
  }
  if (has('http')) {
    lines.push(`  @Mock Object httpClient; // TODO: replace Object with the real client type (RestTemplate, WebClient, HttpClient)`);
  }
  if (has('time')) {
    lines.push(`  // TODO: the clock is real here — inject a Clock or use MockedStatic<LocalDateTime> so the test is deterministic.`);
  }
  if (has('env')) {
    lines.push(`  // TODO: environment variables are real here — read them through a config object you can stub in tests.`);
  }
  if (hasError && first) {
    lines.push(``);
    lines.push(`  @Test void errorPath() {`);
    lines.push(`    assertThrows(Exception.class, () -> ${call}); // TODO: pass the input that actually triggers the error, and narrow the exception type`);
    lines.push(`  }`);
  }
  if (pagination.length > 0 && first) {
    const pageArgs = first.params.map((p) => /page/i.test(p) ? '1' : /limit|perPage|pageSize/i.test(p) ? '10' : /offset/i.test(p) ? '0' : sampleValue(p)).join(', ');
    lines.push(``);
    lines.push(`  @Test void pagination() {`);
    lines.push(`    var result = ${first.name}(${pageArgs});`);
    lines.push(`    assertNotNull(result); // TODO: assert the page has at most 10 items`);
    lines.push(`  }`);
  }
  lines.push(`}`);
  return lines.join('\n') + '\n';
}

export function generateRealWorldGoTests(deps: RealWorldDep[], hasError: boolean, pagination: string[], fns: ParsedFunction[], sourceFile: string): string {
  const first = fns[0];
  const call = first ? `${first.name}(${first.params.map(sampleValue).join(', ')})` : 'fn()';
  const has = (k: RealWorldDepKind) => deps.some((d) => d.kind === k);
  const lines: string[] = [];
  lines.push(`// Generated by AITestNova — real-world tests for ${sourceFile}`);
  lines.push(`// These tests mock the outside world (${deps.map((d) => d.name).join(', ') || 'no external calls detected'}). Nothing here hits the network, disk, or a database.`);
  lines.push(`package main`);
  lines.push(``);
  lines.push(`import "testing"`);
  if (has('http')) { lines.push(`import "net/http"`, `import "net/http/httptest"`); }
  lines.push(``);
  if (has('http')) {
    lines.push(`func TestRealWorld_NoRealNetwork(t *testing.T) {`);
    lines.push(`  server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {`);
    lines.push(`    w.WriteHeader(http.StatusOK)`);
    lines.push(`    _, _ = w.Write([]byte("{}"))`);
    lines.push(`  }))`);
    lines.push(`  defer server.Close()`);
    lines.push(`  _ = server.URL // TODO: point your HTTP client at server.URL instead of the real host`);
    lines.push(`  got := ${call}`);
    lines.push(`  _ = got`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`func TestRealWorld_FailedRequest(t *testing.T) {`);
    lines.push(`  server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {`);
    lines.push(`    w.WriteHeader(http.StatusInternalServerError)`);
    lines.push(`  }))`);
    lines.push(`  defer server.Close()`);
    lines.push(`  _ = server.URL // TODO: point your HTTP client at server.URL and assert the error is surfaced`);
    lines.push(`  _ = ${call}`);
    lines.push(`}`);
    lines.push(``);
  }
  if (has('fs')) {
    lines.push(`// TODO: this file reads or writes files — test it against t.TempDir() instead of the real disk.`);
    lines.push(``);
  }
  if (has('db')) {
    lines.push(`// TODO: this file queries a database (${deps.filter((d) => d.kind === 'db').map((d) => d.name).join(', ')}) — test it behind an interface with a fake implementation.`);
    lines.push(``);
  }
  if (has('time')) {
    lines.push(`// TODO: this file reads the clock — pass the time in (a now func or a time.Time argument) so the test is deterministic.`);
    lines.push(``);
  }
  if (hasError && first) {
    lines.push(`func TestRealWorld_ErrorPath(t *testing.T) {`);
    lines.push(`  _, err := ${call} // TODO: adjust if this function does not return an error`);
    lines.push(`  if err == nil {`);
    lines.push(`    t.Fatal("expected an error")`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push(``);
  }
  if (pagination.length > 0 && first) {
    const pageArgs = first.params.map((p) => /page/i.test(p) ? '1' : /limit|perPage|pageSize/i.test(p) ? '10' : /offset/i.test(p) ? '0' : sampleValue(p)).join(', ');
    lines.push(`func TestRealWorld_Pagination(t *testing.T) {`);
    lines.push(`  got := ${first.name}(${pageArgs})`);
    lines.push(`  _ = got // TODO: assert the page has at most 10 items`);
    lines.push(`}`);
    lines.push(``);
  }
  return lines.join('\n');
}

export function generateRealWorldGenericTests(lang: string, deps: RealWorldDep[], hasError: boolean, pagination: string[], fns: ParsedFunction[], sourceFile: string): string {
  const first = fns[0];
  const depList = deps.map((d) => d.name).join(', ') || 'no external calls detected';
  const call = first ? `${first.name}(${first.params.map(sampleValue).join(', ')})` : 'fn()';
  const cap = first ? (first.name[0] ?? 'F').toUpperCase() + first.name.slice(1) : 'Fn';
  const header = `// Generated by AITestNova — real-world tests for ${sourceFile}\n// Outside world in this file: ${depList}. Mock those before asserting on behaviour.`;
  if (lang === 'csharp') {
    return `${header}\nusing Xunit;\n\npublic class RealWorldTests\n{\n${hasError && first ? `    [Fact]\n    public void ErrorPath()\n    {\n        Assert.Throws<System.Exception>(() => ${call}); // TODO: pass the input that actually triggers the error\n    }\n` : ''}${pagination.length > 0 && first ? `\n    [Fact]\n    public void Pagination()\n    {\n        var result = ${first.name}(${first.params.map((p) => /page/i.test(p) ? '1' : /limit|perPage|pageSize/i.test(p) ? '10' : /offset/i.test(p) ? '0' : sampleValue(p)).join(', ')});\n        Assert.NotNull(result); // TODO: assert the page has at most 10 items\n    }\n` : ''}}\n`;
  }
  if (lang === 'rust') {
    return `${header}\n#[test]\nfn test_real_world_error_path() {\n    // TODO: pass the input that actually triggers the error\n    let result = std::panic::catch_unwind(|| ${call});\n    assert!(result.is_err());\n}\n`;
  }
  if (lang === 'ruby') {
    return `# Generated by AITestNova — real-world tests for ${sourceFile}\n# Outside world in this file: ${depList}. Mock those before asserting on behaviour.\nrequire 'minitest/autorun'\n\nclass RealWorldTest < Minitest::Test\n${hasError && first ? `  def test_error_path\n    assert_raises(StandardError) { ${call} } # TODO: pass the input that actually triggers the error\n  end\n` : ''}${pagination.length > 0 && first ? `\n  def test_pagination\n    result = ${first.name}(${first.params.map((p) => /page/i.test(p) ? '1' : /limit|perPage|pageSize/i.test(p) ? '10' : /offset/i.test(p) ? '0' : sampleValue(p)).join(', ')})\n    refute_nil result # TODO: assert the page has at most 10 items\n  end\n` : ''}end\n`;
  }
  if (lang === 'php') {
    return `<?php\n// Generated by AITestNova — real-world tests for ${sourceFile}\n// Outside world in this file: ${depList}. Mock those before asserting on behaviour.\nuse PHPUnit\\Framework\\TestCase;\n\nclass RealWorldTest extends TestCase\n{\n${hasError && first ? `    public function testErrorPath(): void\n    {\n        $this->expectException(\\Exception::class); // TODO: pass the input that actually triggers the error\n        ${call};\n    }\n` : ''}${pagination.length > 0 && first ? `\n    public function testPagination(): void\n    {\n        $result = ${first.name}(${first.params.map((p) => /page/i.test(p) ? '1' : /limit|perPage|pageSize/i.test(p) ? '10' : /offset/i.test(p) ? '0' : sampleValue(p)).join(', ')});\n        $this->assertNotNull($result); // TODO: assert the page has at most 10 items\n    }\n` : ''}}\n`;
  }
  if (lang === 'kotlin') {
    return `${header}\nimport org.junit.jupiter.api.Test\nimport org.junit.jupiter.api.Assertions.*\n\nclass RealWorldTest {\n${hasError && first ? `    @Test\n    fun errorPath() {\n        assertThrows<Exception> { ${call} } // TODO: pass the input that actually triggers the error\n    }\n` : ''}${pagination.length > 0 && first ? `\n    @Test\n    fun pagination() {\n        val result = ${first.name}(${first.params.map((p) => /page/i.test(p) ? '1' : /limit|perPage|pageSize/i.test(p) ? '10' : /offset/i.test(p) ? '0' : sampleValue(p)).join(', ')})\n        assertNotNull(result) // TODO: assert the page has at most 10 items\n    }\n` : ''}}\n`;
  }
  if (lang === 'swift') {
    return `${header}\nimport XCTest\n\nfinal class RealWorldTests: XCTestCase {\n${hasError && first ? `    func testErrorPath() {\n        XCTAssertThrowsError(try ${call}) // TODO: pass the input that actually triggers the error\n    }\n` : ''}${pagination.length > 0 && first ? `\n    func testPagination() {\n        let result = ${first.name}(${first.params.map((p) => /page/i.test(p) ? '1' : /limit|perPage|pageSize/i.test(p) ? '10' : /offset/i.test(p) ? '0' : sampleValue(p)).join(', ')})\n        XCTAssertNotNil(result as Any?) // TODO: assert the page has at most 10 items\n    }\n` : ''}}\n`;
  }
  if (lang === 'cpp') {
    return `${header}\n#include <gtest/gtest.h>\n#include "${sourceFile.split('/').pop()}"\n\nTEST(RealWorld, ErrorPath) {\n  // TODO: pass the input that actually triggers the error\n  EXPECT_THROW(${call}, std::exception);\n}\n`;
  }
  if (lang === 'c') {
    return `${header}\n#include <assert.h>\n#include "${sourceFile.split('/').pop()}"\n\nint main(void) {\n  // TODO: pass the input that actually triggers the error path, and mock ${depList} first\n  (void) ${call};\n  return 0;\n}\n`;
  }
  return `${header}\n// TODO: mock ${depList} before asserting on behaviour.\n`;
}

// The body of one parsed function, for per-function analysis. Brace
// languages use balanced braces; Python uses indentation; Ruby uses `end`.
export function functionBody(text: string, fn: ParsedFunction, lang: string): string {
  const lines = text.split('\n');
  if (fn.line >= lines.length) { return text; }
  if (lang === 'python') {
    const defIndent = (lines[fn.line].match(/^\s*/) ?? [''])[0].length;
    const out: string[] = [lines[fn.line]];
    for (let i = fn.line + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') { out.push(line); continue; }
      const indent = (line.match(/^\s*/) ?? [''])[0].length;
      if (indent <= defIndent) { break; }
      out.push(line);
    }
    return out.join('\n');
  }
  if (lang === 'ruby') {
    const out: string[] = [lines[fn.line]];
    for (let i = fn.line + 1; i < lines.length; i++) {
      out.push(lines[i]);
      if (/^\s*end\b/.test(lines[i])) { break; }
    }
    return out.join('\n');
  }
  const start = text.indexOf('{', lines.slice(0, fn.line + 1).join('\n').length - lines[fn.line].length);
  if (start === -1) { return text; }
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') { depth += 1; }
    else if (text[i] === '}') { depth -= 1; if (depth === 0) { return text.slice(start, i + 1); } }
  }
  return text.slice(start);
}

// A function whose plain test would hit the outside world: the network, a
// database, or a file write. Its plain test is not just weak — it is a
// side effect. Such a function gets the mocked real-world suite instead.
export function hasDangerousDeps(bodyText: string): boolean {
  const deps = detectRealWorldDeps(bodyText);
  return deps.some((d) => d.kind === 'http' || d.kind === 'db' || (d.kind === 'fs' && /writeFile|\.write\s*\(|['"]w['"]/.test(bodyText)));
}

export function parseFunctions(text: string, language: string): ParsedFunction[] {
  const masked = maskStringsAndComments(text, language);
  const out: ParsedFunction[] = [];
  const lineOf = (idx: number): number => text.slice(0, idx).split('\n').length - 1;
  const nameStartBefore = (open: number): number => {
    let s = open;
    while (s > 0 && /\s/.test(masked[s - 1])) { s -= 1; }
    while (s > 0 && /[A-Za-z0-9_$]/.test(masked[s - 1])) { s -= 1; }
    return s;
  };
  const push = (name: string, paramsText: string, offset: number): void => {
    if (!name || KEYWORDS.has(name)) { return; }
    // A decorator call like @Injectable() is not a function definition.
    if (offset > 0 && masked[offset - 1] === '@') { return; }
    let raws = splitTopLevel(paramsText);
    let names = raws.flatMap((r) => paramNamesFor(r, language));
    if (language === 'python' && (names[0] === 'self' || names[0] === 'cls')) {
      names = names.slice(1);
      raws = raws.slice(1);
    }
    if (language === 'rust' && names[0] === 'self') {
      names = names.slice(1);
      raws = raws.slice(1);
    }
    const line = lineOf(offset);
    if (!out.some((f) => f.name === name && f.line === line)) {
      out.push({ name, params: names, line, language, rawParams: raws });
    }
  };
  // After the closing paren, the next thing (ignoring a return-type
  // annotation) must be a body brace or, for a JS arrow, "=>".
  // A call statement ends in ";" instead, so this is what stops a
  // call like foo(a); from being mistaken for a method definition.
  const followsBody = (end: number): boolean => {
    const rest = masked.slice(end, end + 120);
    const semi = rest.indexOf(';');
    const brace = rest.indexOf('{');
    return brace !== -1 && (semi === -1 || brace < semi);
  };
  const followsArrow = (end: number): boolean => /^\s*(?::[^=\n]*?)?=>/.test(masked.slice(end, end + 120));
  let m: RegExpExecArray | null;
  if (language === 'vue') {
    // A .vue file's testable code lives in its <script> block. Parse that
    // block as JavaScript, then shift line numbers back to the file.
    const script = /<script(?:\s+setup)?[^>]*>([\s\S]*?)<\/script>/i.exec(text);
    if (!script) { return []; }
    const before = text.slice(0, script.index);
    const tagLines = script[0].slice(0, script[0].indexOf(script[1])).split('\n').length - 1;
    const startLine = before.split('\n').length - 1 + tagLines;
    return parseFunctions(script[1], 'javascript').map((f) => ({ ...f, line: f.line + startLine, language: 'vue' }));
  }
  if (language === 'python') {
    const re = /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
    while ((m = re.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
  } else if (language === 'java') {
    const re = /(?:public|private|protected|static|final|abstract|synchronized|native|\s)+([A-Za-z_][A-Za-z0-9_<>\[\],\s\?]*?)\s+([A-Za-z_][A-Za-z0-9_$]*)\s*\(/g;
    while ((m = re.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const nameStart = masked.lastIndexOf(m[2], open);
      if (nameStart > 0 && masked[nameStart - 1] === '.') { continue; }
      const bal = readBalancedParens(text, open, language);
      if (!bal) { continue; }
      const after = masked.slice(bal.end, bal.end + 200);
      if (!/^\s*(?:throws\s+[^{]+?)?\{/.test(after)) { continue; }
      push(m[2], bal.inside, nameStart);
    }
    const ctor = /(?:public|private|protected)\s+([A-Z][A-Za-z0-9_$]*)\s*\(/g;
    while ((m = ctor.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal && followsBody(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
  } else if (language === 'go') {
    const re = /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
    while ((m = re.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
  } else if (language === 'c') {
    const cRe = /(?:^|[\s{;}])[\w<>\[\]\*&,\s]+?\s+([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = cRe.exec(masked)) !== null) {
      const name = m[1];
      const open = masked.indexOf('(', m.index);
      const parens = readBalancedParens(text, open, language);
      if (!parens || !followsBody(parens.end)) { continue; }
      const nameStart = nameStartBefore(open);
      if (nameStart > 0 && masked[nameStart - 1] === '.') { continue; }
      push(name, parens.inside, parens.end);
    }
  } else if (language === 'cpp') {
    const cppRe = /(?:^|[\s{;}])[\w<>\[\]\*&,\s]+?\s+(?:[A-Za-z_]\w*::)?([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = cppRe.exec(masked)) !== null) {
      const name = m[1];
      const open = masked.indexOf('(', m.index);
      const parens = readBalancedParens(text, open, language);
      if (!parens || !followsBody(parens.end)) { continue; }
      const nameStart = nameStartBefore(open);
      if (nameStart > 0 && masked[nameStart - 1] === '.') { continue; }
      push(name, parens.inside, parens.end);
    }
  } else if (language === 'csharp') {
    const csRe = /(?:^|[\s{;}])\s*(?:(?:public|private|protected|internal|static|virtual|override|sealed|async|extern|unsafe)\s+)*[\w<>\[\]\?,\s]+?\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/g;
    const csCtorRe = /(?:^|[\s{;}])\s*(?:public|private|protected|internal)\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = csRe.exec(masked)) !== null) {
      const name = m[1];
      const open = masked.indexOf('(', m.index);
      const parens = readBalancedParens(text, open, language);
      if (!parens) { continue; }
      const rest = masked.slice(parens.end, parens.end + 8);
      if (!/^\s*(?:=>|\{)/.test(rest)) { continue; }
      const nameStart = nameStartBefore(open);
      if (nameStart > 0 && masked[nameStart - 1] === '.') { continue; }
      push(name, parens.inside, parens.end);
    }
    while ((m = csCtorRe.exec(masked)) !== null) {
      const name = m[1];
      const open = masked.indexOf('(', m.index);
      const parens = readBalancedParens(text, open, language);
      if (!parens || !followsBody(parens.end)) { continue; }
      push(name, parens.inside, parens.end);
    }
  } else if (language === 'rust') {
    const rsRe = /(?:^|[\s{;}])\s*(?:pub\s*(?:\([^)]*\)\s*)?)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = rsRe.exec(masked)) !== null) {
      const name = m[1];
      const open = masked.indexOf('(', m.index);
      const parens = readBalancedParens(text, open, language);
      if (!parens || !followsBody(parens.end)) { continue; }
      push(name, parens.inside, parens.end);
    }
  } else if (language === 'ruby') {
    const rbRe = /^(\s*)def\s+(?:self\.)?([A-Za-z_]\w*)\s*(?:\(|$)/gm;
    let m: RegExpExecArray | null;
    while ((m = rbRe.exec(masked)) !== null) {
      const name = m[2];
      const afterName = m.index + m[0].length;
      let params = '';
      if (masked[afterName - 1] === '(') {
        const parens = readBalancedParens(text, afterName - 1, language);
        if (!parens) { continue; }
        params = parens.inside;
      } else {
        const eol = masked.indexOf('\n', afterName);
        params = masked.slice(afterName, eol === -1 ? masked.length : eol).replace(/#.*$/, '').trim();
      }
      push(name, params, afterName);
    }
  } else if (language === 'php') {
    const phpRe = /(?:^|[\s{;}])\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = phpRe.exec(masked)) !== null) {
      const name = m[1];
      const open = masked.indexOf('(', m.index);
      const parens = readBalancedParens(text, open, language);
      if (!parens || !followsBody(parens.end)) { continue; }
      push(name, parens.inside, parens.end);
    }
  } else if (language === 'kotlin') {
    const ktRe = /(?:^|[\s{;}])\s*(?:(?:public|private|internal|protected|suspend|inline|open|override|tailrec|operator)\s+)*fun\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = ktRe.exec(masked)) !== null) {
      const name = m[1];
      const open = masked.indexOf('(', m.index);
      const parens = readBalancedParens(text, open, language);
      if (!parens) { continue; }
      const rest = masked.slice(parens.end, parens.end + 120);
      const semi = rest.indexOf(';');
      const head = semi === -1 ? rest : rest.slice(0, semi);
      if (!/\{/.test(head) && !/^\s*(?::[^{=;]+)?=/.test(head)) { continue; }
      push(name, parens.inside, parens.end);
    }
  } else if (language === 'swift') {
    const swRe = /(?:^|[\s{;}])\s*(?:(?:public|private|internal|fileprivate|open|static|class|override|mutating|nonmutating|async|convenience|required)\s+)*func\s+([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = swRe.exec(masked)) !== null) {
      const name = m[1];
      const open = masked.indexOf('(', m.index);
      const parens = readBalancedParens(text, open, language);
      if (!parens || !followsBody(parens.end)) { continue; }
      push(name, parens.inside, parens.end);
    }
  } else {
    const fnRe = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/g;
    while ((m = fnRe.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal && followsBody(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
    const varRe = /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:function\s*\*?\s*)?(?:<[^>]*>\s*)?\(/g;
    while ((m = varRe.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (!bal) { continue; }
      if (masked.slice(m.index, open).includes('function')) { if (followsBody(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); } }
      else if (followsArrow(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
    const singleRe = /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?([A-Za-z_][A-Za-z0-9_$]*)\s*=>/g;
    while ((m = singleRe.exec(masked)) !== null) { push(m[1], m[2], nameStartBefore(m.index + m[0].length - 2)); }
    const methodRe = /(?:^|[{\n,;])\s*(?:static\s+|async\s+|get\s+|set\s+|\*\s*|public\s+|private\s+|protected\s+|readonly\s+|abstract\s+|override\s+)*([A-Za-z_][A-Za-z0-9_$]*)\s*\(/g;
    while ((m = methodRe.exec(masked)) !== null) {
      const open = m.index + m[0].length - 1;
      const bal = readBalancedParens(text, open, language);
      if (bal && followsBody(bal.end)) { push(m[1], bal.inside, nameStartBefore(open)); }
    }
  }
  return out;
}

function sampleValue(param: string): string {
  const p = param.toLowerCase();
  if (/(count|num|age|qty|quantity|amount|price|total|index)/.test(p)) { return '2'; }
  if (/(name|title|email|text|msg|message|str|string)/.test(p)) { return '"hello"'; }
  if (/(flag|enabled|active|valid|is)/.test(p)) { return 'true'; }
  if (/(list|arr|items|data)/.test(p)) { return '[1, 2]'; }
  return '1';
}

export function testFileName(sourceFile: string, language: string): string {
  const base = sourceFile.replace(/\.[^.]+$/, '');
  if (language === 'python') { return `test_${base.split('/').pop()}.py`; }
  if (language === 'java') { return `${base}Test.java`; }
  if (language === 'go') { return `${base}_test.go`; }
  if (language === 'c') { return `${base}_test.c`; }
  if (language === 'cpp') { return `${base}_test.cpp`; }
  if (language === 'csharp') { return `${base}Tests.cs`; }
  if (language === 'rust') { return `${base}_test.rs`; }
  if (language === 'ruby') { return `${base}_test.rb`; }
  if (language === 'php') { return `${base}Test.php`; }
  if (language === 'kotlin') { return `${base}Test.kt`; }
  if (language === 'swift') { return `${base}Tests.swift`; }
  if (sourceFile.endsWith('.tsx')) { return `${base}.test.tsx`; }
  return `${base}.test.${sourceFile.split('.').pop() === 'ts' || sourceFile.endsWith('.tsx') ? 'ts' : 'js'}`;
}

export function generateTestFor(fn: ParsedFunction, sourceFile: string, extraPrompt = '', javaFramework = 'junit', testFramework: TestFramework = 'jest', sourceText = ''): string {
  // Args come from the raw parameter text when the parser kept it, so
  // a destructured parameter becomes one object/array argument instead
  // of one argument per field, and a typed parameter keeps its name.
  const argFor = (raw: string): string => {
    const t = raw.trim();
    if (t.startsWith('{')) { const fields = paramNamesFor(t, fn.language); return `{ ${fields.map((f) => `${f}: ${sampleValue(f)}`).join(', ')} }`; }
    if (t.startsWith('[')) { const fields = paramNamesFor(t, fn.language); return `[${fields.map(sampleValue).join(', ')}]`; }
    return sampleValue(paramNamesFor(t, fn.language)[0] ?? t);
  };
  const rawList = fn.rawParams ?? fn.params;
  const args = fn.rawParams ? rawList.map(argFor).join(', ') : fn.params.map(sampleValue).join(', ');
  const nullArgs = rawList.map(() => 'null').join(', ');
  const undefArgs = rawList.map(() => 'undefined').join(', ');
  const nilArgs = rawList.map(() => 'nil').join(', ');
  const call = `${fn.name}(${args})`;
  const extra = extraPrompt.trim()
    ? `\n  // Extra case requested by the user: ${extraPrompt.trim().replace(/\n/g, ' ')}\n`
    : '';
  if (fn.language === 'unknown') {
    return `// AITestNova does not generate tests for this file type yet.\n// Supported: JavaScript/TypeScript, Python, Java, Go, C, C++, C#, Rust, Ruby, PHP, Kotlin, Swift.\n// The file's functions were not parsed, so nothing was guessed.\n`;
  }
  if (fn.language === 'python') {
    const module = sourceFile.replace(/\.py$/, '').split('/').pop();
    const isAsync = sourceText ? new RegExp(`async\\s+def\\s+${fn.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(sourceText) : false;
    if (sourceText && detectPythonTestStyle(sourceText) === 'unittest') {
      return `# Generated by AITestNova for ${fn.name} in ${sourceFile}\n# Review and edit before committing. Mock external calls as needed.\nimport unittest\nfrom ${module} import ${fn.name}\n\n\nclass Test${(fn.name[0] ?? 'F').toUpperCase()}${fn.name.slice(1)}(unittest.TestCase):\n    def test_normal(self):\n        result = ${call}\n        self.assertIsNotNone(result)\n\n    def test_edge_cases(self):\n        for value in ([], "", None):\n            try:\n                ${fn.name}(*([value] * ${rawList.length}))\n            except (TypeError, ValueError):\n                pass\n\n\nif __name__ == "__main__":\n    unittest.main()\n`;
    }
    if (isAsync) {
      return `# Generated by AITestNova for ${fn.name} in ${sourceFile}\n# Review and edit before committing. Mock external calls as needed. Requires pytest-asyncio.\nimport pytest\nfrom ${module} import ${fn.name}\n\n\n@pytest.mark.asyncio\nasync def test_${fn.name}_normal():\n    result = await ${call}\n    assert result is not None\n\n\n@pytest.mark.asyncio\nasync def test_${fn.name}_empty_and_none():\n${rawList.length === 0 ? `    await ${fn.name}()` : `    for value in ([], "", None):\n        try:\n            await ${fn.name}(*([value] * ${rawList.length}))\n        except (TypeError, ValueError):\n            pass`}\n${extra}`;
    }
    return `# Generated by AITestNova for ${fn.name} in ${sourceFile}\n# Review and edit before committing. Mock external calls as needed.\nimport pytest\nfrom ${module} import ${fn.name}\n\n\ndef test_${fn.name}_normal():\n    result = ${call}\n    assert result is not None\n\n\ndef test_${fn.name}_empty_and_none():\n${rawList.length === 0 ? `    ${fn.name}()` : `    for value in ([], "", None):\n        try:\n            ${fn.name}(*([value] * ${rawList.length}))\n        except (TypeError, ValueError):\n            pass`}\n${extra}`;
  }
  if (fn.language === 'java') {
    if (javaFramework === 'testng') {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Mock dependencies as needed.\nimport org.testng.annotations.Test;\nimport static org.testng.Assert.*;\n\npublic class ${fn.name}Test {\n  @Test public void normal() {\n    var result = ${call};\n    assertNotNull(result);\n  }\n  @Test public void edgeCases() {\n    ${fn.name}(${nullArgs});\n  }\n${extra}}\n`;
    }
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Mock dependencies as needed.\nimport org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass ${fn.name}Test {\n  @Test void normal() {\n    var result = ${call};\n    assertNotNull(result);\n  }\n  @Test void edgeCases() {\n    assertDoesNotThrow(() -> ${fn.name}(${nullArgs}));\n  }\n${extra}}\n`;
  }
  if (fn.language === 'go') {
    const cap = (fn.name[0] ?? 'F').toUpperCase() + fn.name.slice(1);
    const testify = sourceText ? /testify\/(assert|require)/.test(sourceText) : false;
    // Table-driven tests are the Go idiom: one table, one loop, one
    // assertion per case. Field types come from the real signatures.
    const fields = rawList.map((r) => {
      const names = paramNamesFor(r, 'go');
      const ty = goParamType(r) || 'any';
      return names.map((n) => `    ${n} ${ty}`).join('\n');
    }).filter(Boolean).join('\n');
    const fieldNames = fn.params.join(', ');
    const zeroValue = (r: string): string => {
      const ty = goParamType(r).toLowerCase();
      if (/int|float|byte|rune/.test(ty)) { return '0'; }
      if (/string/.test(ty)) { return '""'; }
      if (/bool/.test(ty)) { return 'false'; }
      return 'nil';
    };
    if (fields) {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Fill in the expected values.\npackage main\n\nimport "testing"\n${testify ? `import "github.com/stretchr/testify/require"\n` : ''}\nfunc Test${cap}(t *testing.T) {\n  tests := []struct {\n    name string\n${fields}\n    want any // TODO: fill in expected values\n  }{\n    {name: "normal", ${fn.params.map((p) => `${p}: ${sampleValue(p)}`).join(', ')}, want: nil},\n    {name: "edge", ${rawList.map((r, i) => `${fn.params[i] ?? `arg${i}`}: ${zeroValue(r)}`).join(', ')}, want: nil},\n  }\n  for _, tt := range tests {\n    t.Run(tt.name, func(t *testing.T) {\n      got := ${fn.name}(${fn.params.map((p) => 'tt.' + p).join(', ')})\n      ${testify ? 'require.NotNil(t, got)' : '_ = got'}\n      _ = tt.want\n    })\n  }\n}\n\nfunc Test${cap}_Edge(t *testing.T) {\n  defer func() { _ = recover() }()\n  _ = ${fn.name}(${rawList.map(zeroValue).join(', ')})\n}\n${extra}`;
    }
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Mock dependencies as needed.\npackage main\n\nimport "testing"\n${testify ? `import "github.com/stretchr/testify/require"\n` : ''}\nfunc Test${cap}_Normal(t *testing.T) {\n  got := ${call}\n  ${testify ? 'require.NotNil(t, got)' : '_ = got'}\n}\n\nfunc Test${cap}_Edge(t *testing.T) {\n  defer func() { _ = recover() }()\n  _ = ${fn.name}(${rawList.map(zeroValue).join(', ')})\n}\n${extra}`;
  }
  if (fn.language === 'c') {
    const inc = sourceFile.split('/').pop();
    if (sourceText && sourceText.includes('unity.h')) {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires the Unity test framework.\n#include "unity.h"\n#include "${inc}"\n\nvoid setUp(void) {}\nvoid tearDown(void) {}\n\nvoid test_${fn.name}_normal(void) {\n  TEST_ASSERT_NOT_EQUAL(0, ${call}); // TODO: replace 0 with the expected value\n}\n\nvoid test_${fn.name}_edge(void) {\n  ${fn.name}(${nullArgs}); // edge case: must not crash\n}\n\nint main(void) {\n  UNITY_BEGIN();\n  RUN_TEST(test_${fn.name}_normal);\n  RUN_TEST(test_${fn.name}_edge);\n  return UNITY_END();\n}\n`;
    }
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. The test includes the source file directly.\n#include <assert.h>\n#include "${inc}"\n\nint main(void) {\n  (void) ${call}; // normal case\n  (void) ${fn.name}(${nullArgs}); // edge case: must not crash\n  return 0;\n}\n// TODO: add asserts with the expected value, e.g. assert(${call} == 3);\n`;
  }
  if (fn.language === 'cpp') {
    const inc = sourceFile.split('/').pop();
    const cap = (fn.name[0] ?? 'F').toUpperCase() + fn.name.slice(1);
    if (sourceText && /catch2|catch_amalgamated/.test(sourceText)) {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires Catch2.\n#include <catch2/catch_test_macros.hpp>\n#include "${inc}"\n\nTEST_CASE("${fn.name} normal") {\n  CHECK(${call} != 0); // TODO: replace with the expected value\n}\n\nTEST_CASE("${fn.name} edge") {\n  CHECK_NOTHROW(${fn.name}(${nullArgs}));\n}\n`;
    }
    if (sourceText && /doctest/.test(sourceText)) {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires doctest.\n#include <doctest/doctest.h>\n#include "${inc}"\n\nTEST_CASE("${fn.name} normal") {\n  CHECK(${call} != 0); // TODO: replace with the expected value\n}\n\nTEST_CASE("${fn.name} edge") {\n  CHECK_NOTHROW(${fn.name}(${nullArgs}));\n}\n`;
    }
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires Google Test.\n#include <gtest/gtest.h>\n#include "${inc}"\n\nTEST(${cap}Test, Normal) {\n  EXPECT_NO_THROW(${call});\n}\n\nTEST(${cap}Test, Edge) {\n  EXPECT_NO_THROW(${fn.name}(${nullArgs}));\n}\n// TODO: add assertions with the expected value, e.g. EXPECT_EQ(${call}, 3);\n`;
  }
  if (fn.language === 'csharp') {
    const cap = (fn.name[0] ?? 'F').toUpperCase() + fn.name.slice(1);
    const csFw = sourceText ? detectCSharpFramework(sourceText) : 'xunit';
    if (csFw === 'nunit') {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires NUnit.\nusing NUnit.Framework;\n\n[TestFixture]\npublic class ${cap}Tests\n{\n    [Test]\n    public void Normal()\n    {\n        var result = ${call};\n        Assert.That(result, Is.Not.Null); // TODO: replace with the expected value\n    }\n\n    [Test]\n    public void Edge()\n    {\n        var result = ${fn.name}(${nullArgs});\n        Assert.That(result, Is.Not.Null);\n    }\n}\n`;
    }
    if (csFw === 'mstest') {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires MSTest.\nusing Microsoft.VisualStudio.TestTools.UnitTesting;\n\n[TestClass]\npublic class ${cap}Tests\n{\n    [TestMethod]\n    public void Normal()\n    {\n        var result = ${call};\n        Assert.IsNotNull(result); // TODO: replace with the expected value\n    }\n\n    [TestMethod]\n    public void Edge()\n    {\n        var result = ${fn.name}(${nullArgs});\n        Assert.IsNotNull(result);\n    }\n}\n`;
    }
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires xUnit.\nusing Xunit;\n\npublic class ${cap}Tests\n{\n    [Fact]\n    public void Normal()\n    {\n        var result = ${call};\n        Assert.NotNull(result); // TODO: replace with the expected value\n    }\n\n    [Fact]\n    public void Edge()\n    {\n        var result = ${fn.name}(${nullArgs});\n        Assert.NotNull(result);\n    }\n}\n`;
  }
  if (fn.language === 'rust') {
    const base = sourceFile.replace(/\.rs$/, '').split('/').pop();
    const defaults = rawList.map(() => 'Default::default()').join(', ');
    const isAsyncRust = sourceText ? new RegExp(`async\\s+fn\\s+${fn.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(sourceText) : false;
    if (isAsyncRust) {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires tokio.\n#[tokio::test]\nasync fn test_${fn.name}_normal() {\n    let result = ${fn.name}(${args}).await;\n    assert_ne!(result, Default::default()); // TODO: replace with the expected value\n}\n\n#[tokio::test]\nasync fn test_${fn.name}_edge() {\n    let _ = ${fn.name}(${defaults}).await;\n}\n`;
    }
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Rust tests usually live in the same\n// file: paste this module into ${base}.rs, or include it as a submodule.\n#[cfg(test)]\nmod ${fn.name}_tests {\n    use super::*;\n\n    #[test]\n    fn test_${fn.name}_normal() {\n        let result = ${call};\n        assert_ne!(result, Default::default()); // TODO: replace with the expected value\n    }\n\n    #[test]\n    fn test_${fn.name}_edge() {\n        let _ = ${fn.name}(${defaults});\n    }\n}\n`;
  }
  if (fn.language === 'ruby') {
    const base = sourceFile.replace(/\.rb$/, '').split('/').pop();
    const cap = (fn.name[0] ?? 'F').toUpperCase() + fn.name.slice(1);
    if (sourceText && detectRubyFramework(sourceText) === 'rspec') {
      return `# Generated by AITestNova for ${fn.name} in ${sourceFile}\n# Review and edit before committing. Requires RSpec.\nrequire_relative "${base}"\n\nRSpec.describe '${fn.name}' do\n  it 'normal case' do\n    result = ${call}\n    expect(result).not_to be_nil # TODO: replace with the expected value\n  end\n\n  it 'edge case' do\n    result = ${fn.name}(${nilArgs})\n    expect(result).not_to be_nil\n  end\nend\n`;
    }
    return `# Generated by AITestNova for ${fn.name} in ${sourceFile}\n# Review and edit before committing.\nrequire "minitest/autorun"\nrequire_relative "${base}"\n\nclass Test${cap} < Minitest::Test\n  def test_normal\n    result = ${call}\n    refute_nil result # TODO: replace with the expected value\n  end\n\n  def test_edge\n    result = ${fn.name}(${nilArgs})\n    refute_nil result\n  end\nend\n`;
  }
  if (fn.language === 'php') {
    const cap = (fn.name[0] ?? 'F').toUpperCase() + fn.name.slice(1);
    if (sourceText && /pest/i.test(sourceText)) {
      return `<?php\n// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires Pest.\ntest('${fn.name} normal', function () {\n    $result = ${call};\n    expect($result)->not->toBeNull(); // TODO: replace with the expected value\n});\n\ntest('${fn.name} edge', function () {\n    $result = ${fn.name}(${nullArgs});\n    expect($result)->not->toBeNull();\n});\n`;
    }
    return `<?php\n// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires PHPUnit.\nuse PHPUnit\\Framework\\TestCase;\n\nclass ${cap}Test extends TestCase\n{\n    public function testNormal(): void\n    {\n        $result = ${call};\n        $this->assertNotNull($result); // TODO: replace with the expected value\n    }\n\n    public function testEdge(): void\n    {\n        $result = ${fn.name}(${nullArgs});\n        $this->assertNotNull($result);\n    }\n}\n`;
  }
  if (fn.language === 'kotlin') {
    const cap = (fn.name[0] ?? 'F').toUpperCase() + fn.name.slice(1);
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires JUnit 5.\nimport org.junit.jupiter.api.Test\nimport org.junit.jupiter.api.Assertions.*\n\nclass ${cap}Test {\n    @Test\n    fun normal() {\n        val result = ${call}\n        assertNotNull(result) // TODO: replace with the expected value\n    }\n\n    @Test\n    fun edge() {\n        val result = ${fn.name}(${nullArgs})\n        assertNotNull(result)\n    }\n}\n`;
  }
  if (fn.language === 'swift') {
    const cap = (fn.name[0] ?? 'F').toUpperCase() + fn.name.slice(1);
    const isAsyncSwift = sourceText ? new RegExp(`func\\s+${fn.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\([^)]*\\)\\s*(?:async|throws)`).test(sourceText) : false;
    if (isAsyncSwift) {
      return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires XCTest.\nimport XCTest\n\nfinal class ${cap}Tests: XCTestCase {\n    func testNormal() async throws {\n        let result = try await ${call}\n        XCTAssertNotNil(result as Any?) // TODO: replace with the expected value\n    }\n\n    func testEdge() async throws {\n        let result = try await ${fn.name}(${nilArgs})\n        XCTAssertNotNil(result as Any?)\n    }\n}\n`;
    }
    return `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Requires XCTest.\nimport XCTest\n\nfinal class ${cap}Tests: XCTestCase {\n    func testNormal() {\n        let result = ${call}\n        XCTAssertNotNil(result as Any?) // TODO: replace with the expected value\n    }\n\n    func testEdge() {\n        let result = ${fn.name}(${nilArgs})\n        XCTAssertNotNil(result as Any?)\n    }\n}\n`;
  }
  // ---- JavaScript: the right test for the right library ----
  const moduleSystem = detectModuleSystem(sourceText, sourceFile);
  const baseName = sourceFile.split('/').pop();
  const isDefault = sourceText ? isDefaultExport(sourceText, fn.name) : false;
  const importLine = moduleSystem === 'cjs'
    ? (isDefault ? `const ${fn.name} = require('./${baseName}');` : `const { ${fn.name} } = require('./${baseName}');`)
    : (isDefault ? `import ${fn.name} from './${baseName}';` : `import { ${fn.name} } from './${baseName}';`);
  const kind = sourceText ? detectComponentKind(sourceText, fn) : 'function';
  const head = `// Generated by AITestNova for ${fn.name} in ${sourceFile}\n// Review and edit before committing. Mock dependencies as needed.\n`;
  if (kind === 'component') {
    const propsAttrs = fn.params.map((p) => `${p}={${sampleValue(p)}}`).join(' ');
    const jsx = `<${fn.name}${propsAttrs ? ' ' + propsAttrs : ''} />`;
    if (testFramework === 'vitest') {
      return `${head}import { describe, test, expect } from 'vitest';\nimport { render } from '@testing-library/react';\n${importLine}\n\ndescribe('${fn.name}', () => {\n  test('renders without crashing', () => {\n    const { container } = render(${jsx});\n    expect(container.firstChild).not.toBeNull();\n  });\n});\n// TODO: add assertions on what the component shows, e.g. screen.getByText('...')\n`;
    }
    if (testFramework === 'mocha' || testFramework === 'node') {
      const runnerImport = testFramework === 'node' ? `import { describe, test } from 'node:test';\nimport assert from 'node:assert/strict';` : `import assert from 'node:assert/strict';`;
      return `${head}${runnerImport}\nimport { render } from '@testing-library/react';\n${importLine}\n\ndescribe('${fn.name}', () => {\n  ${testFramework === 'node' ? 'test' : 'it'}('renders without crashing', () => {\n    const { container } = render(${jsx});\n    assert.ok(container.firstChild);\n  });\n});\n// TODO: add assertions on what the component shows, e.g. screen.getByText('...')\n`;
    }
    return `${head}import { render } from '@testing-library/react';\n${importLine}\n\ndescribe('${fn.name}', () => {\n  test('renders without crashing', () => {\n    const { container } = render(${jsx});\n    expect(container.firstChild).not.toBeNull();\n  });\n});\n// TODO: add assertions on what the component shows, e.g. screen.getByText('...')\n`;
  }
  if (kind === 'hook') {
    if (testFramework === 'vitest') {
      return `${head}import { describe, test, expect } from 'vitest';\nimport { renderHook, act } from '@testing-library/react';\n${importLine}\n\ndescribe('${fn.name}', () => {\n  test('returns a value', () => {\n    const { result } = renderHook(() => ${call});\n    expect(result.current).not.toBeNull();\n  });\n});\n// TODO: wrap state updates in act() and assert the hook's real behaviour\n`;
    }
    if (testFramework === 'mocha' || testFramework === 'node') {
      const runnerImport = testFramework === 'node' ? `import { describe, test } from 'node:test';\nimport assert from 'node:assert/strict';` : `import assert from 'node:assert/strict';`;
      return `${head}${runnerImport}\nimport { renderHook } from '@testing-library/react';\n${importLine}\n\ndescribe('${fn.name}', () => {\n  ${testFramework === 'node' ? 'test' : 'it'}('returns a value', () => {\n    const { result } = renderHook(() => ${call});\n    assert.notEqual(result.current, null);\n  });\n});\n// TODO: wrap state updates in act() and assert the hook's real behaviour\n`;
    }
    return `${head}import { renderHook, act } from '@testing-library/react';\n${importLine}\n\ndescribe('${fn.name}', () => {\n  test('returns a value', () => {\n    const { result } = renderHook(() => ${call});\n    expect(result.current).not.toBeNull();\n  });\n});\n// TODO: wrap state updates in act() and assert the hook's real behaviour\n`;
  }
  // Async functions and Observables need awaited tests: a plain
  // expect(result).not.toBeNull() on a Promise always passes.
  const isAsync = sourceText ? isAsyncFunction(sourceText, fn) : false;
  const isObs = sourceText ? returnsObservable(sourceText, fn) : false;
  const needsAwait = isAsync || isObs;
  const rxImport = isObs ? (moduleSystem === 'cjs' ? `const { firstValueFrom } = require('rxjs');\n` : `import { firstValueFrom } from 'rxjs';\n`) : '';
  const normalCall = isObs ? `await firstValueFrom(${call})` : needsAwait ? `await ${call}` : call;
  const asyncKw = needsAwait ? 'async ' : '';
  const edgeExpect = needsAwait
    ? `await ${fn.name}(${nullArgs}).catch(() => undefined);\n    await ${fn.name}(${undefArgs}).catch(() => undefined);`
    : `expect(() => ${fn.name}(${nullArgs})).not.toThrow();\n    expect(() => ${fn.name}(${undefArgs})).not.toThrow();`;
  const edgeAssert = needsAwait
    ? `await ${fn.name}(${nullArgs}).catch(() => undefined);\n    await ${fn.name}(${undefArgs}).catch(() => undefined);`
    : `assert.doesNotThrow(() => ${fn.name}(${nullArgs}));\n    assert.doesNotThrow(() => ${fn.name}(${undefArgs}));`;
  if (testFramework === 'vitest') {
    return `${head}import { describe, test, expect } from 'vitest';\n${importLine}\n${rxImport}\ndescribe('${fn.name}', () => {\n  test('normal case', ${asyncKw}() => {\n    const result = ${normalCall};\n    expect(result).not.toBeNull();\n  });\n  test('edge cases', ${asyncKw}() => {\n    ${edgeExpect}\n  });\n${extra}});\n`;
  }
  if (testFramework === 'mocha') {
    return `${head}import assert from 'node:assert/strict';\n${importLine}\n${rxImport}\ndescribe('${fn.name}', () => {\n  it('normal case', ${asyncKw}() => {\n    const result = ${normalCall};\n    assert.notEqual(result, null);\n  });\n  it('edge cases', ${asyncKw}() => {\n    ${edgeAssert}\n  });\n${extra}});\n`;
  }
  if (testFramework === 'node') {
    return `${head}import { describe, test } from 'node:test';\nimport assert from 'node:assert/strict';\n${importLine}\n${rxImport}\ndescribe('${fn.name}', () => {\n  test('normal case', ${asyncKw}() => {\n    const result = ${normalCall};\n    assert.notEqual(result, null);\n  });\n  test('edge cases', ${asyncKw}() => {\n    ${edgeAssert}\n  });\n${extra}});\n`;
  }
  if (testFramework === 'jasmine') {
    return `${head}${importLine}\n${rxImport}\ndescribe('${fn.name}', () => {\n  it('normal case', ${asyncKw}() => {\n    const result = ${normalCall};\n    expect(result).not.toBeNull();\n  });\n  it('edge cases', ${asyncKw}() => {\n    ${edgeExpect}\n  });\n${extra}});\n`;
  }
  return `${head}${importLine}\n${rxImport}\ndescribe('${fn.name}', () => {\n  test('normal case', ${asyncKw}() => {\n    const result = ${normalCall};\n    expect(result).not.toBeNull();\n  });\n  test('edge cases', ${asyncKw}() => {\n    ${edgeExpect}\n  });\n${extra}});\n`;
}

export function generateTestsForFile(text: string, sourceFile: string, extraPrompt = '', javaFramework = 'junit', testFramework: TestFramework = 'jest'): string {
  const lang = languageFromFile(sourceFile);
  const fns = parseFunctions(text, lang);
  const parts: string[] = [];
  // Plain tests never call a function that would hit the network, a
  // database, or write a file — that function gets the mocked
  // real-world suite instead.
  const plainFns = fns.filter((f) => !hasDangerousDeps(functionBody(text, f, lang)));
  if (plainFns.length > 0) {
    parts.push(plainFns.map((f) => generateTestFor(f, sourceFile, extraPrompt, javaFramework, testFramework, text)).join('\n'));
  }
  // TypeScript frameworks get their own suites: a class is not a plain
  // function, and calling a controller method directly never tests the
  // HTTP layer or the Angular/NestJS wiring around it.
  if (lang === 'javascript') {
    const angularClasses = parseAngularClasses(text);
    for (const cls of angularClasses) {
      // An @Injectable class is a NestJS service when the file uses
      // NestJS, an Angular service otherwise; components/directives
      // always get the TestBed version.
      if (cls.decorator === 'Injectable' && (text.includes('@nestjs/common') || text.includes('nestjs'))) {
        parts.push(generateNestServiceTest(cls, sourceFile));
      } else {
        parts.push(generateAngularTest(cls, sourceFile, testFramework));
      }
    }
    for (const ctrl of parseNestControllers(text)) {
      parts.push(generateNestControllerTest(ctrl, sourceFile));
    }
    for (const schema of parseZodSchemas(text)) {
      parts.push(generateZodTest(schema, sourceFile));
    }
    const nextHandlers = parseNextHandlers(text);
    if (nextHandlers.length > 0) {
      parts.push(generateNextHandlerTest(nextHandlers, sourceFile));
    }
  }
  // Framework suites, one per language: routes, controllers, models and
  // schemas get their own test, because a plain function test never
  // exercises the framework layer around them.
  if (lang === 'python') {
    const pyFw = detectPythonFramework(text);
    if (pyFw === 'flask' || pyFw === 'fastapi') {
      const routes = parseFlaskRoutes(text);
      if (routes.length > 0) { parts.push(generatePythonWebTests(routes, sourceFile, pyFw)); }
    }
    if (pyFw === 'django') {
      const paths = parseDjangoPaths(text);
      if (paths.length > 0) { parts.push(generateDjangoTests(paths, sourceFile)); }
    }
    for (const model of parsePydanticModels(text)) {
      parts.push(generatePydanticTest(model, sourceFile));
    }
  }
  if (lang === 'java') {
    for (const ctrl of parseSpringControllers(text)) { parts.push(generateSpringControllerTest(ctrl, sourceFile)); }
    for (const svc of parseSpringServices(text)) { parts.push(generateMockitoServiceTest(svc, sourceFile)); }
  }
  if (lang === 'kotlin') {
    for (const ctrl of parseSpringControllers(text)) { parts.push(generateSpringKotlinTest(ctrl, sourceFile)); }
    const ktor = parseKtorRoutes(text);
    if (ktor.length > 0) { parts.push(generateKtorTest(ktor, sourceFile)); }
  }
  if (lang === 'go') {
    const gin = parseGinRoutes(text);
    if (gin.length > 0) { parts.push(generateGinTest(gin, sourceFile)); }
  }
  if (lang === 'csharp') {
    const asp = parseAspNetRoutes(text);
    if (asp.length > 0) { parts.push(generateAspNetTest(asp, sourceFile)); }
  }
  if (lang === 'rust') {
    for (const s of parseSerdeStructs(text)) { parts.push(generateSerdeTest(s, sourceFile)); }
  }
  if (lang === 'ruby') {
    const ctrlMatch = /class\s+([A-Za-z_]\w*Controller)\s*</.exec(text);
    if (ctrlMatch) { parts.push(generateRailsRequestSpec(ctrlMatch[1], sourceFile)); }
  }
  if (lang === 'php') {
    const laravel = parseLaravelRoutes(text);
    if (laravel.length > 0) { parts.push(generateLaravelTest(laravel, sourceFile)); }
  }
  if (lang === 'swift') {
    const vapor = parseVaporRoutes(text);
    if (vapor.length > 0) { parts.push(generateVaporTest(vapor, sourceFile)); }
  }
  // Real-world suites: code that talks to the outside world gets tests
  // that mock it, plus error-path and pagination tests.
  const rwDeps = detectRealWorldDeps(text);
  const rwError = detectErrorPaths(text);
  const rwPage = detectPaginationParams(fns);
  if (fns.length > 0 && (rwDeps.length > 0 || rwError || rwPage.length > 0)) {
    // The real-world suite targets the first function that actually
    // touches the outside world, has an error path, or paginates — not
    // just the first function in the file.
    const rwTarget = fns.find((f) => {
      const body = functionBody(text, f, lang);
      return detectRealWorldDeps(body).length > 0 || detectErrorPaths(body) || detectPaginationParams([f]).length > 0;
    }) ?? fns[0];
    const rwFns = [rwTarget, ...fns.filter((f) => f !== rwTarget)];
    if (lang === 'javascript' || lang === 'vue') {
      parts.push(generateRealWorldJsTests(rwDeps, rwError, rwPage, rwFns, sourceFile, testFramework));
    } else if (lang === 'python') {
      parts.push(generateRealWorldPythonTests(rwDeps, rwError, rwPage, rwFns, sourceFile));
    } else if (lang === 'java') {
      parts.push(generateRealWorldJavaTests(rwDeps, rwError, rwPage, rwFns, sourceFile));
    } else if (lang === 'go') {
      parts.push(generateRealWorldGoTests(rwDeps, rwError, rwPage, rwFns, sourceFile));
    } else {
      parts.push(generateRealWorldGenericTests(lang, rwDeps, rwError, rwPage, rwFns, sourceFile));
    }
  }
  // Express routes get their own supertest suite — a route is not a
  // plain function, and calling it directly never tests the HTTP layer.
  if (lang === 'javascript' || lang === 'vue') {
    const routes = parseExpressRoutes(text);
    if (routes.length > 0) {
      parts.push(generateRouteTests(routes, sourceFile, testFramework, detectModuleSystem(text, sourceFile)));
    }
  }
  if (parts.length === 0) { return `// AITestNova: no functions found in ${sourceFile}.\n`; }
  return parts.join('\n');
}

export function coverageDelta(baseline: number, current: number): { delta: number; improved: boolean } {
  const delta = Math.round((current - baseline) * 10) / 10;
  return { delta, improved: delta > 0 };
}

// Coverage: read the coverage files tools already produce, never invent numbers.
export function parseCoverageXml(xml: string): { lineRate: number; branchRate: number } | null {
  const line = /line-rate="([0-9.]+)"/.exec(xml);
  const branch = /branch-rate="([0-9.]+)"/.exec(xml);
  if (!line) { return null; }
  return { lineRate: Math.round(parseFloat(line[1]) * 1000) / 10, branchRate: branch ? Math.round(parseFloat(branch[1]) * 1000) / 10 : 0 };
}

export function parseJestCoverageJson(jsonText: string): { pct: number } | null {
  try {
    const data = JSON.parse(jsonText) as { total?: { lines?: { pct?: number } } };
    if (typeof data.total?.lines?.pct === 'number') { return { pct: data.total.lines.pct }; }
  } catch { /* not jest coverage */ }
  return null;
}

// Go coverprofile (what "go test -coverprofile=coverage.out" writes):
// one line per block, "file.go:line.col,line.col numStatements count".
// A block with count > 0 ran. Percentage = covered statements / total.
export function parseGoCoverprofile(text: string): { pct: number } | null {
  let total = 0; let covered = 0;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^[^:]+\.go:\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)\s*$/.exec(raw.trim());
    if (!m) { continue; }
    const stmts = Number(m[1]); const count = Number(m[2]);
    total += stmts;
    if (count > 0) { covered += stmts; }
  }
  if (!total) { return null; }
  return { pct: Math.round((covered / total) * 1000) / 10 };
}

// Multi-model evaluation scoring: count real test signals, not length alone.
// A candidate with more tests, assertions and edge cases scores higher;
// unbalanced braces are penalised. Deterministic, so it can be unit-tested.
export function scoreGeneratedTest(text: string): number {
  const testCount = (text.match(/test\(|it\(|def test_|@Test|func Test/g) || []).length;
  const assertCount = (text.match(/assert|expect\(/g) || []).length;
  const edgeCount = (text.match(/empty|null|undefined|edge|error/gi) || []).length;
  const opens = (text.match(/\{/g) || []).length;
  const closes = (text.match(/\}/g) || []).length;
  return testCount * 10 + assertCount * 3 + Math.min(edgeCount, 5) * 2 - Math.abs(opens - closes) * 5;
}

export function pickBestCandidate(candidates: { model: string; text: string }[]): { model: string; text: string; score: number } | null {
  let best: { model: string; text: string; score: number } | null = null;
  for (const c of candidates) {
    if (!c.text.trim()) { continue; }
    const score = scoreGeneratedTest(c.text);
    if (!best || score > best.score) { best = { model: c.model, text: c.text, score }; }
  }
  return best;
}

// Generate tests from a comment / spec selection, not from code.
// Case names come from the spec lines; the target is the first `code`
// identifier in the spec, or "target" as an explicit placeholder to replace.
export function generateTestsFromSpec(spec: string, language: string): string {
  const fnMatch = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(spec);
  const target = fnMatch ? fnMatch[1] : 'target';
  const cases: string[] = [];
  for (const raw of spec.split(/\r?\n/)) {
    let line = raw.replace(/^\s*(?:\/\/|#|\*)\s*/, '').replace(/`/g, '').trim()
      .replace(/^[-*•\d.)]+\s*/, '')
      .replace(/^(?:should|must|when|test|case)\s*:?\s*/i, '').trim();
    if (line.length < 3 || line.length > 90) { continue; }
    if (!cases.includes(line)) { cases.push(line); }
    if (cases.length >= 8) { break; }
  }
  if (cases.length === 0) { cases.push('handles a normal input'); }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'case';
  if (language === 'python') {
    return `# Generated by AITestNova from a comment/spec — target: ${target}\n# Replace 'target' with your real function and fill in the assertions.\nimport pytest\n\n${cases.map((c) => `def test_${slug(c)}():\n    # Spec: ${c}\n    # TODO: call ${target}() and assert the expected result\n    assert True\n`).join('\n')}`;
  }
  if (language === 'java') {
    return `// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real method and fill in the assertions.\nimport org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass SpecTest {\n${cases.map((c) => `  @Test void ${slug(c)}() {\n    // Spec: ${c}\n    // TODO: call target() and assert the expected result\n    assertTrue(true);\n  }\n`).join('')}}\n`;
  }
  if (language === 'rust') {
    return `// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real function and fill in the assertions.\n#[cfg(test)]\nmod spec_tests {\n${cases.map((c) => `    #[test]\n    fn ${slug(c)}() {\n        // Spec: ${c}\n        // TODO: call ${target}() and assert the expected result\n    }\n`).join('')}}\n`;
  }
  if (language === 'ruby') {
    return `# Generated by AITestNova from a comment/spec — target: ${target}\n# Replace 'target' with your real method and fill in the assertions.\nrequire "minitest/autorun"\n\nclass TestSpec < Minitest::Test\n${cases.map((c) => `  def test_${slug(c)}\n    # Spec: ${c}\n    # TODO: call ${target}() and assert the expected result\n    assert true\n  end\n`).join('\n')}\nend\n`;
  }
  if (language === 'php') {
    return `<?php\n// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real function and fill in the assertions.\nuse PHPUnit\\Framework\\TestCase;\n\nclass SpecTest extends TestCase\n{\n${cases.map((c) => `    public function test${(slug(c)[0] ?? 'c').toUpperCase()}${slug(c).slice(1)}(): void\n    {\n        // Spec: ${c}\n        // TODO: call ${target}() and assert the expected result\n        $this->assertTrue(true);\n    }\n`).join('\n')}\n}\n`;
  }
  if (language === 'kotlin') {
    return `// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real function and fill in the assertions.\nimport org.junit.jupiter.api.Test\nimport org.junit.jupiter.api.Assertions.*\n\nclass SpecTest {\n${cases.map((c) => `    @Test\n    fun ${slug(c)}() {\n        // Spec: ${c}\n        // TODO: call ${target}() and assert the expected result\n        assertTrue(true)\n    }\n`).join('\n')}\n}\n`;
  }
  if (language === 'swift') {
    return `// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real function and fill in the assertions.\nimport XCTest\n\nfinal class SpecTests: XCTestCase {\n${cases.map((c) => `    func test${(slug(c)[0] ?? 'c').toUpperCase()}${slug(c).slice(1)}() {\n        // Spec: ${c}\n        // TODO: call ${target}() and assert the expected result\n        XCTAssertTrue(true)\n    }\n`).join('\n')}\n}\n`;
  }
  if (language === 'csharp') {
    return `// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real method and fill in the assertions.\nusing Xunit;\n\npublic class SpecTests\n{\n${cases.map((c) => `    [Fact]\n    public void ${(slug(c)[0] ?? 'c').toUpperCase()}${slug(c).slice(1)}()\n    {\n        // Spec: ${c}\n        // TODO: call ${target}() and assert the expected result\n        Assert.True(true);\n    }\n`).join('\n')}\n}\n`;
  }
  if (language === 'c' || language === 'cpp') {
    return `// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real function and fill in the assertions.\n#include <assert.h>\n\nint main(void) {\n${cases.map((c) => `  (void) 0; // Spec: ${c} — TODO: call ${target}() and assert the expected result\n`).join('')}  return 0;\n}\n`;
  }
  if (language === 'unknown') {
    return `// AITestNova does not generate tests for this file type yet.\n// Supported: JavaScript/TypeScript, Python, Java, Go, C, C++, C#, Rust, Ruby, PHP, Kotlin, Swift.\n`;
  }
  return `// Generated by AITestNova from a comment/spec — target: ${target}\n// Replace 'target' with your real function and fill in the assertions.\ndescribe('${target}', () => {\n${cases.map((c) => `  test('${c.replace(/'/g, "\\'")}', () => {\n    // TODO: call ${target}() and assert the expected result\n    expect(true).toBe(true);\n  });\n`).join('')}});\n`;
}
