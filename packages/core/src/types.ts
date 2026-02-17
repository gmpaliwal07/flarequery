export type RelationType = "one" | "many";

export interface RelationDefinition {
    from: string;
    to: string;
    type: RelationType;
}

export type ScalarType = "string" | "number" | "boolean" | "timestamp"

export interface RelationFieldDefinition {

    relation: RelationDefinition;
    select?: string[];

}

export type FieldDefinition = ScalarType | RelationFieldDefinition

export interface ModelDefinition {
    source: FirestoreCollectionRef
    fields: Record<string, FieldDefinition>
    auth?: AuthRule
}

export type AuthRule = (ctx: QueryContext) => boolean
export interface QueryContext {
    userId: string | null;
    token: Record<string, unknown> | null;
}
export interface FirestoreCollectionRef {
    readonly path: string;
}

export interface QueryField {
    name: string;
    children: QueryField[]
}

export interface QueryNode {
    model: string;
    id: string;
    selections: QueryField[];
}

export type ExecutionOp = | GetOneOp
    | GetManyOp

export interface GetOneOp {
    kind: "getOne"
    collection: string
    id: string
    fieldMask: string[]
    dependents: DependentRelation[]
}
export interface GetManyOp {
    kind: "getMany"
    collection: string
    idsFrom: string
    fieldMask: string[]
    dependents: DependentRelation[]
}

export interface DependentRelation {
    fieldName: string
    foreignKey: string;
    relationType: RelationType;
    op: ExecutionOp;
}

export interface ExecutionPlan {
    root: ExecutionOp;
    ops: ExecutionOp[]
}

export type FlareResult = Record<string, unknown>

export interface FlareResponse {
    data: FlareResult | null;
    errors?: string[];
}