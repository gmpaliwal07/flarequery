import { ModelDefinition, QueryContext } from "@flarequery/core";
import { Auth } from "firebase-admin/auth";
import { Firestore } from "firebase-admin/firestore";
import { createFirestoreAdapter } from "./adapter.js";
import { CollectionReference, createCollectionRef } from "./builder.js";

export interface ServerlessAppOptions {
    firestore: Firestore;
    auth: Auth;
}

export interface ServerlessApp {
    model(name: string, definition: ModelDefinition): void;

    collection(name: string): CollectionReference;
}

export function createServerlessApp(options: ServerlessAppOptions): ServerlessApp {
    const { firestore } = options;

    const models = new Map<string, ModelDefinition>();
    const adapter = createFirestoreAdapter(firestore);

    return {
        model(name, definition) {
            if (models.has(name)) {
                console.warn(`[FlareQuery] model '${name}' is already registered — skipping duplicate registration`);
            }
            models.set(name, definition);
        },
        collection(name) {
            return createCollectionRef(name, models, adapter);
        },
    };
}

export async function extractContext(
    authorization: string | undefined,
    auth: Auth
): Promise<QueryContext> {
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
        return { userId: null, token: null };
    }

    const idToken = authorization.slice("Bearer ".length);

    try {
        const decoded = await auth.verifyIdToken(idToken);
        return {
            userId: decoded.uid,
            token: decoded as unknown as Record<string, unknown>,
        };
    } catch (err) {
        console.warn("[FlareQuery] extractContext: token verification failed —",
            err instanceof Error ? err.message : "unknown error"
        );
        return { userId: null, token: null };
    }
}