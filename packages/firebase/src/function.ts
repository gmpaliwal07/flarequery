import type { Auth } from "firebase-admin/auth";
import * as functionsV1 from "firebase-functions/v1";
import { onRequest } from "firebase-functions/v2/https";
import type { ServerlessApp } from "./app.js";
import { extractContext } from "./app.js";

export interface FunctionOptions {
    cors?: boolean;
}

interface QueryRequest {
    model: string;
    id: string;
    select: string[];
}

const VALID_FIELD = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/

function extractQueryRequest(body: unknown): QueryRequest | { error: string } | null {
    if (
        typeof body !== "object" ||
        body === null ||
        !("model" in body) ||
        !("id" in body) ||
        !("select" in body)
    ) return null

    const req = body as Record<string, unknown>

    if (
        typeof req.model !== "string" ||
        typeof req.id !== "string" ||
        !Array.isArray(req.select) ||
        req.select.length === 0
    ) return null

    const invalidField = (req.select as unknown[]).find(
        (f) => typeof f !== "string" || !VALID_FIELD.test(f)
    )

    if (invalidField !== undefined) {
        return { error: `invalid field: "${String(invalidField)}"` }
    }

    return {
        model: req.model,
        id: req.id,
        select: req.select as string[],
    }
}

function handleCors(
    req: { method: string },
    res: {
        set(k: string, v: string): void;
        status(code: number): { send(b: string): void; json(b: unknown): void }
    },
    options: FunctionOptions
): boolean {
    if (!options.cors) return false

    res.set("Access-Control-Allow-Origin", "*")
    res.set("Access-Control-Allow-Methods", "POST")
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type")

    if (req.method === "OPTIONS") {
        res.status(204).send("")
        return true
    }

    return false
}

// gen 1 = firebase-functions v1
export function createFunction(
    app: ServerlessApp,
    auth: Auth,
    options: FunctionOptions = {}
) {
    return functionsV1.https.onRequest(async (req, res) => {
        if (handleCors(req, res, options)) return

        if (req.method !== "POST") {
            res.status(405).json({ error: "method not allowed — use POST" })
            return
        }

        const queryReq = extractQueryRequest(req.body)

        if (queryReq === null) {
            res.status(400).json({
                error: "request body must contain: { model, id, select }",
                example: {
                    model: "Event",
                    id: "event_1",
                    select: ["title", "participants.name"]
                }
            })
            return
        }

        if ("error" in queryReq) {
            res.status(400).json({ error: queryReq.error })
            return
        }

        const ctx = await extractContext(req.headers.authorization, auth)

        try {
            const response = await app
                .collection(queryReq.model)
                .doc(queryReq.id)
                .select(...queryReq.select)
                .get(ctx)

            res.status(200).json(response)
        } catch (error) {
            res.status(500).json({
                error: error instanceof Error ? error.message : "internal server error"
            })
        }
    })
}

// gen 2 = firebase-functions v2
export function createOnRequest(
    app: ServerlessApp,
    auth: Auth,
    options: FunctionOptions = {}
) {
    return onRequest(async (req, res) => {
        if (handleCors(req, res, options)) return

        if (req.method !== "POST") {
            res.status(405).json({ error: "method not allowed — use POST" })
            return
        }

        const queryReq = extractQueryRequest(req.body)

        if (queryReq === null) {
            res.status(400).json({
                error: "request body must contain: { model, id, select }",
                example: {
                    model: "Event",
                    id: "event_1",
                    select: ["title", "participants.name"]
                }
            })
            return
        }

        if ("error" in queryReq) {
            res.status(400).json({ error: queryReq.error })
            return
        }

        const ctx = await extractContext(req.headers.authorization, auth)

        try {
            const response = await app
                .collection(queryReq.model)
                .doc(queryReq.id)
                .select(...queryReq.select)
                .get(ctx)

            res.status(200).json(response)
        } catch (error) {
            res.status(500).json({
                error: error instanceof Error ? error.message : "internal server error"
            })
        }
    })
}