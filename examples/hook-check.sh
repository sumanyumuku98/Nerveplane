#!/bin/sh
# Verifies the last-mile Claude Code hook end-to-end: a high-severity warning
# routed to an agent is injected into the agent's context by `nerveplane hook`
# (the PreToolUse entrypoint). Self-contained/self-cleaning.
set -eu

NP="${NERVEPLANE:-bun run $(cd "$(dirname "$0")/.." && pwd)/src/index.ts}"
export NERVEPLANE_HOME="$(mktemp -d)"
export NERVEPLANE_PORT="${NERVEPLANE_PORT:-7833}"
API="http://127.0.0.1:${NERVEPLANE_PORT}/api/v1"
W="$(mktemp -d)"
cleanup() { $NP stop >/dev/null 2>&1 || true; rm -rf "$W" "$NERVEPLANE_HOME"; }
trap cleanup EXIT

git init -q -b main "$W/repo"; git -C "$W/repo" config user.email d@d.dev; git -C "$W/repo" config user.name d
echo x > "$W/repo/README.md"; git -C "$W/repo" add -A; git -C "$W/repo" commit -q -m base
git -C "$W/repo" worktree add -q -b a "$W/wt-a" >/dev/null 2>&1
git -C "$W/repo" worktree add -q -b b "$W/wt-b" >/dev/null 2>&1

$NP daemon >"$NERVEPLANE_HOME/daemon.log" 2>&1 &
sleep 2
post() { curl -s -X POST "$API/$1" -H 'content-type: application/json' -d "$2"; }
aid() { bun -e "console.log((await Bun.stdin.json()).agent_id)"; }

A=$(post register "{\"name\":\"agent-a\",\"repo_path\":\"$W/wt-a\",\"worktree_path\":\"$W/wt-a\"}" | aid)
B=$(post register "{\"name\":\"agent-b\",\"repo_path\":\"$W/wt-b\",\"worktree_path\":\"$W/wt-b\"}" | aid)
REPO=$(curl -s "$API/agents/$A" | bun -e "console.log((await Bun.stdin.json()).agent.repoId)")

echo "▶ agent-b publishes a HIGH warning into the repo…"
post publish "{\"producer_agent_id\":\"$B\",\"type\":\"api_contract_changed\",\"severity\":\"high\",\"summary\":\"POST /invoices changed\",\"repo_scope\":[\"$REPO\"],\"required_action\":\"update consumer before merge\"}" >/dev/null

echo "▶ invoking 'nerveplane hook' as Claude Code would (PreToolUse stdin), cwd=agent-a's worktree:"
OUT=$(printf '{"cwd":"%s","tool_name":"Edit"}' "$W/wt-a" | $NP hook)
# printf '%s' (not echo) so the JSON's \n escapes aren't mangled by /bin/sh.
printf '%s' "$OUT" | bun -e "const o=JSON.parse((await Bun.stdin.text()).trim()||'{}'); console.log('   '+(o.hookSpecificOutput?.additionalContext??'(none)').split('\n').join('\n   '))"
if printf '%s' "$OUT" | grep -q "POST /invoices changed"; then
  echo "✓ hook injected the high-severity warning before the edit."
else
  echo "✗ FAIL: hook did not inject the warning"; exit 1
fi
