import type { BreakingChange } from "./index.ts";

/**
 * Focused in-process protobuf breaking-change detector (no `buf` binary needed,
 * consistent with the other in-process detectors). Catches the wire-breaking
 * changes: removed messages, removed fields, and changed field numbers/types.
 * Handles flat (non-nested) message blocks — sufficient for typical contracts.
 */
interface Field {
  type: string;
  number: string;
}
type Message = Map<string, Field>; // fieldName -> {type, number}

function parseMessages(text: string): Map<string, Message> {
  const messages = new Map<string, Message>();
  const msgRe = /message\s+(\w+)\s*\{([\s\S]*?)\n\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = msgRe.exec(text))) {
    const name = m[1]!;
    const body = m[2]!;
    const fields: Message = new Map();
    const fieldRe = /^\s*(?:repeated\s+|optional\s+|required\s+)?([\w.]+)\s+(\w+)\s*=\s*(\d+)\s*;/gm;
    let f: RegExpExecArray | null;
    while ((f = fieldRe.exec(body))) {
      fields.set(f[2]!, { type: f[1]!, number: f[3]! });
    }
    messages.set(name, fields);
  }
  return messages;
}

export function diffProtobuf(oldText: string, newText: string): BreakingChange[] {
  const oldMsgs = parseMessages(oldText);
  const newMsgs = parseMessages(newText);
  const changes: BreakingChange[] = [];

  for (const [name, oldFields] of oldMsgs) {
    const newFields = newMsgs.get(name);
    if (!newFields) {
      changes.push({ kind: "message_removed", path: name, detail: `message "${name}" removed`, breaking: true });
      continue;
    }
    for (const [fname, f] of oldFields) {
      const nf = newFields.get(fname);
      if (!nf) {
        changes.push({ kind: "field_removed", path: `${name}.${fname}`, detail: `field "${fname}" removed`, breaking: true });
      } else if (nf.number !== f.number) {
        changes.push({ kind: "field_number_changed", path: `${name}.${fname}`, detail: `field "${fname}" number ${f.number} → ${nf.number}`, breaking: true });
      } else if (nf.type !== f.type) {
        changes.push({ kind: "field_type_changed", path: `${name}.${fname}`, detail: `field "${fname}" type ${f.type} → ${nf.type}`, breaking: true });
      }
    }
    for (const fname of newFields.keys()) {
      if (!oldFields.has(fname)) {
        changes.push({ kind: "field_added", path: `${name}.${fname}`, detail: `field "${fname}" added`, breaking: false });
      }
    }
  }
  return changes;
}
