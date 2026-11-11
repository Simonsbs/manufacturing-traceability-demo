# HTTP and input contract

All API responses use JSON and no-store caching. Bearer access keys are opaque, random, role-scoped and workspace-scoped. No key is accepted from a URL or role header. Cross-origin POSTs are rejected. No permissive CORS headers are emitted. Human labels are unverified demo annotations.

| Method / path | Role | Request |
| --- | --- | --- |
| `GET /api/health` | Public | Source fingerprint and actual SQL connectivity |
| `POST /api/workspaces` | Public | Empty JSON object; creates a bounded 24-hour workspace and returns three capabilities once |
| `GET /api/workspaces/{id}` | Any workspace role | Current source, measurement, finding, proposal and audit snapshot |
| `POST /api/workspaces/{id}/imports` | Operator | `{revision, requestId, file, actorLabel}` |
| `POST /api/workspaces/{id}/proposals` | Operator | `{revision, rowId, baseVersion, field, value, reason, actorLabel}` |
| `POST /api/workspaces/{id}/review` | Reviewer | `{revision, proposalId, decision, reason, actorLabel}`; decision `approved` or `rejected` |

Unknown top-level request fields are rejected. A repeated import request identifier with identical canonical file data returns its existing evidence; different data returns 409. The UI uses the file's canonical digest as its stable identifier. A newly identified source import may legitimately contain duplicate rows; those are retained and excluded at the measurement grain.

## Import file

```json
{
  "schemaVersion": 1,
  "source": "synthetic-press-run.json",
  "records": [{
    "sourceRecordId": "MES-001",
    "batchCode": "AX-1101",
    "sampleId": "S01",
    "stage": "Forming",
    "parameter": "temperature",
    "value": 180,
    "unit": "°C",
    "measuredAt": "2026-11-10T09:15:00.000Z",
    "equipment": "P-01"
  }]
}
```

The envelope, row count, flat primitive shape and byte bounds are validated before ingestion. Nested/prototype-shaped values and path-bearing source filenames are rejected. Supported-but-invalid row data is retained and quarantined with explicit findings. Unknown primitive row fields are retained and produce a schema finding. The maximum source file is 64 KiB, with 1-25 rows, at most 15 fields per row and at most 300 characters per field value. Four imports and 100 source rows are allowed per workspace. Mutation wrapper bytes have an additional 4 KiB allowance and are streamed with an enforced limit.

A row correction is limited to value, unit, measuredAt or equipment. Numeric corrections must be finite JSON numbers of magnitude at most one billion. Text corrections are limited to 100 characters. Reasons require 10-600 characters and actor labels 1-60. A measurement version and workspace revision are required. Approval re-evaluates the patch and rejects stale or non-improving changes.

## Errors

Errors use `{error:{code,message}}`. 400 covers invalid shape/schema/JSON; 401 invalid or expired capability; 403 incorrect role or origin; 404 unknown workspace-owned records; 409 stale revision/version, completed review or idempotency conflict; 413 size limit; 415 content type; 422 a correction that does not improve findings; 429 bounded workspace/import/proposal limits. Unexpected errors return a generic 500 without data, tokens or SQL in logs.

## Export

The client independently verifies the snapshot before building a ZIP with six fixed filenames. No access keys appear in the snapshot or export. The JSON records preserve original typed values, all finding history and the hash-linked audit. CSV exports protect formula-leading text. Export is evidence preservation, not access restoration, product approval or a compliance certificate.
