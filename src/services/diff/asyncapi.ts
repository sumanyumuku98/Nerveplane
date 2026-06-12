import { parse as parseYaml } from "yaml";
import type { BreakingChange } from "./index.ts";

/**
 * Focused in-process AsyncAPI (v2) breaking-change detector — same philosophy as
 * the OpenAPI one (no external binary/library, fully controllable). Covers the
 * changes that break subscribers: removed channels/operations and removed or
 * retyped message-payload fields.
 */
type Json = Record<string, unknown>;
const OPS = ["publish", "subscribe"] as const;

function load(text: string): Json {
  return (parseYaml(text) ?? {}) as Json;
}

function deref(doc: Json, node: unknown): Json {
  if (node && typeof node === "object" && "$ref" in (node as Json)) {
    const ref = String((node as Json).$ref);
    const parts = ref.replace(/^#\//, "").split("/");
    let cur: unknown = doc;
    for (const p of parts) cur = (cur as Json)?.[p];
    return (cur as Json) ?? {};
  }
  return (node as Json) ?? {};
}

/** Map of payload property name → declared type for an operation's message. */
function payloadProps(doc: Json, op: Json): Map<string, string> {
  const msg = deref(doc, op.message);
  const payload = deref(doc, msg.payload);
  const props = (payload.properties as Json) ?? {};
  const out = new Map<string, string>();
  for (const [name, def] of Object.entries(props)) {
    const d = deref(doc, def);
    out.set(name, String(d.type ?? (d.$ref ? "ref" : "object")));
  }
  return out;
}

export function diffAsyncAPI(oldText: string, newText: string): BreakingChange[] {
  const oldDoc = load(oldText);
  const newDoc = load(newText);
  const changes: BreakingChange[] = [];

  const oldChannels = (oldDoc.channels as Json) ?? {};
  const newChannels = (newDoc.channels as Json) ?? {};

  for (const [ch, oldChanRaw] of Object.entries(oldChannels)) {
    const newChan = newChannels[ch] as Json | undefined;
    if (!newChan) {
      changes.push({ kind: "channel_removed", path: ch, detail: `channel "${ch}" removed`, breaking: true });
      continue;
    }
    const oldChan = oldChanRaw as Json;
    for (const op of OPS) {
      const oldOp = oldChan[op] as Json | undefined;
      if (!oldOp) continue;
      const where = `${ch} ${op}`;
      const newOp = newChan[op] as Json | undefined;
      if (!newOp) {
        changes.push({ kind: "operation_removed", path: where, detail: `operation ${where} removed`, breaking: true });
        continue;
      }
      const oldP = payloadProps(oldDoc, oldOp);
      const newP = payloadProps(newDoc, newOp);
      for (const [name, type] of oldP) {
        if (!newP.has(name)) {
          changes.push({ kind: "payload_field_removed", path: `${where} → ${name}`, detail: `payload field "${name}" removed`, breaking: true });
        } else if (newP.get(name) !== type) {
          changes.push({ kind: "payload_field_retyped", path: `${where} → ${name}`, detail: `payload field "${name}" type ${type} → ${newP.get(name)}`, breaking: true });
        }
      }
      for (const name of newP.keys()) {
        if (!oldP.has(name)) {
          changes.push({ kind: "payload_field_added", path: `${where} → ${name}`, detail: `payload field "${name}" added`, breaking: false });
        }
      }
    }
  }
  return changes;
}
