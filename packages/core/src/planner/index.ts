import {
    CollectionExecutionPlan,
    CollectionQueryNode,
    DependentRelation,
    ExecutionOp,
    ExecutionPlan,
    FieldDefinition,
    GetManyOp,
    GetOneOp,
    ModelDefinition,
    QueryContext,
    QueryField,
    QueryNode,
    RelationFieldDefinition,
    WhereClause,
} from "../types.js"

export class PlanError extends Error {
    constructor(message: string) {
        super(`PlanError: ${message}`)
        this.name = "PlanError"
    }
}

function isRelationField(def: FieldDefinition): def is RelationFieldDefinition {
    return typeof def === 'object' && "relation" in def
}

function resolveSelections(
    selections: QueryField[],
    model: ModelDefinition,
    models: Map<string, ModelDefinition>,
    ctx: QueryContext,
    allOps: ExecutionOp[]
): { scalarMask: string[]; dependents: DependentRelation[] } {
    const scalarMask: string[] = []
    const dependents: DependentRelation[] = []

    for (const selection of selections) {
        const fieldDef = model.fields[selection.name]

        if (fieldDef === undefined) {
            throw new PlanError(
                `field '${selection.name}' does not exist on model '${model.source.path}'`
            )
        }

        if (isRelationField(fieldDef)) {
            if (selection.children.length === 0) {
                throw new PlanError(
                    `relation field '${selection.name}' must have a selection set`
                )
            }
            const dependent = planRelationField(selection, fieldDef, models, ctx, allOps)
            dependents.push(dependent)
        } else {
            scalarMask.push(selection.name)
        }
    }

    return { scalarMask, dependents }
}

function planRelationField(
    selection: QueryField,
    fieldDef: RelationFieldDefinition,
    models: Map<string, ModelDefinition>,
    ctx: QueryContext,
    allOps: ExecutionOp[]
): DependentRelation {
    const { relation, select: allowedSelects } = fieldDef
    const targetModel = models.get(relation.to)

    if (targetModel === undefined) {
        throw new PlanError(`relation target model '${relation.to}' is not registered`)
    }

    if (allowedSelects !== undefined) {
        for (const child of selection.children) {
            if (!allowedSelects.includes(child.name)) {
                throw new PlanError(
                    `field '${child.name}' is not selectable through relation '${selection.name}'. ` +
                    `allowed: [${allowedSelects.join(", ")}]`
                )
            }
        }
    }

    if (targetModel.auth !== undefined && !targetModel.auth(ctx)) {
        throw new PlanError(`unauthorized access to relation target '${relation.to}'`)
    }

    const { scalarMask, dependents: nestedDependents } = resolveSelections(
        selection.children,
        targetModel,
        models,
        ctx,
        allOps
    )

    const nestedRelationKeys = nestedDependents.map((d) => d.foreignKey)
    const fieldMask = Array.from(new Set([...scalarMask, ...nestedRelationKeys]))

    let op: ExecutionOp

    if (relation.type === "one") {
        const getOneOp: GetOneOp = {
            kind: "getOne",
            collection: targetModel.source.path,
            id: `$ref:${relation.from}`,
            fieldMask,
            dependents: nestedDependents,
        }
        op = getOneOp
    } else {
        const getManyOp: GetManyOp = {
            kind: "getMany",
            collection: targetModel.source.path,
            idsFrom: relation.from,
            fieldMask,
            dependents: nestedDependents,
        }
        op = getManyOp
    }

    allOps.push(op)

    return {
        fieldName: selection.name,
        foreignKey: relation.from,
        relationType: relation.type,
        op,
    }
}

function planModelSelection(
    modelName: string,
    id: string,
    selections: QueryField[],
    models: Map<string, ModelDefinition>,
    ctx: QueryContext,
    allOps: ExecutionOp[]
): GetOneOp {
    const model = models.get(modelName)
    if (model === undefined) {
        throw new PlanError(`model '${modelName}' is not registered`)
    }

    if (model.auth !== undefined && !model.auth(ctx)) {
        throw new PlanError(`unauthorized access to model '${modelName}'`)
    }

    const { scalarMask, dependents } = resolveSelections(
        selections,
        model,
        models,
        ctx,
        allOps
    )

    const relationForeignKeys = dependents.map((d) => d.foreignKey)
    const fieldMask = Array.from(new Set([...scalarMask, ...relationForeignKeys]))

    const op: GetOneOp = {
        kind: "getOne",
        collection: model.source.path,
        id,
        fieldMask,
        dependents,
    }

    allOps.push(op)
    return op
}

