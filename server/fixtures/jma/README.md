# JMA specification fixtures (minimal)

## Source

- Origin: Japan Meteorological Agency (JMA) Typhoon `specifications.json` product responses
  captured offline during R2-4 gapfill (TC2636 / TC2637).
- Absolute product URL pattern (from map.html source chain):
  `https://www.jma.go.jp/bosai/typhoon/data/{TCID}/specifications.json`
- **No new network** was used to refresh these fixtures for dots 1792921846; bytes are
  extracted from preserved private originals under `.tmp/r2-4-ppa-map-20261025/private/`.

## Extraction scope (not complete originals)

| File | Role | What is included |
| --- | --- | --- |
| `TC2637-specifications.min.json` | Positive gale+storm shape | Title + Analysis row + one forecast row only (trimmed from full multi-hour payload) |
| `TC2636-specifications.min.json` | Absent-storm / absent-both shape | Title + Analysis + one forecast row only |

These are **minimal excerpts** for Vitest boundary/shape coverage. They are **not** the
full wire originals. Full offline replay evidence (sha256, all rows) lives under
`docs/evidence/r2-4-xxw02-windcircle-20261025/offline-replay.public.json` and private
`.tmp` captures (not published).

## License / redistribution

- JMA content remains under JMA's own terms of use / copyright. Shipping HOT retains
  these minimal excerpts solely as offline regression fixtures for parsing semantics.
- This repository does **not** claim any new license grant, redistribution right, or
  endorsement from JMA. Do not treat fixtures as redistributable open data beyond the
  project's internal test use.
