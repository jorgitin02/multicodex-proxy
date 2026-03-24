# Dashboard Preferences And Usage Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global persisted dashboard preferences, range-driven analytics for overview/accounts/tracing, and harden OpenAI quota refresh behavior so degraded provider usage is surfaced instead of silently shown as reliable weekly account usage.

**Architecture:** Extend the existing store file with a normalized `dashboardPreferences` object and expose it through focused admin endpoints. Keep trace-window analytics derived from existing trace history endpoints, add lightweight summary endpoints for overview/accounts, and update the React app to load/save global preferences and poll active data on an interval without requiring page reloads.

**Tech Stack:** TypeScript, Express, node:test, React 18, Vite, Recharts

---

### Task 1: Persist And Validate Dashboard Preferences In The Store

**Files:**
- Modify: `src/types.ts`
- Modify: `src/store.ts`
- Test: `test/admin-dashboard.test.js`

- [ ] **Step 1: Write a failing backend test for store-backed dashboard preferences**

Create a focused `node:test` case that initializes `AccountStore` from a temp file without `dashboardPreferences`, updates preferences, flushes, reloads, and asserts:
- defaults are materialized when missing
- partial/invalid values normalize to defaults
- saved preferences survive reload

- [ ] **Step 2: Run the focused test and verify it fails for the missing API**

Run: `node --test test/admin-dashboard.test.js`
Expected: FAIL because the store/types do not yet expose normalized dashboard preferences APIs.

- [ ] **Step 3: Add the dashboard preference types and default/normalize helpers**

Implement compact types for:
- top tab order
- per-tab ranges
- tracing layout state
- account analytics layout state
- quota snapshot degradation metadata

Keep the shape tolerant of missing/extra values and normalize server-side.

- [ ] **Step 4: Add store support for dashboard preferences**

Update `AccountStore` to:
- load `dashboardPreferences` from disk
- return a normalized default when absent
- persist the object alongside accounts/model aliases
- support patch/update operations without mutating unrelated state

- [ ] **Step 5: Re-run the focused test**

Run: `node --test test/admin-dashboard.test.js`
Expected: PASS for store persistence and normalization.

### Task 2: Add Admin API Support And Harden Quota Refresh Reliability

**Files:**
- Modify: `src/routes/admin/index.ts`
- Modify: `src/quota.ts`
- Modify: `src/types.ts`
- Test: `test/admin-dashboard.test.js`

- [ ] **Step 1: Write failing tests for admin preference routes and degraded quota refresh**

Add focused tests that assert:
- `GET /admin/dashboard-preferences` returns normalized defaults
- `PATCH /admin/dashboard-preferences` persists validated updates
- refreshing usage for an OpenAI account without `chatgptAccountId` marks the provider quota snapshot as degraded/untrusted instead of pretending account-scoped weekly data is valid

- [ ] **Step 2: Run the focused test file and verify the new cases fail**

Run: `node --test test/admin-dashboard.test.js`
Expected: FAIL on missing endpoints and missing degraded usage state.

- [ ] **Step 3: Implement admin preference routes**

Add endpoints to:
- read preferences
- patch preferences
- reset preference groups if needed by the UI

Return normalized data in all cases.

- [ ] **Step 4: Harden OpenAI usage refresh behavior**

Update `refreshUsageIfNeeded()` so that when the provider is OpenAI and `chatgptAccountId` is absent:
- it does not silently overwrite trusted account-scoped quota semantics
- it records degraded quota metadata on the account usage/state
- the admin API can expose that degraded status to the UI

Do not add proxy-path latency or alter retry semantics.

- [ ] **Step 5: Re-run the focused backend tests**

Run: `node --test test/admin-dashboard.test.js`
Expected: PASS for preference routes and degraded quota refresh behavior.

### Task 3: Add Range-Driven Overview/Accounts Analytics And Shared Live Refresh

**Files:**
- Modify: `src/routes/admin/index.ts`
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/ui.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/tabs/OverviewTab.tsx`
- Modify: `web/src/components/tabs/AccountsTab.tsx`
- Modify: `web/src/styles.css`
- Test: `test/admin-dashboard.test.js`

- [ ] **Step 1: Write a failing test for any new summary endpoint needed by overview/accounts**

If a dedicated summary endpoint is introduced, add a focused test asserting it derives data from trace history over `24h`, `7d`, `30d`, and `all` windows.

- [ ] **Step 2: Run the focused backend tests and verify failure**

Run: `node --test test/admin-dashboard.test.js`
Expected: FAIL if the summary endpoint or response shape does not exist yet.

- [ ] **Step 3: Implement the minimal backend summary shape**

Expose the smallest data needed for:
- overview selected-range metrics
- account usage charts/tables over the selected range
- provider quota snapshot metadata kept separate from trace analytics

- [ ] **Step 4: Update the React app to load/save preferences and poll shared data**

In `App.tsx`:
- load preferences on startup
- save preference changes via admin API
- apply persisted tab order
- keep active-tab analytics fresh on an interval
- keep base account/config/model data fresh on an interval

- [ ] **Step 5: Update `OverviewTab` and `AccountsTab`**

Add:
- persistent range selectors
- trace-derived metrics/charts for selected range
- separate live provider quota sections
- account analytics section reorder controls as defined by preferences

- [ ] **Step 6: Build the web app**

Run: `npm --prefix web run build`
Expected: PASS.

### Task 4: Move Tracing Layout Persistence Server-Side And Finish UI Controls

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/tabs/TracingTab.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/src/types.ts`
- Test: `test/admin-dashboard.test.js`

- [ ] **Step 1: Write a failing test for any backend contract needed by tracing preferences**

Add or extend backend tests to verify tracing preference fields round-trip through the preferences API.

- [ ] **Step 2: Run the focused backend tests and verify failure**

Run: `node --test test/admin-dashboard.test.js`
Expected: FAIL if tracing-specific preference fields are not yet normalized/persisted.

- [ ] **Step 3: Update tracing UI to use server preferences instead of `localStorage`**

Implement:
- persistent tracing range
- persistent card order
- persistent graph visibility toggle
- persistent hide/show for `Usage by route`
- persistent reorder controls for the account-usage section
- reset-to-default action

- [ ] **Step 4: Add account usage charts in tracing**

Use existing usage aggregate data to add a few charts for:
- requests by account
- tokens by account
- cost by account

Keep the UI resilient when data is sparse.

- [ ] **Step 5: Rebuild the web app and run focused backend tests**

Run: `npm --prefix web run build`
Expected: PASS.

Run: `node --test test/admin-dashboard.test.js`
Expected: PASS.

### Task 5: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run the narrowest full verification for touched backend/frontend paths**

Run: `node --test test/admin-dashboard.test.js`
Expected: PASS.

Run: `npm --prefix web run build`
Expected: PASS.

- [ ] **Step 2: Run the repo test suite if the focused checks are green**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Manual smoke-check summary**

Confirm in the final report:
- dashboard tabs can be reordered and stay reordered after reload
- overview/accounts/tracing ranges persist
- tracing graph visibility and hidden sections persist
- overview/accounts live data no longer requires constant refresh
- provider quota snapshots are clearly separate from trace-window analytics
- accounts missing `chatgptAccountId` show degraded provider quota status instead of misleading weekly usage
