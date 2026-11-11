import {
  Problem,
  ensure,
  shape,
  text,
  version,
  hash,
  canonical,
  validateImport,
  naturalKey,
  dataIdentity,
  evaluate,
  applyPatch,
  BATCHES,
  LIMITS,
  FIELDS,
} from "../src/domain.ts";
import type {
  Role,
  SourceRow,
  Measurement,
  Finding,
  Proposal,
  Audit,
  AuditBody,
  Snapshot,
  RawRecord,
  Field,
  Primitive,
  Quality,
} from "../src/domain.ts";
import { query } from "./store.ts";
import type { Store, Sql, SqlValue } from "./store.ts";
type Context = { workspaceId: string; role: Role };
type Clock = () => Date;
const parse = <T>(v: unknown): T => JSON.parse(String(v));
const nullable = (v: unknown) =>
  v === null || v === undefined ? null : String(v);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export class Service {
  store: Store;
  clock: Clock;
  constructor(store: Store, clock: Clock = () => new Date()) {
    this.store = store;
    this.clock = clock;
  }
  async create() {
    const instant = this.clock(),
      now = instant.toISOString(),
      expires = new Date(instant.getTime() + LIMITS.ttlMs).toISOString(),
      id = crypto.randomUUID();
    const capabilities = {
      operator: token(),
      reviewer: token(),
      observer: token(),
    };
    const statements: Sql[] = [
      query("DELETE FROM workspaces WHERE expires_at <= ?", now),
      query(
        "INSERT INTO workspaces (id,revision,created_at,expires_at) SELECT ?,0,?,? WHERE (SELECT COUNT(*) FROM workspaces) < ? AND (SELECT COUNT(*) FROM workspaces WHERE created_at > ?) < ?",
        id,
        now,
        expires,
        LIMITS.activeWorkspaces,
        new Date(this.clock().getTime() - 60000).toISOString(),
        LIMITS.createsPerMinute,
      ),
    ];
    for (const role of ["operator", "reviewer", "observer"] as const)
      statements.push(
        query(
          "INSERT INTO access_keys (key_hash,workspace_id,role,expires_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id=?)",
          await hash(capabilities[role]),
          id,
          role,
          expires,
          id,
        ),
      );
    for (const b of BATCHES)
      statements.push(
        query(
          "INSERT INTO batches (workspace_id,code,material,line,planned_at,specification_version) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id=?)",
          id,
          b.code,
          b.material,
          b.line,
          b.plannedAt,
          "fictional-v1",
          id,
        ),
      );
    const result = await this.store.batch(statements);
    ensure(
      result[1].changes === 1,
      429,
      "WORKSPACE_LIMIT",
      "The public demo is at its workspace limit. Please try again later.",
    );
    return {
      workspaceId: id,
      expiresAt: expires,
      capabilities,
      snapshot: await this.snapshot(id),
    };
  }
  async authorize(
    workspaceId: string,
    header: string | null,
  ): Promise<Context> {
    ensure(
      /^Bearer [a-f0-9]{64}$/.test(header ?? ""),
      401,
      "ACCESS_REQUIRED",
      "A valid demo workspace access key is required.",
    );
    const [result] = await this.store.batch([
      query(
        "SELECT role FROM access_keys WHERE key_hash=? AND workspace_id=? AND expires_at > ?",
        await hash(header!.slice(7)),
        workspaceId,
        this.clock().toISOString(),
      ),
    ]);
    ensure(
      result.rows.length === 1,
      401,
      "ACCESS_EXPIRED",
      "The workspace access key is invalid or expired. Start a new demo workspace.",
    );
    return { workspaceId, role: result.rows[0].role as Role };
  }
  async snapshot(workspaceId: string): Promise<Snapshot> {
    const tables = [
      "workspaces",
      "imports",
      "source_rows",
      "measurements",
      "issues",
      "proposals",
      "audit",
      "batches",
    ];
    const r = await this.store.batch(
      tables.map((t) =>
        query(
          `SELECT * FROM ${t} WHERE ${t === "workspaces" ? "id" : "workspace_id"}=? ${t === "audit" ? "ORDER BY revision" : t === "source_rows" ? "ORDER BY created_at, import_id, ordinal" : t === "imports" ? "ORDER BY created_at,id" : ""}`,
          workspaceId,
        ),
      ),
    );
    const w = r[0].rows[0];
    ensure(w, 404, "WORKSPACE_MISSING", "This demo workspace was not found.");
    ensure(
      String(w.expires_at) > this.clock().toISOString(),
      401,
      "ACCESS_EXPIRED",
      "This demo workspace has expired.",
    );
    ensure(
      r[7].rows.length === 3,
      500,
      "PLAN_INTEGRITY",
      "The synthetic batch plan is incomplete.",
    );
    const rows: SourceRow[] = r[2].rows.map((v) => ({
      id: String(v.id),
      importId: String(v.import_id),
      ordinal: Number(v.ordinal),
      raw: parse(v.raw_json),
      rawHash: String(v.raw_hash),
      naturalKey: nullable(v.natural_key),
      duplicateOf: nullable(v.duplicate_of),
      duplicateKind: v.duplicate_kind as SourceRow["duplicateKind"],
      createdAt: String(v.created_at),
    }));
    const measurements: Measurement[] = r[3].rows.map((v) => ({
      rowId: String(v.row_id),
      effective: parse(v.effective_json),
      version: Number(v.version),
    }));
    const findings: Finding[] = r[4].rows.map((v) => ({
      id: String(v.id),
      rowId: nullable(v.row_id),
      batchCode: String(v.batch_code),
      code: String(v.code),
      severity: v.severity as Finding["severity"],
      field: String(v.field),
      message: String(v.message),
      status: v.status as Finding["status"],
      detectedAt: String(v.detected_at),
      resolvedAt: nullable(v.resolved_at),
    }));
    const proposals: Proposal[] = r[5].rows
      .map((v) => ({
        id: String(v.id),
        rowId: String(v.row_id),
        baseVersion: Number(v.base_version),
        field: v.field as Field,
        value: parse<Primitive>(v.proposed_json),
        reason: String(v.reason),
        submittedBy: String(v.submitted_by),
        submittedAt: String(v.submitted_at),
        status: v.status as Proposal["status"],
        reviewedBy: nullable(v.reviewed_by),
        reviewReason: nullable(v.review_reason),
        reviewedAt: nullable(v.reviewed_at),
      }))
      .sort(
        (a, b) =>
          b.submittedAt.localeCompare(a.submittedAt) ||
          a.id.localeCompare(b.id),
      );
    const audit: Audit[] = r[6].rows.map((v) => ({
      id: String(v.id),
      body: parse(v.body_json),
      previousHash: String(v.previous_hash),
      eventHash: String(v.event_hash),
    }));
    return {
      schemaVersion: 1,
      workspace: {
        id: String(w.id),
        revision: Number(w.revision),
        createdAt: String(w.created_at),
        expiresAt: String(w.expires_at),
      },
      imports: r[1].rows.map((v) => ({
        id: String(v.id),
        source: String(v.source),
        digest: String(v.digest),
        rows: Number(v.row_count),
        createdAt: String(v.created_at),
      })),
      rows,
      measurements,
      findings,
      proposals,
      audit,
      quality: evaluate(rows, measurements, String(w.id), r[1].rows.length > 0),
    };
  }
  permit(ctx: Context, role: Role) {
    ensure(
      ctx.role === role,
      403,
      "ROLE_FORBIDDEN",
      `This action requires the ${role} demo role.`,
    );
  }
  guarded(sql: string, args: SqlValue[], snapshot: Snapshot, op: string): Sql {
    return query(
      sql +
        " AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND mutation_token=?)",
      ...args,
      snapshot.workspace.id,
      op,
    );
  }
  inserts(
    table: string,
    columns: string[],
    values: SqlValue[][],
    s: Snapshot,
    op: string,
  ): Sql[] {
    const statements: Sql[] = [];
    const chunk = Math.max(1, Math.floor(88 / columns.length));
    for (let i = 0; i < values.length; i += chunk) {
      const rows = values.slice(i, i + chunk);
      statements.push(
        query(
          `WITH payload (${columns.join(",")}) AS (VALUES ${rows.map(() => `(${columns.map(() => "?").join(",")})`).join(",")}) INSERT INTO ${table} (${columns.join(",")}) SELECT ${columns.join(",")} FROM payload WHERE EXISTS (SELECT 1 FROM workspaces WHERE id=? AND mutation_token=?)`,
          ...rows.flat(),
          s.workspace.id,
          op,
        ),
      );
    }
    return statements;
  }
  issueStatements(s: Snapshot, q: Quality, op: string, at: string): Sql[] {
    const old = new Map(s.findings.map((f) => [f.id, f])),
      current = new Set(q.findings.map((f) => f.id));
    const statements = this.inserts(
      "issues",
      [
        "id",
        "workspace_id",
        "row_id",
        "batch_code",
        "code",
        "severity",
        "field",
        "message",
        "status",
        "detected_at",
        "resolved_at",
      ],
      q.findings
        .filter((f) => !old.has(f.id))
        .map((f) => [
          f.id,
          s.workspace.id,
          f.rowId,
          f.batchCode,
          f.code,
          f.severity,
          f.field,
          f.message,
          "open",
          at,
          null,
        ]),
      s,
      op,
    );
    for (const f of s.findings)
      if (f.status === "open" && !current.has(f.id))
        statements.push(
          this.guarded(
            "UPDATE issues SET status=?,resolved_at=? WHERE id=? AND workspace_id=?",
            ["resolved", at, f.id, s.workspace.id],
            s,
            op,
          ),
        );
    for (const f of q.findings)
      if (old.get(f.id)?.status === "resolved")
        statements.push(
          this.guarded(
            "UPDATE issues SET status=?,resolved_at=NULL WHERE id=? AND workspace_id=?",
            ["open", f.id, s.workspace.id],
            s,
            op,
          ),
        );
    return statements;
  }
  async commit(
    s: Snapshot,
    op: string,
    body: AuditBody,
    statements: Sql[],
  ): Promise<Snapshot> {
    const previous = s.audit.at(-1)?.eventHash ?? "GENESIS",
      eventHash = await hash({ body, previousHash: previous });
    const batch = [
      query(
        "UPDATE workspaces SET revision=revision+1,mutation_token=? WHERE id=? AND revision=? AND expires_at > ?",
        op,
        s.workspace.id,
        s.workspace.revision,
        this.clock().toISOString(),
      ),
      ...statements,
      ...this.inserts(
        "audit",
        [
          "id",
          "workspace_id",
          "revision",
          "body_json",
          "previous_hash",
          "event_hash",
        ],
        [
          [
            crypto.randomUUID(),
            s.workspace.id,
            body.revision,
            canonical(body),
            previous,
            eventHash,
          ],
        ],
        s,
        op,
      ),
    ];
    const result = await this.store.batch(batch);
    ensure(
      result[0].changes === 1,
      409,
      "REVISION_CONFLICT",
      "The workspace changed. Refresh the evidence and retry your action.",
    );
    return this.snapshot(s.workspace.id);
  }
  event(
    s: Snapshot,
    ctx: Context,
    action: AuditBody["action"],
    actorLabel: string,
    details: Record<string, unknown>,
    at = this.clock().toISOString(),
  ): AuditBody {
    return {
      workspaceId: s.workspace.id,
      revision: s.workspace.revision + 1,
      action,
      role: ctx.role,
      actorLabel,
      at,
      details,
    };
  }
  async ingest(ctx: Context, value: unknown) {
    this.permit(ctx, "operator");
    shape(
      value,
      ["revision", "requestId", "file", "actorLabel"],
      "Import request",
    );
    const rev = version(value.revision),
      key = text(value.requestId, 64, "Import request identifier"),
      actor = text(value.actorLabel, 60, "Operator label"),
      file = validateImport(value.file),
      digest = await hash(file);
    const [replay] = await this.store.batch([
      query(
        "SELECT digest FROM imports WHERE workspace_id=? AND request_key=?",
        ctx.workspaceId,
        key,
      ),
    ]);
    if (replay.rows.length) {
      ensure(
        replay.rows[0].digest === digest,
        409,
        "IDEMPOTENCY_CONFLICT",
        "This import request identifier was already used for different data.",
      );
      return { replayed: true, snapshot: await this.snapshot(ctx.workspaceId) };
    }
    const s = await this.snapshot(ctx.workspaceId);
    ensure(
      s.workspace.revision === rev,
      409,
      "REVISION_CONFLICT",
      "Refresh the workspace before importing.",
    );
    ensure(
      s.imports.length < LIMITS.imports &&
        s.rows.length + file.records.length <= LIMITS.workspaceRows,
      429,
      "IMPORT_LIMIT",
      "This workspace has reached its bounded import limit. Export its evidence and start another workspace.",
    );
    const op = token(),
      at = this.clock().toISOString(),
      importId = crypto.randomUUID(),
      rows: SourceRow[] = [],
      measurements: Measurement[] = [];
    const keys = new Map(
      s.rows
        .filter((r) => r.naturalKey && !r.duplicateOf)
        .map((r) => [r.naturalKey, r]),
    );
    for (const [ordinal, raw] of file.records.entries()) {
      const key = naturalKey(raw),
        first = key ? keys.get(key) : undefined;
      const row: SourceRow = {
        id: crypto.randomUUID(),
        importId,
        ordinal: ordinal + 1,
        raw,
        rawHash: await hash(raw),
        naturalKey: key,
        duplicateOf: first?.id ?? null,
        duplicateKind: first
          ? dataIdentity(raw) === dataIdentity(first.raw)
            ? "exact"
            : "conflict"
          : null,
        createdAt: at,
      };
      rows.push(row);
      if (!first) {
        if (key) keys.set(key, row);
        measurements.push({ rowId: row.id, effective: raw, version: 1 });
      }
    }
    const statements: Sql[] = [
      ...this.inserts(
        "imports",
        [
          "id",
          "workspace_id",
          "request_key",
          "digest",
          "source",
          "row_count",
          "created_at",
        ],
        [[importId, s.workspace.id, key, digest, file.source, rows.length, at]],
        s,
        op,
      ),
      ...this.inserts(
        "source_rows",
        [
          "id",
          "workspace_id",
          "import_id",
          "ordinal",
          "raw_json",
          "raw_hash",
          "natural_key",
          "duplicate_of",
          "duplicate_kind",
          "created_at",
        ],
        rows.map((r) => [
          r.id,
          s.workspace.id,
          importId,
          r.ordinal,
          canonical(r.raw),
          r.rawHash,
          r.naturalKey,
          r.duplicateOf,
          r.duplicateKind,
          at,
        ]),
        s,
        op,
      ),
      ...this.inserts(
        "measurements",
        [
          "row_id",
          "workspace_id",
          "batch_code",
          "sample_id",
          "stage",
          "parameter",
          "value",
          "unit",
          "measured_at",
          "equipment",
          "effective_json",
          "version",
        ],
        measurements.map((m) => {
          const d = m.effective;
          return [
            m.rowId,
            s.workspace.id,
            str(d.batchCode),
            str(d.sampleId),
            str(d.stage),
            str(d.parameter),
            typeof d.value === "number" ? d.value : null,
            str(d.unit),
            str(d.measuredAt),
            str(d.equipment),
            canonical(d),
            1,
          ];
        }),
        s,
        op,
      ),
    ];
    statements.push(
      ...this.issueStatements(
        s,
        evaluate(
          [...s.rows, ...rows],
          [...s.measurements, ...measurements],
          s.workspace.id,
        ),
        op,
        at,
      ),
    );
    return {
      replayed: false,
      snapshot: await this.commit(
        s,
        op,
        this.event(
          s,
          ctx,
          "IMPORT",
          actor,
          {
            importId,
            source: file.source,
            digest,
            rows: rows.length,
            rowIds: rows.map((r) => r.id),
          },
          at,
        ),
        statements,
      ),
    };
  }
  async propose(ctx: Context, value: unknown) {
    this.permit(ctx, "operator");
    shape(
      value,
      [
        "revision",
        "rowId",
        "baseVersion",
        "field",
        "value",
        "reason",
        "actorLabel",
      ],
      "Correction proposal",
    );
    const s = await this.snapshot(ctx.workspaceId);
    ensure(
      s.workspace.revision === version(value.revision),
      409,
      "REVISION_CONFLICT",
      "Refresh before proposing a correction.",
    );
    const rowId = text(value.rowId, 64, "Source row"),
      field = value.field;
    ensure(
      typeof field === "string" && FIELDS.includes(field as Field),
      400,
      "IMMUTABLE_FIELD",
      "This source field cannot be corrected.",
    );
    const m = s.measurements.find((m) => m.rowId === rowId);
    ensure(
      m,
      404,
      "ROW_NOT_FOUND",
      "The canonical source row was not found in this workspace.",
    );
    ensure(
      m.version === version(value.baseVersion),
      409,
      "STALE_CORRECTION",
      "The measurement changed. Review its current version.",
    );
    applyPatch(m.effective, field as Field, value.value as Primitive);
    ensure(
      s.proposals.length < LIMITS.proposals,
      429,
      "PROPOSAL_LIMIT",
      "This workspace has reached its correction proposal limit.",
    );
    const reason = text(value.reason, 600, "Correction evidence", 10),
      actor = text(value.actorLabel, 60, "Operator label"),
      id = crypto.randomUUID(),
      op = token(),
      body = this.event(s, ctx, "PROPOSE", actor, {
        proposalId: id,
        rowId,
        baseVersion: m.version,
        field,
        value: value.value,
        reason,
      });
    return {
      snapshot: await this.commit(
        s,
        op,
        body,
        this.inserts(
          "proposals",
          [
            "id",
            "workspace_id",
            "row_id",
            "base_version",
            "field",
            "proposed_json",
            "reason",
            "submitted_by",
            "submitted_at",
            "status",
          ],
          [
            [
              id,
              s.workspace.id,
              rowId,
              m.version,
              field,
              JSON.stringify(value.value),
              reason,
              actor,
              body.at,
              "pending",
            ],
          ],
          s,
          op,
        ),
      ),
    };
  }
  async review(ctx: Context, value: unknown) {
    this.permit(ctx, "reviewer");
    shape(
      value,
      ["revision", "proposalId", "decision", "reason", "actorLabel"],
      "Correction review",
    );
    const s = await this.snapshot(ctx.workspaceId);
    ensure(
      s.workspace.revision === version(value.revision),
      409,
      "REVISION_CONFLICT",
      "Refresh before recording a review.",
    );
    const proposal = s.proposals.find((p) => p.id === value.proposalId);
    ensure(
      proposal,
      404,
      "PROPOSAL_NOT_FOUND",
      "This proposal was not found in this workspace.",
    );
    ensure(
      proposal.status === "pending",
      409,
      "ALREADY_REVIEWED",
      "This proposal has already been reviewed.",
    );
    const decision = value.decision;
    ensure(
      decision === "approved" || decision === "rejected",
      400,
      "INVALID_DECISION",
      "Choose approved or rejected.",
    );
    const reason = text(value.reason, 600, "Review evidence", 10),
      actor = text(value.actorLabel, 60, "Reviewer label"),
      op = token();
    const m = s.measurements.find((m) => m.rowId === proposal.rowId)!;
    const before = m.effective;
    let after = before;
    if (decision === "approved") {
      ensure(
        m.version === proposal.baseVersion,
        409,
        "STALE_CORRECTION",
        "This proposal targets an older measurement version. Reject it and propose a correction against the current version.",
      );
      after = applyPatch(before, proposal.field, proposal.value);
    }
    const body = this.event(
      s,
      ctx,
      decision === "approved" ? "APPROVE" : "REJECT",
      actor,
      {
        proposalId: proposal.id,
        rowId: proposal.rowId,
        field: proposal.field,
        value: proposal.value,
        before: before[proposal.field] ?? null,
        baseVersion: proposal.baseVersion,
        resultingVersion: decision === "approved" ? m.version + 1 : m.version,
        reason,
      },
    );
    const statements = [
      this.guarded(
        "UPDATE proposals SET status=?,reviewed_by=?,review_reason=?,reviewed_at=? WHERE id=? AND workspace_id=?",
        [decision, actor, reason, body.at, proposal.id, s.workspace.id],
        s,
        op,
      ),
    ];
    if (decision === "approved") {
      statements.push(
        this.guarded(
          "UPDATE measurements SET value=?,unit=?,measured_at=?,equipment=?,effective_json=?,version=version+1 WHERE row_id=? AND workspace_id=? AND version=?",
          [
            typeof after.value === "number" ? after.value : null,
            str(after.unit),
            str(after.measuredAt),
            str(after.equipment),
            canonical(after),
            m.rowId,
            s.workspace.id,
            m.version,
          ],
          s,
          op,
        ),
      );
      statements.push(
        ...this.issueStatements(
          s,
          evaluate(
            s.rows,
            s.measurements.map((v) =>
              v.rowId === m.rowId
                ? { ...v, effective: after, version: v.version + 1 }
                : v,
            ),
            s.workspace.id,
          ),
          op,
          body.at,
        ),
      );
    }
    return { snapshot: await this.commit(s, op, body, statements) };
  }
}
export async function readBody(request: Request): Promise<unknown> {
  ensure(
    request.headers.get("content-type")?.split(";")[0].trim() ===
      "application/json",
    415,
    "CONTENT_TYPE",
    "Send application/json.",
  );
  const limit = LIMITS.importBytes + 4096;
  ensure(
    Number(request.headers.get("content-length") ?? 0) <= limit,
    413,
    "BODY_LIMIT",
    "The request exceeds the bounded import size.",
  );
  const reader = request.body?.getReader();
  ensure(reader, 400, "EMPTY_BODY", "A JSON body is required.");
  let size = 0,
    parts: Uint8Array[] = [];
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Problem(
        413,
        "BODY_LIMIT",
        "The request exceeds the bounded import size.",
      );
    }
    parts.push(r.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Problem(
      400,
      "INVALID_JSON",
      "The request is not valid UTF-8 JSON.",
    );
  }
}
export async function route(
  request: Request,
  service: Service,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    ensure(
      !origin || origin === url.origin,
      403,
      "ORIGIN_FORBIDDEN",
      "Cross-origin mutations are not allowed.",
    );
  }
  if (path === "/api/workspaces" && request.method === "POST") {
    const body = await readBody(request);
    shape(body, [], "Workspace request");
    return Response.json(await service.create(), { status: 201 });
  }
  const match = path.match(
    /^\/api\/workspaces\/([a-f0-9-]{36})(?:\/(imports|proposals|review))?$/,
  );
  ensure(match, 404, "API_NOT_FOUND", "This API route was not found.");
  const ctx = await service.authorize(
    match[1],
    request.headers.get("authorization"),
  );
  if (!match[2] && request.method === "GET")
    return Response.json({
      role: ctx.role,
      snapshot: await service.snapshot(ctx.workspaceId),
    });
  ensure(
    request.method === "POST" && match[2],
    405,
    "METHOD_NOT_ALLOWED",
    "This method is not supported.",
  );
  const body = await readBody(request);
  const result =
    match[2] === "imports"
      ? await service.ingest(ctx, body)
      : match[2] === "proposals"
        ? await service.propose(ctx, body)
        : await service.review(ctx, body);
  return Response.json(result, { status: 200 });
}
