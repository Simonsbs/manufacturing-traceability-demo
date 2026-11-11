import { strToU8, zipSync } from "fflate";
import { verifySnapshot } from "./domain.ts";
import type { Snapshot } from "./domain.ts";
export function csv(rows: unknown[][]): string {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = value === null || value === undefined ? "" : String(value);
            if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}
export async function evidenceFiles(
  snapshot: Snapshot,
  at = new Date().toISOString(),
): Promise<Record<string, string>> {
  const integrity = await verifySnapshot(snapshot);
  if (!integrity.valid)
    throw new Error(
      "Evidence verification failed. Export is stopped; refresh the workspace and investigate the mismatch.",
    );
  const report = {
    kind: "synthetic-manufacturing-evidence",
    schemaVersion: 1,
    exportedAt: at,
    scope:
      "Fictional process, specifications and measurements. Agent-built demonstrator, not a product release, validated pharmaceutical system, regulatory certification or verified human sign-off.",
    integrity,
    snapshot,
  };
  const measurements = snapshot.measurements.map((m) => {
    const r = snapshot.rows.find((r) => r.id === m.rowId)!,
      d = m.effective,
      issues = snapshot.quality.findings.filter((f) => f.rowId === m.rowId);
    return [
      r.id,
      d.sourceRecordId,
      d.batchCode,
      d.sampleId,
      d.parameter,
      d.value,
      d.unit,
      d.measuredAt,
      d.equipment,
      m.version,
      issues.length ? "quarantined" : "usable",
      r.importId,
      r.ordinal,
      r.rawHash,
    ];
  });
  return {
    "evidence.json": JSON.stringify(report, null, 2) + "\n",
    "sources.json":
      JSON.stringify(
        snapshot.imports.map((i) => ({
          ...i,
          records: snapshot.rows
            .filter((r) => r.importId === i.id)
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((r) => ({
              rowId: r.id,
              ordinal: r.ordinal,
              rawHash: r.rawHash,
              duplicateOf: r.duplicateOf,
              duplicateKind: r.duplicateKind,
              raw: r.raw,
            })),
        })),
        null,
        2,
      ) + "\n",
    "measurements.csv": csv([
      [
        "row_id",
        "source_record_id",
        "batch",
        "sample",
        "parameter",
        "value",
        "unit",
        "measured_at_utc",
        "equipment",
        "version",
        "state",
        "import_id",
        "source_row",
        "raw_sha256",
      ],
      ...measurements,
    ]),
    "findings.csv": csv([
      [
        "finding_id",
        "row_id",
        "batch",
        "code",
        "severity",
        "field",
        "message",
        "status",
        "detected_at_utc",
        "resolved_at_utc",
      ],
      ...snapshot.findings.map((f) => [
        f.id,
        f.rowId,
        f.batchCode,
        f.code,
        f.severity,
        f.field,
        f.message,
        f.status,
        f.detectedAt,
        f.resolvedAt,
      ]),
    ]),
    "audit.csv": csv([
      [
        "event_id",
        "revision",
        "action",
        "demo_role",
        "unverified_actor_label",
        "at_utc",
        "details_json",
        "previous_sha256",
        "event_sha256",
      ],
      ...snapshot.audit.map((e) => [
        e.id,
        e.body.revision,
        e.body.action,
        e.body.role,
        e.body.actorLabel,
        e.body.at,
        JSON.stringify(e.body.details),
        e.previousHash,
        e.eventHash,
      ]),
    ]),
    "README.txt": `TRACEABILITY LAB | SYNTHETIC EVIDENCE\nExported ${at}\nWorkspace ${snapshot.workspace.id}, revision ${snapshot.workspace.revision}\n\n${snapshot.rows.length} source rows = ${snapshot.quality.summary.usable} usable + ${snapshot.quality.summary.quarantined} quarantined + ${snapshot.quality.summary.duplicates} duplicates.\nExpected sample coverage: ${snapshot.quality.summary.observed}/${snapshot.quality.summary.expected}. Observed slots include quarantined readings; coverage is not a quality pass rate.\n\nThe six files retain original rows, current measurements, all finding history and the proposed/reviewed change trail. Raw SHA-256 hashes and import digests use canonical JSON, not original file bytes. Duplicate grain is batch + sample + stage + parameter; the first received row remains canonical. Corrections change only reviewed overlays. Numeric strings and units are never silently converted.\n\nThe audit chain can detect inconsistent exports. It is not a digital signature, external timestamp or protection from a database administrator rewriting both data and hashes. Actor labels and role switching are a demo simulation, not authenticated people or independent two-person sign-off.\n\nThe public SQL workspace expires after 24 hours. Access is refused at expiry; physical cleanup occurs on a later workspace creation. This export contains no access keys. It cannot restore workspace access. Use synthetic data only. No production quality, pharmaceutical validation or regulatory approval is claimed.\n`,
  };
}
export async function packBytes(
  snapshot: Snapshot,
  at?: string,
): Promise<Uint8Array> {
  const files = await evidenceFiles(snapshot, at);
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, value]) => [name, strToU8(value)]),
    ),
    { level: 6 },
  );
}
export function download(
  name: string,
  data: string | Uint8Array,
  type = "application/json",
) {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : Uint8Array.from(data);
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
