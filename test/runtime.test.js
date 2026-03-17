import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createTempDir, startRuntime, writeJson } from "./helpers.js";

test("runtime refuses non-loopback binding without admin auth", async () => {
  const { createRuntime } = await import("../dist/runtime.js");
  const tmp = await createTempDir();
  const storePath = path.join(tmp, "accounts.json");
  const oauthStatePath = path.join(tmp, "oauth-state.json");
  await writeJson(storePath, { accounts: [], modelAliases: [] });
  await writeJson(oauthStatePath, { states: [] });

  await assert.rejects(
    () =>
      createRuntime({
        host: "0.0.0.0",
        port: 0,
        adminToken: "",
        installSignalHandlers: false,
        storePath,
        oauthStatePath,
        traceFilePath: path.join(tmp, "traces.jsonl"),
        traceStatsHistoryPath: path.join(tmp, "traces-history.jsonl"),
      }),
    /ADMIN_TOKEN is required/,
  );
});

test("runtime exposes readiness separately from health", async () => {
  const tmp = await createTempDir();
  await writeJson(path.join(tmp, "accounts.json"), { accounts: [], modelAliases: [] });
  await writeJson(path.join(tmp, "oauth-state.json"), { states: [] });
  const runtime = await startRuntime({
    adminToken: "test-admin",
    storePath: path.join(tmp, "accounts.json"),
    oauthStatePath: path.join(tmp, "oauth-state.json"),
    traceFilePath: path.join(tmp, "traces.jsonl"),
    traceStatsHistoryPath: path.join(tmp, "traces-history.jsonl"),
  });

  try {
    const health = await fetch(`${runtime.baseUrl}/health`).then((r) => r.json());
    const ready = await fetch(`${runtime.baseUrl}/ready`).then((r) => ({
      status: r.status,
      body: r.status === 200 ? r.json() : r.text(),
    }));

    assert.equal(health.ok, true);
    assert.equal(health.ready, true);
    assert.equal(ready.status, 200);
  } finally {
    await runtime.close();
  }
});
