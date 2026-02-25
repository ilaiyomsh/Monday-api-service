---
name: monday-api
description: Use this skill whenever writing code that interacts with the monday.com platform API — GraphQL queries, mutations, column value formatting, item CRUD, pagination, error handling, or building monday apps. Trigger for any mention of monday.com, monday API, board items, column values, monday SDK, monday-sdk-js, SeamlessApiClient, mondayApi, monday GraphQL, or when the user needs to create/read/update/delete items on a monday board. Also trigger when debugging monday API errors (complexity, rate limits, column format issues), or when the user references column types like status, people, date, timeline, dropdown, etc.
---

# Monday.com API — Complete Coding Reference

This skill contains everything needed to write correct monday.com API calls.
Use this as your single source of truth — do NOT guess column value formats.

## Table of Contents

1. [Setup & SDK](#1-setup--sdk)
2. [API Versioning](#2-api-versioning)
3. [GraphQL Basics](#3-graphql-basics)
4. [Items CRUD](#4-items-crud)
5. [Column Value Formats](#5-column-value-formats) ← CRITICAL — refer to this for every column write
6. [Pagination](#6-pagination)
7. [Board & Group Operations](#7-board--group-operations)
8. [Subitems](#8-subitems)
9. [Updates (Comments)](#9-updates-comments)
10. [Error Handling](#10-error-handling)
11. [Rate Limits & Complexity](#11-rate-limits--complexity)
12. [Using the Service Layer](#12-using-the-service-layer)
13. [Common Pitfalls](#13-common-pitfalls)
14. [Quick Recipe Index](#14-quick-recipe-index)

---

## 1. Setup & SDK

### Two SDKs — Know Which to Use

| Package | Purpose | Auth | Environment |
|---|---|---|---|
| `monday-sdk-js` | App framework: context, UI, storage, events | Auto (iframe) | Client-side monday apps |
| `@mondaydotcomorg/api` — `SeamlessApiClient` | GraphQL API calls | Auto (iframe) | Client-side monday apps |
| `@mondaydotcomorg/api` — `ApiClient` | GraphQL API calls | Token required | Server-side / external |

**Client-side app (inside monday iframe):**
```js
import mondaySdk from 'monday-sdk-js';
import { SeamlessApiClient } from '@mondaydotcomorg/api';

const monday = mondaySdk();
monday.setApiVersion('2026-01');

const apiClient = new SeamlessApiClient({ apiVersion: '2026-01' });
const response = await apiClient.request(query, variables);
```

**Server-side / external:**
```js
import { ApiClient } from '@mondaydotcomorg/api';

const apiClient = new ApiClient({
  token: process.env.MONDAY_API_TOKEN,
  apiVersion: '2026-01'
});
const response = await apiClient.request(query, variables);
```

> **IMPORTANT:** Server-side methods in `monday-sdk-js` are DEPRECATED and will be removed in v1.0.0. Use `@mondaydotcomorg/api` for all API calls.

---

## 2. API Versioning

**As of February 2026:**

| Version | Status |
|---|---|
| `2026-04` | Release Candidate (unstable) |
| `2026-01` | **Current** ← USE THIS |
| `2025-10` | Maintenance |
| `2025-04` | Maintenance (2024-10 and 2025-01 deprecated → rerouted to 2025-04) |

Always pass the version header:
```js
// With SeamlessApiClient
const apiClient = new SeamlessApiClient({ apiVersion: '2026-01' });

// With monday-sdk-js
monday.setApiVersion('2026-01');

// With raw fetch
headers: { 'API-Version': '2026-01' }
```

---

## 3. GraphQL Basics

All API calls are GraphQL. Two operations: **queries** (read) and **mutations** (write).

**Always use variables** — never inline values into the query string:
```js
// ✅ CORRECT
const query = `query ($ids: [ID!]) { boards(ids: $ids) { id name } }`;
const variables = { ids: ['1234567890'] };

// ❌ WRONG — never do this
const query = `query { boards(ids: 1234567890) { id name } }`;
```

**Variable types used by monday API:**
- `ID!` — IDs (board, item, user). Always pass as **String**, not Number.
- `[ID!]` — Array of IDs
- `String!` — Strings (column_id, group_id, item_name)
- `JSON!` — JSON-stringified values (column_values)
- `Int` — Integers (limit, page)
- `Boolean` — Booleans

> **CRITICAL:** All IDs must be passed as strings: `"1234567890"`, not `1234567890`

---

## 4. Items CRUD

### Read Items (with pagination)

```js
// First page
const query = `query ($ids: [ID!]) {
  boards(ids: $ids) {
    items_page(limit: 500) {
      cursor
      items {
        id
        name
        group { id title }
        column_values {
          id
          text
          value
          type
          column { id title }
        }
      }
    }
  }
}`;
const variables = { ids: [String(boardId)] };
```

### Read Items by Column Value (filter/search)

```js
const query = `query ($boardId: ID!, $columns: [ItemsPageByColumnValuesQuery!]) {
  items_page_by_column_values(board_id: $boardId, limit: 50, columns: $columns) {
    cursor
    items { id name column_values { id text value type } }
  }
}`;
const variables = {
  boardId: String(boardId),
  columns: [{ column_id: "status", column_values: ["Done"] }]
};
```

### Create Item

```js
const query = `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON, $groupId: String) {
  create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues, group_id: $groupId) {
    id
  }
}`;
const variables = {
  boardId: String(boardId),
  itemName: "New task",
  groupId: "topics",  // optional
  columnValues: JSON.stringify({
    status: { label: "Working on it" },
    date4: "2026-03-01",
    person: { personsAndTeams: [{ id: 12345, kind: "person" }] }
  })
};
```

> **NOTE:** When creating an item with column values, use `create_labels_if_missing: true` if the status/dropdown labels might not exist yet.

### Update Single Column Value

Two methods — choose based on column type:

**`change_simple_column_value`** — for text, numbers, status (by label string), date (string):
```js
const query = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
  change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
}`;
const variables = {
  boardId: String(boardId),
  itemId: String(itemId),
  columnId: "status",
  value: "Done"  // plain string, NOT JSON
};
```

**`change_column_value`** — for complex types that need JSON (people, email, phone, link, location, etc.):
```js
const query = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
  change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
}`;
const variables = {
  boardId: String(boardId),
  itemId: String(itemId),
  columnId: "person",
  value: JSON.stringify({ personsAndTeams: [{ id: 12345, kind: "person" }] })
};
```

### Update Multiple Columns at Once

```js
const query = `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
  change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
}`;
const variables = {
  boardId: String(boardId),
  itemId: String(itemId),
  columnValues: JSON.stringify({
    status: { label: "Done" },
    text0: "Updated text",
    date4: { date: "2026-03-01" },
    numbers5: "42"
  })
};
```

> You can mix string values and JSON values in `column_values`.

### Delete Item

```js
const query = `mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`;
const variables = { itemId: String(itemId) };
```

### Archive Item

```js
const query = `mutation ($itemId: ID!) { archive_item(item_id: $itemId) { id } }`;
const variables = { itemId: String(itemId) };
```

### Move Item to Group

```js
const query = `mutation ($itemId: ID!, $groupId: String!) {
  move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
}`;
const variables = { itemId: String(itemId), groupId: "new_group" };
```

---

## 5. Column Value Formats

### ⚠️ THIS IS THE MOST IMPORTANT SECTION ⚠️

Every column type has a specific JSON format. Getting this wrong is the #1 cause of API errors.

**Rules:**
1. `column_values` must be a **JSON-stringified** object: `JSON.stringify({ col_id: value })`
2. Keys are **column IDs** (e.g., `"status"`, `"date4"`, `"person"`) — NOT column titles
3. Some columns accept both string and JSON values; some accept ONLY JSON
4. To **clear** a column: send `{}` (empty object) for JSON columns, `""` for text/number

### Complete Column Format Reference

#### Status
```js
// By label name (recommended)
{ label: "Done" }
// By index number
{ index: 1 }
// Simple string (in change_simple_column_value or column_values mix)
"Done"
```

#### Text
```js
// Simple string
"Hello world"
```

#### Numbers
```js
// String representation of number
"42"
// Or just the number (in column_values JSON)
"42.5"
```

#### Date
```js
// Date only
{ date: "2026-03-01" }
// Date with time
{ date: "2026-03-01", time: "14:30:00" }
// Simple string (in change_simple_column_value)
"2026-03-01"
```

#### People
```js
// One person
{ personsAndTeams: [{ id: 12345, kind: "person" }] }
// Multiple people
{ personsAndTeams: [
  { id: 12345, kind: "person" },
  { id: 67890, kind: "person" }
] }
// Team
{ personsAndTeams: [{ id: 100, kind: "team" }] }
```

#### Dropdown
```js
// By labels (text)
{ labels: ["Option A", "Option B"] }
// By IDs
{ ids: ["1", "3"] }
```
> **Cannot mix labels and IDs in the same value.**

#### Email
```js
{ email: "user@example.com", text: "Display text" }
```

#### Phone
```js
{ phone: "+972501234567", countryShortName: "IL" }
```

#### Link / URL
```js
{ url: "https://example.com", text: "Example" }
```

#### Long Text
```js
{ text: "This is a long text\nWith line breaks" }
```

#### Checkbox
```js
{ checked: "true" }
// To uncheck
{ checked: "false" }
```

#### Rating
```js
{ rating: 4 }
```

#### Timeline
```js
{ from: "2026-01-01", to: "2026-03-31" }
```

#### Hour
```js
{ hour: 14, minute: 30 }
```

#### Location
```js
{ lat: 32.0853, lng: 34.7818, address: "Tel Aviv, Israel" }
```

#### Country
```js
{ countryCode: "IL", countryName: "Israel" }
```

#### Week
```js
{ startDate: "2026-03-02", endDate: "2026-03-08" }
```

#### World Clock (Timezone)
```js
{ timezone: "Asia/Jerusalem" }
```

#### Tags
```js
{ tag_ids: [123, 456] }
```

#### Connect Boards (Link to Item)
```js
{ linkedPulseIds: [{ linkedPulseId: 9876543210 }] }
// Multiple items
{ linkedPulseIds: [
  { linkedPulseId: 9876543210 },
  { linkedPulseId: 1234567890 }
] }
```

#### Dependency
```js
{ linkedPulseIds: [{ linkedPulseId: 9876543210 }] }
```

#### Color Picker
```js
{ color: "#FF5733" }
```

#### Files (Assets)
```js
// Files CANNOT be set via column_values.
// Use the add_file_to_column mutation instead.
// To clear: { clear_all: true }
```

#### Read-only columns (cannot write):
- Auto Number
- Formula
- Mirror
- Creation Log
- Last Updated
- Item ID
- Vote
- Button
- Progress Tracking

### Full create_item Example with Multiple Column Types

```js
const variables = {
  boardId: String(boardId),
  itemName: "Full example item",
  groupId: "topics",
  columnValues: JSON.stringify({
    // Status — by label
    status: { label: "Working on it" },
    // Date
    date4: { date: "2026-03-15", time: "09:00:00" },
    // Person
    person: { personsAndTeams: [{ id: 12345, kind: "person" }] },
    // Text
    text0: "Some text",
    // Number
    numbers5: "100",
    // Dropdown
    dropdown_mksr: { labels: ["Marketing", "Sales"] },
    // Email
    email: { email: "test@example.com", text: "Test" },
    // Link
    link_mkst: { url: "https://monday.com", text: "Monday" },
    // Checkbox
    checkbox: { checked: "true" },
    // Timeline
    timeline: { from: "2026-03-01", to: "2026-03-31" },
    // Long text
    long_text: { text: "Detailed description here" }
  })
};
```

---

## 6. Pagination

Monday.com uses **cursor-based pagination**. Max 500 items per page.

### First Page (inside boards query)
```js
const query = `query ($ids: [ID!]) {
  boards(ids: $ids) {
    items_page(limit: 500) {
      cursor
      items { id name column_values { id text value type } }
    }
  }
}`;
```

### Next Pages (root-level query — lower complexity)
```js
const query = `query ($cursor: String!) {
  next_items_page(cursor: $cursor, limit: 500) {
    cursor
    items { id name column_values { id text value type } }
  }
}`;
```

### Auto-Paginate Pattern
```js
async function getAllItems(boardId) {
  const allItems = [];

  // First page (inside boards)
  const firstQuery = `query ($ids: [ID!]) {
    boards(ids: $ids) {
      items_page(limit: 500) {
        cursor
        items { id name column_values { id text value type } }
      }
    }
  }`;
  const firstResult = await apiClient.request(firstQuery, { ids: [String(boardId)] });
  const firstPage = firstResult.data.boards[0].items_page;
  allItems.push(...firstPage.items);
  let cursor = firstPage.cursor;

  // Next pages (root level)
  while (cursor) {
    const nextQuery = `query ($cursor: String!) {
      next_items_page(cursor: $cursor, limit: 500) {
        cursor
        items { id name column_values { id text value type } }
      }
    }`;
    const nextResult = await apiClient.request(nextQuery, { cursor });
    const nextPage = nextResult.data.next_items_page;
    allItems.push(...nextPage.items);
    cursor = nextPage.cursor;
  }

  return allItems;
}
```

> **Cursors expire after 60 minutes.** Plan your pagination accordingly.

---

## 7. Board & Group Operations

### Get Board Structure
```js
const query = `query ($ids: [ID!]) {
  boards(ids: $ids) {
    id name description
    columns { id title type settings_str }
    groups { id title color position }
    owners { id name }
  }
}`;
```

> **TIP:** Always query the board structure first to discover column IDs and types before writing values.

### Create Group
```js
const query = `mutation ($boardId: ID!, $groupName: String!) {
  create_group(board_id: $boardId, group_name: $groupName) { id title }
}`;
```

### Delete Group
```js
const query = `mutation ($boardId: ID!, $groupId: String!) {
  delete_group(board_id: $boardId, group_id: $groupId) { id }
}`;
```

---

## 8. Subitems

### Create Subitem
```js
const query = `mutation ($parentItemId: ID!, $itemName: String!, $columnValues: JSON) {
  create_subitem(parent_item_id: $parentItemId, item_name: $itemName, column_values: $columnValues) {
    id
    name
    board { id }
  }
}`;
```

### Read Subitems of an Item
```js
const query = `query ($ids: [ID!]) {
  items(ids: $ids) {
    subitems {
      id
      name
      column_values { id text value type }
    }
  }
}`;
```

> **NOTE:** Subitems live on a separate board. The subitem's `board.id` is different from the parent's board ID.

---

## 9. Updates (Comments)

### Create Update
```js
const query = `mutation ($itemId: ID!, $body: String!) {
  create_update(item_id: $itemId, body: $body) {
    id body text_body created_at creator { id name }
  }
}`;
```

### Read Updates
```js
const query = `query ($ids: [ID!]) {
  items(ids: $ids) {
    updates(limit: 25) {
      id body text_body created_at creator { id name }
    }
  }
}`;
```

---

## 10. Error Handling

### Error Response Format (API version 2025-04+)

All errors return HTTP 200 with an `errors` array:
```json
{
  "data": null,
  "errors": [{
    "message": "User unauthorized to perform action",
    "locations": [{ "line": 2, "column": 3 }],
    "path": ["me"],
    "extensions": {
      "code": "UserUnauthorizedException",
      "error_data": {},
      "status_code": 403
    }
  }],
  "account_id": 123456
}
```

### Common Error Codes
| Code | Meaning | Retryable? |
|---|---|---|
| `COMPLEXITY_BUDGET_EXHAUSTED` | Too many complex queries | ✅ wait `retry_in_seconds` |
| `RATE_LIMIT_EXCEEDED` | Too many requests per minute | ✅ wait `Retry-After` header |
| `UserUnauthorizedException` | No permission | ❌ |
| `InvalidUserIdException` | Bad user ID | ❌ |
| `InvalidColumnIdException` | Column doesn't exist | ❌ |
| `InvalidItemIdException` | Item doesn't exist | ❌ |
| `ColumnValueException` | Wrong column value format | ❌ fix format |
| `CreateBoardException` | Board creation failed | ❌ |
| `ItemsLimitationException` | Board item limit reached | ❌ |
| `ConcurrencyLimitExceededException` | Too many concurrent requests | ✅ backoff |
| `InternalServerException` | Monday server error | ✅ retry |

### Partial Data

Queries can return **partial data** with errors. Always check both `data` and `errors`:
```js
const result = await apiClient.request(query, variables);
if (result.errors) {
  // Handle errors — but result.data might still have partial results
}
```

---

## 11. Rate Limits & Complexity

### Complexity Budget
- **10,000,000 complexity points per minute** per account
- Query `complexity { query before after reset_in_x_seconds }` to track usage
- `items_page` inside `boards` is expensive; `next_items_page` at root is cheaper

### Request Rate Limits
- **5,000 requests per 10 seconds** per IP
- HTTP 429 response with `Retry-After` header

### Tips to Reduce Complexity
1. Use `next_items_page` for pagination (not nested `items_page`)
2. Request only the fields you need
3. Use `column_ids` argument to limit returned columns:
   ```js
   column_values(ids: ["status", "date4", "person"]) { id text value }
   ```
4. Batch multiple simple operations into one request using aliases:
   ```graphql
   mutation {
     item1: create_item(board_id: "123", item_name: "A") { id }
     item2: create_item(board_id: "123", item_name: "B") { id }
   }
   ```

---

## 12. Using the Service Layer

If the project includes our `monday-services` package, use it instead of raw API calls:

### Service Files
| File | Purpose |
|---|---|
| `mondayApi.js` | Unified API — init, CRUD methods, UI helpers, storage |
| `errorHandler.js` | Error classification, retry logic, failure tracking |
| `logger.js` | Leveled logging, Supabase error reporting |
| `ErrorBanner.jsx` | React component for two-step error UX |
| `index.js` | Barrel exports |

### Initialization
```js
import { mondayApi } from './services';

await mondayApi.init({
  language: 'he',  // 'he' or 'en' for error messages
  supabase: {      // optional — for error reporting
    url: 'https://xxx.supabase.co',
    anonKey: 'eyJ...'
  }
});
```

### Available Methods
```js
// Context
mondayApi.boardId    // current board ID
mondayApi.user       // { id, name, ... }
mondayApi.context    // full context object
mondayApi.theme      // "light" | "dark"

// Raw query (with auto-retry)
await mondayApi.query(graphqlString, variables, { operation: 'myOp' });

// Items
await mondayApi.getItems(boardId, { limit, cursor, fields });
await mondayApi.getAllItems(boardId, { fields });   // auto-paginate all
await mondayApi.createItem(boardId, itemName, { groupId, columnValues });
await mondayApi.updateColumnValue(boardId, itemId, columnId, value);
await mondayApi.updateSimpleColumnValue(boardId, itemId, columnId, value);
await mondayApi.updateMultipleColumnValues(boardId, itemId, columnValues);
await mondayApi.deleteItem(itemId);
await mondayApi.createSubitem(parentItemId, itemName, { columnValues });

// Board
await mondayApi.getBoard(boardId);

// UI
mondayApi.notice(message, type);      // "success" | "error" | "info"
mondayApi.confirm(message, options);

// Storage (per-app key/value)
await mondayApi.storageGet(key);
await mondayApi.storageSet(key, value);

// Listeners
mondayApi.onSettingsChange(callback);
mondayApi.onContextChange(callback);
```

### Error Flow in Components
```jsx
import { mondayApi, ErrorBanner, useErrorHandler } from './services';

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

The `ErrorBanner` handles:
1. **First failure:** Shows "משהו השתבש" + retry button
2. **Second failure (same operation):** Shows + "שלח פרטי תקלה" button
3. **User clicks "send details":** Sends last 20 error log entries to Supabase

---

## 13. Common Pitfalls

### ❌ Pitfall 1: IDs as Numbers
```js
// ❌ WRONG
variables = { ids: [1234567890] };
// ✅ CORRECT
variables = { ids: ["1234567890"] };
```

### ❌ Pitfall 2: column_values not stringified
```js
// ❌ WRONG — passing object directly
column_values: { status: { label: "Done" } }
// ✅ CORRECT — must be JSON string
column_values: JSON.stringify({ status: { label: "Done" } })
```

### ❌ Pitfall 3: Using column TITLE instead of column ID
```js
// ❌ WRONG — "Status" is the title
{ "Status": { label: "Done" } }
// ✅ CORRECT — "status" or "status_1" is the ID
{ "status": { label: "Done" } }
```
> Query the board structure first to get the correct column IDs.

### ❌ Pitfall 4: Wrong People format
```js
// ❌ WRONG
{ person: 12345 }
{ person: { id: 12345 } }
// ✅ CORRECT
{ person: { personsAndTeams: [{ id: 12345, kind: "person" }] } }
```

### ❌ Pitfall 5: Checkbox value type
```js
// ❌ WRONG — boolean
{ checked: true }
// ✅ CORRECT — string
{ checked: "true" }
```

### ❌ Pitfall 6: Forgetting JSON.stringify in variables
```js
// ❌ WRONG
variables = { columnValues: { status: "Done" } };
// ✅ CORRECT
variables = { columnValues: JSON.stringify({ status: "Done" }) };
```

### ❌ Pitfall 7: Inline JSON in GraphQL string
```js
// ❌ WRONG — trying to inline JSON in query string
`mutation { create_item(board_id: "123", column_values: "{\\"status\\":\\"Done\\"}") { id } }`
// ✅ CORRECT — use variables
`mutation ($boardId: ID!, $columnValues: JSON) {
  create_item(board_id: $boardId, column_values: $columnValues) { id }
}`
// with variables: { boardId: "123", columnValues: JSON.stringify({ status: "Done" }) }
```

### ❌ Pitfall 8: Mixing dropdown labels and IDs
```js
// ❌ WRONG — can't mix
{ labels: ["Option A"], ids: ["3"] }
// ✅ CORRECT — use one or the other
{ labels: ["Option A", "Option B"] }
// OR
{ ids: ["1", "3"] }
```

### ❌ Pitfall 9: Not handling cursor=null
```js
// Always check if cursor is null/undefined before next page
while (cursor) { /* fetch next page */ }
// cursor === null means you've reached the last page
```

### ❌ Pitfall 10: Querying items without board context
```js
// items(ids: [...]) can only fetch up to 100 items at a time
// For bulk reads, always use items_page via boards query
```

---

## 14. Quick Recipe Index

### "I need to get all items from a board"
→ Section 6 (Pagination) — use `items_page` + `next_items_page` loop

### "I need to create an item with column values"
→ Section 4 (Create Item) + Section 5 (Column Value Formats)

### "I need to update a status column"
→ `change_simple_column_value` with plain string `"Done"`, OR `change_column_value` with `JSON.stringify({ label: "Done" })`

### "I need to assign a person to an item"
→ Section 5 → People: `{ personsAndTeams: [{ id: userId, kind: "person" }] }`

### "I need to find items with a specific column value"
→ Section 4 → `items_page_by_column_values`

### "I need to know which columns exist on a board"
→ Section 7 → `boards(ids: [...]) { columns { id title type settings_str } }`

### "I'm getting ColumnValueException"
→ Section 5 — check the exact format for that column type. Section 13 for common pitfalls.

### "I'm getting rate limited"
→ Section 11 — check complexity, use `next_items_page`, request fewer fields

### "I need to work with subitems"
→ Section 8 — note: subitems are on a separate board

### "I need to batch multiple operations"
→ Section 11 → use GraphQL aliases for multiple mutations in one request

---

## Appendix: Column Type ↔ API Type Mapping

| Column Type | `type` field value | Writable? | JSON Format |
|---|---|---|---|
| Auto Number | `auto_number` | ❌ | — |
| Button | `button` | ❌ | — |
| Checkbox | `checkbox` | ✅ | `{ checked: "true" }` |
| Color Picker | `color_picker` | ✅ | `{ color: "#HEX" }` |
| Connect Boards | `board_relation` | ✅ | `{ linkedPulseIds: [{linkedPulseId: ID}] }` |
| Country | `country` | ✅ | `{ countryCode: "XX", countryName: "..." }` |
| Creation Log | `creation_log` | ❌ | — |
| Date | `date` | ✅ | `{ date: "YYYY-MM-DD" }` or `{ date: "...", time: "HH:MM:SS" }` |
| Dependency | `dependency` | ✅ | `{ linkedPulseIds: [{linkedPulseId: ID}] }` |
| Dropdown | `dropdown` | ✅ | `{ labels: [...] }` or `{ ids: [...] }` |
| Email | `email` | ✅ | `{ email: "...", text: "..." }` |
| Files | `file` | ⚠️ | Use `add_file_to_column` mutation. Clear: `{ clear_all: true }` |
| Formula | `formula` | ❌ | — |
| Hour | `hour` | ✅ | `{ hour: N, minute: N }` |
| Item ID | `item_id` | ❌ | — |
| Last Updated | `last_updated` | ❌ | — |
| Link | `link` | ✅ | `{ url: "...", text: "..." }` |
| Location | `location` | ✅ | `{ lat: N, lng: N, address: "..." }` |
| Long Text | `long_text` | ✅ | `{ text: "..." }` |
| Mirror | `mirror` | ❌ | — |
| Name | `name` | ✅ | Set via `item_name` argument, not column_values |
| Numbers | `numbers` | ✅ | `"42"` (string) |
| People | `people` | ✅ | `{ personsAndTeams: [{id: N, kind: "person"\|"team"}] }` |
| Phone | `phone` | ✅ | `{ phone: "+...", countryShortName: "XX" }` |
| Progress Tracking | `progress` | ❌ | — |
| Rating | `rating` | ✅ | `{ rating: N }` (1-5) |
| Status | `status` | ✅ | `{ label: "..." }` or `{ index: N }` or `"label"` |
| Tags | `tags` | ✅ | `{ tag_ids: [N, N] }` |
| Text | `text` | ✅ | `"plain string"` |
| Timeline | `timeline` | ✅ | `{ from: "YYYY-MM-DD", to: "YYYY-MM-DD" }` |
| Time Tracking | `time_tracking` | ⚠️ | Read-only in most contexts |
| Vote | `vote` | ❌ | — |
| Week | `week` | ✅ | `{ startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }` |
| World Clock | `world_clock` | ✅ | `{ timezone: "Area/City" }` |

---

*Last updated: February 2026 | API version: 2026-01*
