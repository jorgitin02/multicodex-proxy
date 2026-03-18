import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createTempDir, startHttpServer, startRuntime, writeJson } from "./helpers.js";

function responseObject(text = "OK") {
  return {
    object: "response",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    },
  };
}

test("proxy fails over on model incompatibility and records capability state", async () => {
  const seenAccounts = [];
  const upstream = await startHttpServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/backend-api/wham/usage") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 0 },
            secondary_window: { used_percent: 0 },
          },
        }),
      );
      return;
    }
    if (
      req.method === "GET" &&
      req.url?.startsWith("/backend-api/codex/models")
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ slug: "gpt-5.4" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/backend-api/codex/responses") {
      const auth = req.headers.authorization ?? "";
      seenAccounts.push(auth);
      if (auth === "Bearer acct-1-token") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            detail:
              "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.",
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(responseObject("OK")));
      return;
    }
    res.writeHead(404).end();
  });

  const tmp = await createTempDir();
  const storePath = path.join(tmp, "accounts.json");
  const oauthStatePath = path.join(tmp, "oauth-state.json");
  const traceFilePath = path.join(tmp, "traces.jsonl");
  const traceStatsHistoryPath = path.join(tmp, "traces-history.jsonl");
  await writeJson(storePath, {
    accounts: [
      {
        id: "acct-1",
        provider: "openai",
        accessToken: "acct-1-token",
        enabled: true,
        priority: 0,
        usage: { fetchedAt: Date.now(), primary: { usedPercent: 0 } },
        state: {},
      },
      {
        id: "acct-2",
        provider: "openai",
        accessToken: "acct-2-token",
        enabled: true,
        priority: 0,
        usage: { fetchedAt: Date.now(), primary: { usedPercent: 0 } },
        state: {},
      },
    ],
    modelAliases: [],
  });
  await writeJson(oauthStatePath, { states: [] });

  const runtime = await startRuntime({
    storePath,
    oauthStatePath,
    traceFilePath,
    traceStatsHistoryPath,
    openaiBaseUrl: upstream.url,
  });

  try {
    const res = await fetch(`${runtime.baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        stream: false,
        input: "reply with ok",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.object, "response");
    assert.equal(seenAccounts.length, 2);
    assert.deepEqual(seenAccounts, [
      "Bearer acct-1-token",
      "Bearer acct-2-token",
    ]);

    await runtime.runtime.store.flushIfDirty();
    const store = JSON.parse(await readFile(storePath, "utf8"));
    const account1 = store.accounts.find((account) => account.id === "acct-1");
    assert.match(account1.state.blockedReason, /model unsupported/i);
    assert.equal(
      account1.state.modelAvailability["gpt-5.4"].supported,
      false,
    );
  } finally {
    await runtime.close();
    await upstream.close();
  }
});

test("proxy does not blindly retry generic upstream 500s for POST responses", async () => {
  let responseCalls = 0;
  const upstream = await startHttpServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/backend-api/wham/usage") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 0 },
            secondary_window: { used_percent: 0 },
          },
        }),
      );
      return;
    }
    if (
      req.method === "GET" &&
      req.url?.startsWith("/backend-api/codex/models")
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ slug: "gpt-5.4" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/backend-api/codex/responses") {
      responseCalls += 1;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "boom" }));
      return;
    }
    res.writeHead(404).end();
  });

  const tmp = await createTempDir();
  await writeJson(path.join(tmp, "accounts.json"), {
    accounts: [
      {
        id: "acct-1",
        provider: "openai",
        accessToken: "acct-1-token",
        enabled: true,
        usage: { fetchedAt: Date.now(), primary: { usedPercent: 0 } },
        state: {},
      },
    ],
    modelAliases: [],
  });
  await writeJson(path.join(tmp, "oauth-state.json"), { states: [] });

  const runtime = await startRuntime({
    storePath: path.join(tmp, "accounts.json"),
    oauthStatePath: path.join(tmp, "oauth-state.json"),
    traceFilePath: path.join(tmp, "traces.jsonl"),
    traceStatsHistoryPath: path.join(tmp, "traces-history.jsonl"),
    openaiBaseUrl: upstream.url,
  });

  try {
    const res = await fetch(`${runtime.baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        stream: false,
        input: "reply with ok",
      }),
    });
    assert.equal(res.status, 500);
    assert.equal(responseCalls, 1);
  } finally {
    await runtime.close();
    await upstream.close();
  }
});