export function buildExecutionPlan(
    queryNode: QueryNode,
    models: Map<string, ModelDefinition>,
    ctx: QueryContext
): ExecutionPlan {
    const allOps: ExecutionOp[] = []

    const rootOp = planModelSelection(
        queryNode.model,
        queryNode.id,
        queryNode.selections,
        models,
        ctx,
        allOps
    )

    return { root: rootOp, ops: allOps }
}

const INEQUALITY_OPS = new Set(["!=", "<", "<=", ">", ">="])

function validateFirestoreConstraints(
    filters: WhereClause[],
    orderBy?: { field: string; direction: "asc" | "desc" }
): void {
    const inequalityFields = [
        ...new Set(
            filters
                .filter((f) => INEQUALITY_OPS.has(f.operator))
                .map((f) => f.field)
        ),
    ]

    if (inequalityFields.length > 1) {
        throw new PlanError(
            `Firestore only allows inequality filters (!=, <, <=, >, >=) on ONE field per query.\n` +
            `You have inequality filters on: [${inequalityFields.join(", ")}].\n` +
            `Fix: keep one inequality field in .filter() and handle the rest in memory after .get().`
        )
    }

    if (
        inequalityFields.length === 1 &&
        orderBy !== undefined &&
        orderBy.field !== inequalityFields[0]
    ) {
        throw new PlanError(
            `Firestore requires orderBy to be on the same field as the inequality filter.`
        )
    }
}

function validateModelFields(
    filters: WhereClause[],
    selections: QueryField[],
    model: ModelDefinition
): void {
    const availableFields = Object.keys(model.fields).join(", ")

    for (const filter of filters) {
        const fieldDef = model.fields[filter.field]

        if (fieldDef === undefined) {
            throw new PlanError(
                `filter field '${filter.field}' does not exist on model '${model.source.path}'.\n` +
                `Available fields: [${availableFields}]`
            )
        }

        if (typeof fieldDef === "object" && "relation" in fieldDef) {
            throw new PlanError(
                `Use the scalar foreign key field instead (e.g. '${fieldDef.relation.from}').`
            )
        }
    }

    for (const selection of selections) {
        if (model.fields[selection.name] === undefined) {
            throw new PlanError(
                `selected field '${selection.name}' does not exist on model '${model.source.path}'.\n`
            )
        }
    }
}

export function buildCollectionPlan(
    queryNode: CollectionQueryNode,
    models: Map<string, ModelDefinition>,
    ctx: QueryContext
): CollectionExecutionPlan {
    const model = models.get(queryNode.model)

    if (model === undefined) {
        throw new PlanError(`model '${queryNode.model}' is not registered`)
    }

    if (model.auth !== undefined && !model.auth(ctx)) {
        throw new PlanError(`unauthorized access to model '${queryNode.model}'`)
    }

    validateModelFields(queryNode.filters, queryNode.selections, model)
    validateFirestoreConstraints(queryNode.filters, queryNode.orderBy)

    const allOps: ExecutionOp[] = []
    const { scalarMask, dependents } = resolveSelections(
        queryNode.selections,
        model,
        models,
        ctx,
        allOps
    )

    const relationForeignKeys = dependents.map((d) => d.foreignKey)
    const fieldMask = Array.from(new Set([...scalarMask, ...relationForeignKeys]))

    const plan: CollectionExecutionPlan = {
        collection: model.source.path,
        fieldMask,
        filters: queryNode.filters,
        dependents,
        selections: queryNode.selections,
    }

    if (queryNode.orderBy !== undefined) {
        plan.orderBy = queryNode.orderBy
    }

    if (queryNode.limit !== undefined) {
        plan.limit = queryNode.limit
    }

    return plan
}