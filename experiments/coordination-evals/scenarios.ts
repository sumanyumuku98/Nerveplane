import type { Scenario } from "./harness.ts";
import { readMerged } from "./harness.ts";

/**
 * NP-Bench Tier-A scenarios (deterministic). Each defines per-agent naive vs
 * coordinated edits; the harness picks coordinated in C1 iff Nerveplane warned
 * the agent (a prior teammate's sensed change touched a file it edits/consumes).
 * Continuity (memory) + lost-in-the-middle are Tier-B (live agents).
 */

// 1) SHARED-FILE — two agents rewrite the same file. C0 → git merge conflict;
//    C1 → B is warned A touched report.ts and splits its work into a new file.
const sharedFile: Scenario = {
  name: "shared-file",
  dependencyClass: "same-file overlap",
  base: { "src/report.ts": "export function report() {\n  return 'base';\n}\n" },
  agents: [
    {
      name: "A",
      touches: ["src/report.ts"],
      naive: { "src/report.ts": "export function report() {\n  return csv();\n}\nexport function csv() { return 'csv'; }\n" },
      coordinated: { "src/report.ts": "export function report() {\n  return csv();\n}\nexport function csv() { return 'csv'; }\n" },
    },
    {
      name: "B",
      touches: ["src/report.ts"],
      // naive: rewrites the SAME file/lines → conflicts with A
      naive: { "src/report.ts": "export function report() {\n  return pdf();\n}\nexport function pdf() { return 'pdf'; }\n" },
      // coordinated: warned A owns report.ts → put PDF in its own module (clean merge)
      coordinated: { "src/report_pdf.ts": "export function pdf() { return 'pdf'; }\n" },
    },
  ],
  expectWarned: ["B"],
};

// 2) CONTRACT — backend changes the invoice API shape; frontend consumes it.
//    Different files → git merge is always clean; the DIFFERENCE is correctness:
//    C0 → web built against the old shape (accept fails); C1 → web adapts.
const OLD_API = JSON.stringify({ invoice: { id: "string", total: "number" } }, null, 2) + "\n";
const NEW_API = JSON.stringify({ invoice: { id: "string", total: "number", currency: "string" } }, null, 2) + "\n";
const contract: Scenario = {
  name: "contract",
  dependencyClass: "producer→consumer contract",
  base: { "api/openapi.json": OLD_API, "web/invoice.ts": "export function render(inv: any) {\n  return `${inv.total}`;\n}\n" },
  agents: [
    {
      name: "backend",
      touches: ["api/openapi.json"],
      naive: { "api/openapi.json": NEW_API },
      coordinated: { "api/openapi.json": NEW_API },
    },
    {
      name: "frontend",
      touches: ["web/invoice.ts"],
      consumes: ["api/openapi.json"],
      naive: { "web/invoice.ts": "export function render(inv: any) {\n  return `${inv.total}`;\n}\n" }, // ignores currency
      coordinated: { "web/invoice.ts": "export function render(inv: any) {\n  return `${inv.total} ${inv.currency}`;\n}\n" },
    },
  ],
  expectWarned: ["frontend"],
  // acceptance: the consumer must render the new `currency` field the API added
  accept: (repo) => readMerged(repo, "web/invoice.ts").includes("currency") && readMerged(repo, "api/openapi.json").includes("currency"),
};

// 3) MICROSERVICE-CONTRACT-FANOUT — payments changes a contract that orders &
//    notifications consume; search-svc is unrelated. C1 must warn exactly the
//    two real consumers (routing accuracy), not search-svc.
const fanout: Scenario = {
  name: "microservice-fanout",
  dependencyClass: "cross-repo contract fan-out",
  base: {
    "payments/openapi.json": OLD_API,
    "orders/consume.ts": "export const total = (i:any)=>i.total;\n",
    "notifications/consume.ts": "export const msg = (i:any)=>`paid ${i.total}`;\n",
    "search/index.ts": "export const q = 'x';\n",
  },
  agents: [
    { name: "payments", touches: ["payments/openapi.json"], naive: { "payments/openapi.json": NEW_API }, coordinated: { "payments/openapi.json": NEW_API } },
    {
      name: "orders",
      touches: ["orders/consume.ts"],
      consumes: ["payments/openapi.json"],
      naive: { "orders/consume.ts": "export const total = (i:any)=>i.total;\n" },
      coordinated: { "orders/consume.ts": "export const total = (i:any)=>`${i.total} ${i.currency}`;\n" },
    },
    {
      name: "notifications",
      touches: ["notifications/consume.ts"],
      consumes: ["payments/openapi.json"],
      naive: { "notifications/consume.ts": "export const msg = (i:any)=>`paid ${i.total}`;\n" },
      coordinated: { "notifications/consume.ts": "export const msg = (i:any)=>`paid ${i.total} ${i.currency}`;\n" },
    },
    // unrelated service — must NOT be warned (false-positive routing guard)
    { name: "search", touches: ["search/index.ts"], naive: { "search/index.ts": "export const q = 'y';\n" }, coordinated: { "search/index.ts": "export const q = 'y';\n" } },
  ],
  expectWarned: ["orders", "notifications"],
  accept: (repo) => readMerged(repo, "orders/consume.ts").includes("currency") && readMerged(repo, "notifications/consume.ts").includes("currency"),
};

// 4) INDEPENDENT-CONTROL — no real dependency. C0 and C1 must be identical
//    (no warnings, no behavior change) → proves Nerveplane does ≈0 harm.
const independent: Scenario = {
  name: "independent-control",
  dependencyClass: "no dependency (control)",
  base: { "src/alpha.ts": "export const a=0;\n", "src/beta.ts": "export const b=0;\n" },
  agents: [
    { name: "A", touches: ["src/alpha.ts"], naive: { "src/alpha.ts": "export const a=1;\n" }, coordinated: { "src/alpha.ts": "export const a=1;\n" } },
    { name: "B", touches: ["src/beta.ts"], naive: { "src/beta.ts": "export const b=1;\n" }, coordinated: { "src/beta.ts": "export const b=1;\n" } },
  ],
  expectWarned: [],
};

export const SCENARIOS: Scenario[] = [sharedFile, contract, fanout, independent];
