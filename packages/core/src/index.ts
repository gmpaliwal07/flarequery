export type {
    RelationType,
    RelationDefinition,
    ScalarType,
    RelationFieldDefinition,
    FieldDefinition,
    ModelDefinition,
    FirestoreCollectionRef,
    QueryContext,
    AuthRule,
    QueryField,
    QueryNode,
    ExecutionOp,
    GetOneOp,
    GetManyOp,
    DependentRelation,
    ExecutionPlan,
    FlareResult,
    FlareResponse,
    WhereOperator,
    WhereValue,
    WhereClause,
    OrderByClause,
    CollectionQueryNode,
    CollectionExecutionPlan,
    FlareCollectionResponse,
} from "./types.js"

// planner
export { buildExecutionPlan, PlanError } from "./planner/index.js"
export { buildCollectionPlan } from "./planner/index.js"

// executor
export { executePlan, ExecutionError } from "./executor/index.js"
export { executeCollectionPlan } from "./executor/index.js"
export { one, many } from "./types.js"
export type { FirestoreAdapter, DocumentSnapshot } from "./executor/index.js"