import { test, expect } from "bun:test";
import { diffOpenAPI } from "../src/services/diff/openapi.ts";
import { diffGraphQL } from "../src/services/diff/graphql.ts";
import { breakingOnly } from "../src/services/diff/index.ts";

const oasOld = `
openapi: 3.0.0
info: { title: billing, version: 1.0.0 }
paths:
  /invoices:
    post:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Invoice' }
  /legacy:
    get:
      responses: { '200': { description: ok } }
components:
  schemas:
    Invoice:
      properties:
        invoice_id: { type: string }
        total: { type: integer }
`;

const oasNew = `
openapi: 3.0.0
info: { title: billing, version: 2.0.0 }
paths:
  /invoices:
    post:
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Invoice' }
components:
  schemas:
    Invoice:
      properties:
        id: { type: string }
        amount_cents: { type: integer }
`;

test("OpenAPI diff detects the demo's renamed response fields + removed endpoint as breaking", () => {
  const changes = diffOpenAPI(oasOld, oasNew);
  const breaking = breakingOnly(changes);
  const kinds = breaking.map((b) => `${b.kind}:${b.path}`);

  // invoice_id and total removed (the rename), /legacy endpoint removed.
  expect(kinds).toContain("response_field_removed:POST /invoices → invoice_id");
  expect(kinds).toContain("response_field_removed:POST /invoices → total");
  expect(kinds).toContain("endpoint_removed:/legacy");

  // Added fields are surfaced but NOT breaking.
  const added = changes.filter((c) => c.kind === "response_field_added");
  expect(added.length).toBe(2);
  expect(added.every((c) => !c.breaking)).toBe(true);
});

test("OpenAPI diff flags a newly-required request field", () => {
  const a = `openapi: 3.0.0
paths:
  /x:
    post:
      requestBody:
        content: { application/json: { schema: { type: object, required: [a] } } }
      responses: { '200': { description: ok } }`;
  const b = `openapi: 3.0.0
paths:
  /x:
    post:
      requestBody:
        content: { application/json: { schema: { type: object, required: [a, b] } } }
      responses: { '200': { description: ok } }`;
  const breaking = breakingOnly(diffOpenAPI(a, b));
  expect(breaking.some((c) => c.kind === "request_field_newly_required" && c.path.includes("b"))).toBe(true);
});

test("GraphQL diff flags a removed field as breaking", async () => {
  const before = `type Query { user: User }\ntype User { id: ID! name: String }`;
  const after = `type Query { user: User }\ntype User { id: ID! }`;
  const breaking = breakingOnly(await diffGraphQL(before, after));
  expect(breaking.length).toBeGreaterThanOrEqual(1);
  expect(breaking.some((c) => c.detail.toLowerCase().includes("name"))).toBe(true);
});

test("identical OpenAPI specs produce no breaking changes", () => {
  expect(breakingOnly(diffOpenAPI(oasOld, oasOld))).toEqual([]);
});
