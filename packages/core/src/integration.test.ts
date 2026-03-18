import { describe, it, expect, vi } from "vitest"
import { parseQuery } from "../src/parser/index.js"
import { buildExecutionPlan } from "../src/planner/index.js"
import { executeplan } from "../src/executor/index.js"
import type { FirestoreAdapter, DocumentSnapshot } from "../src/executor/index.js"
import type { ModelDefinition, QueryContext } from "../src/types.js"


const MOCK_EVENT = {
    id: "event_1",
    title: "ETH Denver 2025",
    description: "biggest web3 event",
    location: "Denver, CO",
    maxCapacity: 5000,
    createdAt: "2025-01-01",
    updatedAt: "2025-01-02",
    bannerImage: "https://example.com/banner.jpg",
    organizerId: "org_1",
    category: "web3",
    isPublic: true,
    rsvpUserIds: ["u1", "u2", "u3"],
}

const MOCK_USERS: Record<string, Record<string, unknown>> = {
    u1: {
        name: "Alice",
        email: "alice@example.com",
        age: 28,
        bio: "builder",
        twitter: "@alice",
        github: "alice",
        website: "alice.dev",
        company: "Acme",
        role: "engineer",
        location: "NYC",
        createdAt: "2024-01-01",
        updatedAt: "2024-06-01",
        avatarUrl: "https://example.com/alice.jpg",
        isVerified: true,
        plan: "pro",
    },
    u2: {
        name: "Bob",
        email: "bob@example.com",
        age: 32,
        bio: "designer",
        twitter: "@bob",
        github: "bob",
        website: "bob.design",
        company: "Studio B",
        role: "designer",
        location: "SF",
        createdAt: "2024-02-01",
        updatedAt: "2024-07-01",
        avatarUrl: "https://example.com/bob.jpg",
        isVerified: false,
        plan: "free",
    },
    u3: {
        name: "Carol",
        email: "carol@example.com",
        age: 25,
        bio: "founder",
        twitter: "@carol",
        github: "carol",
        website: "carol.io",
        company: "StartupX",
        role: "ceo",
        location: "Austin",
        createdAt: "2024-03-01",
        updatedAt: "2024-08-01",
        avatarUrl: "https://example.com/carol.jpg",
        isVerified: true,
        plan: "enterprise",
    },
}


function createMockAdapter(): FirestoreAdapter & {
    getOneCalls: Array<{ collection: string; id: string; fieldMask: string[] }>
    getManyCalls: Array<{ collection: string; ids: string[]; fieldMask: string[] }>
} {
    const getOneCalls: Array<{ collection: string; id: string; fieldMask: string[] }> = []
    const getManyCalls: Array<{ collection: string; ids: string[]; fieldMask: string[] }> = []

    return {
        getOneCalls,
        getManyCalls,

        async getOne(collection, id, fieldMask): Promise<DocumentSnapshot> {
            getOneCalls.push({ collection, id, fieldMask })

            if (collection === "events" && id === "event_1") {
                return {
                    id,
                    exists: true,
                    data() {
                        const masked: Record<string, unknown> = {}
                        for (const field of fieldMask) {
                            if (field in MOCK_EVENT) {
                                masked[field] = MOCK_EVENT[field as keyof typeof MOCK_EVENT]
                            }
                        }
                        return masked
                    },
                }
            }

            return { id, exists: false, data: () => undefined }
        },

        async getMany(collection, ids, fieldMask): Promise<DocumentSnapshot[]> {
            getManyCalls.push({ collection, ids, fieldMask })

            if (collection === "users") {
                return ids.map((id) => ({
                    id,
                    exists: id in MOCK_USERS,
                    data() {
                        const user = MOCK_USERS[id]
                        if (user === undefined) return undefined

                        // return only fields in the mask
                        const masked: Record<string, unknown> = {}
                        for (const field of fieldMask) {
                            if (field in user) {
                                masked[field] = user[field]
                            }
                        }
                        return masked
                    },
                }))
            }

            return []
        },
    }
}


function buildModels(): Map<string, ModelDefinition> {
    const models = new Map<string, ModelDefinition>()

    models.set("Event", {
        source: { path: "events" },
        fields: {
            title: "string",
            description: "string",
            location: "string",
            participants: {
                relation: {
                    from: "rsvpUserIds",
                    to: "User",
                    type: "many",
                },
                select: ["name", "email"],
            },
        },
    })

    models.set("User", {
        source: { path: "users" },
        fields: {
            name: "string",
            email: "string",
            bio: "string",
            company: "string",
        },
    })

    return models
}

