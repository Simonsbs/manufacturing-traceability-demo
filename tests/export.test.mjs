import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { sqliteStore } from "../server/sqlite.mjs";
import { Service } from "../server/service.ts";
import { SAMPLE } from "../src/fixtures.ts";
import { verifySnapshot } from "../src/domain.ts";
import { packBytes, evidenceFiles, csv } from "../src/export.ts";
async function example(t) {
  const store = await sqliteStore();
  t.after(() => store.close());
  const service = new Service(store),
    workspace = await service.create();
  const { snapshot } = await service.ingest(
    { workspaceId: workspace.workspaceId, role: "operator" },
    {
      revision: 0,
      requestId: "export-test",
      file: SAMPLE,
      actorLabel: "=SUM(1,1)",
    },
  );
  return { snapshot, workspace };
}
test("actual ZIP opens to six fixed paths and independently verifiable complete evidence", async (t) => {
  const { snapshot, workspace } = await example(t),
    files = unzipSync(await packBytes(snapshot, "2026-11-11T16:00:00.000Z"));
  assert.deepEqual(Object.keys(files).sort(), [
    "README.txt",
    "audit.csv",
    "evidence.json",
    "findings.csv",
    "measurements.csv",
    "sources.json",
  ]);
  const report = JSON.parse(strFromU8(files["evidence.json"]));
  assert.deepEqual(report.snapshot, snapshot);
  assert.equal((await verifySnapshot(report.snapshot)).valid, true);
  const all = Object.values(files).map(strFromU8).join("");
  for (const token of Object.values(workspace.capabilities))
    assert.ok(!all.includes(token));
  assert.ok(!all.includes("capabilities"));
});
test("export stops if raw data, finding history or current quality was changed", async (t) => {
  const { snapshot } = await example(t);
  for (const mutate of [
    (s) => (s.rows[0].raw.value = 12),
    (s) => s.findings.pop(),
    (s) => (s.quality.summary.errors = 0),
  ]) {
    const s = structuredClone(snapshot);
    mutate(s);
    await assert.rejects(evidenceFiles(s), /verification failed/);
  }
});
test("CSV quotes commas/newlines/quotes and neutralises formula-leading cells", () => {
  assert.equal(
    csv([["a,b", "line\nbreak", 'a"b', "=1+1", " @SUM(1,2)", "-1", "safe"]]),
    '"a,b","line\nbreak","a""b","\'=1+1","\' @SUM(1,2)","\'-1","safe"\r\n',
  );
});
test("unverified actor labels are exported safely as text and sources retain raw typed values", async (t) => {
  const { snapshot } = await example(t),
    files = await evidenceFiles(snapshot);
  assert.ok(files["audit.csv"].includes('"\'=SUM(1,1)"'));
  const sources = JSON.parse(files["sources.json"]);
  assert.equal(
    sources[0].records.find((r) => r.raw.sourceRecordId === "MES-009").raw
      .value,
    "2,0",
  );
  assert.equal(
    sources[0].records.find((r) => r.raw.sourceRecordId === "MES-005").raw
      .value,
    null,
  );
});
test("export states count meanings, role limitations, expiry and hash boundaries", async (t) => {
  const { snapshot } = await example(t),
    files = await evidenceFiles(snapshot);
  assert.match(
    files["README.txt"],
    /11 source rows = 4 usable \+ 5 quarantined \+ 2 duplicates/,
  );
  assert.match(files["README.txt"], /coverage is not a quality pass rate/);
  assert.match(files["README.txt"], /not authenticated people/);
  assert.match(files["README.txt"], /24 hours/);
  assert.match(files["README.txt"], /not original file bytes/);
});
