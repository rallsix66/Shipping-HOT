# Approved local synthetic clip build

`pnpm build:clip-synthetic` creates `.tmp/clip-synthetic-build/{app,extension,client}` and build.json. Normal build commands always compile the capability off. This test build alone additionally accepts the whole-string source `http://127.0.0.1:5174/synthetic-article.html`; no aliases/query/fragment/redirect. See ADR-010. No new permissions, schema, source or provider.

For a verified commit, copy the app/extension to `.tmp/clipper-manual-<short-sha>/{app-test,extension-test}`, and copy build.json plus the one authored HTML alongside. Never overwrite normal artifacts. Run `pnpm serve:clip-synthetic -- .tmp/clipper-manual-<short-sha>` from the repository root. It initializes its own `run/.data` DB, binds source5174 and receiver5173 only to127.0.0.1, and starts the server with real mode, Runtime/intel off and an OS-only environment. Existing unrelated listeners must not be stopped. No local secret may exist.

Before user actions, verify source/receiver HTTP200, marked HTML, actual process bindings and zero material/version/action/usage counters. The per-round handoff/evidence in docs/status.md identifies the exact reviewed path and SHA. Do not infer actual browser success from a build or API test.

Only the user operates Chrome in the independent test configuration: `chrome://extensions` → Developer mode → Load unpacked → exact `extension-test` directory; confirm ID `jihkanbaffodclncabodmbahbbgkjoad`, synthetic name and original activeTab/scripting/storage permissions. No ChatGPT control extension needed. Open the exact source URL. Fill a synthetic operator; choose metadata with unknown rights first, or declare own-work/full-text only for this authored fixture. Preview → send to Shipping HOT → inspect → explicitly `保存人工剪藏资料`. The parent then reads existing intel GET list/detail/version APIs and actual SQLite counters. Browser screenshot, nonce delivery, save/reopen and failure observations remain pending until the user performs them.

Normal-package genuine-HTTPS acceptance remains separate. Keep all temporary databases, packages and evidence; cleanup requires a later explicit decision.
