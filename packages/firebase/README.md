# flarequery

**Declarative, field-mask-aware data fetching for Firestore.**  
Stop paying for fields you never read.

[![npm version](https://img.shields.io/npm/v/@flarequery/firebase.svg)](https://www.npmjs.com/package/@flarequery/firebase)
[![license](https://img.shields.io/npm/l/@flarequery/firebase.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

---

## The Problem

Every Firestore fetch returns the **entire document** — whether you asked for 2 fields or 20. You pay for all of them.

FlareQuery lets you declare exactly what you need. It builds field masks, resolves relations in parallel, and returns only what was asked for.

---

## Install

```bash
yarn add @flarequery/firebase
```

> Node 18+, firebase-admin ≥11, firebase-functions ≥4

---

## Quick Start

```ts
import { createServerlessApp, one, many } from "@flarequery/firebase";

const app = createServerlessApp({ firestore: db, auth });

app.model("Product", {
  source: { path: "products" },
  fields: {
    name: "string",
    price: "number",
    category: one("Category", { from: "categoryId", select: ["name"] }),
    tags: many("Tag", { from: "tagIds", select: ["label"] }),
  },
  auth: (ctx) => ctx.userId !== null,
});
```

```ts
const response = await app
  .collection("Product")
  .doc("prod_abc")
  .select("name", "price", "category.name")
  .get(ctx);

// response.data → { name: "...", price: 299, category: { name: "Cameras" } }
```

Relations resolved in parallel. Only declared fields hit the wire.

---

## Cloud Function

```ts
export const query = createOnRequest(app, getAuth(), { cors: true });
```

```json
POST /query
Authorization: Bearer <firebase_id_token>

{ "model": "Product", "id": "prod_abc", "select": ["name", "price", "category.name"] }
```

```json
{
  "data": { "name": "EOS R5", "price": 3899, "category": { "name": "Cameras" } }
}
```

Gen 1: `createFunction` — Gen 2: `createOnRequest`

---

## Auth

```ts
import { extractContext } from "@flarequery/firebase";

const ctx = await extractContext(req.headers.authorization, auth);
// { userId: string | null, token: DecodedIdToken | null }
```

Auth rules run before any Firestore read. Unauthorized access throws a `PlanError`.

---

## Field Types

| Type                | Usage                                   |
| ------------------- | --------------------------------------- |
| `"string"`          | Scalar string                           |
| `"number"`          | Scalar number                           |
| `"boolean"`         | Scalar boolean                          |
| `"timestamp"`       | Firestore Timestamp                     |
| `one(model, opts)`  | Single related document via foreign key |
| `many(model, opts)` | Multiple related documents via ID array |

---

## Error Handling

| Class            | When                                              |
| ---------------- | ------------------------------------------------- |
| `PlanError`      | Invalid model, unknown field, unauthorized access |
| `ExecutionError` | Runtime — missing doc, unresolvable ref           |

`ExecutionError`s surface in `response.errors[]` — partial data is still returned.

---

## License

MIT © Gaurav Paliwal
