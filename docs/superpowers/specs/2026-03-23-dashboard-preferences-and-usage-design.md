# Dashboard Preferences And Usage Reliability Design

**Date:** 2026-03-23

## Goal

Add global, server-persisted dashboard customization for tab order, section layout, visibility toggles, and range selection across the admin UI while also correcting the product model for account usage data so trace-window analytics and provider quota snapshots are not conflated.

## Scope

In scope:
- Persistent top-tab reordering.
- Persistent range selection for `Overview`, `Accounts`, and `Tracing`.
- Persistent tracing layout controls:
  - reorder sections
  - reset layout
  - hide/show graphs
  - hide/show `Usage by route`
  - reorder `Usage by account`
- Additional account usage graphs driven by trace history.
- Diagnose and harden provider usage refresh behavior for OpenAI accounts whose weekly usage is currently unreliable.
- Make dashboard data refresh automatically without requiring constant manual reloads.

Out of scope:
- Multi-user preference scoping.
- Drag-and-drop layout editing.
- Broad refactors outside admin storage, admin routes, and dashboard UI.
- Changing proxy failover semantics around timeout retry behavior.

## Current State

The dashboard already has:
- trace-history-backed analytics for tracing via `/admin/stats/traces` and `/admin/stats/usage`
- browser-local tracing card order persistence in `localStorage`
- manual base-data refresh
- a tracing-only polling loop every 10 seconds

The dashboard does not yet have:
- server-persisted UI preferences
- range controls for `Overview` or `Accounts`
- shared live-refresh behavior across non-tracing tabs
- clear separation between provider quota snapshots and trace-window analytics in the UI

## Root Cause Diagnosis: Weekly Account Usage Refresh

The current weekly usage issue is caused by a mismatch between the data source and the UI semantics.

### What the code does today

- `Overview` reads `accounts[].usage.primary/secondary.usedPercent`, which comes from provider-reported quota data.
- `Accounts` account rows also expose provider usage snapshots.
- `Tracing` stats are built from trace history in `traceStatsHistory`.
- OpenAI usage refresh is implemented in `refreshUsageIfNeeded()` in `src/quota.ts` by calling `GET /backend-api/wham/usage`.
- That request only becomes account-scoped when the `ChatGPT-Account-Id` header is present.
- `chatgptAccountId` is populated from OAuth token data when available, but older/manual accounts can exist without it.

### Why some weekly values are wrong

- When an OpenAI account does not have `chatgptAccountId`, the usage probe is not guaranteed to target the intended account quota bucket.
- The current code silently accepts whatever `wham/usage` returns and stores it back on the account.
- The UI presents those values as if they were reliable per-account weekly usage.
- The UI also uses the word "weekly" in places where the user expects selectable trace-window analytics, not provider quota-window snapshots.

### Correct product model

The dashboard should present two different kinds of data:

1. **Trace-window analytics**
   - driven only by retained trace history
   - supports `24h`, `7d`, `30d`, `all`
   - powers `Overview`, `Accounts`, and `Tracing` analytics

2. **Provider quota snapshots**
   - driven by the provider usage probe
   - reflects live provider quota windows such as the current ~5h and weekly buckets
   - shown separately from trace-window analytics

### Correct refresh behavior

For OpenAI accounts, the correct way to pull account usage is:
- ensure the access token is fresh
- send `Authorization: Bearer <token>`
- send `ChatGPT-Account-Id: <account.chatgptAccountId>` when known
- treat missing `chatgptAccountId` as degraded/untrusted for account-scoped quota reporting
- surface that degraded state in the stored account metadata and UI instead of silently showing potentially misleading weekly values

For Mistral accounts:
- provider quota refresh remains unsupported unless a provider-specific quota endpoint is added later
- trace-window analytics still work because they are derived from local trace history

## Proposed Architecture

### 1. Persist dashboard preferences in the existing store

Add a `dashboardPreferences` object to the store file alongside `accounts` and `modelAliases`.

Reasons:
- one operator, global preferences
- same durability and write path as existing admin state
- low implementation overhead
- avoids another disk file and sync path

### 2. Expose preferences through admin routes

Add focused admin endpoints to:
- read the current preferences
- patch the preferences
- reset selected preference groups to defaults

Validation must normalize:
- tab ids
- per-tab range values
- visible/hidden section ids
- ordered section lists

