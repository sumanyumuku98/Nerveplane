#!/bin/sh
# Demo: contract-aware cross-repo routing (spec §29). billing-service changes its
# OpenAPI contract; agents in checkout (direct), frontend (indirect) and e2e
# (test owner) get warned — unrelated repos do not. Self-contained/self-cleaning.
set -eu

NP="${NERVEPLANE:-bun run $(cd "$(dirname "$0")/.." && pwd)/src/index.ts}"
export NERVEPLANE_HOME="$(mktemp -d)"
export NERVEPLANE_PORT="${NERVEPLANE_PORT:-7832}"
API="http://127.0.0.1:${NERVEPLANE_PORT}/api/v1"
W="$(mktemp -d)"
cleanup() { $NP stop >/dev/null 2>&1 || true; rm -rf "$W" "$NERVEPLANE_HOME"; }
trap cleanup EXIT

mkrepo() { # $1=dir $2=remote
  git init -q -b main "$1"; git -C "$1" config user.email d@d.dev; git -C "$1" config user.name d
  echo x > "$1/README.md"; git -C "$1" add -A; git -C "$1" commit -q -m base
  git -C "$1" remote add origin "$2"
}
echo "▶ creating 5 service repos wired by a service graph…"
mkrepo "$W/billing"   "git@github.com:org/billing-service.git"
mkrepo "$W/checkout"  "git@github.com:org/checkout-service.git"
mkrepo "$W/frontend"  "git@github.com:org/frontend-web.git"
mkrepo "$W/e2e"       "git@github.com:org/e2e-tests.git"
mkrepo "$W/unrelated" "git@github.com:org/unrelated.git"

mkdir -p "$W/billing/openapi"
cat > "$W/billing/openapi/billing.yaml" <<'YAML'
openapi: 3.0.0
info: { title: billing, version: 1.0.0 }
paths:
  /invoices:
    post:
      responses:
        '200': { content: { application/json: { schema: { $ref: '#/components/schemas/Invoice' } } } }
components:
  schemas:
    Invoice: { properties: { invoice_id: { type: string }, total: { type: integer } } }
YAML
git -C "$W/billing" add -A; git -C "$W/billing" commit -q -m openapi
git -C "$W/billing" checkout -q -b feat-invoice-api

cat > "$W/services.yaml" <<'YAML'
services:
  billing-service:  { repo: git@github.com:org/billing-service.git,  provides: [{ openapi: openapi/billing.yaml }], consumed_by: [checkout-service] }
  checkout-service: { repo: git@github.com:org/checkout-service.git, consumes: [{ service: billing-service, api: POST /invoices }] }
  frontend-web:     { repo: git@github.com:org/frontend-web.git,     consumes: [{ service: checkout-service, api: POST /checkout }] }
  e2e-tests:        { repo: git@github.com:org/e2e-tests.git,        owns_integration_tests_for: [billing-service, checkout-service] }
  unrelated-service:{ repo: git@github.com:org/unrelated.git }
YAML

echo "▶ starting daemon + registering one agent per repo…"
$NP daemon >"$NERVEPLANE_HOME/daemon.log" 2>&1 &
sleep 2
post() { curl -s -X POST "$API/$1" -H 'content-type: application/json' -d "$2"; }
aid() { bun -e "console.log((await Bun.stdin.json()).agent_id)"; }
post register "{\"name\":\"billing-agent\",\"repo_path\":\"$W/billing\",\"branch\":\"feat-invoice-api\",\"base_branch\":\"main\"}" >/dev/null
CHK=$(post register "{\"name\":\"checkout-agent\",\"repo_path\":\"$W/checkout\"}" | aid)
FE=$(post register "{\"name\":\"frontend-agent\",\"repo_path\":\"$W/frontend\"}" | aid)
E2E=$(post register "{\"name\":\"e2e-agent\",\"repo_path\":\"$W/e2e\"}" | aid)
UNR=$(post register "{\"name\":\"unrelated-agent\",\"repo_path\":\"$W/unrelated\"}" | aid)
post services/scan "{\"path\":\"$W/services.yaml\"}" >/dev/null
sleep 6  # baseline

echo "▶ billing-agent rewrites POST /invoices (invoice_id→id, total→amount_cents)…"
cat > "$W/billing/openapi/billing.yaml" <<'YAML'
openapi: 3.0.0
info: { title: billing, version: 2.0.0 }
paths:
  /invoices:
    post:
      responses:
        '200': { content: { application/json: { schema: { $ref: '#/components/schemas/Invoice' } } } }
components:
  schemas:
    Invoice: { properties: { id: { type: string }, amount_cents: { type: integer } } }
YAML
sleep 7  # sense + diff + route

echo "▶ who got warned:"
for pair in "checkout:$CHK" "frontend:$FE" "e2e:$E2E" "unrelated:$UNR"; do
  name="${pair%%:*}"; id="${pair##*:}"
  post "agents/$id/sync" '{}' | bun -e "
const s=await Bun.stdin.json();
const c=s.updates.filter(u=>u.type==='api_contract_changed');
console.log('   $name:', c.length?('⚠ '+c[0].priority+' — '+c[0].summary):'(nothing)');
"
done
echo "✓ done — consumers warned across repos, unrelated untouched."
