// Generate API tests from an OpenAPI spec (0.4.4). Pure functions, no
// vscode import, so they can be smoke-tested with plain Node.
//
// The spec may be JSON or YAML. YAML support is a small block-style
// subset parser written for the shape OpenAPI specs actually use
// (nested maps, sequences, quoted and plain scalars, literal blocks,
// comments) — it is not a full YAML implementation, and parseOpenApiSpec
// says so when a document it cannot read arrives, instead of silently
// producing a partial spec. Generated tests use the global fetch
// (Node 18+) against the spec's first server URL, one test per
// operation, with sample values drawn from each parameter and request
// body schema.

export interface OpenApiOperation {
  method: string;
  path: string;
  operationId: string | null;
  summary: string | null;
  parameters: OpenApiParameter[];
  requestBody: Record<string, unknown> | null;
  responses: Record<string, unknown>;
}
export interface OpenApiParameter { name: string; in: 'query' | 'path' | 'header' | 'cookie'; required: boolean; schema: Record<string, unknown>; }
export interface OpenApiSpec { title: string; version: string; baseUrl: string; operations: OpenApiOperation[]; }

// --- YAML subset -------------------------------------------------------
// Block-style maps and sequences, indented with spaces. Scalars: plain,
// single-quoted, double-quoted, numbers, booleans, null (~ / null /
// empty). Literal blocks (|) join their lines. Flow style ({...} /
// [...]) is kept as text unless it is valid JSON. Anchors, tags and
// multi-document files are not supported — parseOpenApiSpec reports
// the document as unreadable rather than guessing at it.

function yamlScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') { return null; }
  if (s === 'true' || s === 'True' || s === 'TRUE') { return true; }
  if (s === 'false' || s === 'False' || s === 'FALSE') { return false; }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (/^-?\d+$/.test(s)) { return Number(s); }
  if (/^-?\d*\.\d+$/.test(s)) { return Number(s); }
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try { return JSON.parse(s); } catch { return s; }
  }
  return s;
}

interface YamlLine { indent: number; text: string; }
function yamlLines(text: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) { continue; }
    const indent = raw.length - raw.trimStart().length;
    out.push({ indent, text: raw.trim() });
  }
  return out;
}

function parseYamlBlock(lines: YamlLine[], start: number, indent: number): { value: unknown; next: number } {
  if (start >= lines.length || lines[start].indent < indent) { return { value: null, next: start }; }
  if (lines[start].text.startsWith('- ') || lines[start].text === '-') {
    const arr: unknown[] = [];
    let i = start;
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
      const itemText = lines[i].text.slice(1).trim();
      if (itemText === '') {
        const sub = i + 1 < lines.length ? parseYamlBlock(lines, i + 1, lines[i + 1].indent) : { value: null, next: i + 1 };
        arr.push(sub.value);
        i = sub.next;
      } else if (/^[^:\s][^:]*:\s/.test(itemText) || /^[^:\s][^:]*:$/.test(itemText)) {
        // "- key: value" — a map whose first entry sits on the dash line.
        const first = { indent: indent + 2, text: itemText };
        const rest = lines.slice(i + 1);
        const merged = [first, ...rest];
        const sub = parseYamlBlock(merged, 0, indent + 2);
        arr.push(sub.value);
        // sub.next counts from the merged array, whose first entry is
        // synthetic: the real index is the dash line plus sub.next.
        i = i + sub.next;
      } else {
        arr.push(yamlScalar(itemText));
        i += 1;
      }
    }
    return { value: arr, next: i };
  }
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i].text;
    if (line.startsWith('- ')) { break; }
    const colon = line.indexOf(':');
    if (colon < 0) { return { value: null, next: i }; }
    const key = line.slice(0, colon).trim().replace(/^['"]|['"]$/g, '');
    const rest = line.slice(colon + 1).trim();
    if (rest === '' || rest === '|' || rest === '>') {
      if (rest === '|' || rest === '>') {
        // Literal / folded block: the following deeper lines are the value.
        const blockLines: string[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].indent > indent) { blockLines.push(lines[j].text); j += 1; }
        obj[key] = blockLines.join(rest === '|' ? '\n' : ' ');
        i = j;
      } else {
        // Nested block: its indent is whatever the next line actually
        // uses, not indent + 1 — YAML indents by any consistent amount.
        const sub = i + 1 < lines.length ? parseYamlBlock(lines, i + 1, lines[i + 1].indent) : { value: null, next: i + 1 };
        obj[key] = sub.value;
        i = sub.next;
      }
    } else if (rest.startsWith('#')) {
      obj[key] = null;
      i += 1;
    } else {
      obj[key] = yamlScalar(rest);
      i += 1;
    }
  }
  return { value: obj, next: i };
}

