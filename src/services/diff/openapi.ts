import { parse as parseYaml } from "yaml";
import type { BreakingChange } from "./index.ts";

/**
 * Focused in-process OpenAPI breaking-change detector (plan M3, decided
 * in-process over bundling oasdiff). Covers the changes that matter for
 * consumer-side agents: removed endpoints, removed/retyped response fields, and
 * newly-required request fields — including the demo's `invoice_id→id`,
 * `total→amount_cents` renames (surfaced as removed response fields).
 *
 * `oasdiff` (470 checks) can later be swapped in behind diffContract() without
 * touching callers.
 */

type Json = Record<string, unknown>;
const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function load(text: string): Json {
  return (parseYaml(text) ?? {}) as Json;
}

/** Resolve a one-level local $ref into components.schemas. */
function deref(doc: Json, schema: unknown): Json {
  if (schema && typeof schema === "object" && "$ref" in (schema as Json)) {
    const ref = String((schema as Json).$ref);
    const name = ref.split("/").pop()!;
    const schemas = ((doc.components as Json)?.schemas as Json) ?? {};
    return (schemas[name] as Json) ?? {};
  }
  return (schema as Json) ?? {};
}

/** Property name → declared type for an object schema (one level deep). */
function propTypes(doc: Json, schema: unknown): Map<string, string> {
  const s = deref(doc, schema);
  const props = (s.properties as Json) ?? {};
  const out = new Map<string, string>();
  for (const [name, def] of Object.entries(props)) {
    const d = deref(doc, def);
    out.set(name, String(d.type ?? (d.$ref ? "ref" : "object")));
  }
  return out;
}

function jsonResponseSchema(doc: Json, op: Json): unknown {
  const responses = (op.responses as Json) ?? {};
  for (const status of ["200", "201", "default"]) {
    const r = deref(doc, responses[status]);
    const schema = ((r.content as Json)?.["application/json"] as Json)?.schema;
    if (schema) return schema;
  }
  return undefined;
}

function requiredRequestProps(doc: Json, op: Json): Set<string> {
  const rb = deref(doc, op.requestBody);
  const schema = deref(doc, ((rb.content as Json)?.["application/json"] as Json)?.schema);
  return new Set((schema.required as string[]) ?? []);
}

export function diffOpenAPI(oldText: string, newText: string): BreakingChange[] {
  const oldDoc = load(oldText);
  const newDoc = load(newText);
  const changes: BreakingChange[] = [];

  const oldPaths = (oldDoc.paths as Json) ?? {};
  const newPaths = (newDoc.paths as Json) ?? {};

  for (const [path, oldItem] of Object.entries(oldPaths)) {
    const newItem = newPaths[path] as Json | undefined;
    if (!newItem) {
      changes.push({ kind: "endpoint_removed", path, detail: `path ${path} removed`, breaking: true });
      continue;
    }
    for (const method of METHODS) {
      const oldOp = (oldItem as Json)[method] as Json | undefined;
      if (!oldOp) continue;
      const newOp = newItem[method] as Json | undefined;
      const where = `${method.toUpperCase()} ${path}`;
      if (!newOp) {
        changes.push({ kind: "operation_removed", path: where, detail: `operation ${where} removed`, breaking: true });
        continue;
      }

      // Response fields removed or retyped → breaking for consumers reading them.
      const oldResp = propTypes(oldDoc, jsonResponseSchema(oldDoc, oldOp));
      const newResp = propTypes(newDoc, jsonResponseSchema(newDoc, newOp));
      for (const [name, type] of oldResp) {
        if (!newResp.has(name)) {
          changes.push({ kind: "response_field_removed", path: `${where} → ${name}`, detail: `response field "${name}" removed`, breaking: true });
        } else if (newResp.get(name) !== type) {
          changes.push({ kind: "response_field_retyped", path: `${where} → ${name}`, detail: `response field "${name}" type ${type} → ${newResp.get(name)}`, breaking: true });
        }
      }
      for (const name of newResp.keys()) {
        if (!oldResp.has(name)) {
          changes.push({ kind: "response_field_added", path: `${where} → ${name}`, detail: `response field "${name}" added`, breaking: false });
        }
      }

      // Newly-required request fields → breaking for existing callers.
      const oldReq = requiredRequestProps(oldDoc, oldOp);
      const newReq = requiredRequestProps(newDoc, newOp);
      for (const name of newReq) {
        if (!oldReq.has(name)) {
          changes.push({ kind: "request_field_newly_required", path: `${where} → ${name}`, detail: `request field "${name}" is now required`, breaking: true });
        }
      }
    }
  }

  return changes;
}
