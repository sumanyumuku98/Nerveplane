import type { ContractType } from "../graph.ts";
import { diffOpenAPI } from "./openapi.ts";
import { diffGraphQL } from "./graphql.ts";

/** A normalized contract change, format-agnostic, so routing/eval don't care
 *  whether it came from OpenAPI, GraphQL, etc. */
export interface BreakingChange {
  kind: string; // e.g. "response_field_removed", "FIELD_REMOVED"
  path: string; // where in the contract
  detail: string; // human summary
  breaking: boolean;
}

/** Dispatch a contract diff by type. Unsupported types (asyncapi/protobuf in
 *  M3) return [] — the interface is ready for them later. */
export async function diffContract(type: ContractType, oldText: string, newText: string): Promise<BreakingChange[]> {
  switch (type) {
    case "openapi":
      return diffOpenAPI(oldText, newText);
    case "graphql":
      return diffGraphQL(oldText, newText);
    default:
      return [];
  }
}

export function breakingOnly(changes: BreakingChange[]): BreakingChange[] {
  return changes.filter((c) => c.breaking);
}
