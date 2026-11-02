# AITestNova — Test Studio for Antigravity

By NitinKumar Hiremath. Publisher: nitinkumarhiremath.

Repository: https://github.com/1nc24cs146-cmyk/AITestNova

License: MIT — see the LICENSE file in this repository.

An original extension inspired by the Keploy workflow — it is **not** Keploy, uses no Keploy code or binary, and is not affiliated with Keploy.

## Same workflow, in Antigravity

- **Unit tests:** a “AITestNova: Generate test” button above each function, or generate for a whole file. Tests open for review first — nothing is saved until you save it.
- **Flake filtering, honestly scoped:** recorded API tests can be replayed 5 times (configurable) and are marked STABLE only if they pass every time.
- **Coverage-driven:** AITestNova reads coverage files your runner already made (Cobertura XML, Jest coverage JSON). It never invents a coverage number.
- **Record & replay APIs:** Send & Record saves a real request + response. Replay sends it again and diffs status + body. Mock mode returns the recorded response without calling the server.
- **Mocks:** recorded responses act as mocks for replay, so replay does not need the live server.
- **Additional prompts:** type an extra case in the panel (“also test empty input”) and it is added to the next generation.
- **AI, local-first:** default is template generation (no model, no key). Set `aitestnova.aiProvider` to `ollama` to use a local Ollama model if one is running.

## What's new in 0.2.0

- **Unit-test stability:** Command Palette → "AITestNova: Run Unit Tests Stability Check" runs your test command (auto-detected: `npm test`, `pytest`, `go test ./...`, `mvn -B test`, or your `aitestnova.testCommand`) 5 times and reports STABLE / FLAKY.
- **Coverage baseline + delta:** in the Coverage tab, "Set as baseline", then re-run with coverage and "Check coverage delta". If coverage did not improve, it warns you — it does not delete tests automatically, because per-test coverage attribution needs your runner's data.
- **TestNG:** set `aitestnova.javaFramework` to `testng` for TestNG imports instead of JUnit.
- **CI workflow:** Command Palette → "AITestNova: Add CI Workflow" writes `.github/workflows/aitestnova.yml` for your detected stack (Node / Python / Go / Java). Review before committing.
- **Replay normalisation:** tick "Ignore volatile fields" to ignore timestamp, id, uuid, token and similar keys when comparing bodies.
- **Dedup:** "Remove duplicate recorded tests" removes identical method + URL + body recordings.
- **OpenAI-compatible AI:** set `aitestnova.aiProvider` to `openai` and save a key with "AITestNova: Set AI API Key" — the key goes to the OS keychain via SecretStorage, never to a file.
- **Summary:** the Coverage tab's "Show summary" aggregates recorded tests, last replay, and last coverage, locally only.

## What is NOT included, honestly

- No kernel/eBPF traffic capture, no TLS interception, no DB/queue/gRPC capture. AITestNova only records requests made through its own panel.
- No multi-LLM evaluation, no LiteLLM routing, no cloud PR agent, no GitHub auto-commit, no dashboard / cloud analytics, no autocomplete or comment completion. Those need a separate server/binary and are out of scope for a pure Antigravity extension.
- Template tests are starting points, not proof. Review, mock dependencies, and adjust assertions before committing.

## Install in Antigravity

1. Extensions → … → Install from VSIX → choose `aitestnova-antigravity-0.2.0.vsix`
2. Reload, click the AITestNova icon in the activity bar
3. Open a code file and click “AITestNova: Generate test” above a function, or use the Record & Replay tab

## Build

```
npm install
npm run compile
npx @vscode/vsce package --no-yarn
```

License: MIT.
