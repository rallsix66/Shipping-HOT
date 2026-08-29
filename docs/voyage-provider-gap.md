# Voyage / ETA Provider Gap

> Recorded: 2026-08-29

Real Mode currently has no implemented real Voyage/ETA adapter. The Runtime registry therefore exposes `voyage-sync` with the existing Mock provider disabled when Real Mode is selected. `VESSELAPI_API_KEY` is not configured in the local environment.

This is a credential/adapter gap, not an entitlement result: no VesselAPI ETA or Port Events request was made, and no endpoint availability or plan capability is inferred. VesselAPI Search/Discovery and Voyage/ETA are separate capability contracts.

Current consequences:

- Real Operational Readiness remains `blocked` because the approved Voyage Job is disabled rather than a real enabled Job.
- No ETA, ETD, Port Event or commercial Schedule data is presented as real.
- No Mock Voyage row is promoted into Real Mode operational reads.

Any future ETA/Port Events probe requires a separately authorized credential and capability decision. Until then, this submodule remains stopped; no adapter, migration, secret or Provider contract change is introduced by this record.
