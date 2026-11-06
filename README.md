<div align="center">

# 🧪 AITestNova — Test Studio for Antigravity
### Generate unit tests, record and replay APIs, check coverage — locally, in Antigravity

**Generate unit tests, record and replay API calls with mocks, run test suites, check coverage, and see a local dashboard — in Antigravity. Multi-model test generation, stability checks, and CI workflow included.**

[![Open VSX](https://img.shields.io/badge/Open_VSX-aitestnova.aitestnova-0d9488?style=for-the-badge)](https://open-vsx.org/extension/aitestnova/aitestnova)
[![Version](https://img.shields.io/badge/Version-v0.3.9-8b5cf6?style=for-the-badge)](https://github.com/1nc24cs146-cmyk/AITestNova)
[![Downloads](https://img.shields.io/badge/Downloads-362-10b981?style=for-the-badge)](https://open-vsx.org/extension/aitestnova/aitestnova)
[![License](https://img.shields.io/badge/License-MIT-0f172a?style=for-the-badge)](LICENSE)

[⬇️ Install](#-install-in-antigravity) •
[✨ What it does](#-what-it-does) •
[⚙️ Settings](#-settings) •
[🚫 What it does not do](#-what-is-not-included-honestly)

</div>

---

## 📊 At a glance

| | |
|---|---|
| **Extension** | `nitinkumarhiremath.aitestnova` (this build) — live on Open VSX as `aitestnova.aitestnova` |
| **Version** | 0.3.9 |
| **Downloads** | 362 on Open VSX (4 Nov 2026) |
| **Editor** | Antigravity |
| **Models** | Template (no model), local Ollama, or OpenAI-compatible — your choice |
| **Cloud** | None. No account, no telemetry, dashboard local only |
| **License** | MIT |

**Downloads note:** Antigravity's own extension-details panel has no downloads row, so the live count is shown at the top of the AITestNova sidebar in Antigravity and on the Open VSX listing page.

## ⬇️ Install in Antigravity

1. Extensions → … → Install from VSIX → choose `aitestnova-antigravity-0.3.9.vsix`
2. Reload Antigravity, then click the AITestNova icon in the activity bar.
3. Open a code file and click “AITestNova: Generate test” above a function, or open the Record & Replay tab.

If you installed an earlier AITestNova build, uninstall it first when you change publisher/namespace, because a different extension ID does not auto-update the old one.

## ✨ What it does

### Unit tests

- **Per function:** a “AITestNova: Generate test” button above each function in JavaScript/TypeScript, Python, Java, Go, C, C++, C#, Rust, Ruby, PHP, Kotlin, and Swift.
- **Per file:** Command Palette → “AITestNova: Generate Tests for This File”.
- **From a comment or spec:** select a comment/spec in a code file, then Command Palette → “AITestNova: Generate Tests from Selected Comment/Spec”. Case names come from your spec lines; the target is the first `code` name in the spec, or “target” for you to replace.
- **Extra cases:** type an extra case in the panel (“also test empty input”) and it is added to the next generation.
- **Review first:** generated tests open in the editor. Nothing is saved until you save it. Template tests are starting points, not proof — review them, mock dependencies, and adjust assertions before committing.
- **Java frameworks:** set `aitestnova.javaFramework` to `junit` (default) or `testng`.

### AI generation — template first, models optional

- **Template (default):** no model, no key, no account needed.
- **Ollama (local):** set `aitestnova.aiProvider` to `ollama`, with `aitestnova.ollamaUrl` (default http://localhost:11434) and `aitestnova.ollamaModel` (default qwen2.5-coder:7b).
- **Multi-model evaluation:** set `aitestnova.aiModels` to a comma list, max 3 (for example `qwen2.5-coder:7b,llama3.2:3b`). Generation tries each model and keeps the best-scoring output — tests, assertions, and edge cases, penalised for unbalanced braces — and tells you which model won. Leave it blank for a single model.
- **OpenAI-compatible:** set `aitestnova.aiProvider` to `openai`, set `aitestnova.openaiBaseUrl` and `aitestnova.openaiModel`, and save a key with “AITestNova: Set AI API Key”. The key goes to the OS keychain via SecretStorage — it is never written to a file. Clear it with “AITestNova: Clear AI API Key”.

### Record & replay APIs

- **Send & Record:** enter a method, URL, headers, and body in the Record & Replay tab, then Send & Record. The real request and response are saved.
- **Replay:** replays a recorded test and diffs status and body against the recording. JSON bodies are compared key-order-insensitively.
- **Mock mode:** replay returns the recorded response without calling the server, so replay does not need the live server.
- **Normalisation:** tick “Ignore volatile fields” to ignore timestamp, id, uuid, token, and similar keys when comparing bodies.
- **Stability:** replay recorded tests 5 times (configurable via `aitestnova.stabilityRuns`); a test is STABLE only if it passes every time.
- **Dedup:** “Remove duplicate recorded tests” removes identical method + URL + body recordings.
- **Suites:** name a suite and “Create suite from all recorded”, then Run suite (in order, stops on first failure) or Delete.
- **Export / import:** “Export tests (JSON + YAML)” writes `aitestnova-tests.json` and `aitestnova-tests.yml` in the workspace. “AITestNova: Import API Tests” loads the JSON back, deduped. Edit the exported files — they are yours.

### Coverage, dashboard, and stability

- **Coverage:** AITestNova reads coverage files your test runner already made (Cobertura XML, Jest coverage JSON). It never invents a coverage number. Run your tests with coverage first, for example `jest --coverage` or `pytest --cov`.
- **Baseline + delta:** in the Coverage tab, “Set as baseline”, then re-run with coverage and “Check coverage delta”. If coverage did not improve, it warns you. It does not delete tests automatically, because per-test coverage attribution needs your runner's data.
- **Dashboard (local only):** the Dashboard tab shows recorded tests, suites, total replay pass rate, and the last 5 replays, coverage reads, and unit stability runs. The last 20 of each are kept. No cloud, no telemetry.
- **Unit stability:** Command Palette → “AITestNova: Run Unit Tests Stability Check” runs your test command 5 times (auto-detected: `npm test`, `pytest`, `go test ./...`, `mvn -B test`, or your `aitestnova.testCommand`) and reports STABLE / FLAKY in the output channel.

### CI and pull requests — local only

- **CI workflow:** Command Palette → “AITestNova: Add CI Workflow” writes `.github/workflows/aitestnova.yml` for your detected stack (Node, Python, Go, or Java). Review it before committing. It refuses to overwrite an existing file.
- **Commit tests:** “AITestNova: Commit Generated Tests (Local Git)” stages and commits a saved test file in your repo. Push is NOT done automatically.
- **PR description:** “AITestNova: Create PR Description” writes `aitestnova-pr.md` with replay and coverage summary to paste into a pull request.

There is no cloud PR agent, no auto-push, and no GitHub token in this extension.

## ⚙️ Settings

| Setting | Default | What it does |
|---|---|---|
| `aitestnova.aiProvider` | `template` | `template`, `ollama`, or `openai` |
| `aitestnova.aiModels` | (blank) | Comma list, max 3, for multi-model evaluation |
| `aitestnova.ollamaUrl` | http://localhost:11434 | Ollama base URL |
| `aitestnova.ollamaModel` | qwen2.5-coder:7b | Single Ollama model |
| `aitestnova.openaiBaseUrl` | https://api.openai.com/v1 | OpenAI-compatible base URL |
| `aitestnova.openaiModel` | gpt-4o-mini | Single OpenAI-compatible model |
| `aitestnova.javaFramework` | `junit` | `junit` or `testng` |
| `aitestnova.stabilityRuns` | 5 | Times a test is replayed / run in a stability check |
| `aitestnova.testCommand` | (auto-detect) | Test command for unit stability runs |

## 🚫 What is NOT included, honestly

- No kernel/eBPF traffic capture, no TLS interception, and no DB, queue, or gRPC traffic capture. AITestNova only records requests made through its own panel — it cannot silently capture all traffic of a running app.
- No LiteLLM cloud routing, no cloud PR agent with auto-push, no cloud dashboard, and no live inline autocomplete. Those need a separate server or binary and are out of scope for a pure Antigravity extension.
- What IS included instead, locally: multi-model scoring, a local dashboard, local git commit plus a PR description file, and generate-from-spec.

## 🔨 Build from source

```
npm install
npm run compile
npx @vscode/vsce package --no-yarn
```

## 📄 License

AITestNova is released under the MIT License. You may use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of this software, subject to keeping the copyright notice and this permission notice in all copies or substantial portions of the software.

The full license text, also included as the LICENSE file with this extension, is:

```
MIT License

Copyright (c) 2026 NitinKumar Hiremath

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Note: the LICENSE file in the GitHub repository was created by GitHub at repository creation with the copyright name “NITINKUMAR”. The LICENSE shipped inside this VSIX uses the full name “NitinKumar Hiremath”, as above. Both are MIT licenses.

---

*AITestNova — Developed by NitinKumar Hiremath.*

## Test health — stale, mutation, flaky

Open the AITestNova panel and use the **Health** tab, or the Command Palette commands.

- **Stale-test detection (`AITestNova: Check Stale Tests`):** every test generated by AITestNova (from 0.3.4) records a snapshot of the function name and its parameters. The check re-reads the source and reports STALE when the function is gone or its parameters changed, OK when unchanged, and POSSIBLE STALE (heuristic only) when a saved test calls a function with the wrong argument count. Tests generated before 0.3.4 have no snapshot, so they cannot be checked definitely — the check says so instead of guessing.
- **Mutation score (`AITestNova: Run Mutation Score`):** seeds small bugs (one operator per line, up to `aitestnova.mutationLimit`, default 8) into the open file, runs your project's own test command for each, and reports killed / survived / unknown and a percentage. If the baseline (unmutated) tests fail, no score is reported at all. The file is restored to its original content after every mutant, and the score covers only the mutants actually run, not the whole codebase.
- **Flaky quarantine + trends (`AITestNova: Quarantine Flaky Tests`, `AITestNova: Show Trends`):** every replay and stability run is recorded per test. The Dashboard shows a pass-rate trend over the last 20 runs, the flaky tests, and the quarantined list. Quarantining moves tests that actually failed at least once into a "Quarantined (flaky)" suite and excludes them from Replay all; restoring puts them back. Recorded tests are tagged [FLAKY] or [QUARANTINED] in the panel.

## Hardened for all situations (0.3.5)

This release makes every feature handle real-world code instead of only the happy path:

- **Parsing:** multi-line signatures, class methods, async functions, generators, arrow functions (including single-parameter arrows), TypeScript types, Java typed/generic/varargs/annotated parameters, Go grouped and receiver parameters, Python async functions, type hints, and defaults containing commas like `(1, 2)` — all parsed correctly. Functions mentioned inside strings or comments are no longer mistaken for real functions, and a plain call like `add(1, 2);` is no longer mistaken for a method.
- **Generation:** a destructured parameter becomes one object/array argument, not one argument per field; a zero-parameter Python function is tested with `fn()`, not `fn(value)`.
- **Mutation:** operators inside strings and comments (including multi-line block comments) are never mutated, and `trueValue` is no longer flipped to `falseValue` — only whole-word constants are.
- **Replay:** dedup now counts headers, so tests differing only by an Authorization header are kept; a stability setting of 0 no longer reports "stable" with zero runs; invalid and non-HTTP URLs fail with a readable message.
- **Stale:** the heuristic counts arguments with balanced parens, so `add(foo(1), 2)` is correctly 2 arguments, and calls inside comments are ignored.
- **Panel safety:** recorded test names, URLs, and suite names are escaped before display, so a test named like HTML cannot become markup in the panel.
- **Honest failures:** an unknown stack no longer gets a guessed `npm test` command — mutation and unit stability ask you to set `aitestnova.testCommand` instead; a broken coverage file is reported as broken, not as "no coverage file"; a failed export reports its error instead of failing silently; an imported test with a bad method, missing URL, or non-numeric status is skipped and counted.

Still honestly not covered: the parser is pattern-based, not a full AST, so deeply unusual syntax (macros, exotic decorators, heavily nested generics) can still be missed — in that case generation says "no functions found" rather than inventing one. Mutation is operator-only; it does not delete statements or swap return values. Everything else from earlier versions (no eBPF capture, no cloud dashboard) still applies.

## What's new in 0.3.9

- **Real-world problems:** the generator now detects what a file actually touches — network calls, databases, the file system, the clock, environment config — and writes tests that mock them instead of calling the real thing. A function that hits the network, a database, or writes a file gets no plain test at all (its plain test used to call the real thing); it gets the mocked suite instead. Error paths and pagination get their own tests too.

## What's new in 0.3.8

- **All 13 languages trained, one by one:** JavaScript (Jest, Vitest, Mocha, Node runner, Jasmine; React, Express, Vue, ESM/CommonJS), TypeScript (Angular TestBed, NestJS e2e + services, RxJS Observables, Zod, Next.js handlers), Python (Flask, FastAPI, Django, async tests, unittest, Pydantic), Java (Spring Boot MockMvc, Mockito services), Go (table-driven tests, Gin, testify), C (Unity), C++ (Catch2, doctest), C# (NUnit, MSTest, ASP.NET Core), Rust (tokio, serde round-trip), Ruby (RSpec, Rails request specs), PHP (Pest, Laravel), Kotlin (Spring Boot, Ktor), Swift (async tests, Vapor). The generator recognises the framework a file uses and writes the test that framework expects.

## What's new in 0.3.7

- **All languages (12):** C, C++, C#, Rust, Ruby, PHP, Kotlin, and Swift join JavaScript/TypeScript, Python, Java, and Go — each with real function parsing and a real test template (Google Test, xUnit, Rust `#[cfg(test)]`, Minitest, PHPUnit, JUnit 5, XCTest, and a C assert harness), plus spec-to-test generation in the same languages. A file type AITestNova does not know now says so honestly instead of being treated as JavaScript.

## JavaScript libraries — shipped in v0.3.8

The generator now recognises what kind of JavaScript it is looking at and writes the right test for it:

- **Test runners:** Jest, Vitest, Mocha, Node's own test runner, and Jasmine. `aitestnova.testFramework` is `auto` by default — it reads the project's `package.json` and config files and picks the runner; set it explicitly to force one.
- **React:** a capitalised function that returns JSX gets a `@testing-library/react` render test; a `useXxx` hook gets a `renderHook` test.
- **Express:** `app.get/post/...` routes get a supertest suite that hits the real HTTP layer instead of calling handlers directly.
- **Vue:** functions inside a `.vue` file's `<script>` block are parsed and tested like JavaScript.
- **Modules:** ESM `import` vs CommonJS `require` is detected from the file, and a default export is imported as a default import.

Training is complete for all 13 languages on the list — JavaScript, TypeScript, Python, Java, Go, C, C++, C#, Rust, Ruby, PHP, Kotlin, Swift — all shipped in v0.3.8.

## Python libraries — shipped in v0.3.8

- **Flask:** `@app.route` and `@app.get`/`post` routes get a pytest suite using `app.test_client()`.
- **FastAPI:** routes get a `TestClient` suite.
- **Django:** `path()` entries in a urls file get a `TestCase` suite using Django's test client.
- **Async:** an `async def` gets an awaited test marked `@pytest.mark.asyncio`.
- **unittest:** a file that imports `unittest` gets a `TestCase` class instead of pytest functions.
- **Pydantic / dataclasses:** a `BaseModel` or `@dataclass` gets a valid/invalid test (valid data passes, bad data raises `ValidationError`).

## Java libraries — shipped in v0.3.8

- **Spring Boot:** a `@RestController` gets a MockMvc test for every route (base path from `@RequestMapping` included); a `@Service` gets a Mockito test with each constructor dependency mocked and each method smoke-tested.
- **JUnit 5 / TestNG:** picked per project as before.

## Go libraries — shipped in v0.3.8

- **Table-driven tests:** every function test is now a table with a normal case and an edge case (zero values), run through `t.Run` — the Go idiom, with field types taken from the real signature.
- **Gin:** `r.GET`/`POST`/`...` calls get an `httptest` suite.
- **testify:** a file that imports `testify/assert` or `testify/require` uses `require.NotNil` assertions.

## C and C++ libraries — shipped in v0.3.8

- **C — Unity:** a file that includes `unity.h` gets a Unity test (`TEST_ASSERT_*`, `RUN_TEST`, `UNITY_BEGIN`/`UNITY_END`); otherwise the plain assert harness is used.
- **C++ — Catch2 / doctest:** a file that includes Catch2 gets `TEST_CASE` with `CHECK`; doctest gets the same shape with doctest headers; otherwise Google Test is used.

## C# libraries — shipped in v0.3.8

- **NUnit / MSTest / xUnit:** picked from the file's `using` lines (`[TestFixture]`/`[Test]`, `[TestClass]`/`[TestMethod]`, or xUnit `[Fact]`).
- **ASP.NET Core:** a controller's `[HttpGet]`/`[HttpPost]`/`...` actions get a `WebApplicationFactory` test that calls each route over HTTP.

## Rust libraries — shipped in v0.3.8

- **tokio:** an `async fn` gets a `#[tokio::test]` with an awaited call.
- **serde:** a struct that derives `Serialize`/`Deserialize` gets a JSON round-trip test (`to_string` then `from_str`).

## Ruby libraries — shipped in v0.3.8

- **RSpec:** a file that uses RSpec gets an `RSpec.describe` suite instead of Minitest.
- **Rails:** a `*Controller` class gets a request spec (`type: :request`) hitting its conventional index route.

## PHP libraries — shipped in v0.3.8

- **Pest:** a Pest project gets `test('...', function () {...})` suites with `expect(...)->not->toBeNull()`.
- **Laravel:** `Route::get`/`post`/`...` entries get a feature test (`$this->get(...)` + `assertStatus(200)`).

## Kotlin libraries — shipped in v0.3.8

- **Spring Boot (Kotlin):** a `@RestController` gets a MockMvc test in Kotlin syntax (`lateinit var mockMvc`).
- **Ktor:** `routing { get("/...") { } }` entries get a `testApplication` test per route.

## Swift libraries — shipped in v0.3.8

- **async:** an `async` function gets an `async throws` test with `try await`.
- **Vapor:** `app.get`/`post`/`...` routes get an XCTVapor test (`app.test(.GET, "...")`).

## Real-world problems — shipped in v0.3.9

Toy functions are pure; real code is not. The generator now detects what a file actually touches and writes tests for that:

- **Outside world detected:** network calls (`fetch`, `axios`, `requests`, `net/http`, `HttpClient`), databases (Prisma, Mongoose, SQL, repositories), the file system, the clock (`Date.now`, `datetime.now`, `time.Now`), and environment config (`process.env`, `os.environ`).
- **Mocked, not real:** JavaScript/TypeScript tests mock `fetch`/`axios`, freeze the clock, and set test env vars; Python tests use `unittest.mock.patch` (`requests.get`, `builtins.open`, `datetime`, `os.environ`); Java tests use Mockito `@Mock`; Go tests use an `httptest` server. Nothing in these tests hits the network, disk, or a database.
- **Plain tests no longer hit the network:** a function that calls the network, a database, or writes a file gets no plain test at all — its plain test used to call the real thing. It gets the mocked suite instead; pure functions in the same file keep their plain tests.
- **Error paths:** a function that throws, raises, panics, or returns an error gets a test that triggers the error and asserts it surfaces.
- **Pagination:** functions with `page`/`limit`/`offset` params get a test that asks for a real page.

Not yet trained: Svelte, Fastify, and E2E runners (Cypress, Playwright).

## TypeScript libraries — shipped in v0.3.8

- **Parser:** generic functions and arrows (`function identity<T>(...)`, `<T,>(x) => ...`), class methods with `private`/`public`/`protected`/`readonly`/`abstract`/`override`, constructor property promotion (`constructor(private db: Db)`), optional and union params. Overload signatures and abstract methods are skipped (the implementation is kept), and a decorator call like `@Injectable()` is never mistaken for a function.
- **Async done right:** an `async` function gets an awaited test, and a function returning `Observable` gets a `firstValueFrom` test — a plain assertion on a Promise always passes, so the generator no longer writes one.
- **Angular:** `@Component` classes get a TestBed test (create, detectChanges, plus each method); `@Injectable` services get a TestBed inject test.
- **NestJS:** `@Controller` classes get an end-to-end test with `Test.createTestingModule` and supertest for every route; `@Injectable` services get a unit test with each constructor dependency mocked as `{ provide: Dep, useValue: {} }`.
- **Zod:** a `z.object` schema gets parse tests (valid data accepted, `null` rejected).
- **Next.js:** App Router `GET`/`POST` handlers get a test that calls the handler with a real `Request`.
- **Runners:** `ts-jest` maps to Jest, `ts-node`/`tsx` map to the Node runner, and an Angular project with no other runner maps to Jasmine. A `.tsx` component test is written to `.test.tsx`.

## What's new in 0.3.6 — only the useful additions

- **Save generated test to its test file** (`AITestNova: Save Generated Test to Its Test File`, or the button in the Unit Tests tab): writes the last generated test straight to the test file AITestNova expects it in, creating folders as needed. If that file already exists, it asks before replacing it. The stale check then finds the saved test at that exact path.
- **Update expected** (button on each recorded API test): re-sends that one request live and replaces its expected status and body with the fresh response. For when an API changed on purpose and the old recording should stop failing — if the re-send fails, nothing is changed.
- **Go coverage:** `coverage/coverage.out` (from `go test -coverprofile=coverage.out`) is now read, so Go projects get coverage and deltas instead of "no coverage file found".
- **AI failures are no longer silent:** when Ollama or OpenAI is configured but every model fails, you now get one warning with the real reason (e.g. Ollama returned HTTP 500, or no API key saved) and the template is used instead — previously it fell back without a word.