### 3. Split analytics from provider quota snapshots in the UI

`Overview` and `Accounts` will consume trace-derived range-specific stats from admin API endpoints. Provider quota data remains visible, but in clearly labeled sections such as "Live provider quota" or similar.

### 4. Make dashboard refresh shared and predictable

Replace the tracing-only live behavior with a shared polling strategy in `App.tsx`:
- base account/config/model/preferences data refreshes on an interval
- range-driven analytics refresh for the active tab on an interval
- manual refresh remains available

This keeps the dashboard live without forcing a full browser reload.

## Preference Model

The global preference object should cover:

- `tabOrder`: ordered list of top-level tabs
- `ranges`:
  - `overview`
  - `accounts`
  - `tracing`
- `tracing`:
  - `cardOrder`
  - `graphsHidden`
  - `hiddenCards`
  - `topSessionsSort`
- `accounts`:
  - `sectionOrder`
  - optional hidden sections if needed by UI parity
- `overview`:
  - optional section order / hidden sections only if required by final UI

The model must be tolerant of unknown or missing values and always normalize to a full default structure.

## UI Behavior

### Top tabs

- Add a layout edit mode for the top navigation.
- Each tab gets `Earlier` / `Later` controls.
- Order persists globally.
- A reset action restores default tab order.

### Overview

- Add a persistent range selector.
- Metrics in this tab switch to trace-derived stats for the selected range.
- Keep provider quota averages separate and labeled as live provider data.

### Accounts

- Add a persistent range selector.
- Add account analytics panels based on trace history for the selected range.
- Add a way to reorder the account analytics sections.
- Keep account quota snapshot information separate from trace-derived usage charts.

Possible charts:
- requests by account
- tokens by account
- cost by account
- model split for selected account range

### Tracing

- Move tracing card layout persistence from browser-only storage to server preferences.
- Add a reset action that restores tracing defaults.
- Add a `Show graphs` toggle.
- When graphs are hidden, table/summary sections remain accessible.
- Add account-focused charts for requests/tokens/cost using the existing usage aggregate data.
- Add persistent reorder controls for `Usage by account`.
- Add a hide/show control for `Usage by route`.

## Reliability And Error Handling

### Preferences

- Invalid stored preferences must not break the UI.
- Server normalizes malformed values to defaults.
- Client treats preferences as eventually consistent and continues rendering while saving.

### Usage refresh

- If OpenAI quota refresh lacks `chatgptAccountId`, mark the snapshot as degraded rather than silently presenting it as authoritative.
- Continue to preserve fast-path proxy behavior; do not add request-path latency for dashboard preferences.
- Do not change routing retry semantics for timeout failures.

## Testing Strategy

### Backend

- Add store coverage for `dashboardPreferences` persistence and normalization.
- Add admin route tests for reading/updating preferences.
- Add focused tests for usage refresh behavior when `chatgptAccountId` is missing.

### Frontend

- Add targeted component tests where practical for:
  - preference-driven tab order
  - range selectors
  - tracing graph visibility
  - hidden section behavior

If the repo lacks frontend test coverage for these components, keep tests focused on backend normalization and use a production build as the verification step for the web UI.

### Manual verification

- change top-tab order, reload, confirm persistence
- change `Overview` / `Accounts` / `Tracing` ranges, reload, confirm persistence
- hide tracing graphs, reload, confirm persistence
- hide `Usage by route`, reload, confirm persistence
- reorder tracing/account sections, reload, confirm persistence
- confirm `Overview` and `Accounts` refresh without full page reload
- confirm degraded provider quota state is visible for accounts missing `chatgptAccountId`

## Risks

- Expanding the store schema must remain backward compatible with existing `accounts.json` files.
- Preferences and analytics refresh should not cause excessive admin API chatter.
- The UI copy must make the distinction between provider quota snapshots and trace-window analytics obvious.

## File Areas Likely To Change

- `src/types.ts`
- `src/store.ts`
- `src/routes/admin/index.ts`
- `src/quota.ts`
- `test/proxy-behavior.test.js`
- `web/src/App.tsx`
- `web/src/types.ts`
- `web/src/lib/api.ts`
- `web/src/components/tabs/OverviewTab.tsx`
- `web/src/components/tabs/AccountsTab.tsx`
- `web/src/components/tabs/TracingTab.tsx`
- `web/src/styles.css`
