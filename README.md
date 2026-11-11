# Manufacturing Data Quality and Traceability Demonstrator

A standalone, synthetic manufacturing investigation lab with a real SQL-backed ingestion service, retained source records, explicit quality checks, lineage, reviewed corrections and evidence exports.

**[Public demo](https://traceability.bestdev.co.il/)** · **[Source](https://github.com/Simonsbs/manufacturing-traceability-demo)** · [Architecture](BUILD_NOTES.md) · [HTTP contract](CONTRACT.md) · [Validation](VALIDATION.md)

## Five-minute investigation

1. Ingest the sample run as **Operator**. Eleven source rows reconcile to four usable, five quarantined and two duplicates. Eight of nine expected slots are observed.
2. Open the **UNIT** finding for **MES-004**, batch **AX-1102**. Trace the import and source-row pointer, inspect the raw JSON and compare original/current fields.
3. Propose a correction. Use the clearly fictional source-owner clarification to change `degC` to `°C`. Submission records a proposal; it does not change the measurement.
4. Switch the demo role to **Reviewer**. Record a rationale and approve the correction. The curated measurement becomes version 2, the original stays intact and the resolved finding remains in history.
5. Verify the evidence in **Audit trail** and download the six-file ZIP. Optional: ingest the separate follow-up pressure reading to close AX-1103's completeness gap.

Demo roles have real server permission checks, but one visitor can switch between all roles. They do not establish separate people, verified identity or independent two-person approval. All batches, specifications, readings and source-owner statements are invented fixtures. The tool makes no product release decision or pharmaceutical/regulatory validation claim.

## Local setup

Node 24.12+ and npm are required. No cloud account, external API key or paid model is needed for the local SQLite API.

```sh
npm ci
npm run check
npm test
npm run build
npm run verify:local
npm run dev:api
```

In another terminal, run `npm run dev` and open `http://127.0.0.1:5177/`. The local API uses the same service as the Worker and a persistent SQLite file under ignored `.runtime/`. Public hosting uses Cloudflare D1. The Worker serves all assets directly so security/cache headers apply consistently.

`npm run test:api -- --url <origin>` exercises actual HTTP ingestion, permission, concurrency, correction and export scenarios. Additional local/D1 persistence and public-host reports are recorded in `docs/validation/` when completed. Run `npm run types:worker` after changing the Wrangler binding configuration. SQL schema generation uses Drizzle; applied migration files and metadata must not be rewritten.

## Data boundaries

Use synthetic data only. A visitor workspace and its browser-held access keys expire after 24 hours. The service rejects expired access; later workspace creation lazily removes expired records. Imports are limited to four files, 25 rows per file, 64 KiB per file and 100 rows total; 30 correction proposals are allowed. Public creation is bounded globally. Export before starting a fresh workspace or clearing browser storage. The export excludes access keys and cannot restore access.

The export contains `evidence.json`, `sources.json`, `measurements.csv`, `findings.csv`, `audit.csv` and `README.txt`. Source/import hashes use canonical JSON, not the original uploaded bytes. A hash chain detects inconsistent exports, but a database administrator could rewrite data and hashes. It is not a digital signature or external timestamp.