export function parseYamlSubset(text: string): unknown {
  const lines = yamlLines(text);
  if (!lines.length) { return null; }
  const { value } = parseYamlBlock(lines, 0, lines[0].indent);
  return value;
}

// --- OpenAPI -----------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseOpenApiSpec(text: string): OpenApiSpec | null {
  let doc: unknown = null;
  const trimmed = String(text || '').trim();
  if (!trimmed) { return null; }
  try { doc = JSON.parse(trimmed); } catch { doc = parseYamlSubset(trimmed); }
  const root = asRecord(doc);
  if (!root || typeof root.openapi !== 'string' || !root.openapi.startsWith('3.')) { return null; }
  const info = asRecord(root.info) ?? {};
  const servers = Array.isArray(root.servers) ? root.servers : [];
  const firstServer = asRecord(servers[0]) ?? {};
  const baseUrl = typeof firstServer.url === 'string' && firstServer.url ? firstServer.url : 'http://localhost:3000';
  const paths = asRecord(root.paths);
  if (!paths) { return null; }
  const operations: OpenApiOperation[] = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  for (const [p, item] of Object.entries(paths)) {
    const pathItem = asRecord(item);
    if (!pathItem) { continue; }
    for (const method of methods) {
      const op = asRecord(pathItem[method]);
      if (!op) { continue; }
      const params: OpenApiParameter[] = [];
      if (Array.isArray(op.parameters)) {
        for (const pRaw of op.parameters) {
          const pRec = asRecord(pRaw);
          if (!pRec || typeof pRec.name !== 'string') { continue; }
          const where = pRec.in === 'query' || pRec.in === 'path' || pRec.in === 'header' || pRec.in === 'cookie' ? pRec.in : 'query';
          params.push({ name: pRec.name, in: where, required: pRec.required === true || where === 'path', schema: asRecord(pRec.schema) ?? {} });
        }
      }
      const requestBody = asRecord(op.requestBody) ?? null;
      const responses = asRecord(op.responses) ?? {};
      operations.push({
        method: method.toUpperCase(),
        path: p,
        operationId: typeof op.operationId === 'string' ? op.operationId : null,
        summary: typeof op.summary === 'string' ? op.summary : null,
        parameters: params,
        requestBody,
        responses,
      });
    }
  }
  if (!operations.length) { return null; }
  return {
    title: typeof info.title === 'string' ? info.title : 'API',
    version: typeof info.version === 'string' ? info.version : '',
    baseUrl,
    operations,
  };
}

// A sample value for a JSON Schema fragment. Name-aware like the
// existing sample values: email, url, date, uuid, token and id get
// realistic values; enums use their first value; objects and arrays
// recurse (depth capped, so a self-referencing schema cannot loop).
export function sampleValueForSchema(schema: Record<string, unknown>, name = '', depth = 0): unknown {
  const lower = name.toLowerCase();
  if (Array.isArray(schema.enum) && schema.enum.length) { return schema.enum[0]; }
  if (schema.example !== undefined) { return schema.example; }
  if (schema.default !== undefined) { return schema.default; }
  const type = typeof schema.type === 'string' ? schema.type : '';
  const format = typeof schema.format === 'string' ? schema.format : '';
  if (type === 'string' || (!type && format)) {
    if (format === 'email' || lower.includes('email')) { return 'test@example.com'; }
    if (format === 'uri' || format === 'url' || lower.includes('url') || lower.includes('website')) { return 'https://example.com'; }
    if (format === 'date' || lower.includes('date')) { return '2026-01-01'; }
    if (format === 'date-time' || lower.includes('time')) { return '2026-01-01T00:00:00Z'; }
    if (format === 'uuid' || lower.includes('uuid')) { return '00000000-0000-0000-0000-000000000000'; }
    if (lower.includes('password')) { return 'secret123'; }
    if (lower.includes('phone')) { return '9876543210'; }
    if (lower.includes('token') || lower.includes('secret') || lower.includes('api-key') || lower.includes('apikey')) { return 'test-token'; }
    if (lower.includes('username') || lower.includes('user-name')) { return 'testuser'; }
    if (lower.endsWith('id') || lower === 'id') { return '1'; }
    return 'test';
  }
  if (type === 'integer' || type === 'number') { return type === 'integer' ? 1 : 1.5; }
  if (type === 'boolean') { return true; }
  if (type === 'array') {
    const items = asRecord(schema.items) ?? {};
    return [sampleValueForSchema(items, name, depth + 1)];
  }
  if (type === 'object' || (!type && asRecord(schema.properties))) {
    if (depth >= 3) { return {}; }
    const props = asRecord(schema.properties) ?? {};
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(props)) {
      const subRec = asRecord(sub) ?? {};
      out[key] = sampleValueForSchema(subRec, key, depth + 1);
    }
    return out;
  }
  return 'test';
}

