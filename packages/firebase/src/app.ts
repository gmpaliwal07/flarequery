import { buildExecutionPlan, executeplan, FlareResponse, ModelDefinition, parseQuery, QueryContext } from "@flarequery/core";
import { Auth } from "firebase-admin/auth";
import { Firestore } from "firebase-admin/firestore";
import { createFirestoreAdapter } from "./adapter.js";

export interface ServerlessAppOptions {
    firestore: Firestore;
    auth: Auth;
}

export interface ServerlessApp {
    model(name: string, definition: ModelDefinition): void

    execute(query: string, ctx: QueryContext): Promise<FlareResponse>
}

export function createServerlessApp(options: ServerlessAppOptions): ServerlessApp {
    const { firestore, auth: firebaseAuth } = options

    const models = new Map<string, ModelDefinition>()


    const adapter = createFirestoreAdapter(firestore)

    return {
        model(name, definition) {
            if (models.has(name)) {
                throw new Error(`model '${name}' is already registered`)
            }
            models.set(name, definition)
        },

        async execute(query, ctx) {
            // parse
            const queryNode = parseQuery(query)

            // plan 
            const plan = buildExecutionPlan(queryNode, models, ctx)

            // execute 
            return executeplan(plan, adapter)
        },
    }
}

export async function extractContext(
    authorization: string | undefined,
    auth: Auth
): Promise<QueryContext> {
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
        return { userId: null, token: null }
    }

    const idToken = authorization.slice("Bearer ".length)

    try {
        const decoded = await auth.verifyIdToken(idToken)
        return {
            userId: decoded.uid,
            token: decoded as unknown as Record<string, unknown>,
        }
    } catch {
        // invalid or expired token 
        return { userId: null, token: null }
    }
}