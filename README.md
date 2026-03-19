# FlareQuery

**FlareQuery solves the overfetching and N+1 problem in Firestore.**  
Declare exactly what you need — fields, filters, relations.  
FlareQuery builds the execution plan, resolves relations in parallel, and returns only what was asked for. Nothing more.

[![npm](https://img.shields.io/npm/v/@flarequery/firebase.svg)](https://www.npmjs.com/package/@flarequery/firebase)
[![license](https://img.shields.io/npm/l/@flarequery/firebase.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

---

## The Problem

Firestore charges per document read. Every `.get()` returns the entire document — all fields — whether you needed 2 or 20. And the moment you need related data, you're writing sequential fetch chains — the classic N+1 problem.

```ts
// Overfetching — all fields returned, 1 used
const snap = await db.collection("posts").where("status", "==", "published").get()
const titles = snap.docs.map(d => d.data().title)

// N+1 — 1 query for posts + 1 query per author
const posts = await db.collection("posts").get()
for (const post of posts.docs) {
  const author = await db.collection("users").doc(post.data().authorId).get()
}
```

---

## The Fix
  
```ts
// Only declared fields hit the wire
const result = await flareApp
  .collection("Post")
  .filter("status").equals("published")
  .select("title", "slug", "author.name")
  .get(ctx)

// Relations resolved in parallel — not sequentially
const result = await flareApp
  .collection("Post")
  .doc("post_abc")
  .select("title", "body", "author.name", "tags.label")
  .get(ctx)

// result.data →
// {
//   title: "Hello World",
//   body: "...",
//   author: { name: "Alice" },   ← resolved in parallel
//   tags: [{ label: "dev" }]     ← batch fetched via getAll
// }
```

No N+1. No overfetching. One declaration.

---

## Install

```bash
yarn add @flarequery/firebase
```

> Node 18+, firebase-admin ≥11, firebase-functions ≥4

---

## Setup

```ts
// lib/flarequery.ts
import { createServerlessApp, one, many } from "@flarequery/firebase"
import { adminDb, adminAuth } from "@/lib/firebase-admin"

export const flareApp = createServerlessApp({
  firestore: adminDb,
  auth: adminAuth,
})

flareApp.model("Post", {
  source: { path: "posts" },
  fields: {
    title: "string",
    body: "string",
    status: "string",
    author: one("User", { from: "authorId" }),
    tags: many("Tag", { from: "tagIds" }),
  },
  auth: (ctx) => ctx.userId !== null,
})

flareApp.model("User", {
  source: { path: "users" },
  fields: { name: "string", email: "string" },
})

flareApp.model("Tag", {
  source: { path: "tags" },
  fields: { label: "string" },
})
```

---

## Three Ways to Query

### 1. Document fetch with relations — solves N+1

```ts
const result = await flareApp
  .collection("Post")
  .doc("post_abc")
  .select("title", "body", "author.name", "author.email", "tags.label")
  .get(ctx)
```

FlareQuery builds an execution plan, resolves `author` and `tags` in parallel using `Promise.all` and `getAll` batching. One round trip per relation level — not one per document.

### 2. Collection query with filters — solves overfetching

```ts
const result = await flareApp
  .collection("Post")
  .filter("status").equals("published")
  .filter("featured").equals(true)
  .select("title", "slug", "author.name")
  .orderBy("createdAt", "desc")
  .limit(20)
  .get(ctx)
```

Firestore receives only the fields you declared. Nothing else is read off disk.

### 3. Aggregation — unique field values with field mask

```ts
// Fetch only the "category" field — not full documents
const snapshot = await adminDb
  .collection("posts")
  .where("status", "==", "published")
  .select("category")
  .get()

const categories = [
  ...new Set(snapshot.docs.map(d => d.get("category")).filter(Boolean))
].sort()
```

---

## Filter Operators

```ts
.filter("status").equals("published")        // ==
.filter("status").not("archived")            // !=
.filter("views").gt(100)                     // >
.filter("views").gte(100)                    // >=
.filter("views").lt(1000)                    // <
.filter("views").lte(1000)                   // <=
.filter("status").in(["draft", "published"]) // in
.filter("tags").contains("firebase")         // array-contains
```

Chain as many filters as needed — all ANDed by Firestore:

```ts
flareApp.collection("Post")
  .filter("status").equals("published")
  .filter("views").gte(100)
  .filter("featured").equals(true)
  .select("title", "author.name")
  .get(ctx)
```

---

## Field Types

| Type          | Usage                                             |
| ------------- | ------------------------------------------------- |
| `"string"`    | String field                                      |
| `"number"`    | Number field                                      |
| `"boolean"`   | Boolean field                                     |
| `"timestamp"` | Firestore Timestamp                               |
| `one(...)`    | Single related doc resolved via foreign key       |
| `many(...)`   | Multiple related docs via ID array, batch fetched |

---

## Auth

Auth rules run **before any Firestore read**. Unauthorized access throws a `PlanError` — nothing hits the database.

```ts
import { extractContext } from "@flarequery/firebase"

const ctx = await extractContext(req.headers.get("authorization"), auth)
// { userId: string | null, token: DecodedIdToken | null }
```

```ts
flareApp.model("Post", {
  source: { path: "posts" },
  fields: { title: "string", body: "string" },
  auth: (ctx) => ctx.userId !== null,
})
```

---

## Cloud Function

```ts
export const query = createOnRequest(flareApp, getAuth(), { cors: true })
```

```json
POST /query
Authorization: Bearer <token>

{ "model": "Post", "id": "post_abc", "select": ["title", "author.name", "tags.label"] }
```

```json
{
  "data": {
    "title": "Hello World",
    "author": { "name": "Alice" },
    "tags": [{ "label": "dev" }, { "label": "firebase" }]
  }
}
```


## License

MIT © Gaurav Paliwal
