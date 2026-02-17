import type { Auth } from "firebase-admin/auth"
import * as functionsV1 from "firebase-functions/v1"
import { onRequest } from "firebase-functions/v2/https"
import type { ServerlessApp } from "./app.js"
import { extractContext } from "./app.js"

export interface FunctionOptions {
    cors?: boolean
}

// gen 1 = firebase-functions v1
export function createFunction(
    app: ServerlessApp,
    auth: Auth,
    options: FunctionOptions = {}
) {
    return functionsV1.https.onRequest(async (req, res) => {
        if (options.cors) {
            res.set("Access-Control-Allow-Origin", "*")
            res.set("Access-Control-Allow-Methods", "POST")
            res.set("Access-Control-Allow-Headers", "Authorization, Content-Type")

            if (req.method === "OPTIONS") {
                res.status(204).send("")
                return
            }
        }

        if (req.method !== "POST") {
            res.status(405).json({ error: "method not allowed — use POST" })
            return
        }

        const query = extractQuery(req.body)
        if (query === null) {
            res.status(400).json({ error: "request body must contain a 'query' string field" })
            return
        }

        const ctx = await extractContext(req.headers.authorization, auth)
        const response = await app.execute(query, ctx)

        res.status(200).json(response)
    })
}

//gen 2 - firebase-functions v2
export function createOnRequest(
    app: ServerlessApp,
    auth: Auth,
    options: FunctionOptions = {}
) {
    return onRequest(async (req, res) => {
        if (options.cors) {
            res.set("Access-Control-Allow-Origin", "*")
            res.set("Access-Control-Allow-Methods", "POST")
            res.set("Access-Control-Allow-Headers", "Authorization, Content-Type")

            if (req.method === "OPTIONS") {
                res.status(204).send("")
                return
            }
        }

        if (req.method !== "POST") {
            res.status(405).json({ error: "method not allowed — use POST" })
            return
        }

        const query = extractQuery(req.body)
        if (query === null) {
            res.status(400).json({ error: "request body must contain a 'query' string field" })
            return
        }

        const ctx = await extractContext(req.headers.authorization, auth)
        const response = await app.execute(query, ctx)

        res.status(200).json(response)
    })
}

function extractQuery(body: unknown): string | null {
    if (typeof body === "string" && body.trim().length > 0) return body.trim()

    if (
        typeof body === "object" &&
        body !== null &&
        "query" in body &&
        typeof (body as Record<string, unknown>)["query"] === "string"
    ) {
        return ((body as Record<string, unknown>)["query"] as string).trim()
    }

    return null
}