# PAGASA empty-state fixtures (synthetic excerpts)

Synthetic HTML fragments for offline PH-W01 / PH-W02 empty-state parse tests.
They mirror the **product container / empty-node selectors** observed on real
2026-10-26 captures under `.tmp/r2-4-pagasa-phw-20261026/` (private) and
summarized in `docs/evidence/r2-4-pagasa-phw-20261026/`.

These fixtures are **not** full production pages and are **not** live captures.
Real-sample offline replay uses the private wire HTML when present on the
isolation machine; CI uses these synthetic positives + negatives only.

Negative coverage includes: missing container, unknown copy, paragraph/div/h3/
nested/bare-text body conflicts, duplicate product regions, and error pages.
Archive region content must not be misclassified as active bulletin body.

Private-raw replay: default path uses explicit `it.skipIf` when raw is absent
(never `expect(true)` false PASS). Local qualification requiring raw:

`PAGASA_STRICT_PRIVATE_REPLAY=1 pnpm exec vitest run -c vitest.config.ts server/services/pagasa-empty-state-parse.test.ts`

Do not treat `parsed_empty` as "Philippines has no weather risk".
