import type { ContractType } from "../graph.ts";
import { diffOpenAPI } from "./openapi.ts";
import { diffGraphQL } from "./graphql.ts";
import { diffAsyncAPI } from "./asyncapi.ts";
import { diffProtobuf } from "./protobuf.ts";

/** A normalized contract change, format-agnostic, so routing/eval don't care
 *  whether it came from OpenAPI, GraphQL, etc. */
export interface BreakingChange {
  kind: string; // e.g. "response_field_removed", "FIELD_REMOVED"
  path: string; // where in the contract
  detail: string; // human summary
  breaking: boolean;
}

/** Dispatch a contract diff by type. All four formats are detected in-process
 *  (no external binaries); event-name contracts have no file body to diff. */
export async function diffContract(type: ContractType, oldText: string, newText: string): Promise<BreakingChange[]> {
  switch (type) {
    case "openapi":
      return diffOpenAPI(oldText, newText);
    case "graphql":
      return diffGraphQL(oldText, newText);
    case "asyncapi":
      return diffAsyncAPI(oldText, newText);
    case "protobuf":
      return diffProtobuf(oldText, newText);
    default:
      return [];
  }
}

export function breakingOnly(changes: BreakingChange[]): BreakingChange[] {
  return changes.filter((c) => c.breaking);
}