test("successful proxy responses clear stale auth failure state", async () => {
  const upstream = await startHttpServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/backend-api/wham/usage") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 0 },
            secondary_window: { used_percent: 0 },
          },
        }),
      );
      return;
    }
    if (
      req.method === "GET" &&
      req.url?.startsWith("/backend-api/codex/models")
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ slug: "gpt-5.4" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/backend-api/codex/responses") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(responseObject("OK")));
      return;
    }
    res.writeHead(404).end();
  });

  const tmp = await createTempDir();
  const storePath = path.join(tmp, "accounts.json");
  await writeJson(storePath, {
    accounts: [
      {
        id: "acct-1",
        provider: "openai",
        accessToken: "acct-1-token",
        enabled: true,
        usage: { fetchedAt: Date.now(), primary: { usedPercent: 0 } },
        state: {
          blockedUntil: Date.now() + 60_000,
          blockedReason: "auth failure: 401",
          needsTokenRefresh: true,
          refreshFailureCount: 3,
          refreshBlockedUntil: Date.now() + 60_000,
          lastError: "refresh token failed: token endpoint failed 401",
          recentErrors: [
            { at: Date.now(), message: "usage probe failed 401" },
            { at: Date.now() - 1_000, message: "auth failure: 401" },
            { at: Date.now() - 2_000, message: "quota/rate-limit: 429" },
          ],
        },
      },
    ],
    modelAliases: [],
  });
  await writeJson(path.join(tmp, "oauth-state.json"), { states: [] });

  const runtime = await startRuntime({
    storePath,
    oauthStatePath: path.join(tmp, "oauth-state.json"),
    traceFilePath: path.join(tmp, "traces.jsonl"),
    traceStatsHistoryPath: path.join(tmp, "traces-history.jsonl"),
    openaiBaseUrl: upstream.url,
  });

  try {
    await runtime.runtime.store.upsertAccount({
      ...(await runtime.runtime.store.listAccounts())[0],
      state: {
        blockedUntil: undefined,
        blockedReason: undefined,
        needsTokenRefresh: true,
        refreshFailureCount: 3,
        refreshBlockedUntil: Date.now() + 60_000,
        lastError: "refresh token failed: token endpoint failed 401",
        recentErrors: [
          { at: Date.now(), message: "usage probe failed 401" },
          { at: Date.now() - 1_000, message: "auth failure: 401" },
          { at: Date.now() - 2_000, message: "quota/rate-limit: 429" },
        ],
      },
    });

    const res = await fetch(`${runtime.baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        stream: false,
        input: "reply with ok",
      }),
    });

    assert.equal(res.status, 200);

    await runtime.runtime.store.flushIfDirty();
    const store = JSON.parse(await readFile(storePath, "utf8"));
    const account = store.accounts.find((entry) => entry.id === "acct-1");
    assert.equal(account.state.needsTokenRefresh, false);
    assert.equal(account.state.refreshFailureCount, 0);
    assert.equal(account.state.refreshBlockedUntil, undefined);
    assert.equal(account.state.lastError, undefined);
    assert.equal(account.state.blockedUntil, undefined);
    assert.equal(account.state.blockedReason, undefined);
    assert.deepEqual(account.state.recentErrors, [
      {
        at: account.state.recentErrors[0].at,
        message: "quota/rate-limit: 429",
      },
    ]);
  } finally {
    await runtime.close();
    await upstream.close();
  }
});
