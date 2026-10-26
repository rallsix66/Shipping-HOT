# PAGASA empty-state fixtures (synthetic excerpts)

Synthetic HTML fragments for offline PH-W01 / PH-W02 empty-state parse tests.
They mirror the **product container / empty-node selectors** observed on real
2026-10-26 captures under `.tmp/r2-4-pagasa-phw-20261026/` (private) and
summarized in `docs/evidence/r2-4-pagasa-phw-20261026/`.

These fixtures are **not** full production pages and are **not** live captures.
Real-sample offline replay uses the private wire HTML when present on the
isolation machine; CI uses these synthetic positives + negatives only.

Do not treat `parsed_empty` as "Philippines has no weather risk".
