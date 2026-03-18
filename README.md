# flarequery

The missing query layer for Firebase. Eliminates overfetching and N+1 reads in serverless apps — no GraphQL, no migrations, no extra infrastructure.

---

## Installation

```bash
npm install @flarequery/firebase firebase-admin
```

---

## Setup

```ts
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createServerlessApp } from "@flarequery/firebase";

const admin = initializeApp();
const db = getFirestore();
const auth = getAuth();

const app = createServerlessApp({ firestore: db, auth });
```

---

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

**Relation types:**

```ts
// one-to-one
author: {
  relation: { from: "authorId", to: "User", type: "one" },
  select: ["name"],
}

// one-to-many
participants: {
  relation: { from: "rsvpUserIds", to: "User", type: "many" },
  select: ["name", "email"],
}
```

---

## Auth

Auth rules run before any read. Return `false` to block the entire branch.

```ts
app.model("Event", {
  source: db.collection("events"),
  fields: { title: "string" },
  auth: (ctx) => ctx.userId !== null,
});
```

---

## Deploy

```ts
import { createOnRequest } from "@flarequery/firebase";

// Gen 2 (recommended)
export const query = createOnRequest(app, auth);

// Gen 1
export const query = createFunction(app, auth);
```

---

## Querying

### Server-side (inside a Cloud Function)

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

### HTTP (curl)

```bash
curl -X POST https://us-central1-your-project.cloudfunctions.net/query \
  -H 'Authorization: Bearer <firebase-id-token>' \
  -H 'Content-Type: application/json' \
  -d '{"query": "query { Event(id: \"event_1\") { title participants { name email } } }"}'
```

### Next.js API Route

```ts
// app/api/event/route.ts
export async function GET(req: Request) {
  const token = req.headers.get("authorization") ?? "";

  const res = await fetch(
    "https://us-central1-your-project.cloudfunctions.net/query",
    {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query {
            Event(id: "event_1") {
              title
              participants { name email }
            }
          }
        `,
      }),
    },
  );

  return Response.json(await res.json());
}
```

### React Client

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
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) return;

      const result = await flareFetch(
        `query { Event(id: "${eventId}") { title participants { name } } }`,
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

---

## Packages

| Package | Usage |
|---|---|
| `@flarequery/firebase` | Install this |
| `@flarequery/core` | Internal — do not import directly |

---

## License

MIT
