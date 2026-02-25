# monday-app-services

A standardized service layer for building **monday.com client-side apps** — with unified API client, smart error handling, Hebrew-first UX, and an AI coding skill for Claude Code.

## What's Inside

```
monday-app-services/
├── src/                        # Service layer (copy into your app)
│   ├── mondayApi.js            # Unified API client (both SDKs)
│   ├── errorHandler.js         # Error classification + retry logic
│   ├── logger.js               # Leveled logging + Supabase reporting
│   ├── ErrorBanner.jsx         # React error UX component (HE/EN)
│   └── index.js                # Barrel exports
├── skill/                      # Claude Code / AI coding skill
│   └── SKILL.md                # Complete monday API reference for LLMs
├── docs/                       # Research & architecture
│   ├── monday-sdk-client-side-research.md
│   └── package-architecture.jsx
├── supabase-setup.sql          # DB schema for error reporting
└── README.md
```

## Quick Start

### 1. Install Dependencies

```bash
npm install monday-sdk-js @mondaydotcomorg/api
```

### 2. Copy `src/` Into Your Project

```bash
cp -r src/ your-app/src/services/monday/
```

### 3. Initialize

```js
import { mondayApi } from './services/monday';

await mondayApi.init({
  language: 'he',  // 'he' or 'en'
  supabase: {      // optional — enables error reporting
    url: 'https://your-project.supabase.co',
    anonKey: 'eyJ...'
  }
});
```

### 4. Use

```js
// Get board structure
const board = await mondayApi.getBoard(boardId);

// Create item with column values
await mondayApi.createItem(boardId, 'New Task', {
  groupId: 'topics',
  columnValues: {
    status: { label: 'Working on it' },
    date4: { date: '2026-03-15' },
    person: { personsAndTeams: [{ id: 12345, kind: 'person' }] }
  }
});

// Update multiple columns
await mondayApi.updateMultipleColumnValues(boardId, itemId, {
  status: { label: 'Done' },
  numbers5: '100'
});

// Auto-paginate all items
const allItems = await mondayApi.getAllItems(boardId);
```

### 5. Error UX (React)

```jsx
import { mondayApi, ErrorBanner, useErrorHandler } from './services/monday';

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

**Error flow:**
1. First failure → ⚠️ "משהו השתבש" + retry button
2. Second failure (same operation) → + "שלח פרטי תקלה" button
3. User clicks send → last 20 error entries sent to Supabase with shared `report_id`

## Service Layer Overview

### `mondayApi.js`

Unified client wrapping both monday SDKs:
- **monday-sdk-js** — context, UI, storage, event listeners
- **@mondaydotcomorg/api** — `SeamlessApiClient` for GraphQL (no token needed inside iframe)

All methods auto-retry on rate limits, and errors bubble up to components for the two-step UX.

| Method | Description |
|---|---|
| `init(options)` | Initialize both SDKs, fetch context |
| `query(query, vars, opts)` | Raw GraphQL with auto-retry |
| `getItems(boardId, opts)` | Paginated items |
| `getAllItems(boardId, opts)` | Auto-paginate everything |
| `createItem(boardId, name, opts)` | Create with column values |
| `updateColumnValue(...)` | JSON column update |
| `updateSimpleColumnValue(...)` | String column update |
| `updateMultipleColumnValues(...)` | Batch column update |
| `deleteItem(itemId)` | Delete |
| `createSubitem(parentId, name, opts)` | Subitem |
| `getBoard(boardId)` | Board metadata + columns + groups |
| `notice(msg, type)` | Monday UI notification |
| `storageGet/Set(key, value)` | App-level storage |

### `errorHandler.js`

- 40+ monday API error codes classified into categories: `rate_limit`, `auth`, `validation`, `server`, `network`
- Per-operation failure counter for progressive disclosure
- `withRetry(fn, opts)` — exponential backoff + jitter, respects `Retry-After`
- Hebrew + English user-facing messages

### `logger.js`

- Leveled logging: `debug`, `info`, `warn`, `error`
- In-memory history (max 200 entries)
- **Never auto-sends** to Supabase — only when user clicks "שלח פרטי תקלה"
- `sendErrorReport()` — batches last N entries with unique `report_id`

### `ErrorBanner.jsx`

- `useErrorHandler()` React hook
- Inline-styled component (Figtree font, monday colors)
- Full RTL Hebrew support
- Three visual states: error → error+send → sent confirmation

## AI Skill (`skill/SKILL.md`)

A comprehensive reference file for **Claude Code** (or any LLM coding assistant) to write correct monday API calls without guessing.

### What It Covers

- Setup & SDK selection (SeamlessApiClient vs ApiClient)
- API versioning (current: `2026-01`)
- **Column value JSON format for every column type** — status, people, date, dropdown, timeline, email, phone, location, connect boards, checkbox, etc.
- Complete CRUD examples with proper variables
- Cursor-based pagination patterns
- Error codes and handling
- Rate limits and complexity optimization
- Integration with this service layer
- 13 common pitfalls with ❌/✅ examples

### Installation

**Claude Code:**
```bash
cp -r skill/ ~/.claude/skills/monday-api/
```

**Or add to your project's `.claude/skills/` directory.**

## Supabase Setup (Optional)

If you want error reporting, run the SQL in `supabase-setup.sql`:

```bash
# In Supabase SQL editor, run:
cat supabase-setup.sql
```

Creates the `error_logs` table with:
- RLS: anyone can INSERT (anon key), only your UUID can SELECT
- Indexes on `timestamp`, `account_id`, `report_id`, `error_code`
- Immutable logs (no UPDATE/DELETE)

## API Version

Built for **monday.com API version `2026-01`** (current stable as of February 2026).

| Version | Status |
|---|---|
| `2026-04` | Release Candidate |
| `2026-01` | **Current** ← used here |
| `2025-10` | Maintenance |
| `2025-04` | Maintenance |

## Requirements

- `monday-sdk-js` ≥ 0.5.7
- `@mondaydotcomorg/api` ≥ 13.0.0
- React 17+ (for ErrorBanner)
- App must run **inside monday.com iframe** (for SeamlessApiClient)

## License

MIT
