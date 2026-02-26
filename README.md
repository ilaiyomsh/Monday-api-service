# monday-app-services

A standardized service layer for building **monday.com client-side apps** — with unified API client, smart error handling, Hebrew-first UX, and an AI coding skill for Claude Code.

## What's Inside

```
monday-app-services/
├── src/                        # Service layer (copy into your app)
│   ├── mondayApi.js            # Unified API client (monday-sdk-js only)
│   ├── errorHandler.js         # Error classification + retry + auto-report
│   ├── logger.js               # Leveled logging + breadcrumbs + Supabase
│   ├── ErrorBanner.jsx         # React error UX component (HE/EN)
│   └── index.js                # Barrel exports
├── skill/                      # Claude Code / AI coding skill
│   └── SKILL.md                # Complete monday API reference for LLMs
├── docs/                       # Research & architecture
│   ├── monday-sdk-client-side-research.md
│   └── package-architecture.jsx
├── supabase-setup.sql          # DB schema for error reporting (fresh install)
├── supabase-migration.sql      # Migration for existing installs
└── README.md
```

## Quick Start

### 1. Install

```bash
npm install monday-app-services monday-sdk-js
```

### 2. Initialize

```js
import { mondayApi } from 'monday-app-services';

await mondayApi.init({
  language: 'he',            // 'he' or 'en'
  apiVersion: '2026-01',     // optional, default '2026-01'
  appVersion: '1.2.3',       // optional — tracks which version errors occur in
  environment: 'production', // 'development' | 'staging' | 'production'
  supabase: {                // optional — enables error reporting
    url: 'https://your-project.supabase.co',
    anonKey: 'eyJ...'
  },
  autoReport: {              // optional — auto-report errors (enabled by default with Supabase)
    enabled: true,
    maxPerSession: 10,
  },
});
```

### 3. Use

```js
// Get board structure
const board = await mondayApi.getBoard(boardId);

// Create item with column values
await mondayApi.createItem(boardId, 'New Task', {
  status: { label: 'Working on it' },
  date4: { date: '2026-03-15' },
  person: { personsAndTeams: [{ id: 12345, kind: 'person' }] }
}, { groupId: 'topics' });

// Update multiple columns
await mondayApi.updateMultipleColumnValues(boardId, itemId, {
  status: { label: 'Done' },
  numbers5: '100'
});

// Auto-paginate all items
const allItems = await mondayApi.getAllItems(boardId);

// Load users and teams
const { users, teams } = await mondayApi.getUsersAndTeams();

// Batch load items by IDs (with concurrency control)
const items = await mondayApi.loadItemsByIds(itemIds, {
  batchSize: 100,
  maxConcurrent: 3,
  columnIds: ['status', 'person'],
});
```

### 4. Error UX (React)

```jsx
import { mondayApi, ErrorBanner, useErrorHandler } from 'monday-app-services';

function MyComponent() {
  const { error, handleError, clearError, retry } = useErrorHandler();

  async function loadData() {
    try {
      clearError();
      const items = await mondayApi.getItems(boardId);
      setItems(items);
    } catch (err) {
      handleError(err, { operation: 'loadData', retryFn: loadData });
    }
  }

  return (
    <>
      <ErrorBanner error={error} onRetry={retry} onDismiss={clearError} />
      {/* your UI */}
    </>
  );
}
```

**Error flow (hybrid privacy model):**
1. API call fails → auto-retry with backoff
2. Retries exhausted → **auto-report** (anonymized) sent to Supabase `error_events` table (no PII)
3. ErrorBanner shows "Something went wrong" + retry button + "Error details sent automatically"
4. Second failure → + "Send additional details" button
5. User clicks send → **full report** to `error_logs` with PII, linked by fingerprint

The auto-report contains only: fingerprint, error_code, operation, app_version, environment, breadcrumbs (API ops only). No userId, accountId, boardId, or raw error details.

## Service Layer Overview

### `mondayApi.js`

Unified client using `monday-sdk-js` exclusively. Uses `monday.api()` for GraphQL (no token needed inside iframe), plus context, UI, storage, and event listeners.

All methods auto-retry on rate limits, and errors bubble up to components for the two-step UX.

