# Monday.com Client-Side SDK Research — February 2026

## Executive Summary

There are now **two distinct SDKs** for Monday.com app development, and this distinction is critical. The ecosystem is in transition — the older `monday-sdk-js` package is becoming **client-side only** (server methods deprecated), while the newer `@mondaydotcomorg/api` package is the recommended path for API operations, supporting both server-side (`ApiClient`) and client-side (`SeamlessApiClient`) usage.

---

## 1. The Two SDKs — Understanding the Split

### SDK #1: `monday-sdk-js` (v0.5.7) — The App Framework SDK
- **npm**: `npm i monday-sdk-js`
- **GitHub**: [mondaycom/monday-sdk-js](https://github.com/mondaycom/monday-sdk-js)
- **Purpose**: Client-side app framework — UI interaction, context, storage, event listening
- **Key methods**: `monday.api()`, `monday.get()`, `monday.listen()`, `monday.execute()`, `monday.storage`, `monday.set()`
- **⚠️ DEPRECATION**: Server-side usage of this SDK is deprecated and will be removed in v1.0.0

### SDK #2: `@mondaydotcomorg/api` (v13.0.0) — The API SDK
- **npm**: `npm i @mondaydotcomorg/api`
- **GitHub**: [mondaycom/monday-graphql-api](https://github.com/mondaycom/monday-graphql-api)
- **Purpose**: Typed GraphQL API client with pre-built operations for CRUD
- **Key classes**: `ApiClient` (server, requires token), `SeamlessApiClient` (client-side, no token needed)
- **✅ RECOMMENDED** for all new API operations (create, update, delete)

### When to use which?

| Need | Use |
|------|-----|
| Get board context, theme, user info | `monday-sdk-js` → `monday.get("context")` |
| Listen to events/settings changes | `monday-sdk-js` → `monday.listen()` |
| Client-side key-value storage | `monday-sdk-js` → `monday.storage` |
| Open dialogs, notices, confirmations | `monday-sdk-js` → `monday.execute()` |
| Create/update/delete items (client-side) | `@mondaydotcomorg/api` → `SeamlessApiClient` |
| Create/update/delete items (server-side) | `@mondaydotcomorg/api` → `ApiClient` |
| Raw GraphQL from client-side iframe | Either works, but `SeamlessApiClient` gives types |

---

## 2. Client-Side Setup — The Right Way

### Installation

```bash
npm i monday-sdk-js @mondaydotcomorg/api
```

### Initializing the App Framework SDK (for context, UI, storage)

```javascript
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

// No token needed on client-side — seamless auth handles it
// The iframe session authenticates automatically

// Get app context
const context = await monday.get("context");
console.log(context.data);
// Returns: { boardId, boardIds, user: { id, isAdmin, ... }, theme, ... }
```

### Initializing the API SDK for Client-Side CRUD

```javascript
import { SeamlessApiClient } from "@mondaydotcomorg/api";

// No token needed — authentication is handled by the iframe session
const client = new SeamlessApiClient();
```

### Critical Auth Rules for Client-Side

1. **Never hardcode API tokens in client-side code** — they will be exposed to users
2. **Seamless auth only works inside a monday.com iframe** — it won't work in standalone apps or local dev outside the tunnel
3. **Permissions are scoped** to the logged-in user's access AND the app's configured OAuth scopes
4. **Seamless auth does NOT support file uploads** — use OAuth tokens on the server for that
5. **Seamless auth does NOT work from server-side** — use `ApiClient` with OAuth token there

---

## 3. API Operations — Create, Update, Delete

### Using `SeamlessApiClient` (Recommended for Client-Side)

#### Create an Item

```javascript
import { SeamlessApiClient } from "@mondaydotcomorg/api";

const client = new SeamlessApiClient();

// Using pre-built operations
const newItem = await client.operations.createItemOp({
  boardId: "your_board_id",
  itemName: "New Task",
  groupId: "your_group_id",
  columnValues: JSON.stringify({
    status: { label: "Working on it" },
    date4: { date: "2026-03-01" },
    text: "Some description"
  })
});
```

#### Update Column Values

```javascript
// Change a text column
const result = await client.operations.changeColumnValueOp({
  boardId: "your_board_id",
  itemId: "your_item_id",
  columnId: "text",
  value: JSON.stringify("Updated text value"),
});

// Change a status column
await client.operations.changeColumnValueOp({
  boardId: "your_board_id",
  itemId: "your_item_id",
  columnId: "project_status",
  value: JSON.stringify({ label: "Done" }),
});
```

#### Delete an Item

```javascript
// Raw GraphQL via SeamlessApiClient
const result = await client.request(`
  mutation {
    delete_item(item_id: 123456789) {
      id
    }
  }
`);
```

#### Freestyle GraphQL Queries (with types)

```javascript
import { SeamlessApiClient, Board } from "@mondaydotcomorg/api";

const client = new SeamlessApiClient();

const { boards } = await client.request<{ boards: Board[] }>(`
  query {
    boards(ids: [12345]) {
      id
      name
      items_page(limit: 25) {
        items {
          id
          name
          column_values {
            id
            text
            value
          }
        }
      }
    }
  }
`);
```

### Using `monday.api()` (Legacy / Simple Alternative)

The older `monday.api()` method from `monday-sdk-js` still works for client-side queries:

```javascript
import mondaySdk from "monday-sdk-js";
const monday = mondaySdk();

// Simple query
const res = await monday.api(`query { users { id name } }`);

// With variables
const res = await monday.api(
  `mutation ($boardId: ID!, $itemName: String!) {
    create_item(board_id: $boardId, item_name: $itemName) { id }
  }`,
  {
    variables: { boardId: "12345", itemName: "New Item" },
    apiVersion: "2026-01"  // Always specify!
  }
);
```

---

## 4. API Versioning — Critical for Feb 2026

### Current Version Lifecycle (as of Feb 24, 2026)

| Version | Status | Notes |
|---------|--------|-------|
| `2025-10` | **Maintenance** | Will be deprecated — migrate away |
| `2026-01` | **Current** ✅ | Use this for production |
| `2026-04` | **Release Candidate** | Preview, may have breaking changes |

### ⚠️ Breaking Change Alert (Feb 15, 2026)

Versions `2024-10` and `2025-01` were **officially deprecated on February 15, 2026**. All API calls to those versions are now automatically routed to `2025-04`, which may cause unexpected behavior. 

### Always Specify the API Version

```javascript
// With monday-sdk-js
monday.api('query { boards { id } }', {
  apiVersion: '2026-01'  // Always pin your version!
});

// With raw fetch
fetch("https://api.monday.com/v2", {
  method: 'post',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'YOUR_TOKEN',
    'API-Version': '2026-01'
  },
  body: JSON.stringify({ query: '...' })
});
```

### Key Breaking Changes from 2025-04 Migration

- Errors now follow a **consistent GraphQL-compliant format** with `errors[]` array
- HTTP status `200` for app-level errors; `429` for rate limits; `400` for bad requests
- Partial data is returned — queries may return some fields + errors simultaneously
- Handle `null` values for `subitems` to prevent client errors

---

## 5. Error Handling — Complete Guide

### Error Response Structure

```json
{
  "data": { ... },
  "errors": [
    {
      "message": "Human-readable error description",
      "locations": [{ "line": 2, "column": 3 }],
      "path": ["fieldName"],
      "extensions": {
        "code": "ERROR_CODE",
        "error_data": {},
        "status_code": 403
      }
    }
  ],
  "account_id": 123456
}
```

### Error Handling with `SeamlessApiClient`

```javascript
import { SeamlessApiClient } from "@mondaydotcomorg/api";

const client = new SeamlessApiClient();

try {
  const data = await client.request(`
    query { boards(ids: [12345]) { id name } }
  `);
  // Success — use data
} catch (error) {
  // SeamlessApiClientError type
  if (error.response?.errors) {
    for (const err of error.response.errors) {
      const code = err.extensions?.code;
      
      switch (code) {
        case "UserUnauthorizedException":
          // User doesn't have permission — show appropriate UI
          break;
        case "COMPLEXITY_BUDGET_EXHAUSTED":
          // Rate limited — wait and retry
          break;
        case "ResourceNotFoundException":
          // Board/item doesn't exist
          break;
        default:
          console.error("API Error:", err.message);
      }
    }
  }
}
```

### Error Handling with `monday.api()`

```javascript
try {
  const res = await monday.api(`query { boards(ids: [12345]) { id } }`, {
    apiVersion: "2026-01"
  });
  
  // Check for partial errors (200 status with errors array)
  if (res.errors) {
    console.warn("Partial errors:", res.errors);
  }
  
  // Use res.data
} catch (error) {
  // Unhandled GraphQL errors reject the promise
  console.error("API call failed:", error);
}
```

### Error Handling with `ApiClient` (errorPolicy option)

```javascript
import { ApiClient } from "@mondaydotcomorg/api";

// Option 1: Throw on errors (default — errorPolicy: 'none')
const client = new ApiClient({ token: '<TOKEN>' });

// Option 2: Ignore errors, resolve with partial data
const client = new ApiClient({
  token: '<TOKEN>',
  requestConfig: { errorPolicy: 'ignore' }
});

// Option 3: Return both errors and data
const client = new ApiClient({
  token: '<TOKEN>',
  requestConfig: { errorPolicy: 'all' }
});
```

### Common Error Codes Reference

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `UserUnauthorizedException` | 403 | No permission | Check user/app scopes |
| `COMPLEXITY_BUDGET_EXHAUSTED` | 429 | Rate limited (complexity) | Wait `retry_in_seconds`, use pagination |
| `Rate Limit Exceeded` | 429 | >5,000 req/min | Throttle requests |
| `maxConcurrencyExceeded` | 429 | Too many concurrent | Queue requests |
| `IP_RATE_LIMIT_EXCEEDED` | 429 | >5,000 req/10sec from IP | Throttle |
| `ColumnValueException` | 200 | Bad column value format | Check column type JSON format |
| `InvalidArgumentException` | 200 | Bad argument/pagination | Verify IDs and params |
| `ResourceNotFoundException` | 404/200 | ID not found | Verify board/item exists |
| `Parse error on...` | 200 | Malformed GraphQL | Check query syntax |
| `Internal Server Error` | 500 | Server issue | Retry after delay |

---

## 6. Rate Limits — What Client-Side Apps Need to Know

### Limits Summary

| Limit Type | Threshold | Scope |
|-----------|-----------|-------|
| **Complexity** | 10M points/minute (5M for trial/free) | Per account |
| **Minute requests** | 5,000/minute | Varies by plan |
| **Concurrency** | Varies by plan | Per app per account |
| **IP limit** | 5,000 requests/10 seconds | Per IP address |
| **Daily limit** | Varies by plan | Per account |

### The API SDK Handles Retries Automatically

The `@mondaydotcomorg/api` SDK respects rate-limited responses and automatically waits before retrying. However, for client-side apps you should still:

1. **Add the `complexity` field** to heavy queries to monitor usage:
```graphql
mutation {
  complexity { query before after }
  create_item(board_id: 12345, item_name: "test") { id }
}
```

2. **Use pagination** — always set `limit` and `page` arguments
3. **Batch operations wisely** — don't fire 50 mutations at once
4. **Respect the `Retry-After` header** on 429 responses

---

## 7. Typed Development with `@mondaydotcomorg/setup-api`

For full TypeScript support with auto-generated types from your actual Monday schema:

```bash
npm i @mondaydotcomorg/setup-api
```

This generates typed queries so your IDE auto-completes field names:

```typescript
import { GetBoardsQuery, GetBoardsQueryVariables } from "./generated/graphql";

const seamlessClient = new SeamlessApiClient();
const variables: GetBoardsQueryVariables = { ids: ["12345"] };

const data = await seamlessClient.request<GetBoardsQuery>(
  getBoards,
  variables
);
// data.boards is now fully typed
```

---

## 8. Complete Client-Side App Setup Example

```javascript
// app.js — Full setup for a client-side Monday.com app
import mondaySdk from "monday-sdk-js";
import { SeamlessApiClient } from "@mondaydotcomorg/api";

// Initialize both SDKs
const monday = mondaySdk();
const apiClient = new SeamlessApiClient();

// 1. Get context (where the app is running)
async function init() {
  const { data: context } = await monday.get("context");
  const { boardId, user, theme } = context;
  
  console.log(`Running on board ${boardId} as user ${user.id}`);
  console.log(`Theme: ${theme}`); // "light" | "dark" | "black"
  
  // 2. Listen for settings changes
  monday.listen("settings", (res) => {
    console.log("Settings changed:", res.data);
  });
  
  // 3. Listen for context changes
  monday.listen("context", (res) => {
    console.log("Context updated:", res.data);
  });
  
  // 4. Fetch board items via API SDK
  await loadBoardItems(boardId);
}

async function loadBoardItems(boardId) {
  try {
    const { boards } = await apiClient.request(`
      query ($ids: [ID!]) {
        boards(ids: $ids) {
          items_page(limit: 50) {
            cursor
            items {
              id
              name
              column_values { id text value type }
            }
          }
        }
      }
    `, { ids: [String(boardId)] });
    
    return boards[0]?.items_page?.items || [];
  } catch (error) {
    if (error.response?.errors) {
      handleApiErrors(error.response.errors);
    }
    return [];
  }
}

async function createItem(boardId, name, columnValues) {
  try {
    const result = await apiClient.request(`
      mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON) {
        create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
          id
          name
        }
      }
    `, {
      boardId: String(boardId),
      itemName: name,
      columnValues: JSON.stringify(columnValues)
    });
    
    // Show success notice
    monday.execute("notice", {
      message: `Item "${name}" created!`,
      type: "success",
      timeout: 5000,
    });
    
    return result.create_item;
  } catch (error) {
    monday.execute("notice", {
      message: "Failed to create item. Please try again.",
      type: "error",
      timeout: 5000,
    });
    throw error;
  }
}

async function updateItem(boardId, itemId, columnId, value) {
  try {
    return await apiClient.operations.changeColumnValueOp({
      boardId: String(boardId),
      itemId: String(itemId),
      columnId,
      value: JSON.stringify(value),
    });
  } catch (error) {
    handleApiErrors(error.response?.errors);
    throw error;
  }
}

async function deleteItem(itemId) {
  try {
    return await apiClient.request(`
      mutation ($itemId: ID!) {
        delete_item(item_id: $itemId) { id }
      }
    `, { itemId: String(itemId) });
  } catch (error) {
    handleApiErrors(error.response?.errors);
    throw error;
  }
}

function handleApiErrors(errors) {
  if (!errors) return;
  
  for (const err of errors) {
    const code = err.extensions?.code;
    
    if (code === "COMPLEXITY_BUDGET_EXHAUSTED" || code === "maxConcurrencyExceeded") {
      // Rate limited — show user-friendly message
      monday.execute("notice", {
        message: "Too many requests. Please wait a moment and try again.",
        type: "error",
        timeout: 8000,
      });
    } else if (code === "UserUnauthorizedException" || code === "USER_ACCESS_DENIED") {
      monday.execute("notice", {
        message: "You don't have permission to perform this action.",
        type: "error",
        timeout: 8000,
      });
    } else {
      console.error(`API Error [${code}]:`, err.message);
    }
  }
}

init();
```

