import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fingerprint } from "./source-hashes.mjs";
const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
};
const base = option("--url", "https://traceability.bestdev.co.il"),
  output = resolve(option("--output", "docs/validation/public-smoke.json"));
const report = {
  url: base,
  checkedAt: new Date().toISOString(),
  sourceFingerprint: await fingerprint(),
  checks: [],
};
let html = "";
async function check(name, fn) {
  try {
    await fn();
    report.checks.push({ name, passed: true });
  } catch (e) {
    report.checks.push({ name, passed: false, error: e.message });
  }
}
await check("public HTTPS loads without sign-in", async () => {
  assert.equal(new URL(base).protocol, "https:");
  const r = await fetch(base, { redirect: "error" });
  assert.equal(r.status, 200);
  html = await r.text();
  assert.match(html, /Traceability Lab/);
  assert.match(r.headers.get("content-type"), /text\/html/);
});
await check(
  "CSP, framing, MIME, referrer and no-CORS boundaries apply",
  async () => {
    const r = await fetch(base);
    assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
    assert.match(
      r.headers.get("content-security-policy"),
      /connect-src 'self'/,
    );
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  },
);
await check(
  "application assets and self-hosted fonts load with immutable caching",
  async () => {
    const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(
      (m) => m[1],
    );
    assert.ok(paths.length >= 2);
    for (const path of paths) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200);
      assert.match(r.headers.get("cache-control"), /immutable/);
      if (path.endsWith(".css")) {
        const css = await r.text(),
          fonts = [
            ...css.matchAll(/url\((?:["']?)([^)"']+\.woff2)(?:["']?)\)/g),
          ].map((m) => m[1]);
        assert.ok(fonts.length);
        const f = await fetch(new URL(fonts[0], base + path));
        assert.equal(f.status, 200);
        assert.ok((await f.arrayBuffer()).byteLength > 0);
      }
    }
  },
);
await check(
  "README, architecture, HTTP contract, validation and favicon are published",
  async () => {
    for (const path of [
      "/docs/README.md",
      "/docs/BUILD_NOTES.md",
      "/docs/CONTRACT.md",
      "/docs/VALIDATION.md",
      "/favicon.svg",
    ]) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200);
      assert.ok((await r.text()).length > 0);
      assert.match(r.headers.get("cache-control"), /no-cache/);
    }
  },
);
await check(
  "health checks actual SQL connectivity and the exact application fingerprint",
  async () => {
    const r = await fetch(base + "/api/health"),
      data = await r.json();
    assert.equal(r.status, 200);
    assert.equal(data.ready, true);
    assert.equal(data.storage, "SQL-backed visitor workspace");
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.sourceFingerprint, report.sourceFingerprint);
    assert.equal(r.headers.get("cache-control"), "no-store");
  },
);
await check(
  "unauthenticated data access, cross-origin writes and unsupported routes are refused",
  async () => {
    const r = await fetch(
      base + "/api/workspaces/00000000-0000-4000-8000-000000000000",
    );
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(
      (
        await fetch(base + "/api/workspaces", {
          method: "POST",
          headers: {
            Origin: "https://untrusted.invalid",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + "/missing.svg")).status, 404);
    assert.equal(
      (
        await fetch(base + "/", {
          method: "POST",
          body: "synthetic-boundary-test",
        })
      ).status,
      405,
    );
    const h = await fetch(base, { method: "HEAD" });
    assert.equal(h.status, 200);
    assert.equal(await h.text(), "");
  },
);
report.passed = report.checks.every((c) => c.passed);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
process.exitCode = report.passed ? 0 : 1;
