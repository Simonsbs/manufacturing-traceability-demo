import test from "node:test";
import assert from "node:assert/strict";
import { sqliteStore } from "../server/sqlite.mjs";
import { Service, route } from "../server/service.ts";
import { SAMPLE, GAP_FILL, CORRECTION_EXAMPLE } from "../src/fixtures.ts";
import {
  canonical,
  hash,
  verifySnapshot,
  validateImport,
  applyPatch,
  Problem,
  LIMITS,
} from "../src/domain.ts";
async function lab(t) {
  const store = await sqliteStore();
  t.after(() => store.close());
  let now = new Date("2026-11-11T16:00:00.000Z");
  const service = new Service(store, () => now),
    created = await service.create();
  const ctx = (role) => ({ workspaceId: created.workspaceId, role });
  const ingest = async (file = SAMPLE, extra = {}) =>
    service.ingest(ctx("operator"), {
      revision: (await service.snapshot(created.workspaceId)).workspace
        .revision,
      requestId: crypto.randomUUID(),
      file,
      actorLabel: "Demo operator",
      ...extra,
    });
  return {
    store,
    service,
    created,
    ctx,
    ingest,
    advance: (ms) => (now = new Date(now.getTime() + ms)),
  };
}
const source = (s) =>
  s.rows.find((r) => r.raw.sourceRecordId === "MES-004" && !r.duplicateOf);
