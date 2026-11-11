import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { acceptance } from "./acceptance.mjs";
import { verifySnapshot } from "../src/domain.ts";
import { fingerprint } from "./source-hashes.mjs";
const base = "https://traceability.bestdev.co.il";
const { report, checkpoint } = await acceptance(
  base,
  "docs/validation/api-public.json",
);
assert.equal(
  report.passed,
  true,
  "Public acceptance must pass before retaining a checkpoint.",
);
console.log(
  "PUBLIC_CHECKPOINT_READY: keys held only in this process; enter verify after deployment.",
);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (line.trim() !== "verify") continue;
  const response = await fetch(
    base + "/api/workspaces/" + checkpoint.workspaceId,
    {
      headers: { Authorization: "Bearer " + checkpoint.capabilities.observer },
    },
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.snapshot, checkpoint.snapshot);
  const integrity = await verifySnapshot(data.snapshot);
  assert.equal(integrity.valid, true);
  await mkdir("artifacts", { recursive: true });
  const result = {
    checkedAt: new Date().toISOString(),
    url: base,
    sourceFingerprint: await fingerprint(),
    method:
      "Used the same observer capability retained only in process memory to read the complete original public SQL snapshot after a subsequent Site deployment.",
    sourceRows: data.snapshot.rows.length,
    revision: data.snapshot.workspace.revision,
    auditEvents: data.snapshot.audit.length,
    integrity,
    passed: true,
  };
  await writeFile(
    "artifacts/public-deployment-retention.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
  input.close();
  break;
}