| Method | Description |
|---|---|
| `init(options)` | Initialize SDK, fetch context |
| `query(query, vars, opts)` | Raw GraphQL with auto-retry |
| `getItems(boardId, opts)` | Paginated items |
| `getAllItems(boardId, opts)` | Auto-paginate everything |
| `createItem(boardId, name, cols, opts)` | Create with column values |
| `updateColumnValue(...)` | JSON column update |
| `updateSimpleColumnValue(...)` | String column update |
| `updateMultipleColumnValues(...)` | Batch column update |
| `deleteItem(itemId)` | Delete |
| `createSubitem(parentId, name, cols)` | Subitem |
| `getBoard(boardId)` | Board metadata + columns + groups |
| `getUsers(opts)` | Account users |
| `getTeams()` | Account teams (requires `teams:read`) |
| `getUsersAndTeams(opts)` | Both in parallel (teams failure doesn't block) |
| `loadItemsByIds(ids, opts)` | Batch load with concurrency control |
| `notice(msg, type)` | Monday UI notification |
| `confirm(msg, confirm, cancel)` | Confirmation dialog |
| `storageGet/Set(key, value)` | App-level storage |

### `errorHandler.js`

- 40+ monday API error codes classified into categories: `rate_limit`, `auth`, `validation`, `server`, `network`
- Handles two error shapes: GraphQL errors in response + SDK-thrown plain Errors
- Per-operation failure counter for progressive disclosure
- `withRetry(fn, opts)` — exponential backoff + jitter, respects `Retry-After`
- **Error fingerprinting** — stable hash of `operation + code + normalized message` for dedup and grouping
- **Auto-report** — sends anonymized error events to Supabase when retries are exhausted (session dedup, configurable cap)
- Hebrew + English user-facing messages
- `TIMEOUT` error code for SDK timeout errors

### `logger.js`

- Leveled logging: `debug`, `info`, `warn`, `error`
- In-memory history (max 200 entries)
- **Breadcrumbs** — ring buffer of last 30 events (API calls, user actions, navigation) for debugging context
  - Auto-captured on `apiRequest()`, `apiResponse()`, `apiError()`
  - Manual: `logger.addBreadcrumb(category, message, data)`
  - `logger.getBreadcrumbs()` / `logger.getAnonymizedBreadcrumbs()`
- `alwaysLogErrors` option (default `true`) — error-level messages always print to console even when log level is higher
- `sendErrorReport()` — user-triggered full report with breadcrumbs and fingerprint
- `sendAnonymousEvent()` — auto-triggered anonymous event (no PII)
- **Context enrichment** — appVersion, environment, sessionId, userAgent

### `ErrorBanner.jsx`

- `useErrorHandler()` React hook
- Inline-styled component (Figtree font, monday colors)
- Full RTL Hebrew support
- Four visual states: error → error+auto-reported → error+send → sent confirmation
- Shows "Error details sent automatically" when auto-report fired
- "Send additional details" button (upgrades anonymous event to full report)

## AI Skill (`skill/SKILL.md`)

A comprehensive reference file for **Claude Code** (or any LLM coding assistant) to write correct monday API calls without guessing.

### What It Covers

- Setup with `monday-sdk-js` (using `monday.api()`)
- API versioning (current: `2026-01`)
- **Column value JSON format for every column type** — status, people, date, dropdown, timeline, email, phone, location, connect boards, checkbox, etc.
- Complete CRUD examples with proper variables
- Cursor-based pagination patterns
- Error codes and handling
- Rate limits and complexity optimization
- Integration with this service layer
- 13 common pitfalls with examples

### Installation

**Claude Code:**
```bash
cp -r node_modules/monday-app-services/skill/ ~/.claude/skills/monday-api/
```

**Or add to your project's `.claude/skills/` directory.**

## Supabase Setup (Optional)

If you want error reporting, run the SQL in `supabase-setup.sql`:

```bash
# In Supabase SQL editor, run:
cat supabase-setup.sql
```

**Fresh install** — `supabase-setup.sql` creates:
- `error_events` table (anonymous auto-reports, no PII)
- `error_logs` table (user-triggered reports with full context)
- Aggregation views: `error_issues`, `error_trend_hourly`, `error_by_account`
- RLS: anyone can INSERT (anon key), only your UUID can SELECT
- Immutable logs (no UPDATE/DELETE)

**Existing install** — `supabase-migration.sql` adds:
- New `error_events` table
- New columns to `error_logs`: `fingerprint`, `app_version`, `environment`, `breadcrumbs`, `report_type`
- All aggregation views

## API Version

Built for **monday.com API version `2026-01`** (current stable as of February 2026).

| Version | Status |
|---|---|
| `2026-04` | Release Candidate |
| `2026-01` | **Current** |
| `2025-10` | Maintenance |
| `2025-04` | Maintenance |

## Requirements

- `monday-sdk-js` >= 0.5.7
- React 17+ (for ErrorBanner)
- App must run **inside monday.com iframe** (for `monday.api()` to work without a token)

## License

MIT
