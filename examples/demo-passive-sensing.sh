#!/bin/sh
# Demo: passive sensing. Two agents in two worktrees of one repo; one edits a
# file and the OTHER agent's `sync` surfaces it — without the first publishing
# anything. Self-contained and self-cleaning (isolated daemon + temp repo).
set -eu

NP="${NERVEPLANE:-bun run $(cd "$(dirname "$0")/.." && pwd)/src/index.ts}"
export NERVEPLANE_HOME="$(mktemp -d)"
export NERVEPLANE_PORT="${NERVEPLANE_PORT:-7831}"
API="http://127.0.0.1:${NERVEPLANE_PORT}/api/v1"
W="$(mktemp -d)"
cleanup() { $NP stop >/dev/null 2>&1 || true; rm -rf "$W" "$NERVEPLANE_HOME"; }
trap cleanup EXIT

echo "▶ setting up a repo with two worktrees…"
git init -q -b main "$W/demo"
git -C "$W/demo" config user.email d@d.dev; git -C "$W/demo" config user.name d
echo "# demo" > "$W/demo/README.md"; git -C "$W/demo" add -A; git -C "$W/demo" commit -q -m base
git -C "$W/demo" worktree add -q -b feat-a "$W/wt-a" >/dev/null 2>&1
git -C "$W/demo" worktree add -q -b feat-b "$W/wt-b" >/dev/null 2>&1

echo "▶ starting daemon (port $NERVEPLANE_PORT, isolated home)…"
$NP daemon >"$NERVEPLANE_HOME/daemon.log" 2>&1 &
sleep 2

post() { curl -s -X POST "$API/$1" -H 'content-type: application/json' -d "$2"; }
aid() { bun -e "console.log((await Bun.stdin.json()).agent_id)"; }

A=$(post register "{\"name\":\"backend-agent\",\"repo_path\":\"$W/wt-a\",\"worktree_path\":\"$W/wt-a\",\"branch\":\"feat-a\",\"base_branch\":\"main\"}" | aid)
B=$(post register "{\"name\":\"frontend-agent\",\"repo_path\":\"$W/wt-b\",\"worktree_path\":\"$W/wt-b\",\"branch\":\"feat-b\",\"base_branch\":\"main\"}" | aid)
echo "  registered backend-agent and frontend-agent (same repo, different worktrees)"

sleep 6  # baseline sensing tick (clean trees)

echo "▶ backend-agent edits a file — NO publish call…"
mkdir -p "$W/wt-a/src"; echo "export const report = () => 'v2'" > "$W/wt-a/src/report.ts"
sleep 6  # let the daemon sense it

echo "▶ frontend-agent calls sync:"
post "agents/$B/sync" '{}' | bun -e "
const s = await Bun.stdin.json();
for (const u of s.updates) console.log('   ⚡', u.severity, u.type, '—', u.summary, '|', u.reason);
if (!s.updates.length) console.log('   (nothing — unexpected)');
"
echo "✓ done — the change was surfaced with no cooperation from backend-agent."
