import {
    buildCollectionPlan,
    buildExecutionPlan,
    executeCollectionPlan,
    executePlan,
    FirestoreAdapter,
    FlareCollectionResponse,
    FlareResponse,
    ModelDefinition,
    QueryContext,
    QueryField,
    QueryNode,
    CollectionQueryNode,
    WhereClause,
    WhereOperator,
    WhereValue,
    OrderByClause,
} from "@flarequery/core"

export interface CollectionReference {
    /**
     * Fetch a single document by ID.
     * @example app.collection("Product").doc("abc123")
     */
    doc(id: string): DocumentReference

    /**
     * Start a collection query with a filter.
     * @example app.collection("Product").filter("oem").equals("Canon")
     */
    filter(field: string): FilterBuilder
}

export interface DocumentReference {
    /**
     * Select specific fields to fetch. Use dot notation for relations.
     * @example .select("name", "price", "participants.name")
     */
    select(...fields: string[]): Query
}

export interface Query {
    get(ctx: QueryContext): Promise<FlareResponse>
}


/**
 * FilterBuilder — returned by .filter("fieldName")
 * @example
 *   .filter("oem").equals("Canon")
 *   .filter("price").gte(100)
 *   .filter("price").gte(100).lte(500)
 *   .filter("status").in(["New", "Clearout"])
 *   .filter("tags").contains("laser")
 *   .filter("status").not("Discontinued")
 */
export interface FilterBuilder {
    equals(value: string | number | boolean): CollectionQuery

    not(value: string | number | boolean): CollectionQuery

    gt(value: number | string): CollectionQuery
    gte(value: number | string): CollectionQuery
    lt(value: number | string): CollectionQuery
    lte(value: number | string): CollectionQuery

    in(values: (string | number)[]): CollectionQuery

    contains(value: string | number): CollectionQuery
}

/**
 * CollectionQuery — the chainable query builder.
 * @example
 *   app.collection("Product")
 *     .filter("oem").equals("Canon")
 *     .filter("isActive").equals(true)
 *     .filter("price").gte(50)
 *     .select("name", "price", "rtsPN")
 *     .orderBy("name", "asc")
 *     .limit(50)
 *     .get(ctx)
 */
export interface CollectionQuery {
    filter(field: string): FilterBuilder

    select(...fields: string[]): CollectionQuery

    orderBy(field: string, direction: "asc" | "desc"): CollectionQuery

    limit(n: number): CollectionQuery

    get(ctx: QueryContext): Promise<FlareCollectionResponse>
}

class CollectionReferenceImpl implements CollectionReference {
    constructor(
        private readonly modelName: string,
        private readonly models: Map<string, ModelDefinition>,
        private readonly adapter: FirestoreAdapter
    ) { }

    doc(id: string): DocumentReference {
        return new DocumentReferenceImpl(
            this.modelName,
            id,
            this.models,
            this.adapter
        )
    }

    filter(field: string): FilterBuilder {
        return new FilterBuilderImpl(
            field,
            this.modelName,
            [],
            [],
            undefined,
            undefined,
            this.models,
            this.adapter
        )
    }
}

class DocumentReferenceImpl implements DocumentReference {
    constructor(
        private readonly modelName: string,
        private readonly docId: string,
        private readonly models: Map<string, ModelDefinition>,
        private readonly adapter: FirestoreAdapter
    ) { }

    select(...fields: string[]): Query {
        return new QueryImpl(
            this.modelName,
            this.docId,
            fields,
            this.models,
            this.adapter
        )
    }
}

class QueryImpl implements Query {
    constructor(
        private readonly modelName: string,
        private readonly docId: string,
        private readonly fields: string[],
        private readonly models: Map<string, ModelDefinition>,
        private readonly adapter: FirestoreAdapter
    ) { }

    async get(ctx: QueryContext): Promise<FlareResponse> {
        const queryNode = buildQueryNode(this.modelName, this.docId, this.fields)
        const plan = buildExecutionPlan(queryNode, this.models, ctx)
        return executePlan(plan, this.adapter)
    }
}


/**
 * FilterBuilderImpl — constructed by .filter("fieldName")
 */
class FilterBuilderImpl implements FilterBuilder {
    constructor(
        private readonly field: string,
        private readonly modelName: string,
        private readonly existingFilters: WhereClause[],
        private readonly selections: string[],
        private readonly orderByClause: OrderByClause | undefined,
        private readonly limitValue: number | undefined,
        private readonly models: Map<string, ModelDefinition>,
        private readonly adapter: FirestoreAdapter
    ) { }