function firstJsonSchema(requestBody: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!requestBody) { return null; }
  const content = asRecord(requestBody.content) ?? {};
  const json = asRecord(content['application/json']) ?? asRecord(content['*/*']) ?? asRecord(Object.values(content)[0]);
  const schema = json ? asRecord(json.schema) : null;
  return schema;
}

function expectedStatus(op: OpenApiOperation): number {
  const codes = Object.keys(op.responses);
  const ok = codes.find((c) => /^2\d\d$/.test(c));
  if (ok) { return Number(ok); }
  return 200;
}

// One test per operation, plus a missing-required-parameter test when
// the operation has required parameters. Uses the global fetch, so no
// test library beyond the runner is needed. Path parameters are filled
// with samples; query parameters are appended; a request body is sent
// as JSON from its schema. The base URL comes from the spec's servers
// list, or http://localhost:3000 with a TODO when the spec has none.
export function generateOpenApiTests(spec: OpenApiSpec, sourceFile: string, framework: 'jest' | 'vitest' | 'node' = 'jest'): string {
  const baseNote = spec.baseUrl === 'http://localhost:3000'
    ? '// TODO: the spec has no servers entry — set BASE_URL to your running API.\n'
    : '';
  const importLine = framework === 'node'
    ? `import { test, describe } from 'node:test';\nimport assert from 'node:assert/strict';\n`
    : framework === 'vitest'
      ? `import { describe, test, expect } from 'vitest';\n`
      : '';
  const cases: string[] = [];
  for (const op of spec.operations) {
    const label = op.operationId ?? `${op.method} ${op.path}`;
    const summary = op.summary ? ` — ${op.summary}` : '';
    const pathParams = op.parameters.filter((p) => p.in === 'path');
    const queryParams = op.parameters.filter((p) => p.in === 'query');
    let urlPath = op.path;
    for (const p of pathParams) {
      const sample = sampleValueForSchema(p.schema, p.name);
      urlPath = urlPath.replace(`{${p.name}}`, encodeURIComponent(String(sample)));
    }
    const query = queryParams.map((p) => `${p.name}=${encodeURIComponent(String(sampleValueForSchema(p.schema, p.name)))}`).join('&');
    const url = query ? `BASE_URL + '${urlPath}?${query}'` : `BASE_URL + '${urlPath}'`;
    const schema = firstJsonSchema(op.requestBody);
    const body = schema ? `, {\n      method: '${op.method}',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify(${JSON.stringify(sampleValueForSchema(schema, '', 0))}),\n    }` : op.method === 'GET' || op.method === 'DELETE' ? '' : `, { method: '${op.method}' }`;
    const expected = expectedStatus(op);
    const assertLine = framework === 'node'
      ? `assert.equal(res.status, ${expected});`
      : `expect(res.status).toBe(${expected});`;
    const testFn = framework === 'node' ? 'test' : 'test';
    cases.push(`  ${testFn}('${label}${summary.replace(/'/g, "\\'")}', async () => {\n    const res = await fetch(${url}${body});\n    ${assertLine}\n  });`);
    // Missing-required-parameter test: drop one required query param.
    const requiredQuery = queryParams.filter((p) => p.required);
    if (requiredQuery.length) {
      const dropped = requiredQuery[0];
      const rest = queryParams.filter((p) => p.name !== dropped.name)
        .map((p) => `${p.name}=${encodeURIComponent(String(sampleValueForSchema(p.schema, p.name)))}`).join('&');
      const url2 = rest ? `BASE_URL + '${urlPath}?${rest}'` : `BASE_URL + '${urlPath}'`;
      cases.push(`  ${testFn}('${label} — missing required ${dropped.name} is rejected', async () => {\n    const res = await fetch(${url2}${body});\n    ${framework === 'node' ? 'assert.ok(res.status >= 400);' : 'expect(res.status).toBeGreaterThanOrEqual(400);'}\n  });`);
    }
  }
  const suiteTitle = /api$/i.test(spec.title) ? spec.title : `${spec.title} API`;
  return `// Generated by AITestNova from the OpenAPI spec in ${sourceFile}\n// ${spec.title}${spec.version ? ` v${spec.version}` : ''} — ${spec.operations.length} operation(s).\n// Review and edit before committing. Start your API first, then run.\n${baseNote}${importLine}\nconst BASE_URL = '${spec.baseUrl}';\n\ndescribe('${suiteTitle.replace(/'/g, "\\'")}', () => {\n${cases.join('\n')}\n});\n`;
}
