import { DependentRelation, ExecutionOp, ExecutionPlan, FlareResponse, FlareResult, GetManyOp, GetOneOp } from "../types.js";

export interface DocumentSnapshot {
    id: string;
    exists: boolean;
    data(): Record<string, unknown> | undefined;
}

export interface FirestoreAdapter {

    getOne(collection: string, id: string, fieldMask: string[]): Promise<DocumentSnapshot>

    getMany(collection: string, ids: string[], fieldMask: string[]): Promise<DocumentSnapshot[]>

}


export class ExecutionError extends Error {
    constructor(message: string) {
        super(`ExecutionError: ${message}`)
        this.name = "ExecutionError"
    }
}

async function resolveDependents(
    dependents: DependentRelation[],
    docData: Record<string, unknown>,
    adapter: FirestoreAdapter
): Promise<FlareResult> {
    if (dependents.length === 0) return {}

    const resolved = await Promise.all(
        dependents.map(async (dependent) => {
            const value = await executeOp(dependent.op, docData, adapter)
            return { fieldName: dependent.fieldName, value }
        })
    )

    const result: FlareResult = {}
    for (const { fieldName, value } of resolved) {
        result[fieldName] = value
    }

    return result

}

function resolveId(
    id: string,
    parentDoc: Record<string, unknown> | null
): string | null {
    if (!id.startsWith("$ref:")) return id

    const fieldName = id.slice("$ref:".length)

    if (parentDoc === null) {
        throw new ExecutionError(
            `cannot resolve runtime ref '${id}' — no parent document available`
        )
    }

    const value = parentDoc[fieldName]
    if (typeof value !== "string") return null

    return value
}

async function executeGetOne(
    op: GetOneOp,
    parentDoc: Record<string, unknown> | null,
    adapter: FirestoreAdapter
): Promise<FlareResult | null> {
    const id = resolveId(op.id, parentDoc)
    if (id === null) return null

    const snapshot = await adapter.getOne(op.collection, id, op.fieldMask)

    if (!snapshot.exists) return null

    const docData = snapshot.data()
    if (docData === undefined) return null

    const result = await resolveDependents(op.dependents, docData, adapter)

    const foreignKeys = new Set(op.dependents.map((d) => d.foreignKey))

    for (const [key, value] of Object.entries(docData)) {
        if (!foreignKeys.has(key) && op.fieldMask.includes(key)) {
            result[key] = value
        }
    }

    return result
}

async function executeGetMany(
    op: GetManyOp,
    parentDoc: Record<string, unknown> | null,
    adapter: FirestoreAdapter
): Promise<FlareResult | null> {
    if (parentDoc === null) {
        throw new ExecutionError(
            `getMany op for collection '${op.collection}' has no parent document`
        )
    }

    const rawIds = parentDoc[op.idsFrom]
    if (!Array.isArray(rawIds) || rawIds.length === 0) return null

    const ids = rawIds.filter((v): v is string => typeof v === "string")
    if (ids.length === 0) return null

    const snapshots = await adapter.getMany(op.collection, ids, op.fieldMask)

    const results = await Promise.all(
        snapshots
            .filter((snap) => snap.exists)
            .map(async (snap) => {
                const docData = snap.data()
                if (docData === undefined) return null

                const result = await resolveDependents(op.dependents, docData, adapter)

                const foreignKeys = new Set(op.dependents.map((d) => d.foreignKey))

                for (const [key, value] of Object.entries(docData)) {
                    if (!foreignKeys.has(key) && op.fieldMask.includes(key)) {
                        result[key] = value
                    }
                }

                return result
            })
    )

    return results.filter((r): r is FlareResult => r !== null) as unknown as FlareResult
}
async function executeOp(
    op: ExecutionOp,
    parentDoc: Record<string, unknown> | null,
    adapter: FirestoreAdapter
): Promise<FlareResult | null> {
    if (op.kind === "getOne") {
        return executeGetOne(op, parentDoc, adapter)
    }
    return executeGetMany(op, parentDoc, adapter)
}

// public API

export async function executeplan(plan: ExecutionPlan,
    adapter: FirestoreAdapter): Promise<FlareResponse> {
    try {
        const data = await executeOp(plan.root, null, adapter);
        return { data }
    } catch (err) {
        if (err instanceof ExecutionError) {
            return { data: null, errors: [err.message] }
        }
        throw err
    }
}