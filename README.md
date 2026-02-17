# flarequery

The missing query layer for Firebase. Eliminates overfetching, N+1 reads, and ID fan-out in serverless apps — without GraphQL complexity, without migrations, without extra infrastructure.

## The Problem

Every Firebase app with relational data writes this:

```ts
const event = await firestore.doc("events/event_1").get();
const rsvpIds = event.data().rsvpUserIds;

const users = await Promise.all(
  rsvpIds.map((id) => firestore.doc(`users/${id}`).get()),
);

const result = {
  title: event.data().title,
  participants: users.map((u) => ({ name: u.data().name })),
};
```

With 50 RSVPs and 15 fields per user document, this is:

- 51 Firestore reads
- 750 fields fetched
- 2 fields actually needed

## The Solution

```ts
const result = await app.execute(
  `
  query {
    Event(id: "event_1") {
      title
      participants {
        name
      }
    }
  }
`,
  ctx,
);
```

- 2 Firestore reads. Always. Regardless of participant count.
- Field masks applied server-side. Only requested fields transferred.
- Zero manual batching, loops, or stitching.

## Benchmark

| Approach      | Reads | Fields Fetched | Time    |
| ------------- | ----- | -------------- | ------- |
| Raw Firestore | 4     | 56             | ~4000ms |
| flarequery    | 2     | 2              | ~1600ms |

Measured on a live Firestore project with 3 participants and 14 fields per user document. Gap grows with participant count.

## Installation

```bash
npm install @flarequery/firebase firebase-admin
```

## Setup

```ts
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createServerlessApp, createOnRequest } from "@flarequery/firebase";

const admin = initializeApp();
const db = getFirestore();
const auth = getAuth();

const app = createServerlessApp({ firestore: db, auth });
```

## Define Models

```ts
app.model("Event", {
  source: db.collection("events"),
  fields: {
    title: "string",
    description: "string",
    participants: {
      relation: {
        from: "rsvpUserIds",
        to: "User",
        type: "many",
      },
      select: ["name", "email"],
    },
  },
});

app.model("User", {
  source: db.collection("users"),
  fields: {
    name: "string",
    email: "string",
  },
});
```

## Deploy as a Cloud Function

```ts
// Gen 2 (recommended)
export const query = createOnRequest(app, auth);

// Gen 1
export const query = createFunction(app, auth);
```

## Calling the Query Endpoint

flarequery exposes a single HTTP POST endpoint from your Cloud Function. You call it the same way you would call any REST or GraphQL endpoint — just send a `query` string in the body.

### From curl

```bash
curl -X POST https://us-central1-your-project.cloudfunctions.net/query \
  -H 'Authorization: Bearer <firebase-id-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "query { Event(id: \"event_1\") { title participants { name email } } }"
  }'
```

Response:

```json
{
  "data": {
    "title": "ETH Denver 2025",
    "participants": [
      { "name": "Alice", "email": "alice@example.com" },
      { "name": "Bob", "email": "bob@example.com" }
    ]
  }
}
```

### From a Next.js API route

```ts
// app/api/event/route.ts
export async function GET(req: Request) {
  const token = req.headers.get("authorization") ?? "";

  const res = await fetch(
    "https://us-central1-your-project.cloudfunctions.net/query",
    {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
        query {
          Event(id: "event_1") {
            title
            participants {
              name
              email
            }
          }
        }
      `,
      }),
    },
  );

  const data = await res.json();
  return Response.json(data);
}
```

### From a React client

```ts
// lib/flarequery.ts
export async function flareFetch(query: string, idToken: string) {
  const res = await fetch(
    "https://us-central1-your-project.cloudfunctions.net/query",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );

  if (!res.ok) throw new Error(`flarequery error: ${res.status}`);
  return res.json();
}
```

```tsx
// components/EventPage.tsx
import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { flareFetch } from "@/lib/flarequery";

export function EventPage({ eventId }: { eventId: string }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    async function load() {
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const result = await flareFetch(
        `
        query {
          Event(id: "${eventId}") {
            title
            participants {
              name
            }
          }
        }
      `,
        token,
      );

      setData(result.data);
    }

    load();
  }, [eventId]);

  if (!data) return <div>loading...</div>;

  return (
    <div>
      <h1>{data.title}</h1>
      {data.participants.map((p, i) => (
        <div key={i}>{p.name}</div>
      ))}
    </div>
  );
}
```

### Server-side direct call (no HTTP)

If you are already inside a Cloud Function or a server environment with access to the `app` instance, skip the HTTP round trip entirely:

```ts
const result = await app.execute(
  `
  query {
    Event(id: "event_1") {
      title
      participants {
        name
      }
    }
  }
`,
  { userId: req.user.uid, token: null },
);
```

## Auth

```ts
app.model("Event", {
  source: db.collection("events"),
  fields: {
    title: "string",
  },
  // runs before any read — false prunes the entire branch
  auth: (ctx) => ctx.userId !== null,
});
```

Auth rules run at plan time — before any Firestore call happens. Unauthorized branches are pruned, not fetched and filtered.

## Relation Types

```ts
// one — parentDoc.authorId -> single User
author: {
  relation: { from: 'authorId', to: 'User', type: 'one' },
  select: ['name'],
}

// many — parentDoc.rsvpUserIds[] -> User[]
participants: {
  relation: { from: 'rsvpUserIds', to: 'User', type: 'many' },
  select: ['name', 'email'],
}
```

## How It Works

flarequery introduces a query planning layer that runs before any Firestore call:

```
Query string
    |
    v
Parser — query string to AST
    |
    v
Planner — AST to execution DAG
          resolves field masks
          prunes unauthorized branches
          groups reads by collection
    |
    v
Executor — runs DAG against Firestore
           getAll() for every multi-ID read
           field masks on every operation
           sibling relations run in parallel
    |
    v
Result — exact shape of the query
```

The planner is the entire value. Everything is decided before a single read happens.

## What This Is Not

- Not a GraphQL server
- Not an ORM
- Not a Firebase replacement
- No subscriptions
- No client SDK (v1)
- No long-lived servers

## Package Structure

```
@flarequery/firebase   — install this
@flarequery/core       — internal, not for direct use
```

## License

MIT
