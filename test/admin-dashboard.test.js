import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  createTempDir,
  startHttpServer,
  startRuntime,
  writeJson,
} from "./helpers.js";

async function createRuntimeWithStore(tmp, extra = {}) {
  const storePath = path.join(tmp, "accounts.json");
  const oauthStatePath = path.join(tmp, "oauth-state.json");
  const traceFilePath = path.join(tmp, "traces.jsonl");
  const traceStatsHistoryPath = path.join(tmp, "traces-history.jsonl");

  await writeJson(storePath, extra.store ?? { accounts: [], modelAliases: [] });
  await writeJson(oauthStatePath, { states: [] });

  const runtime = await startRuntime({
    storePath,
    oauthStatePath,
    traceFilePath,
    traceStatsHistoryPath,
    ...extra.runtime,
  });

  return { runtime, storePath, traceStatsHistoryPath };
}

test("dashboard preferences are normalized, persisted, and reloaded through admin routes", async () => {
  const tmp = await createTempDir();
  const { runtime, storePath } = await createRuntimeWithStore(tmp);

  try {
    const initialRes = await fetch(
      `${runtime.baseUrl}/admin/dashboard-preferences`,
      {
        headers: { "x-admin-token": "test-admin" },
      },
    );
    assert.equal(initialRes.status, 200);
    const initialBody = await initialRes.json();
    assert.deepEqual(initialBody.preferences.ranges, {
      overview: "7d",
      accounts: "7d",
      tracing: "7d",
    });
    assert.equal(initialBody.preferences.tracing.graphsHidden, false);
    assert.deepEqual(initialBody.preferences.tracing.hiddenCards, []);
    assert.deepEqual(initialBody.preferences.tabOrder, [
      "overview",
      "accounts",
      "aliases",
      "tracing",
      "playground",
      "docs",
    ]);

    const patchRes = await fetch(
      `${runtime.baseUrl}/admin/dashboard-preferences`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-admin-token": "test-admin",
        },
        body: JSON.stringify({
          tabOrder: ["tracing", "overview", "tracing", "bogus"],
          ranges: { overview: "30d", accounts: "24h" },
          tracing: {
            graphsHidden: true,
            hiddenCards: ["usageByRoute", "unknown"],
            cardOrder: [
              "usageByRoute",
              "tokensOverTime",
              "usageByRoute",
              "bad",
            ],
          },
        }),
      },
    );

    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.preferences.ranges.overview, "30d");
    assert.equal(patchBody.preferences.ranges.accounts, "24h");
    assert.equal(patchBody.preferences.ranges.tracing, "7d");
    assert.equal(patchBody.preferences.tracing.graphsHidden, true);
    assert.deepEqual(patchBody.preferences.tracing.hiddenCards, [
      "usageByRoute",
    ]);
    assert.deepEqual(patchBody.preferences.tracing.cardOrder.slice(0, 2), [
      "usageByRoute",
      "tokensOverTime",
    ]);
    assert.deepEqual(patchBody.preferences.tabOrder.slice(0, 3), [
      "tracing",
      "overview",
      "accounts",
    ]);

    await runtime.runtime.store.flushIfDirty();
    const store = JSON.parse(await readFile(storePath, "utf8"));
    assert.equal(store.dashboardPreferences.ranges.overview, "30d");
    assert.equal(store.dashboardPreferences.tracing.graphsHidden, true);

    const reloadRes = await fetch(
      `${runtime.baseUrl}/admin/dashboard-preferences`,
      {
        headers: { "x-admin-token": "test-admin" },
      },
    );
    assert.equal(reloadRes.status, 200);
    const reloadBody = await reloadRes.json();
    assert.equal(reloadBody.preferences.ranges.accounts, "24h");
    assert.equal(reloadBody.preferences.tracing.graphsHidden, true);
    assert.deepEqual(reloadBody.preferences.tabOrder.slice(0, 3), [
      "tracing",
      "overview",
      "accounts",
    ]);
  } finally {
    await runtime.close();
  }
});

test("admin config exposes and persists proxy routing mode", async () => {
  const tmp = await createTempDir();
  const { runtime, storePath } = await createRuntimeWithStore(tmp);

  try {
    const initialRes = await fetch(`${runtime.baseUrl}/admin/config`, {
      headers: { "x-admin-token": "test-admin" },
    });
    assert.equal(initialRes.status, 200);
    const initialBody = await initialRes.json();
    assert.equal(initialBody.proxySettings.routingMode, "quota_aware");

    const patchRes = await fetch(`${runtime.baseUrl}/admin/config`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-admin-token": "test-admin",
      },
      body: JSON.stringify({
        proxySettings: {
          routingMode: "round_robin",
        },
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.proxySettings.routingMode, "round_robin");

    const revertRes = await fetch(`${runtime.baseUrl}/admin/config`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-admin-token": "test-admin",
      },
      body: JSON.stringify({
        proxySettings: {
          routingMode: "quota_aware",
        },
      }),
    });
    assert.equal(revertRes.status, 200);
    const revertBody = await revertRes.json();
    assert.equal(revertBody.proxySettings.routingMode, "quota_aware");

    await runtime.runtime.store.flushIfDirty();
    const store = JSON.parse(await readFile(storePath, "utf8"));
    assert.equal(store.proxySettings.routingMode, "quota_aware");
  } finally {
    await runtime.close();
  }
});

test("refreshing usage without chatgpt account id marks the provider quota snapshot as degraded", async () => {
  let usageCalls = 0;
  const upstream = await startHttpServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/backend-api/wham/usage") {
      usageCalls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 91 },
            secondary_window: { used_percent: 88 },
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });

  const tmp = await createTempDir();
  const { runtime } = await createRuntimeWithStore(tmp, {
    store: {
      accounts: [
        {
          id: "acct-1",
          provider: "openai",
          accessToken: "acct-1-token",
          enabled: true,
          usage: {
            fetchedAt: 0,
            primary: { usedPercent: 14 },
            secondary: { usedPercent: 37 },
          },
          state: {},
        },
      ],
      modelAliases: [],
    },
    runtime: {
      openaiBaseUrl: upstream.url,
    },
  });

  try {
    const res = await fetch(
      `${runtime.baseUrl}/admin/accounts/acct-1/refresh-usage`,
      {
        method: "POST",
        headers: { "x-admin-token": "test-admin" },
      },
    );

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(usageCalls, 0);
    assert.equal(body.account.usage.scope, "unscoped");
    assert.match(body.account.usage.degradedReason, /chatgpt account id/i);
    assert.equal(body.account.usage.primary.usedPercent, 14);
    assert.equal(body.account.usage.secondary.usedPercent, 37);
  } finally {
    await runtime.close();
    await upstream.close();
  }
});
