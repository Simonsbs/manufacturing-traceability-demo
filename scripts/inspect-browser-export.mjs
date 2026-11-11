import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { verifySnapshot } from "../src/domain.ts";
const [path, output, origin = "http://127.0.0.1:5177/"] = process.argv.slice(2);
assert.ok(path && output);
const bytes = await readFile(path),
  files = unzipSync(bytes);
assert.deepEqual(Object.keys(files).sort(), [
  "README.txt",
  "audit.csv",
  "evidence.json",
  "findings.csv",
  "measurements.csv",
  "sources.json",
]);
const data = JSON.parse(strFromU8(files["evidence.json"])),
  s = data.snapshot,
  integrity = await verifySnapshot(s);
assert.equal(integrity.valid, true);
assert.equal(s.workspace.revision, 3);
assert.equal(s.rows.length, 11);
const row = s.rows.find((r) => r.raw.sourceRecordId === "MES-004");
assert.equal(row.raw.unit, "degC");
const current = s.measurements.find((m) => m.rowId === row.id);
assert.equal(current.effective.unit, "°C");
assert.equal(current.version, 2);
assert.equal(s.proposals[0].status, "approved");
assert.equal(s.findings.filter((f) => f.status === "resolved").length, 1);
assert.ok(!strFromU8(files["evidence.json"]).includes("capabilities"));
await mkdir(dirname(output), { recursive: true });
const report = {
  checkedAt: new Date().toISOString(),
  url: origin,
  method:
    "Independent extraction and verification of the actual UI-downloaded evidence ZIP",
  fileName: basename(path),
  sha256: createHash("sha256").update(bytes).digest("hex"),
  zipBytes: bytes.length,
  files: Object.keys(files),
  integrity,
  revision: s.workspace.revision,
  rawUnit: row.raw.unit,
  currentUnit: current.effective.unit,
  currentVersion: current.version,
  approved: s.proposals.filter((p) => p.status === "approved").length,
  resolvedFindings: 1,
  passed: true,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
