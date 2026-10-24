import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
  console.log(
    "Usage: node scripts/check-config.mjs\nValidate production routing, authentication, and built offline assets. Run npm run build first. Requires Node 24. No environment variables. Exit: 0 valid, 1 invalid, 2 usage error.",
  );
} else if (args.length) {
  console.error("Unknown arguments. Use --help.");
  process.exitCode = 2;
} else {
  try {
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    assert.equal(config.name, "daymark");
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.deepEqual(config.routes, [{ pattern: "daymark.lasers.app", custom_domain: true }]);
    assert.equal(config.assets.run_worker_first, true);
    assert.equal(config.vars.APP_ORIGIN, "https://daymark.lasers.app");
    assert.equal(config.vars.ACCESS_REQUIRED, "true");
    assert.match(config.vars.ACCESS_ISSUER, /^https:\/\/[^/]+\.cloudflareaccess\.com$/);
    for (const key of ["ACCESS_AUDIENCE", "ADMIN_ACCESS_AUDIENCE"])
      assert.match(config.vars[key], /^[a-f0-9]{64}$/);
    assert.notEqual(config.vars.ACCESS_AUDIENCE, config.vars.ADMIN_ACCESS_AUDIENCE);
    for (const key of ["AUTH_SECRET", "OWNER_EMAIL"])
      assert.equal(config.vars[key], undefined, `${key} belongs in Worker secrets`);
    assert.equal(config.d1_databases[0].binding, "DB");
    assert.match(config.d1_databases[0].database_id, /^[a-f0-9-]{36}$/);
    const sw = readFileSync("dist/sw.js", "utf8");
    assert.ok(!sw.includes("__CACHE_VERSION__"));
    const paths = JSON.parse(sw.match(/const FILES = (\[[^;]+\]);/)[1]);
    assert.ok(paths.includes("/"), "Offline navigation must cache the canonical root");
    for (const path of paths) {
      assert.ok(!path.startsWith("/api/") && !path.includes("..") && !path.includes("worker"));
      const size = statSync(path === "/" ? "dist/index.html" : `dist${path}`).size;
      assert.ok(size < 25 * 1024 * 1024, "Asset exceeds Cloudflare file limit");
    }
    console.log("Production protection, routing, and offline asset configuration passed");
  } catch (error) {
    console.error(`Configuration check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