    private next(operator: WhereOperator, value: WhereValue): CollectionQuery {
        const newFilter: WhereClause = { field: this.field, operator, value }
        return new CollectionQueryImpl(
            this.modelName,
            [...this.existingFilters, newFilter],
            this.selections,
            this.orderByClause,
            this.limitValue,
            this.models,
            this.adapter
        )
    }

    equals(value: string | number | boolean): CollectionQuery {
        return this.next("==", value)
    }

    not(value: string | number | boolean): CollectionQuery {
        return this.next("!=", value)
    }

    gt(value: number | string): CollectionQuery {
        return this.next(">", value)
    }

    gte(value: number | string): CollectionQuery {
        return this.next(">=", value)
    }

    lt(value: number | string): CollectionQuery {
        return this.next("<", value)
    }

    lte(value: number | string): CollectionQuery {
        return this.next("<=", value)
    }

    in(values: (string | number)[]): CollectionQuery {
        return this.next("in", values)
    }

    contains(value: string | number): CollectionQuery {
        return this.next("array-contains", value)
    }
}

/**
 * CollectionQueryImpl — the main collection query builder.
 */
class CollectionQueryImpl implements CollectionQuery {
    constructor(
        private readonly modelName: string,
        private readonly filters: WhereClause[],
        private readonly selectedFields: string[],
        private readonly orderByClause: OrderByClause | undefined,
        private readonly limitValue: number | undefined,
        private readonly models: Map<string, ModelDefinition>,
        private readonly adapter: FirestoreAdapter
    ) { }

    filter(field: string): FilterBuilder {
        return new FilterBuilderImpl(
            field,
            this.modelName,
            this.filters,
            this.selectedFields,
            this.orderByClause,
            this.limitValue,
            this.models,
            this.adapter
        )
    }

    select(...fields: string[]): CollectionQuery {
        return new CollectionQueryImpl(
            this.modelName,
            this.filters,
            fields,
            this.orderByClause,
            this.limitValue,
            this.models,
            this.adapter
        )
    }

    orderBy(field: string, direction: "asc" | "desc"): CollectionQuery {
        return new CollectionQueryImpl(
            this.modelName,
            this.filters,
            this.selectedFields,
            { field, direction },
            this.limitValue,
            this.models,
            this.adapter
        )
    }

    limit(n: number): CollectionQuery {
        return new CollectionQueryImpl(
            this.modelName,
            this.filters,
            this.selectedFields,
            this.orderByClause,
            n,
            this.models,
            this.adapter
        )
    }

    async get(ctx: QueryContext): Promise<FlareCollectionResponse> {
        const queryNode: CollectionQueryNode = {
            model: this.modelName,
            filters: this.filters,
            selections: parseFieldSelections(this.selectedFields),
        }

        if (this.orderByClause !== undefined) {
            queryNode.orderBy = this.orderByClause
        }

        if (this.limitValue !== undefined) {
            queryNode.limit = this.limitValue
        }

        const plan = buildCollectionPlan(queryNode, this.models, ctx)
        return executeCollectionPlan(plan, this.adapter)
    }
}


function buildQueryNode(modelName: string, id: string, fields: string[]): QueryNode {
    const selections = parseFieldSelections(fields)
    return { model: modelName, id, selections }
}

function addNestedField(parent: QueryField, parts: string[]): void {
    if (parts.length === 0) return

    const [current, ...rest] = parts
    const name = current!

    let child = parent.children.find((c) => c.name === name)
    if (!child) {
        child = { name, children: [] }
        parent.children.push(child)
    }

    if (rest.length > 0) {
        addNestedField(child, rest)
    }
}

function parseFieldSelections(fields: string[]): QueryField[] {
    const fieldMap = new Map<string, QueryField>()

    for (const field of fields) {
        const parts = field.split(".")

        if (parts.length === 1) {
            const name = parts[0]!
            if (!fieldMap.has(name)) {
                fieldMap.set(name, { name, children: [] })
            }
        } else {
            const [root, ...rest] = parts
            const rootName = root!

            if (!fieldMap.has(rootName)) {
                fieldMap.set(rootName, { name: rootName, children: [] })
            }

            const rootField = fieldMap.get(rootName)!
            addNestedField(rootField, rest)
        }
    }

    return Array.from(fieldMap.values())
}

export function createCollectionRef(
    modelName: string,
    models: Map<string, ModelDefinition>,
    adapter: FirestoreAdapter
): CollectionReference {
    return new CollectionReferenceImpl(modelName, models, adapter)
}