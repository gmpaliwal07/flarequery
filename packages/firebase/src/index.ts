export { createServerlessApp, extractContext } from "./app.js";
export type { ServerlessApp, ServerlessAppOptions } from "./app.js";

export type {
    CollectionReference,
    DocumentReference,
    Query
} from "./builder.js";

export { createFunction, createOnRequest } from "./function.js";
export type { FunctionOptions } from "./function.js";

export type {
    ModelDefinition,
    FieldDefinition,
    RelationDefinition,
    QueryContext,
    AuthRule,
    FlareResponse,
} from "@flarequery/core";