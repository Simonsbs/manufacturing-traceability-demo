import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { acceptance } from "./acceptance.mjs";
import { verifySnapshot } from "../src/domain.ts";
import { fingerprint } from "./source-hashes.mjs";
const root = process.cwd(),
  stamp = Date.now(),
  outputAt = process.argv.indexOf("--output"),
  out = resolve(outputAt < 0 ? "docs/validation" : process.argv[outputAt + 1]);
await mkdir(out, { recursive: true });
const runtimePath = resolve("artifacts", "runtime-" + stamp);
await mkdir(runtimePath, { recursive: true });
const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await Promise.race([once(child, "exit").catch(() => {}), sleep(2000)]);
}
async function launch(args, env, url) {
  let logs = "";
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env, WRANGLER_SEND_METRICS: "false" },
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => (logs += b));
  child.stderr.on("data", (b) => (logs += b));
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null)
      throw new Error(
        "Owned runtime exited before readiness: " + logs.slice(-2000),
      );
    try {
      const r = await fetch(url);
      if (r.status === 401) return child;
    } catch {}
    await sleep(250);
  }
  await stop(child);
  throw new Error("Owned runtime readiness timed out: " + logs.slice(-2000));
}
const reports = [];
for (const [kind, port] of [
  ["sqlite", 8795],
  ["d1", 8796],
]) {
  const base = `http://127.0.0.1:${port}`,
    unknown = "/api/workspaces/00000000-0000-4000-8000-000000000000";
  const persistence = resolve(runtimePath, kind);
  let args,
    env = {};
  if (kind === "sqlite") {
    args = [
      "--experimental-strip-types",
      "server/local.mjs",
      "--port",
      String(port),
    ];
    env.TRACEABILITY_DB = persistence + ".sqlite";
  } else {
    const applied = spawnSync(
      process.execPath,
      [
        wrangler,
        "d1",
        "migrations",
        "apply",
        "DB",
        "--local",
        "--persist-to",
        persistence,
      ],
      {
        cwd: root,
        env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
        windowsHide: true,
        encoding: "utf8",
      },
    );
    assert.equal(applied.status, 0, applied.stderr + applied.stdout);
    args = [
      wrangler,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--persist-to",
      persistence,
    ];
  }
  let child;
  try {
    child = await launch(args, env, base + unknown);
    const { report, checkpoint } = await acceptance(
      base,
      resolve(out, "api-" + kind + ".json"),
    );
    assert.equal(report.passed, true, `${kind} acceptance failed`);
    await stop(child);
    child = await launch(args, env, base + unknown);
    const r = await fetch(base + "/api/workspaces/" + checkpoint.workspaceId, {
      headers: { Authorization: "Bearer " + checkpoint.capabilities.observer },
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.deepEqual(data.snapshot, checkpoint.snapshot);
    assert.equal((await verifySnapshot(data.snapshot)).valid, true);
    const result = {
      runtime: kind,
      checkedAt: new Date().toISOString(),
      sourceFingerprint: await fingerprint(),
      acceptance: report.summary,
      restart: {
        passed: true,
        method:
          "Stopped the owned runtime process, restarted it against the same database, read using the same observer capability and compared the entire retained snapshot.",
        revision: data.snapshot.workspace.revision,
        sourceRows: data.snapshot.rows.length,
        auditEvents: data.snapshot.audit.length,
      },
      passed: true,
    };
    await writeFile(
      resolve(out, "persistence-" + kind + ".json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    reports.push(result);
    console.log(
      "PASS: " + kind + " actual process restart preserved data and access",
    );
  } finally {
    await stop(child);
  }
}
console.log(
  JSON.stringify(
    reports.map((r) => ({
      runtime: r.runtime,
      passed: r.passed,
      acceptance: r.acceptance,
      restart: r.restart.passed,
    })),
  ),
);
