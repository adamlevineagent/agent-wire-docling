/**
 * Local type re-exports from generated OpenAPI schemas that api-client.ts
 * doesn't already surface. Kept in this folder so we don't need to edit
 * api-client.ts (out of Agent G scope).
 */

import type { components } from "../../lib/api-types";

type Schemas = components["schemas"];

export type StratumState = Schemas["StratumState"];
export type DocApproval = Schemas["DocApproval"];
