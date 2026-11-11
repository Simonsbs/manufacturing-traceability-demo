import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull().default(0),
    mutationToken: text("mutation_token"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [
    index("workspace_expiry").on(t.expiresAt),
    index("workspace_created").on(t.createdAt),
  ],
);
export const accessKeys = sqliteTable("access_keys", {
  keyHash: text("key_hash").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["operator", "reviewer", "observer"] }).notNull(),
  expiresAt: text("expires_at").notNull(),
});
export const batches = sqliteTable(
  "batches",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    material: text("material").notNull(),
    line: text("line").notNull(),
    plannedAt: text("planned_at").notNull(),
    specificationVersion: text("specification_version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.code] })],
);
export const imports = sqliteTable(
  "imports",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestKey: text("request_key").notNull(),
    digest: text("digest").notNull(),
    source: text("source").notNull(),
    rowCount: integer("row_count").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("import_request").on(t.workspaceId, t.requestKey)],
);
export const sourceRows = sqliteTable(
  "source_rows",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    importId: text("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    rawJson: text("raw_json").notNull(),
    rawHash: text("raw_hash").notNull(),
    naturalKey: text("natural_key"),
    duplicateOf: text("duplicate_of"),
    duplicateKind: text("duplicate_kind", { enum: ["exact", "conflict"] }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("source_ordinal").on(t.importId, t.ordinal),
    index("source_workspace").on(t.workspaceId),
  ],
);
export const measurements = sqliteTable(
  "measurements",
  {
    rowId: text("row_id")
      .primaryKey()
      .references(() => sourceRows.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    batchCode: text("batch_code"),
    sampleId: text("sample_id"),
    stage: text("stage"),
    parameter: text("parameter"),
    value: real("value"),
    unit: text("unit"),
    measuredAt: text("measured_at"),
    equipment: text("equipment"),
    effectiveJson: text("effective_json").notNull(),
    version: integer("version").notNull(),
  },
  (t) => [index("measurement_batch").on(t.workspaceId, t.batchCode)],
);
export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rowId: text("row_id").references(() => sourceRows.id, {
      onDelete: "cascade",
    }),
    batchCode: text("batch_code").notNull(),
    code: text("code").notNull(),
    severity: text("severity", { enum: ["error", "notice"] }).notNull(),
    field: text("field").notNull(),
    message: text("message").notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull(),
    detectedAt: text("detected_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (t) => [index("issue_status").on(t.workspaceId, t.status)],
);
export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rowId: text("row_id")
      .notNull()
      .references(() => sourceRows.id, { onDelete: "cascade" }),
    baseVersion: integer("base_version").notNull(),
    field: text("field").notNull(),
    proposedJson: text("proposed_json").notNull(),
    reason: text("reason").notNull(),
    submittedBy: text("submitted_by").notNull(),
    submittedAt: text("submitted_at").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected"],
    }).notNull(),
    reviewedBy: text("reviewed_by"),
    reviewReason: text("review_reason"),
    reviewedAt: text("reviewed_at"),
  },
  (t) => [index("proposal_workspace").on(t.workspaceId)],
);
export const audit = sqliteTable(
  "audit",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    bodyJson: text("body_json").notNull(),
    previousHash: text("previous_hash").notNull(),
    eventHash: text("event_hash").notNull(),
  },
  (t) => [uniqueIndex("audit_revision").on(t.workspaceId, t.revision)],
);