---

## 9. Key Resources

| Resource | URL |
|----------|-----|
| SDK Introduction | https://developer.monday.com/apps/docs/introduction-to-the-sdk |
| API SDK npm | https://www.npmjs.com/package/@mondaydotcomorg/api |
| monday-sdk-js GitHub | https://github.com/mondaycom/monday-sdk-js |
| monday-graphql-api GitHub | https://github.com/mondaycom/monday-graphql-api |
| API Error Handling | https://developer.monday.com/api-reference/docs/error-handling |
| Rate Limits | https://developer.monday.com/api-reference/docs/rate-limits |
| API Versioning | https://developer.monday.com/api-reference/docs/api-versioning |
| Choosing Auth | https://developer.monday.com/apps/docs/choosing-auth |
| Example Apps | https://github.com/mondaycom/welcome-apps |
| Developer Community | https://developer-community.monday.com/ |
| Quickstart (React) | https://developer.monday.com/apps/docs/quickstart-view |
| Column Types Reference | https://developer.monday.com/api-reference/reference/column-types-reference |

---

## 10. Summary of Best Practices

1. **Use both SDKs together**: `monday-sdk-js` for app framework (context, UI, storage) + `@mondaydotcomorg/api` with `SeamlessApiClient` for CRUD operations
2. **Always pin your API version**: Use `2026-01` (current) — never rely on the default
3. **Handle partial errors**: Responses can contain both `data` and `errors` simultaneously
4. **Don't hardcode tokens client-side**: Seamless auth handles everything in the iframe
5. **Paginate all queries**: Use `limit` and `cursor` to stay within complexity budgets
6. **Stringify column values**: Always `JSON.stringify()` values passed to `column_values` parameters
7. **Use `errorPolicy: 'all'`** on `ApiClient` if you want to handle partial results gracefully
8. **Monitor complexity**: Add `complexity { query before after }` to heavy queries
9. **Use the `setup-api` package** for full TypeScript type generation
10. **Migrate off deprecated versions immediately**: `2024-10` and `2025-01` are already rerouted as of Feb 15, 2026
