export type Role = "operator" | "reviewer" | "observer";
export type Primitive = string | number | boolean | null;
export type RawRecord = Record<string, Primitive>;
export type ImportFile = {
  schemaVersion: 1;
  source: string;
  records: RawRecord[];
};
export type Field = "value" | "unit" | "measuredAt" | "equipment";
export const FIELDS: Field[] = ["value", "unit", "measuredAt", "equipment"];
export const RECORD_FIELDS = [
  "sourceRecordId",
  "batchCode",
  "sampleId",
  "stage",
  "parameter",
  "value",
  "unit",
  "measuredAt",
  "equipment",
];
export const BATCHES = [
  {
    code: "AX-1101",
    material: "Alloy housing A",
    line: "Press 01",
    plannedAt: "2026-11-10T08:00:00.000Z",
  },
  {
    code: "AX-1102",
    material: "Alloy housing A",
    line: "Press 02",
    plannedAt: "2026-11-10T09:00:00.000Z",
  },
  {
    code: "AX-1103",
    material: "Alloy housing B",
    line: "Press 01",
    plannedAt: "2026-11-10T10:00:00.000Z",
  },
] as const;
export const SPECS = [
  {
    parameter: "temperature",
    label: "Forming temperature",
    unit: "°C",
    min: 170,
    max: 190,
  },
  {
    parameter: "thickness",
    label: "Wall thickness",
    unit: "mm",
    min: 1.8,
    max: 2.2,
  },
  {
    parameter: "pressure",
    label: "Forming pressure",
    unit: "bar",
    min: 8,
    max: 12,
  },
] as const;
export const LIMITS = {
  importBytes: 65536,
  importRows: 25,
  workspaceRows: 100,
  imports: 4,
  proposals: 30,
  ttlMs: 86400000,
  activeWorkspaces: 200,
  createsPerMinute: 20,
};
export class Problem extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "Problem";
    this.status = status;
    this.code = code;
  }
}
export function ensure(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new Problem(status, code, message);
}
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function shape(
  value: unknown,
  keys: string[],
  label: string,
): asserts value is Record<string, unknown> {
  ensure(
    object(value) && Object.keys(value).every((k) => keys.includes(k)),
    400,
    "INVALID_SHAPE",
    `${label} has an unsupported shape or field.`,
  );
}
export function text(
  value: unknown,
  max: number,
  label: string,
  min = 1,
): string {
  ensure(
    typeof value === "string" &&
      value.trim().length >= min &&
      value.length <= max &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),
    400,
    "INVALID_TEXT",
    `${label} must contain ${min}-${max} characters.`,
  );
  return value.trim();
}
export function version(value: unknown): number {
  ensure(
    Number.isSafeInteger(value) &&
      Number(value) >= 0 &&
      Number(value) <= 100000,
    400,
    "INVALID_VERSION",
    "A valid expected workspace revision is required.",
  );
  return Number(value);
}
export function validateImport(value: unknown): ImportFile {
  shape(value, ["schemaVersion", "source", "records"], "Import");
  ensure(
    value.schemaVersion === 1,
    400,
    "UNSUPPORTED_SCHEMA",
    "Use a schemaVersion 1 synthetic import.",
  );
  const source = text(value.source, 100, "Source filename");
  ensure(
    !/[\\/]/.test(source),
    400,
    "INVALID_SOURCE",
    "Use a filename without a directory path.",
  );
  ensure(
    Array.isArray(value.records) &&
      value.records.length >= 1 &&
      value.records.length <= LIMITS.importRows,
    400,
    "ROW_LIMIT",
    `Each import must contain 1-${LIMITS.importRows} rows.`,
  );
  for (const row of value.records) {
    ensure(
      object(row) && Object.keys(row).length <= 15,
      400,
      "INVALID_ROW",
      "Source rows must be flat objects with at most 15 fields.",
    );
    for (const [key, v] of Object.entries(row)) {
      ensure(
        !["__proto__", "constructor", "prototype"].includes(key) &&
          key.length <= 50,
        400,
        "INVALID_ROW",
        "Unsupported source field.",
      );
      ensure(
        v === null ||
          typeof v === "boolean" ||
          (typeof v === "number" && Number.isFinite(v)) ||
          (typeof v === "string" &&
            v.length <= 300 &&
            !/[\u0000-\u001f]/.test(v)),
        400,
        "INVALID_ROW",
        "Source field values must be short JSON primitives.",
      );
    }
  }
  const result = {
    schemaVersion: 1 as const,
    source,
    records: value.records as RawRecord[],
  };
  ensure(
    new TextEncoder().encode(JSON.stringify(result)).length <=
      LIMITS.importBytes,
    413,
    "BODY_LIMIT",
    "The import exceeds 64 KiB.",
  );
  return result;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (object(value))
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(
    typeof value === "string" ? value : canonical(value),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function naturalKey(row: RawRecord): string | null {
  const parts = [row.batchCode, row.sampleId, row.stage, row.parameter];
  return parts.every(
    (v) => typeof v === "string" && /^[A-Za-z0-9-]{1,40}$/.test(v),
  )
    ? parts.join("|")
    : null;
}
export function dataIdentity(row: RawRecord): string {
  const copy = { ...row };
  delete copy.sourceRecordId;
  return canonical(copy);
}
export type SourceRow = {
  id: string;
  importId: string;
  ordinal: number;
  raw: RawRecord;
  rawHash: string;
  naturalKey: string | null;
  duplicateOf: string | null;
  duplicateKind: "exact" | "conflict" | null;
  createdAt: string;
};
export type Measurement = {
  rowId: string;
  effective: RawRecord;
  version: number;
};
export type Finding = {
  id: string;
  rowId: string | null;
  batchCode: string;
  code: string;
  severity: "error" | "notice";
  field: string;
  message: string;
  status: "open" | "resolved";
  detectedAt: string;
  resolvedAt: string | null;
};
export type RuleFinding = Omit<Finding, "status" | "detectedAt" | "resolvedAt">;
export function rowFindings(id: string, row: RawRecord): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const add = (code: string, field: string, message: string) =>
    findings.push({
      id: `${id}:${code}:${field}`,
      rowId: id,
      batchCode:
        typeof row.batchCode === "string" ? row.batchCode : "Unassigned",
      code,
      field,
      message,
      severity: "error",
    });
  if (Object.keys(row).some((k) => !RECORD_FIELDS.includes(k)))
    add(
      "SCHEMA_FIELD",
      "record",
      "The source row contains a field outside the declared schema.",
    );
  if (
    typeof row.sourceRecordId !== "string" ||
    !/^[A-Za-z0-9-]{1,40}$/.test(row.sourceRecordId)
  )
    add(
      "SOURCE_ID",
      "sourceRecordId",
      "A source record identifier is required.",
    );
  if (!BATCHES.some((b) => b.code === row.batchCode))
    add(
      "UNKNOWN_BATCH",
      "batchCode",
      "The batch is not present in the synthetic production plan.",
    );
  if (row.sampleId !== "S01")
    add(
      "SAMPLE_ID",
      "sampleId",
      "The declared sampling plan requires sample S01.",
    );
  if (row.stage !== "Forming")
    add("STAGE", "stage", "The declared process stage is Forming.");
  const spec = SPECS.find((s) => s.parameter === row.parameter);
  if (!spec)
    add(
      "PARAMETER",
      "parameter",
      "This parameter is outside the declared specification.",
    );
  if (row.value === null || row.value === undefined || row.value === "")
    add("MISSING_VALUE", "value", "The measurement value is missing.");
  else if (typeof row.value !== "number" || !Number.isFinite(row.value))
    add(
      "VALUE_TYPE",
      "value",
      "Use a numeric JSON measurement; numeric strings are not coerced.",
    );
  else if (
    spec &&
    row.unit === spec.unit &&
    (row.value < spec.min || row.value > spec.max)
  )
    add(
      "OUT_OF_RANGE",
      "value",
      `The value is outside the fictional ${spec.min}-${spec.max} ${spec.unit} limits.`,
    );
  if (spec && row.unit !== spec.unit)
    add(
      "UNIT",
      "unit",
      `Expected ${spec.unit}. Units are not inferred or automatically converted.`,
    );
  const timestamp = typeof row.measuredAt === "string" ? row.measuredAt : "";
  const time = Date.parse(timestamp);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== timestamp
  )
    add(
      "TIMESTAMP",
      "measuredAt",
      "Use an exact UTC timestamp with milliseconds.",
    );
  else if (
    time < Date.parse("2026-11-10T07:00:00.000Z") ||
    time > Date.parse("2026-11-10T15:00:00.000Z")
  )
    add(
      "TIME_WINDOW",
      "measuredAt",
      "The reading is outside the fictional 10 November production window, 07:00-15:00 UTC.",
    );
  if (!["P-01", "P-02"].includes(String(row.equipment)))
    add(
      "EQUIPMENT",
      "equipment",
      "Use a declared press identifier: P-01 or P-02.",
    );
  return findings;
}
export type Quality = {
  findings: RuleFinding[];
  batches: {
    code: string;
    material: string;
    line: string;
    observed: number;
    expected: number;
    usable: number;
    errors: number;
    notices: number;
    state: "awaiting" | "attention" | "clear";
  }[];
  summary: {
    received: number;
    usable: number;
    quarantined: number;
    duplicates: number;
    observed: number;
    expected: number;
    errors: number;
    notices: number;
    coveragePercent: number;
  };
};
export function evaluate(
  rows: SourceRow[],
  measurements: Measurement[],
  scope: string,
  evaluated = true,
): Quality {
  const findings: RuleFinding[] = [],
    current = new Map(measurements.map((m) => [m.rowId, m.effective]));
  let usable = 0,
    quarantined = 0,
    duplicates = 0;
  const observed = new Set<string>(),
    accepted = new Set<string>();
  for (const row of rows) {
    if (row.duplicateOf) {
      duplicates++;
      findings.push({
        id: `${row.id}:DUPLICATE:record`,
        rowId: row.id,
        batchCode: String(row.raw.batchCode ?? "Unassigned"),
        code:
          row.duplicateKind === "exact"
            ? "DUPLICATE_EXACT"
            : "DUPLICATE_CONFLICT",
        severity: row.duplicateKind === "exact" ? "notice" : "error",
        field: "record",
        message:
          row.duplicateKind === "exact"
            ? "A repeat of an existing measurement was retained and excluded from curated data."
            : "This row conflicts with the first recorded measurement at the same batch/sample/stage/parameter grain. Resolve it with the source owner.",
      });
      continue;
    }
    const data = current.get(row.id) ?? row.raw;
    const checks = rowFindings(row.id, data);
    findings.push(...checks);
    const planned =
      BATCHES.some((b) => b.code === data.batchCode) &&
      data.sampleId === "S01" &&
      data.stage === "Forming" &&
      SPECS.some((s) => s.parameter === data.parameter);
    const key = naturalKey(data);
    if (planned && key) observed.add(key);
    if (checks.length) quarantined++;
    else {
      usable++;
      if (planned && key) accepted.add(key);
    }
  }
  if (evaluated)
    for (const batch of BATCHES)
      for (const spec of SPECS) {
        const key = `${batch.code}|S01|Forming|${spec.parameter}`;
        if (!observed.has(key))
          findings.push({
            id: `${scope}:gap:${batch.code}:${spec.parameter}`,
            rowId: null,
            batchCode: batch.code,
            code: "MISSING_MEASUREMENT",
            severity: "error",
            field: spec.parameter,
            message: `No ${spec.label.toLowerCase()} measurement was received for expected sample S01.`,
          });
      }
  const batches = BATCHES.map((b) => {
    const f = findings.filter((f) => f.batchCode === b.code),
      prefix = b.code + "|";
    return {
      ...b,
      observed: [...observed].filter((k) => k.startsWith(prefix)).length,
      expected: 3,
      usable: [...accepted].filter((k) => k.startsWith(prefix)).length,
      errors: f.filter((f) => f.severity === "error").length,
      notices: f.filter((f) => f.severity === "notice").length,
      state: !evaluated
        ? ("awaiting" as const)
        : f.length
          ? ("attention" as const)
          : ("clear" as const),
    };
  });
  return {
    findings,
    batches,
    summary: {
      received: rows.length,
      usable,
      quarantined,
      duplicates,
      observed: observed.size,
      expected: 9,
      errors: findings.filter((f) => f.severity === "error").length,
      notices: findings.filter((f) => f.severity === "notice").length,
      coveragePercent: Math.round((observed.size / 9) * 1000) / 10,
    },
  };
}
export function applyPatch(
  row: RawRecord,
  field: Field,
  value: Primitive,
): RawRecord {
  ensure(
    FIELDS.includes(field),
    400,
    "IMMUTABLE_FIELD",
    "Only value, unit, measuredAt and equipment can be corrected.",
  );
  ensure(
    field === "value"
      ? typeof value === "number" &&
          Number.isFinite(value) &&
          Math.abs(value) <= 1e9
      : typeof value === "string" && value.length >= 1 && value.length <= 100,
    400,
    "INVALID_CORRECTION",
    "The proposed field value has an invalid type or length.",
  );
  const next = { ...row, [field]: value };
  const before = rowFindings("check", row),
    after = rowFindings("check", next);
  const old = new Set(before.map((f) => f.id));
  ensure(
    after.length < before.length && after.every((f) => old.has(f.id)),
    422,
    "NO_IMPROVEMENT",
    "A correction must resolve a current finding and introduce no new findings.",
  );
  return next;
}
export type ImportSummary = {
  id: string;
  source: string;
  digest: string;
  rows: number;
  createdAt: string;
};
export type Proposal = {
  id: string;
  rowId: string;
  baseVersion: number;
  field: Field;
  value: Primitive;
  reason: string;
  submittedBy: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
};
export type AuditBody = {
  workspaceId: string;
  revision: number;
  action: "IMPORT" | "PROPOSE" | "APPROVE" | "REJECT";
  role: Role;
  actorLabel: string;
  at: string;
  details: Record<string, unknown>;
};
export type Audit = {
  id: string;
  body: AuditBody;
  previousHash: string;
  eventHash: string;
};
export type Snapshot = {
  schemaVersion: 1;
  workspace: {
    id: string;
    revision: number;
    createdAt: string;
    expiresAt: string;
  };
  imports: ImportSummary[];
  rows: SourceRow[];
  measurements: Measurement[];
  findings: Finding[];
  proposals: Proposal[];
  audit: Audit[];
  quality: Quality;
};
export async function verifySnapshot(
  data: Snapshot,
): Promise<{
  valid: boolean;
  rawChecked: number;
  auditChecked: number;
  effectiveChecked: number;
  failures: string[];
}> {
  const failures: string[] = [];
  let previous = "GENESIS";
  const canonicalRows = data.rows.filter((r) => !r.duplicateOf);
  if (
    canonicalRows.length !== data.measurements.length ||
    new Set(data.measurements.map((m) => m.rowId)).size !==
      data.measurements.length ||
    canonicalRows.some((r) => !data.measurements.some((m) => m.rowId === r.id))
  )
    failures.push(
      "Canonical source rows do not reconcile to current measurements.",
    );
  if (data.imports.reduce((n, i) => n + i.rows, 0) !== data.rows.length)
    failures.push("Imported and retained source counts do not reconcile.");
  for (const i of data.imports) {
    const rows = data.rows
      .filter((r) => r.importId === i.id)
      .sort((a, b) => a.ordinal - b.ordinal);
    if (
      rows.length !== i.rows ||
      rows.some((r, n) => r.ordinal !== n + 1) ||
      (await hash({
        schemaVersion: 1,
        source: i.source,
        records: rows.map((r) => r.raw),
      })) !== i.digest
    )
      failures.push(`Import digest mismatch: ${i.id}`);
  }
  for (const row of data.rows)
    if ((await hash(row.raw)) !== row.rawHash)
      failures.push(`Raw row hash mismatch: ${row.id}`);
  for (const [i, event] of data.audit.entries()) {
    if (
      event.previousHash !== previous ||
      event.body.revision !== i + 1 ||
      event.body.workspaceId !== data.workspace.id ||
      (await hash({ body: event.body, previousHash: previous })) !==
        event.eventHash
    )
      failures.push(`Audit chain mismatch: ${event.id}`);
    previous = event.eventHash;
  }
  if (data.audit.length !== data.workspace.revision)
    failures.push(
      "The workspace revision does not reconcile to its audit length.",
    );
  const replayRows: SourceRow[] = [],
    replayMeasurements: Measurement[] = [],
    history = new Map<string, Finding>(),
    firstKeys = new Map<string, SourceRow>();
  for (const event of data.audit) {
    const e = event.body;
    if (e.action === "IMPORT") {
      const ids = e.details.rowIds;
      if (!Array.isArray(ids)) {
        failures.push(`Missing imported row identifiers: ${event.id}`);
        continue;
      }
      for (const id of ids) {
        const row = data.rows.find((r) => r.id === id);
        if (!row) {
          failures.push(`Imported source row missing: ${String(id)}`);
          continue;
        }
        const key = naturalKey(row.raw),
          first = key ? firstKeys.get(key) : undefined;
        if (
          row.naturalKey !== key ||
          row.duplicateOf !== (first?.id ?? null) ||
          row.duplicateKind !==
            (first
              ? dataIdentity(row.raw) === dataIdentity(first.raw)
                ? "exact"
                : "conflict"
              : null)
        )
          failures.push(`Duplicate classification mismatch: ${row.id}`);
        replayRows.push(row);
        if (!first) {
          if (key) firstKeys.set(key, row);
          replayMeasurements.push({
            rowId: row.id,
            effective: { ...row.raw },
            version: 1,
          });
        }
      }
    }
    if (e.action === "APPROVE") {
      const m = replayMeasurements.find((m) => m.rowId === e.details.rowId);
      if (!m) {
        failures.push(`Approved source missing: ${event.id}`);
        continue;
      }
      m.effective = {
        ...m.effective,
        [String(e.details.field)]: e.details.value as Primitive,
      };
      m.version++;
    }
    if (e.action === "IMPORT" || e.action === "APPROVE") {
      const current = evaluate(
          replayRows,
          replayMeasurements,
          data.workspace.id,
        ).findings,
        ids = new Set(current.map((f) => f.id));
      for (const f of history.values())
        if (f.status === "open" && !ids.has(f.id)) {
          f.status = "resolved";
          f.resolvedAt = e.at;
        }
      for (const f of current) {
        const old = history.get(f.id);
        history.set(f.id, {
          ...f,
          status: "open",
          detectedAt: old?.detectedAt ?? e.at,
          resolvedAt: null,
        });
      }
    }
  }
  if (
    canonical(
      [...history.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ) !== canonical([...data.findings].sort((a, b) => a.id.localeCompare(b.id)))
  )
    failures.push(
      "Finding history does not reconcile to the audited imports and approvals.",
    );
  for (const p of data.proposals) {
    const submitted = data.audit.find(
        (e) =>
          e.body.action === "PROPOSE" && e.body.details.proposalId === p.id,
      )?.body,
      review = data.audit.find(
        (e) =>
          ["APPROVE", "REJECT"].includes(e.body.action) &&
          e.body.details.proposalId === p.id,
      )?.body;
    if (
      !submitted ||
      submitted.details.rowId !== p.rowId ||
      submitted.details.baseVersion !== p.baseVersion ||
      submitted.details.field !== p.field ||
      canonical(submitted.details.value) !== canonical(p.value) ||
      submitted.details.reason !== p.reason ||
      submitted.actorLabel !== p.submittedBy ||
      submitted.at !== p.submittedAt
    )
      failures.push(`Proposal does not reconcile to its audit: ${p.id}`);
    if (
      p.status === "pending"
        ? !!review
        : !review ||
          review.action !== (p.status === "approved" ? "APPROVE" : "REJECT") ||
          review.actorLabel !== p.reviewedBy ||
          review.details.reason !== p.reviewReason ||
          review.at !== p.reviewedAt
    )
      failures.push(`Review does not reconcile to its audit: ${p.id}`);
  }
  if (
    data.audit.filter((e) => e.body.action === "PROPOSE").length !==
    data.proposals.length
  )
    failures.push("Proposal history does not reconcile to its audit.");
  for (const i of data.imports) {
    const e = data.audit.find(
      (e) => e.body.action === "IMPORT" && e.body.details.importId === i.id,
    );
    if (!e || e.body.details.digest !== i.digest)
      failures.push(`Import audit missing or different: ${i.id}`);
  }
  for (const measurement of data.measurements) {
    const raw = data.rows.find((r) => r.id === measurement.rowId);
    if (!raw || raw.duplicateOf) {
      failures.push(`Measurement source missing: ${measurement.rowId}`);
      continue;
    }
    let expected = { ...raw.raw },
      v = 1;
    for (const event of data.audit)
      if (
        event.body.action === "APPROVE" &&
        event.body.details.rowId === measurement.rowId
      ) {
        const field = event.body.details.field;
        if (typeof field === "string" && FIELDS.includes(field as Field)) {
          expected = {
            ...expected,
            [field]: event.body.details.value as Primitive,
          };
          v++;
        } else failures.push(`Invalid audit correction field: ${event.id}`);
      }
    if (
      canonical(expected) !== canonical(measurement.effective) ||
      v !== measurement.version
    )
      failures.push(
        `Current measurement does not reconcile to approved changes: ${measurement.rowId}`,
      );
  }
  if (
    canonical(
      evaluate(
        data.rows,
        data.measurements,
        data.workspace.id,
        data.imports.length > 0,
      ),
    ) !== canonical(data.quality)
  )
    failures.push(
      "Reported quality does not reconcile to the retained measurements.",
    );
  if (
    canonical(
      data.findings
        .filter((f) => f.status === "open")
        .map((f) => f.id)
        .sort(),
    ) !== canonical(data.quality.findings.map((f) => f.id).sort())
  )
    failures.push("Open finding history does not reconcile to current checks.");
  return {
    valid: failures.length === 0,
    rawChecked: data.rows.length,
    auditChecked: data.audit.length,
    effectiveChecked: data.measurements.length,
    failures,
  };
}
