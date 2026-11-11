import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { SAMPLE, GAP_FILL, CORRECTION_EXAMPLE } from "../src/fixtures.ts";
import { hash, verifySnapshot } from "../src/domain.ts";
import { packBytes } from "../src/export.ts";
import { fingerprint } from "./source-hashes.mjs";
export async function acceptance(base, output) {
  const report = {
    url: base,
    startedAt: new Date().toISOString(),
    sourceFingerprint: await fingerprint(),
    scope:
      "Actual HTTP requests and evidence verification using synthetic data. Expiry is validated separately with an injected service clock; no 24-hour public wait is claimed.",
    cases: [],
    requests: [],
  };
  let workspace,
    s,
    other,
    key = crypto.randomUUID();
  const path = (suffix = "") =>
    `/api/workspaces/${workspace.workspaceId}${suffix}`;
  async function call(
    name,
    route,
    expected = 200,
    {
      method = "GET",
      body,
      role = "operator",
      token,
      origin,
      raw,
      contentType,
    } = {},
  ) {
    const start = performance.now();
    const headers = {};
    if (body !== undefined || raw !== undefined)
      headers["Content-Type"] = contentType ?? "application/json";
    if (token || workspace)
      headers.Authorization =
        "Bearer " + (token ?? workspace.capabilities[role]);
    if (origin) headers.Origin = origin;
    const r = await fetch(base + route, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      redirect: "error",
    });
    let data;
    try {
      data = await r.json();
    } catch {
      data = {};
    }
    report.requests.push({
      name,
      method,
      path: route.replace(/[a-f0-9-]{36}/g, "{workspace}"),
      status: r.status,
      elapsedMs: Number((performance.now() - start).toFixed(2)),
    });
    assert.equal(
      r.status,
      expected,
      `${name}: expected ${expected}, received ${r.status}; ${data.error?.code ?? "unexpected response"}`,
    );
    return data;
  }
  const check = async (name, fn) => {
    try {
      await fn();
      report.cases.push({ name, passed: true });
    } catch (e) {
      report.cases.push({ name, passed: false, error: e.message });
    }
    console.log(`${report.cases.at(-1).passed ? "PASS" : "FAIL"}: ${name}`);
  };
  const ingest = (file, extra = {}) =>
    call("Ingest source", path("/imports"), 200, {
      method: "POST",
      body: {
        revision: s.workspace.revision,
        requestId: crypto.randomUUID(),
        file,
        actorLabel: "HTTP demo operator",
        ...extra,
      },
    });
  const proposal = async (row, value, extra = {}) =>
    call("Propose correction", path("/proposals"), 200, {
      method: "POST",
      body: {
        revision: s.workspace.revision,
        rowId: row.id,
        baseVersion: s.measurements.find((m) => m.rowId === row.id).version,
        field: "value",
        value,
        reason:
          "The fictional source owner confirmed the missing numerical value.",
        actorLabel: "HTTP demo operator",
        ...extra,
      },
    });
  const review = (p, decision = "approved", expected = 200) =>
    call("Review correction", path("/review"), expected, {
      method: "POST",
      role: "reviewer",
      body: {
        revision: s.workspace.revision,
        proposalId: p.id,
        decision,
        reason:
          "Checked the fictional source clarification and current measurement version.",
        actorLabel: "HTTP demo reviewer",
      },
    });
  await check(
    "create an empty SQL-backed workspace with declared batch masters",
    async () => {
      workspace = await call("Create workspace", "/api/workspaces", 201, {
        method: "POST",
        body: {},
      });
      s = workspace.snapshot;
      assert.equal(s.workspace.revision, 0);
      assert.equal(s.rows.length, 0);
      assert.equal(s.quality.batches.length, 3);
      assert.equal(s.quality.summary.errors, 0);
    },
  );
  if (!workspace) {
    report.passed = false;
    await save();
    return { report };
  }
  await check(
    "missing or fabricated capability cannot read a workspace",
    async () => {
      await call("Fabricated key", path(), 401, { token: "0".repeat(64) });
      const r = await fetch(base + path());
      report.requests.push({
        name: "No authorization",
        method: "GET",
        status: r.status,
      });
      assert.equal(r.status, 401);
    },
  );
  await check(
    "cross-origin mutation, malformed JSON and wrong content type are rejected",
    async () => {
      await call("Cross-origin create", "/api/workspaces", 403, {
        method: "POST",
        body: {},
        origin: "https://untrusted.invalid",
      });
      await call("Malformed JSON", "/api/workspaces", 400, {
        method: "POST",
        raw: "{",
      });
      await call("Wrong type", "/api/workspaces", 415, {
        method: "POST",
        raw: "{}",
        contentType: "text/plain",
      });
    },
  );
  await check(
    "bounded streaming input rejects an oversized request",
    async () => {
      await call("Oversized body", path("/imports"), 413, {
        method: "POST",
        raw: JSON.stringify({ padding: "x".repeat(71000) }),
      });
    },
  );
  await check("reviewer and observer cannot ingest data", async () => {
    for (const role of ["reviewer", "observer"])
      await call("Wrong ingest role", path("/imports"), 403, {
        method: "POST",
        role,
        body: {
          revision: 0,
          requestId: "forbidden",
          file: SAMPLE,
          actorLabel: "Wrong role",
        },
      });
  });
  await check(
    "sample import produces independent expected totals and retained duplicates",
    async () => {
      const result = await ingest(SAMPLE, { requestId: key });
      s = result.snapshot;
      assert.equal(result.replayed, false);
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
        s.rows.filter((r) => r.duplicateKind === "conflict").length,
        1,
      );
      assert.equal(s.rows.filter((r) => r.duplicateKind === "exact").length, 1);
    },
  );
  await check(
    "replayed import is idempotent even with an old revision",
    async () => {
      const result = await ingest(SAMPLE, { requestId: key, revision: 0 });
      assert.equal(result.replayed, true);
      assert.deepEqual(result.snapshot, s);
    },
  );
  await check(
    "reusing an import key for different data is a conflict",
    async () => {
      await call("Different file same key", path("/imports"), 409, {
        method: "POST",
        body: {
          revision: s.workspace.revision,
          requestId: key,
          file: GAP_FILL,
          actorLabel: "Operator",
        },
      });
    },
  );
  await check(
    "raw canonical hashes and source pointers reconcile",
    async () => {
      for (const row of s.rows) assert.equal(row.rawHash, await hash(row.raw));
      assert.equal(
        s.rows.find((r) => r.raw.sourceRecordId === "MES-004").ordinal,
        4,
      );
      assert.equal((await verifySnapshot(s)).valid, true);
    },
  );
  let unitProposal, unitRow;
  await check(
    "operator proposal leaves measurement and raw values unchanged",
    async () => {
      unitRow = s.rows.find((r) => r.raw.sourceRecordId === "MES-004");
      const result = await proposal(unitRow, "°C", CORRECTION_EXAMPLE);
      s = result.snapshot;
      unitProposal = s.proposals.find((p) => p.rowId === unitRow.id);
      assert.equal(unitProposal.status, "pending");
      assert.equal(
        s.measurements.find((m) => m.rowId === unitRow.id).effective.unit,
        "degC",
      );
    },
  );
  await check(
    "operator and observer cannot approve or reject a proposal",
    async () => {
      for (const role of ["operator", "observer"])
        await call("Forbidden review", path("/review"), 403, {
          method: "POST",
          role,
          body: {
            revision: s.workspace.revision,
            proposalId: unitProposal.id,
            decision: "approved",
            reason: "A complete but unauthorised review rationale.",
            actorLabel: "Forbidden",
          },
        });
    },
  );
  await check(
    "reviewer approval updates only a versioned overlay and retains resolved history",
    async () => {
      s = (await review(unitProposal)).snapshot;
      assert.equal(
        s.measurements.find((m) => m.rowId === unitRow.id).effective.unit,
        "°C",
      );
      assert.equal(
        s.measurements.find((m) => m.rowId === unitRow.id).version,
        2,
      );
      assert.equal(s.rows.find((r) => r.id === unitRow.id).raw.unit, "degC");
      assert.equal(s.findings.filter((f) => f.status === "resolved").length, 1);
      assert.equal(s.quality.summary.usable, 5);
    },
  );
  await check("review cannot be recorded twice", async () => {
    const before = s.workspace.revision;
    await review(unitProposal, "approved", 409);
    assert.equal(
      (await call("Read unchanged revision", path())).snapshot.workspace
        .revision,
      before,
    );
  });
  await check("observer cannot propose a correction", async () => {
    await call("Observer proposal", path("/proposals"), 403, {
      method: "POST",
      role: "observer",
      body: {},
    });
  });
  await check(
    "cross-workspace read and source-row write are isolated",
    async () => {
      other = await call("Create isolated workspace", "/api/workspaces", 201, {
        method: "POST",
        body: {},
      });
      await call(
        "Foreign workspace read",
        `/api/workspaces/${other.workspaceId}`,
        401,
      );
      await call(
        "Foreign row correction",
        `/api/workspaces/${other.workspaceId}/proposals`,
        404,
        {
          method: "POST",
          token: other.capabilities.operator,
          body: {
            revision: 0,
            rowId: unitRow.id,
            baseVersion: 1,
            ...CORRECTION_EXAMPLE,
            actorLabel: "Other workspace",
          },
        },
      );
    },
  );
  let stale;
  await check(
    "two proposals target a version; only the first approved correction can use it",
    async () => {
      const row = s.rows.find((r) => r.raw.sourceRecordId === "MES-005");
      s = (await proposal(row, 2)).snapshot;
      const first = s.proposals.find((p) => p.rowId === row.id);
      s = (await proposal(row, 2.1)).snapshot;
      stale = s.proposals.find((p) => p.rowId === row.id && p.id !== first.id);
      s = (await review(first)).snapshot;
      await review(stale, "approved", 409);
      assert.equal(s.measurements.find((m) => m.rowId === row.id).version, 2);
    },
  );
  await check(
    "stale proposal can be rejected without changing measurement values",
    async () => {
      const before = JSON.stringify(s.measurements);
      s = (await review(stale, "rejected")).snapshot;
      assert.equal(JSON.stringify(s.measurements), before);
      assert.equal(
        s.proposals.find((p) => p.id === stale.id).status,
        "rejected",
      );
    },
  );
  await check(
    "identity edits and non-improving corrections are rejected",
    async () => {
      for (const [field, value, status] of [
        ["batchCode", "AX-1101", 400],
        ["value", 0, 422],
      ])
        await call("Invalid correction", path("/proposals"), status, {
          method: "POST",
          body: {
            revision: s.workspace.revision,
            rowId: unitRow.id,
            baseVersion: 2,
            field,
            value,
            reason: "This must not change canonical identity or valid data.",
            actorLabel: "Operator",
          },
        });
    },
  );
  await check(
    "unknown request fields, nested source data and stale revisions are rejected",
    async () => {
      await call("Unsupported field", path("/imports"), 400, {
        method: "POST",
        body: {
          revision: s.workspace.revision,
          requestId: "bad",
          file: SAMPLE,
          actorLabel: "Operator",
          admin: true,
        },
      });
      await call("Nested row", path("/imports"), 400, {
        method: "POST",
        body: {
          revision: s.workspace.revision,
          requestId: "bad",
          file: { ...SAMPLE, records: [{ value: { nested: true } }] },
          actorLabel: "Operator",
        },
      });
      await call("Stale import", path("/imports"), 409, {
        method: "POST",
        body: {
          revision: 0,
          requestId: crypto.randomUUID(),
          file: GAP_FILL,
          actorLabel: "Operator",
        },
      });
    },
  );
  await check(
    "a follow-up source import closes the missing slot without replacing existing findings",
    async () => {
      s = (await ingest(GAP_FILL)).snapshot;
      assert.equal(s.quality.summary.observed, 9);
      assert.equal(s.quality.summary.coveragePercent, 100);
      assert.equal(s.quality.summary.usable, 7);
      assert.equal(s.quality.summary.received, 12);
      assert.ok(
        s.findings.some(
          (f) => f.code === "MISSING_MEASUREMENT" && f.status === "resolved",
        ),
      );
    },
  );
  await check(
    "concurrent HTTP imports against one revision have exactly one atomic winner",
    async () => {
      const revision = s.workspace.revision,
        make = (source) => ({
          revision,
          requestId: crypto.randomUUID(),
          file: { ...GAP_FILL, source },
          actorLabel: "Concurrent operator",
        });
      const requests = [make("concurrent-a.json"), make("concurrent-b.json")];
      const results = await Promise.all(
        requests.map(async (body) => {
          const r = await fetch(base + path("/imports"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + workspace.capabilities.operator,
            },
            body: JSON.stringify(body),
          });
          report.requests.push({
            name: "Concurrent import",
            method: "POST",
            status: r.status,
          });
          return { status: r.status, data: await r.json() };
        }),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      s = (await call("Read after concurrency", path())).snapshot;
      assert.equal(s.imports.length, 3);
      assert.equal(s.rows.length, 13);
      assert.equal((await verifySnapshot(s)).valid, true);
    },
  );
  await check(
    "per-workspace import limits reject further writes without partial data",
    async () => {
      s = (await ingest({ ...GAP_FILL, source: "fourth-source.json" }))
        .snapshot;
      await call("Fifth import rejected", path("/imports"), 429, {
        method: "POST",
        body: {
          revision: s.workspace.revision,
          requestId: crypto.randomUUID(),
          file: { ...GAP_FILL, source: "fifth-source.json" },
          actorLabel: "Operator",
        },
      });
      assert.equal(
        (await call("Read bounded workspace", path())).snapshot.rows.length,
        14,
      );
    },
  );
  await check(
    "observer reads persistent state and all evidence reconciles to reviewed changes",
    async () => {
      const observed = await call("Observer snapshot", path(), 200, {
        role: "observer",
      });
      assert.equal(observed.role, "observer");
      assert.deepEqual(observed.snapshot, s);
      assert.equal((await verifySnapshot(s)).valid, true);
    },
  );
  await check(
    "actual ZIP bytes extract to six files and preserve a verifiable snapshot without keys",
    async () => {
      const bytes = await packBytes(s),
        files = unzipSync(bytes);
      assert.equal(Object.keys(files).length, 6);
      const data = JSON.parse(strFromU8(files["evidence.json"]));
      assert.deepEqual(data.snapshot, s);
      assert.equal((await verifySnapshot(data.snapshot)).valid, true);
      const all = Object.values(files).map(strFromU8).join("");
      for (const key of Object.values(workspace.capabilities))
        assert.ok(!all.includes(key));
      report.export = {
        zipBytes: bytes.length,
        files: Object.keys(files),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },
  );
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.cases.filter((c) => c.passed).length,
    total: report.cases.length,
    httpRequests: report.requests.length,
  };
  report.passed = report.summary.passed === report.summary.total;
  await save();
  return {
    report,
    checkpoint: {
      workspaceId: workspace.workspaceId,
      capabilities: workspace.capabilities,
      snapshot: s,
    },
  };
  async function save() {
    if (output) {
      await mkdir(dirname(resolve(output)), { recursive: true });
      await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    }
  }
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const at = process.argv.indexOf("--url"),
    out = process.argv.indexOf("--output");
  const { report } = await acceptance(
    at < 0 ? "http://127.0.0.1:8787" : process.argv[at + 1],
    out < 0 ? "docs/validation/api-local.json" : process.argv[out + 1],
  );
  console.log(JSON.stringify(report.summary));
  process.exitCode = report.passed ? 0 : 1;
}
