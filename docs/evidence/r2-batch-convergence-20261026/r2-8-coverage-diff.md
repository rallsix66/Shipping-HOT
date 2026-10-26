# R2-8 coverage-diff wording (dots 1792993982.228989)

Original plan R2-8 (`docs/plans/shipping-hot-risk-intelligence-2026-09-29.md`):

> P1 sources run continuously for 24 hours; failed sources auto-backoff and mark `failing`. Record results to `docs/live-verification.md`.

## Contract has / does not have

| Has | Does NOT mandate (do not invent) |
| --- | --- |
| P1 continuous 24h (user authorization) | **All 39 public P1 must share one concurrent wall-clock window** |
| Failed auto-backoff + `failing` | **Every new source add forces a full 39 re-run** |
| Record to live-verification | **Stitch discontinuous historical windows (day19+day20) into continuous 24h** |

## Current coverage diff (reusable evidence only)

- **day20-20261026a** profile `24h-19`: **19 covered** now; **20 of public 39** not in this window (see batch-report).
- **day19** = ATTEMPTED_INCOMPLETE: may cite as local collect/recover history; **time ranges must not be stitched** with day20 into continuous 24h.
- Prior **two-source proposal** and **10s zero-HTTP lifecycle tests** are **not** a 24h pass.
- Whether later **incremental observe** is needed = **separate review**; executor does **not** self-open a whole new round or invent a full-39 re-run gate.

## Non-claims

day20 running ≠ full P1 continuous acceptance complete; overallR2Pass stays false unless genuinely earned.
