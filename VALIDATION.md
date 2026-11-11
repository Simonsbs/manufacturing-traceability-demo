# Validation evidence

Version 1 is public without sign-in at [traceability.bestdev.co.il](https://traceability.bestdev.co.il/), with active DNS and TLS. All inputs and specification limits are fictional. Passing the lab's tests does not validate a manufacturing process, qualify a pharmaceutical system, prove human identity or authorise product release.

## Coverage

All 40 unit tests pass. They exercise actual SQLite, seeded defect totals, source conservation, idempotency, duplicate conflicts, proposal/review behaviour, missing-slot resolution, server role restrictions, two populated workspaces, expiry using an injected clock, optimistic concurrency, stale proposals, rollback, rejected schemas, safe correction boundaries, actual ZIP extraction and export-history reconciliation. The advancing-clock regression verifies real operation timestamps rather than relying solely on a fixed clock.

The same 24 HTTP scenarios pass against the local SQLite service and local Worker/D1, with 40 real requests in each run. Both runtime processes were stopped and restarted against the same database. The complete snapshot and original observer access survived. Sixteen real desktop/mobile browser checks pass, including an actual downloaded ZIP, source JSON round trip, role controls, approved overlay, retained original and reload recovery. The dependency audit reports zero vulnerabilities.

The same 24 HTTP scenarios also pass against public D1 on both the hosting URL and the custom domain, with 40 actual requests per run. All six public hosting checks pass on both origins, including SQL connectivity, source fingerprint, security/cache headers, local assets, unauthenticated access refusal and cross-origin mutation rejection. Twelve real public browser checks pass, including the reviewed correction, actual ZIP download and independent extraction, reload recovery, JSON re-import and the mobile view. [Windows and Linux CI](https://github.com/Simonsbs/manufacturing-traceability-demo/actions/runs/43064653994) both pass for the initial application release.

| Evidence | Measured result |
| --- | --- |
| `unit.json` | 40 unit tests passed |
| `api-sqlite.json`, `api-d1.json` | 24/24 HTTP scenarios and 40 actual requests per local runtime |
| `persistence-sqlite.json`, `persistence-d1.json` | Full snapshot and access preserved across actual runtime process restarts |
| `api-hosting.json`, `api-public.json` | 24/24 scenarios and 40 requests per public origin |
| `hosting-smoke.json`, `public-smoke.json` | Six hosting checks pass on each origin |
| `browser-local.json`, `browser-public.json` | 16 local and 12 public UI checks |
| `browser-export-local.json`, `browser-export-public.json` | Actual downloaded six-file ZIPs independently extracted and verified |
| `desktop.png`, `mobile.png`, `lineage.png` | Actual public application captures |
| `domain-routing.json` | Active DNS/TLS and existing root/other demos still return 200 |

The application fingerprint is `60b84c22fa4a866fe6b80cd511e57c8179f130330d2950603249be7805d3f103`. Initial application source commit `44ccf7561124b960318e5ebea36f82b5689f1c01` was published before adding the final reports. Evidence/documentation publication keeps that application fingerprint unchanged. Native hosting metadata records each exact source commit and version. Local tests alone are not evidence of a public release.

## Retained failures

`initial-validation-failure.json` records a 32/33 development run. The first verifier checked open findings but did not detect removal of a resolved finding. It now replays audited imports and approvals to reconcile all finding history, duplicate classification, proposal evidence and review metadata. The subsequent service/domain run passes all 33 tests.

`initial-http-failures.json` and `http-clock-repair.json` retain a 20/24 HTTP run. Ingestion and audit timestamps were read separately, which a moving real clock exposed during replay verification. One operation timestamp now covers its source, findings and audit. `restart-http-failures.json` and `workspace-id-repair.json` retain a second isolation failure: gap finding IDs lacked workspace scope. Two populated workspaces now have independent missing-slot IDs.

`initial-worker-failures.json` and `worker-sql-repair.json` preserve the local D1 compound-SELECT incompatibility. Guarded bulk insertion now uses a VALUES common-table expression and passes the same HTTP cases in both runtimes. Failed reports remain distinct from subsequent passing reports.

## Limits

An agent operates the automated and browser checks; no independent human review is implied. Basic keyboard/responsive checks are not a full accessibility audit. Timing observations apply only to recorded small synthetic runs. Hash chains detect inconsistent exports but do not prevent a database administrator from rewriting data and hashes. Public workspaces are bounded, expiring demonstration data stores.
