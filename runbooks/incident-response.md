# Incident response runbook

## When routing looks wrong

1. Check `/health` and `/ready`.
2. Inspect recent traces in the admin dashboard.
3. Confirm whether the affected account is blocked, auth-degraded, or quota-exhausted.
4. Force a usage refresh for the impacted account.
5. If needed, switch routing mode back to `quota_aware`.
6. Disable the broken account and verify traffic resumes through the remaining pool.

## When auth refresh fails

1. Reauth the account from the dashboard.
2. Confirm `ChatGPT-Account-Id` is set for account-scoped OpenAI quota snapshots.
3. Retry a single request and inspect traces before re-enabling broad traffic.