const ctx: QueryContext = { userId: "test-user", token: null }


describe("flarequery integration", () => {
    it("fetches only requested scalar fields — no overfetch", async () => {
        const models = buildModels()
        const adapter = createMockAdapter()

        const query = `
      query {
        Event(id: "event_1") {
          title
          participants {
            name
          }
        }
      }
    `

        const queryNode = parseQuery(query)
        const plan = buildExecutionPlan(queryNode, models, ctx)
        const response = await executeplan(plan, adapter)

        expect(response.data).toBeDefined()
        expect(response.errors).toBeUndefined()

        expect(response.data!["title"]).toBe("ETH Denver 2025")
        expect(response.data!["description"]).toBeUndefined()
        expect(response.data!["location"]).toBeUndefined()
        expect(response.data!["maxCapacity"]).toBeUndefined()
    })

    it("resolves all 3 participants in a single getMany call — no N+1", async () => {
        const models = buildModels()
        const adapter = createMockAdapter()

        const query = `
      query {
        Event(id: "event_1") {
          title
          participants {
            name
          }
        }
      }
    `

        const queryNode = parseQuery(query)
        const plan = buildExecutionPlan(queryNode, models, ctx)
        await executeplan(plan, adapter)

        expect(adapter.getOneCalls).toHaveLength(1)
        expect(adapter.getOneCalls[0]?.collection).toBe("events")

        expect(adapter.getManyCalls).toHaveLength(1)
        expect(adapter.getManyCalls[0]?.collection).toBe("users")
        expect(adapter.getManyCalls[0]?.ids).toEqual(["u1", "u2", "u3"])
    })

    it("applies field mask on user reads — only name fetched not all 15 fields", async () => {
        const models = buildModels()
        const adapter = createMockAdapter()

        const query = `
      query {
        Event(id: "event_1") {
          title
          participants {
            name
          }
        }
      }
    `

        const queryNode = parseQuery(query)
        const plan = buildExecutionPlan(queryNode, models, ctx)
        const response = await executeplan(plan, adapter)

        expect(adapter.getManyCalls[0]?.fieldMask).toEqual(["name"])

        const participants = response.data!["participants"] as Record<string, unknown>[]
        expect(participants).toHaveLength(3)
        expect(participants[0]).toEqual({ name: "Alice" })
        expect(participants[0]!["email"]).toBeUndefined()
        expect(participants[0]!["bio"]).toBeUndefined()
    })

    it("returns participants in correct shape", async () => {
        const models = buildModels()
        const adapter = createMockAdapter()

        const query = `
      query {
        Event(id: "event_1") {
          title
          participants {
            name
          }
        }
      }
    `

        const queryNode = parseQuery(query)
        const plan = buildExecutionPlan(queryNode, models, ctx)
        const response = await executeplan(plan, adapter)

        const participants = response.data!["participants"] as Record<string, unknown>[]
        expect(participants.map((p) => p["name"])).toEqual(["Alice", "Bob", "Carol"])
    })

    it("blocks unauthorized access via auth rule", async () => {
        const models = buildModels()

        models.set("Event", {
            source: { path: "events" },
            fields: { title: "string" },
            auth: (ctx) => ctx.userId !== null,
        })

        const adapter = createMockAdapter()
        const unauthCtx: QueryContext = { userId: null, token: null }

        const query = `query { Event(id: "event_1") { title } }`
        const queryNode = parseQuery(query)

        expect(() => buildExecutionPlan(queryNode, models, unauthCtx)).toThrow("unauthorized")

        expect(adapter.getOneCalls).toHaveLength(0)
    })

    it("blocks fields not in the relation select upper bound", async () => {
        const models = buildModels()
        const adapter = createMockAdapter()

   
        const query = `
      query {
        Event(id: "event_1") {
          participants {
            bio
          }
        }
      }
    `

        const queryNode = parseQuery(query)
        expect(() => buildExecutionPlan(queryNode, models, ctx)).toThrow("not selectable")
        expect(adapter.getOneCalls).toHaveLength(0)
    })

    it("returns null for a non-existent document", async () => {
        const models = buildModels()
        const adapter = createMockAdapter()

        const query = `query { Event(id: "does_not_exist") { title } }`
        const queryNode = parseQuery(query)
        const plan = buildExecutionPlan(queryNode, models, ctx)
        const response = await executeplan(plan, adapter)

        expect(response.data).toBeNull()
    })
})