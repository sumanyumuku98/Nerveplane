# Monorepo example (M2 fixture)

Scenario for the M2 conflict-detection eval harness: multiple agents working in
separate git worktrees of one repo, where two touch the same file (expected:
high-severity warning) or the same package (expected: medium-severity warning).

To be fleshed out in M2 with a scripted seeded-conflict scenario that measures
detection precision / recall and time-to-notification.
