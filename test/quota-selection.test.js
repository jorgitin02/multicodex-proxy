import test from "node:test";
import assert from "node:assert/strict";

test("quota-aware selection does not give weekly-only accounts an artificial 5h advantage", async () => {
  const { chooseAccount, resetRoutingStateForTest } =
    await import("../dist/quota.js");

  resetRoutingStateForTest();

  const selected = chooseAccount(
    [
      {
        id: "z-free",
        provider: "openai",
        enabled: true,
        quotaProfile: "weekly_only",
        usage: {
          fetchedAt: Date.now(),
          secondary: { usedPercent: 20, resetAt: 1_900_000_000_000 },
        },
        state: {},
      },
      {
        id: "a-pro",
        provider: "openai",
        enabled: true,
        usage: {
          fetchedAt: Date.now(),
          primary: { usedPercent: 20, resetAt: 1_900_000_000_000 },
          secondary: { usedPercent: 20, resetAt: 1_900_000_000_000 },
        },
        state: {},
      },
    ],
    { routingMode: "quota_aware" },
  );

  assert.equal(selected?.id, "a-pro");
});
