# ADR-007: Intelligence Pipeline, Multi-Provider LLM Management, and Paid-Call Boundary

- Date: 2026-10-09
- Status: **Accepted (user sign-off 2026-10-09)**
- Decision owners: User
- Related: ADR-008 (external fetch/embeddings sources); active plan §4–§5; `docs/intel-source-catalog.md`
- Schema baseline before intel migrations: **v13** (article content). Intel and ops tables begin at **`014-*` and upward**, one migration per approved slice (R1.5/R2/R3…), additive and idempotent.

## Context

Shipping HOT adds an intelligence pipeline (prefilter, structured extract, event grouping, impact cards, optional daily digest) adapted from AIHOT@`44578fa`, integrated into the existing Nitro modular monolith, `BackgroundRuntime`, `SecretStore`, and `provider_usage`. Translation today is hard-bound to DeepSeek in guardrails; the risk-intelligence round requires configurable OpenAI-compatible providers, step bindings, vector embeddings from a **separate** vendor, budget gates, and auditable paid receipts—without GET read paths triggering LLM calls.

## Decision

### 1. Architecture placement

- New code lives under `server/intel/**` (and `scripts/intel-eval.ts`) per plan §5.3; no second app, queue product, or PostgreSQL.
- Scheduling: register intel jobs on existing `BackgroundRuntime` only; merge/grouping concurrency = 1 with in-process mutex.
- **Read path rule**: all UI/API GET routes for browsing intel, feed, calendar, weather, policy remain provider-free at read time (zero LLM claim/usage delta on browse).

### 2. LLM provider model (§4.10)

- Tables (logical names; DDL in migrations): `llm_provider`, `llm_model`, `llm_step_binding`, plus existing `provider_usage` extended for all LLM scopes and `paid_receipt` (SQLite, `BEGIN IMMEDIATE` idempotency adapted from AIHOT).
- Settings UI: manage providers (name, base URL, OpenAI-compatible API), models (chat vs embedding, unit pricing), **test connection** (counts against budget), and per-step bindings: prefilter, extract, group batch, group second opinion (**must be a different provider** when configured), summary, daily report, embeddings.
- **Merge second opinion (plan §4.3):** when a binding for **group second opinion** on a **second** chat provider is configured, it may run for low-similarity `SAME_OCCURRENCE` candidates. **When no second chat provider is configured**, the system **must not** auto-merge those candidates: it only creates a **“疑似同一事件”** association and enqueues **manual confirmation**; both events stay visible with pending linkage until a human override.
- **Approved defaults (2026-09-30)**: primary chat = **DeepSeek**; second-opinion chat = **Alibaba Bailian / Qwen** when configured; embeddings = **Alibaba Bailian** (plan option A). No automatic fallback between providers except explicit step binding.
- **Budget**: extend translation monthly budget gates to all LLM calls; if budget unset/zero, **no paid calls** (R3-5). User configures budget in Settings when ready—R0 does not set amounts.
- Translation: after R3 settings work, Feed/article translation selects models via the same binding layer; until then existing fixed DeepSeek translation boundary in `AGENTS.md` remains in force for production behavior.

### 3. Provenance rule (plan §1.3)

- Every **judgment field** exposed in UI, APIs, daily reports and exports must carry **`provenance`** (`official` / `report` / `system` / `ai`) and a **`basis`** (rule id, source id, model step, input snapshot pointer, or equivalent audit handle).
- **No provenance, no display:** rows missing required provenance/basis must not be rendered as factual judgments; exports must retain the same markers (not strip badges for convenience).
- Impact cards, weather impacts, confirmation status, rank score inputs and LLM-derived summaries all obey this rule; reference calendar and provider-free GET paths stay non-LLM but still show source/type where applicable.

### 4. Pipeline and data (§3–§4)

- Persist intel entities: `intel_source`, `intel_fetch_run`, `intel_item`, `intel_analysis`, `intel_fact`, `intel_event`, `intel_event_member`, `intel_grouping_decision`, `impact_card`, `label_item`, `label_decision` as specified in the plan; vectors stored in SQLite (BLOB/JSON) with in-process cosine similarity; FTS5 for lexical recall when needed.
- Confirmation vs rank score remain separate (§4.4); weather impacts stay rule-based (`system` provenance), never LLM-derived “implemented” closures.
- AIHOT reuse: copy only files listed in plan §5.3 from external clone; MIT `third_party/aihot/LICENSE`; file headers `// Adapted from AIHOT@44578fa …`.

### 5. Paid boundary

- Every LLM invocation goes through receipt + usage accounting; diagnostic/test connection included.
- No new paid service accounts or live keys in R0/R1; implementation stages use fixtures and isolated DBs unless explicitly authorized for live verification.

### 6. Guardrail change (when R3 lands)

- Replace “translation-only DeepSeek, no second provider” in `AGENTS.md` with: intel + translation share the LLM registry; **no** silent fallback; step bindings and budget gates are mandatory; Feed GET remains provider-free.

## Consequences

- R2+ may add dependencies `zod`, `@mozilla/readability`, `linkedom`, `undici`, `p-limit` (plan §5.4)—each added in the stage that first needs them, not in R0.
- S5 article translation cache contract (`article-faithful-v1`) stays independent of intel cache rows.

## R0 scope

This ADR is decision-only. No migrations, providers, or settings UI in R0.
