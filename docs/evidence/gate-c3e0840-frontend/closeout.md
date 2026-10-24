# Demo overview correction and review repairs — 2026-10-14

Code `c3e08408623c69a3a071d761ed0300659644bd68`. This round includes the parent's P2 review fixes and the user's substantive screenshot comparison, not another backend slice.

## Correction to the earlier claim

The previous3fb3ad3 build reused shell and policy source, but `/` still mounted the legacy HOT dashboard and navigation duplicated home/event paths. It did **not** satisfy the requested demo homepage. This round replaces the default component with the demo country-overview framework. Legacy HotPage remains exported but unmounted; no backend algorithm was changed.

Reference unchanged: `.tmp/demo/shipping-hot-demo.html`, SHA256 `23d6efbb343182eba93caa74a4b1ca1657bab25f414fb873d9c448efe98b51b7`. Actual `overview()`/`legend()`/COUNTRIES order and CSS copied/adapted: view heading, judgement and confirmation legend, auto-fill min290px country grid, six country cards with top/kv/delay structure, attention panel, banner and single sidebar. Card order CN/MY/PH/VN/TH/ID and approved eight-port codes are scope facts. Risk fields say unevaluated/unopened, never fake severity, count, delay or updated time. No simulated demo events/forecasts/AI advice imported. Exact number of columns follows original responsive auto-fill rule, not a claimed screenshot width match.

One navigation has one link per existing route; no second home/event list. Country overview framework is open while R4/R5 aggregation and estimates are unopened. Independent weather still disabled; port weather remains reachable. Source disclosure is explanation only. Existing `/events` is an existing event list, not proof of R4 merging. Policy page was not visually inspected from the user attachments.

## Three review repairs

1. Shell again calls existing useReduceMotion, wraps all children in MotionConfig, and shows an accessible native MotionToggle. Original `sh-reduce-motion` tri-state key/getOnInit behavior and html reduce-motion class preserved. Explicit reduced=true uses always; false uses never so explicit user choice can override system preference in both CSS and Framer Motion. No old sidebar/background or second preference mechanism. Atom factory is a test seam; production still creates exactly one atom.
2. Policy CSS classes now published/effective, matching actual record statuses and labels. No business/date/status inference change.
3. At<=1280px policy list/detail stack; row children shrink/wrap and status no longer forces nowrap. This is a static risk mitigation for900–1024px, not reproduced overflow or a verified viewport result. Country card header/port strings wrap without altering data.

## Evidence and limits

- Fresh clone with exact code commit; full frozen install with scripts enabled, build/typecheck/lint,46 targeted checks, full116files/1096pass/3existing Windows skips and3isolated native/Runtime/Feed smokes: all raw exit0. Separate stdout/stderr, command/full SHA/cwd/timestamps/raw exit here. Normalized tracked diff0 after build; generated routeTree LF/CRLF status only. Primary repo dist and original previews untouched.
- Tests: actual policy published/effective SSR and CSS mapping; stored localStorage choice loaded immediately/persisted; actual hook with mocked React-effect scheduling/media/useAtom bridge and real Jotai store verifies html class and overrides; native motion switch SSR/handler; six-card overview rendering, no legacy HOT stats/invented values, default route wiring and unique navigation. Hook/effect mocks are **not browser lifecycle acceptance**.
-18 loopback HTTP/resource/API checks passed on `http://127.0.0.1:4483/`, PID15768. New isolated cwd `.tmp/overview-preview-c3e0840` copied4482 DB with original3explicit policy fixtures; record lists exactly equal at the same disclosed test clock, revision versions preserved. No reseeding or real source acquisition. Minimal OS env; no credentials/project env/secret file; Runtime/translation/providers off.4477 PID50980 and4482 PID30024 remain original services/builds.
- Browser/pixel/real keyboard/mobile400/900/1024 and S7 **NOT_RUN / pending**. Official browser unavailable; earlier custom CDP operation rejected, no bypass or new browser attempt. Parent reported actual attachment comparison; this executor did **not independently view/materialize the two user images**, relied on that observation and actual original HTML. No claim of complete pixel/demo match or policy visual PASS. Existing S7 home-flow assumptions may require alignment with the newly approved overview before full acceptance; no duplicate harness introduced.
- Retained databases/SecretStore hashes unchanged in gate metadata. Counter/fixture equality does not prove zero egress; no egress capture claimed. No upstream collection/paid/LLM/schema/provider/config/budget/production changes. Precommit ad-hoc lint/test caught a misplaced JSX conditional brace during editing, fixed before clean code commit; final gate is the code evidence.

## Actual Neat Freak closeout

Real skill v3.0.0 and verification reference already loaded; actual Bash inventory rerun at c3e0840, raw exit0. Inventory is a file/rule enumeration, not a security audit. React Best Practices review retains stable hooks/query keys, pure presentation/native controls, escaped text, internal API-only UI and explicit missing states.

| Fact surface | State | Action |
|---|---|---|
| Code | changed-and-verified, non-browser scope | Exact-SHA gate; no backend/schema/dependency change |
| Runtime | pending full acceptance | HTTP18pass; real UI/pixel/keyboard/S7NOT_RUN |
| Docs | changed-and-verified | Current status, architecture and AGENTS distinguish open framework from unopened algorithms; prior claim explicitly superseded |
| Rules | changed-and-verified | Single routes/current home clarified; authorization and CI policy unchanged |
| Memory | out-of-scope/generated-read-only | No writes |
| Workspace | cleanup pending, preserved | Original previews and fixtures, new clone/preview/drivers/logs retained; nothing deleted |

Known build chunk/Browserslist/duplicate-import/Windows skip/CRLF/ignore permission warnings retained. Secret pattern scan only on new evidence, not historical archives. No account-leak claim or history cleanup. Temporary helper/old preview cleanup still requires explicit post-report authorization. No merge/deploy/force-push; PR8 remains stacked draft and parent review pending. R2 and R3–R5 business acceptance unchanged.
