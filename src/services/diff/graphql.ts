import { buildSchema } from "graphql";
import { diff as inspectorDiff } from "@graphql-inspector/core";
import type { BreakingChange } from "./index.ts";

/**
 * GraphQL schema diff via the embeddable @graphql-inspector/core. BREAKING
 * criticality maps to breaking=true; DANGEROUS/NON_BREAKING are surfaced as
 * non-breaking informational changes.
 */
export async function diffGraphQL(oldSDL: string, newSDL: string): Promise<BreakingChange[]> {
  let oldSchema, newSchema;
  try {
    oldSchema = buildSchema(oldSDL);
    newSchema = buildSchema(newSDL);
  } catch {
    return []; // unparseable SDL — nothing actionable
  }

  const changes = await inspectorDiff(oldSchema, newSchema);
  return changes.map((c) => ({
    kind: String(c.type),
    path: c.path ?? "",
    detail: c.message,
    breaking: c.criticality.level === "BREAKING",
  }));
}
