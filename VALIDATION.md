# Validation evidence

This file records implementation validation as it is completed. All inputs and specification limits are fictional. Passing the lab's tests does not validate a manufacturing process, qualify a pharmaceutical system, prove human identity or authorise product release.

## Coverage

All 40 unit tests pass. They exercise actual SQLite, seeded defect totals, source conservation, idempotency, duplicate conflicts, proposal/review behaviour, missing-slot resolution, server role restrictions, two populated workspaces, expiry using an injected clock, optimistic concurrency, stale proposals, rollback, rejected schemas, safe correction boundaries, actual ZIP extraction and export-history reconciliation. The advancing-clock regression verifies real operation timestamps rather than relying solely on a fixed clock.

The same 24 HTTP scenarios pass against the local SQLite service and local Worker/D1, with 40 real requests in each run. Both runtime processes were stopped and restarted against the same database. The complete snapshot and original observer access survived. Sixteen real desktop/mobile browser checks pass, including an actual downloaded ZIP, source JSON round trip, role controls, approved overlay, retained original and reload recovery. The dependency audit reports zero vulnerabilities.

Public D1, custom-domain HTTPS, Windows/Linux CI and final release evidence are recorded separately as they complete. Local tests alone are not evidence of a public release. Native hosting metadata records the exact deployed source and version.

## Retained failures

`initial-validation-failure.json` records a 32/33 development run. The first verifier checked open findings but did not detect removal of a resolved finding. It now replays audited imports and approvals to reconcile all finding history, duplicate classification, proposal evidence and review metadata. The subsequent service/domain run passes all 33 tests.

`initial-http-failures.json` and `http-clock-repair.json` retain a 20/24 HTTP run. Ingestion and audit timestamps were read separately, which a moving real clock exposed during replay verification. One operation timestamp now covers its source, findings and audit. `restart-http-failures.json` and `workspace-id-repair.json` retain a second isolation failure: gap finding IDs lacked workspace scope. Two populated workspaces now have independent missing-slot IDs.

`initial-worker-failures.json` and `worker-sql-repair.json` preserve the local D1 compound-SELECT incompatibility. Guarded bulk insertion now uses a VALUES common-table expression and passes the same HTTP cases in both runtimes. Failed reports remain distinct from subsequent passing reports.

## Limits

An agent operates the automated and browser checks; no independent human review is implied. Basic keyboard/responsive checks are not a full accessibility audit. Timing observations apply only to recorded small synthetic runs. Hash chains detect inconsistent exports but do not prevent a database administrator from rewriting data and hashes. Public workspaces are bounded, expiring demonstration data stores.
