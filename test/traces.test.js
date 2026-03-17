import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createTempDir } from "./helpers.js";

test("trace manager keeps a bounded in-memory window and compacts persisted traces", async () => {
  const tmp = await createTempDir();
  const { createTraceManager } = await import("../dist/traces.js");
  const manager = createTraceManager({
    filePath: path.join(tmp, "traces.jsonl"),
    historyFilePath: path.join(tmp, "traces-history.jsonl"),
    retentionMax: 3,
  });

  for (let i = 0; i < 5; i += 1) {
    await manager.appendTrace({
      at: Date.now() + i,
      route: "/responses",
      status: 200,
      stream: false,
      latencyMs: 10 + i,
      model: `gpt-${i}`,
    });
  }

  const window = await manager.readTraceWindow();
  assert.equal(window.length, 3);
  assert.deepEqual(
    window.map((entry) => entry.model),
    ["gpt-2", "gpt-3", "gpt-4"],
  );

  await manager.compactTraceStorageIfNeeded();
  const persisted = (await readFile(path.join(tmp, "traces.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(persisted.length, 3);
  assert.deepEqual(
    persisted.map((entry) => entry.model),
    ["gpt-2", "gpt-3", "gpt-4"],
  );
});