async function proposed(l, s, extra = {}) {
  const r = source(s);
  return l.service.propose(l.ctx("operator"), {
    revision: s.workspace.revision,
    rowId: r.id,
    baseVersion: s.measurements.find((m) => m.rowId === r.id).version,
    ...CORRECTION_EXAMPLE,
    actorLabel: "Demo operator",
    ...extra,
  });
}
async function reviewed(l, s, p = s.proposals[0], extra = {}) {
  return l.service.review(l.ctx("reviewer"), {
    revision: s.workspace.revision,
    proposalId: p.id,
    decision: "approved",
    reason:
      "Checked the fictional source-owner clarification and exact unit mapping.",
    actorLabel: "Demo reviewer",
    ...extra,
  });
}
test("empty SQL workspace has three batch masters, no findings and no fabricated ingestion", async (t) => {
  const l = await lab(t);
  assert.equal(l.created.snapshot.rows.length, 0);
  assert.equal(l.created.snapshot.quality.batches.length, 3);
  assert.equal(l.created.snapshot.quality.summary.errors, 0);
  assert.equal(
    l.store.database.prepare("SELECT COUNT(*) n FROM batches").get().n,
    3,
  );
  assert.equal((await verifySnapshot(l.created.snapshot)).valid, true);
});
test("seeded defects and source conservation match independent expected totals", async (t) => {
  const l = await lab(t),
    { snapshot: s } = await l.ingest();
  assert.deepEqual(s.quality.summary, {
    received: 11,
    usable: 4,
    quarantined: 5,
    duplicates: 2,
    observed: 8,
    expected: 9,
    errors: 8,
    notices: 1,
    coveragePercent: 88.9,
  });
  assert.equal(
    s.rows.length,
    s.quality.summary.usable +
      s.quality.summary.quarantined +
      s.quality.summary.duplicates,
  );
  assert.equal(s.quality.batches[0].state, "clear");
  assert.equal(s.measurements.length, 9);
  assert.equal((await verifySnapshot(s)).valid, true);
});
test("exact and conflicting duplicate rows retain their source and never replace the canonical reading", async (t) => {
  const l = await lab(t),
    { snapshot: s } = await l.ingest();
  assert.deepEqual(
    s.rows
      .filter((r) => r.duplicateOf)
      .map((r) => r.duplicateKind)
      .sort(),
    ["conflict", "exact"],
  );
  const r = source(s);
  assert.equal(
    s.measurements.find((m) => m.rowId === r.id).effective.unit,
    "degC",
  );
  assert.equal(
    s.quality.findings.filter((f) => f.code.startsWith("DUPLICATE")).length,
    2,
  );
});
test("import idempotency returns existing evidence without adding rows or audit entries", async (t) => {
  const l = await lab(t),
    key = crypto.randomUUID();
  const a = await l.ingest(SAMPLE, { requestId: key }),
    b = await l.ingest(SAMPLE, { requestId: key, revision: 0 });
  assert.equal(b.replayed, true);
  assert.deepEqual(a.snapshot, b.snapshot);
});
test("an idempotency key cannot be reused with different data", async (t) => {
  const l = await lab(t),
    key = crypto.randomUUID();
  await l.ingest(SAMPLE, { requestId: key });
  await assert.rejects(
    l.ingest(GAP_FILL, { requestId: key }),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    (await l.service.snapshot(l.created.workspaceId)).rows.length,
    11,
  );
});
test("a proposal records evidence without altering current or raw values", async (t) => {
  const l = await lab(t),
    s = (await l.ingest()).snapshot,
    p = (await proposed(l, s)).snapshot;
  assert.equal(p.proposals[0].status, "pending");
  assert.equal(source(p).raw.unit, "degC");
  assert.equal(
    p.measurements.find((m) => m.rowId === source(p).id).effective.unit,
    "degC",
  );
  assert.equal(p.audit.at(-1).body.action, "PROPOSE");
});
test("reviewed correction resolves a finding, advances the curated version and retains the original source hash", async (t) => {
  const l = await lab(t),
    s = (await l.ingest()).snapshot,
    p = (await proposed(l, s)).snapshot,
    a = (await reviewed(l, p)).snapshot,
    r = source(a),
    m = a.measurements.find((m) => m.rowId === r.id);
  assert.equal(r.raw.unit, "degC");
  assert.equal(r.rawHash, source(s).rawHash);
  assert.equal(m.effective.unit, "°C");
  assert.equal(m.version, 2);
  assert.equal(a.quality.summary.usable, 5);
  assert.equal(a.quality.summary.errors, 7);
  assert.equal(a.findings.filter((f) => f.status === "resolved").length, 1);
  assert.equal(
    l.store.database
      .prepare("SELECT unit FROM measurements WHERE row_id=?")
      .get(r.id).unit,
    "°C",
  );
  assert.equal((await verifySnapshot(a)).valid, true);
});
test("rejection is audited and preserves all measurement values", async (t) => {
  const l = await lab(t),
    s = (await l.ingest()).snapshot,
    p = (await proposed(l, s)).snapshot,
    a = (
      await reviewed(l, p, undefined, {
        decision: "rejected",
        reason:
          "The source-owner clarification is insufficient for this demo review.",
      })
    ).snapshot;
  assert.equal(a.proposals[0].status, "rejected");
  assert.deepEqual(a.measurements, s.measurements);
  assert.equal(a.audit.at(-1).body.action, "REJECT");
});
test("supplemental ingestion closes a missing slot and retains resolved finding history", async (t) => {
  const l = await lab(t);
  await l.ingest();
  const s = (await l.ingest(GAP_FILL)).snapshot;
  assert.equal(s.quality.summary.observed, 9);
  assert.equal(s.quality.summary.coveragePercent, 100);
  assert.equal(s.quality.summary.usable, 5);
  assert.ok(
    s.findings.some(
      (f) => f.code === "MISSING_MEASUREMENT" && f.status === "resolved",
    ),
  );
  assert.equal((await verifySnapshot(s)).valid, true);
});
for (const role of ["reviewer", "observer"])
  test(`${role} cannot ingest or propose corrections`, async (t) => {
    const l = await lab(t);
    await assert.rejects(
      l.service.ingest(l.ctx(role), {}),
      (e) => e.status === 403,
    );
    await assert.rejects(
      l.service.propose(l.ctx(role), {}),
      (e) => e.status === 403,
    );
    assert.equal(
      (await l.service.snapshot(l.created.workspaceId)).workspace.revision,
      0,
    );
  });
for (const role of ["operator", "observer"])
  test(`${role} cannot approve or reject corrections`, async (t) => {
    const l = await lab(t);
    await assert.rejects(
      l.service.review(l.ctx(role), {}),
      (e) => e.status === 403,
    );
  });
test("workspace access is isolated even with a valid key for another workspace", async (t) => {
  const l = await lab(t),
    other = await l.service.create();
  await assert.rejects(
    l.service.authorize(
      other.workspaceId,
      "Bearer " + l.created.capabilities.operator,
    ),
    (e) => e.status === 401,
  );
  for (const role of ["operator", "reviewer", "observer"])
    assert.equal(
      (
        await l.service.authorize(
          l.created.workspaceId,
          "Bearer " + l.created.capabilities[role],
        )
      ).role,
      role,
    );
});
test("identical imports in two SQL workspaces do not collide on missing-slot finding IDs", async (t) => {
  const l = await lab(t),
    first = (await l.ingest()).snapshot,
    other = await l.service.create();
  const second = (
    await l.service.ingest(
      { workspaceId: other.workspaceId, role: "operator" },
      {
        revision: 0,
        requestId: "independent",
        file: SAMPLE,
        actorLabel: "Other operator",
      },
    )
  ).snapshot;
  assert.deepEqual(first.quality.summary, second.quality.summary);
  assert.notEqual(
    first.findings.find((f) => f.code === "MISSING_MEASUREMENT").id,
    second.findings.find((f) => f.code === "MISSING_MEASUREMENT").id,
  );
  assert.equal((await verifySnapshot(second)).valid, true);
  assert.deepEqual(await l.service.snapshot(l.created.workspaceId), first);
});
test("actual SQL capability expiry is enforced against the injected service clock", async (t) => {
  const l = await lab(t);
  l.advance(LIMITS.ttlMs);
  await assert.rejects(
    l.service.authorize(
      l.created.workspaceId,
      "Bearer " + l.created.capabilities.operator,
    ),
    (e) => e.code === "ACCESS_EXPIRED",
  );
});
test("a stale workspace revision cannot partially write an import", async (t) => {
  const l = await lab(t);
  await l.ingest();
  await assert.rejects(
    l.ingest(GAP_FILL, { revision: 0 }),
    (e) => e.status === 409,
  );
  const s = await l.service.snapshot(l.created.workspaceId);
  assert.equal(s.imports.length, 1);
  assert.equal(s.audit.length, 1);
});
test("concurrent imports against the same revision produce one atomic winner", async (t) => {
  const l = await lab(t);
  const results = await Promise.allSettled([
    l.ingest(SAMPLE, { revision: 0 }),
    l.ingest(GAP_FILL, { revision: 0 }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.filter((r) => r.status === "rejected" && r.reason.status === 409)
      .length,
    1,
  );
  const s = await l.service.snapshot(l.created.workspaceId);
  assert.equal(s.imports.length, 1);
  assert.equal(s.audit.length, 1);
  assert.equal((await verifySnapshot(s)).valid, true);
});
test("stale measurement proposals cannot be approved after another correction", async (t) => {
  const l = await lab(t),
    s = (await l.ingest()).snapshot,
    p1 = (await proposed(l, s)).snapshot,
    p2 = (await proposed(l, p1)).snapshot;
  const selected = p2.proposals[0],
    other = p2.proposals[1],
    a = (await reviewed(l, p2, selected)).snapshot;
  await assert.rejects(
    reviewed(l, a, other),
    (e) => e.code === "STALE_CORRECTION",
  );
  assert.equal(
    (await l.service.snapshot(l.created.workspaceId)).audit.length,
    4,
  );
});
test("review of a completed proposal is rejected without another audit event", async (t) => {
  const l = await lab(t),
    p = (await proposed(l, (await l.ingest()).snapshot)).snapshot,
    a = (await reviewed(l, p)).snapshot;
  await assert.rejects(reviewed(l, a), (e) => e.code === "ALREADY_REVIEWED");
  assert.equal(
    (await l.service.snapshot(l.created.workspaceId)).audit.length,
    3,
  );
});
test("cross-workspace row and proposal identifiers are rejected", async (t) => {
  const l = await lab(t),
    s = (await l.ingest()).snapshot,
    other = await l.service.create();
  await assert.rejects(
    l.service.propose(
      { workspaceId: other.workspaceId, role: "operator" },
      {
        revision: 0,
        rowId: source(s).id,
        baseVersion: 1,
        ...CORRECTION_EXAMPLE,
        actorLabel: "Operator",
      },
    ),
    (e) => e.status === 404,
  );
});
test("raw rows, import digests and approved overlays can be independently reconciled", async (t) => {
  const l = await lab(t),
    p = (await proposed(l, (await l.ingest()).snapshot)).snapshot,
    a = (await reviewed(l, p)).snapshot;
  assert.deepEqual((await verifySnapshot(a)).failures, []);
  for (const mutate of [
    (x) => (x.rows[0].raw.value = 1),
    (x) => (x.rows[0].rawHash = "0".repeat(64)),
    (x) => (x.audit[0].body.actorLabel = "changed"),
    (x) => x.audit.pop(),
    (x) => (x.measurements[0].effective.value = 1),
    (x) => x.measurements.pop(),
    (x) => (x.quality.summary.usable = 99),
    (x) => x.findings.pop(),
  ]) {
    const modified = structuredClone(a);
    mutate(modified);
    assert.equal((await verifySnapshot(modified)).valid, false);
  }
});
test("SQL transaction failures roll back earlier writes", async (t) => {
  const l = await lab(t);
  await assert.rejects(
    l.store.batch([
      {
        sql: "UPDATE workspaces SET revision=55 WHERE id=?",
        args: [l.created.workspaceId],
      },
      { sql: "INSERT INTO table_that_does_not_exist VALUES(1)", args: [] },
    ]),
  );
  assert.equal(
    (await l.service.snapshot(l.created.workspaceId)).workspace.revision,
    0,
  );
});
for (const [name, value] of [
  ["schema", { ...SAMPLE, schemaVersion: 2 }],
  ["unknown envelope", { ...SAMPLE, role: "reviewer" }],
  ["nested row", { ...SAMPLE, records: [{ value: { deep: true } }] }],
  ["primitive row", { ...SAMPLE, records: [42] }],
  ["path source", { ...SAMPLE, source: "../secret.json" }],
  ["empty rows", { ...SAMPLE, records: [] }],
  ["row limit", { ...SAMPLE, records: Array(26).fill(SAMPLE.records[0]) }],
  [
    "prototype key",
    JSON.parse(
      '{"schemaVersion":1,"source":"test.json","records":[{"__proto__":"x"}]}',
    ),
  ],
])
  test(`import rejects ${name}`, () =>
    assert.throws(() => validateImport(value), Problem));
test("a correction cannot mutate identity, add a finding, coerce values or replace valid data", () => {
  assert.throws(
    () => applyPatch(SAMPLE.records[3], "batchCode", "AX-1101"),
    Problem,
  );
  assert.throws(() => applyPatch(SAMPLE.records[3], "unit", "F"), Problem);
  assert.throws(() => applyPatch(SAMPLE.records[9], "value", "2"), Problem);
  assert.throws(() => applyPatch(SAMPLE.records[0], "value", 185), Problem);
  assert.equal(applyPatch(SAMPLE.records[9], "value", 2).value, 2);
});
test("canonical hash is independent of JSON key order but retains numeric and text distinctions", async () => {
  assert.equal(await hash({ b: 2, a: 1 }), await hash({ a: 1, b: 2 }));
  assert.notEqual(await hash({ value: 2 }), await hash({ value: "2" }));
  assert.equal(canonical({ z: null, a: [1, "x"] }), '{"a":[1,"x"],"z":null}');
});
test("an advancing real-operation clock keeps import, finding and audit timestamps reconcilable", async (t) => {
  const store = await sqliteStore();
  t.after(() => store.close());
  let tick = Date.parse("2026-11-11T16:00:00.000Z");
  const service = new Service(store, () => new Date((tick += 7))),
    w = await service.create();
  const { snapshot: s } = await service.ingest(
    { workspaceId: w.workspaceId, role: "operator" },
    {
      revision: 0,
      requestId: "clock-check",
      file: SAMPLE,
      actorLabel: "Clock regression",
    },
  );
  assert.equal((await verifySnapshot(s)).valid, true);
  assert.ok(s.findings.every((f) => f.detectedAt === s.audit[0].body.at));
});
test("cross-origin writes, malformed JSON, wrong content type and missing authorization fail at the route", async (t) => {
  const l = await lab(t);
  for (const [req, status] of [
    [
      new Request("https://lab.invalid/api/workspaces", {
        method: "POST",
        headers: {
          origin: "https://other.invalid",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      403,
    ],
    [
      new Request("https://lab.invalid/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      400,
    ],
    [
      new Request("https://lab.invalid/api/workspaces", {
        method: "POST",
        body: "{}",
      }),
      415,
    ],
    [
      new Request(
        `https://lab.invalid/api/workspaces/${l.created.workspaceId}`,
      ),
      401,
    ],
  ])
    await assert.rejects(route(req, l.service), (e) => e.status === status);
});
