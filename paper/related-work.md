# Related work (SUM-153)

_Draft for author review. Citation keys are placeholders in `[[...]]`; exact
venue/year/authors must be verified in a citation pass (see "Citations to verify")
before submission — do not trust them as written._

## 7. Related work

**Multi-agent LLM frameworks.** A first wave of systems orchestrates multiple LLM
agents through roles and messages: [[AutoGen]] (conversable agents + a group-chat
manager), [[CrewAI]] (role/task crews), [[MetaGPT]] (an SOP-driven software company of
agents), and [[ChatDev]] (a virtual chat-driven dev org). These focus on *dividing
labor by role and passing messages*; coordination is emergent from conversation, and
none provides a *scheduling* guarantee that concurrently-editing agents will not
collide on shared files or stale contracts. Our planner is complementary: it takes the
work items such a framework produces and computes a disjoint-scope partition + merge
order before execution. **Positioning:** we target the *substrate* (who may touch what,
in what order), not the role/dialogue layer.

**Coding-agent benchmarks.** Evaluation of coding agents is dominated by
*single-agent, single-repo* task success: [[SWE-bench]] (resolve real GitHub issues)
and its variants [[SWE-bench-Verified]] / [[SWE-bench-Multimodal]], plus execution
benchmarks like [[HumanEval]] and [[LiveCodeBench]]. None measures **multi-agent
coordination**: whether N agents working in parallel integrate cleanly. NP-Bench adds
exactly this axis — outcomes of *concurrent* agents (clean-merge success, wasted work,
scope-leakage) rather than the correctness of one agent in isolation. **Positioning:**
NP-Bench is orthogonal to SWE-bench, measuring integration/coordination, not per-task
resolution.

**Conflict detection & developer coordination.** Awareness tools from software
engineering — e.g. [[Palantir]] and the "workspace awareness" line ([[Crystal]],
[[Cassandra]]) — warn developers of *potential* merge conflicts by watching parallel
edits. This is the intellectual ancestor of the **C1-detect** arm: valuable, but
*reactive* — the warning fires once a change is observed, which under agent-speed
concurrency is often *after* the wasted edit. Our contribution is to show, empirically,
that a *proactive* schedule (C1-plan) strictly dominates this reactive detection, and
that a vague reactive warning is ≈ no coordination on live agents.

**Scheduling & dependency-aware build/merge.** Framing coordination as scheduling
connects to classic task-graph scheduling (topological ordering, [[Kahn]]) and to
merge/build systems that exploit a dependency DAG ([[Bazel]]-style). We adapt the
disjoint-partition + topological-merge idea to *predicted code scopes* of LLM agents,
where the novel, non-obvious question is empirical: can scopes be predicted, and will
agents respect them?

**Agent memory & continuity.** A growing line gives agents long-term memory
([[MemGPT]], [[Generative-Agents]], retrieval-augmented scratchpads). Prior work mostly
studies memory *within* an agent's task. Our memory-continuity result studies a
*cross-session, cross-agent* effect — a decision recorded by one session prevents a
later, differently-sessioned agent from repeating a mistake — and isolates it as a
**capability-independent** (information, not reasoning) gain that holds equally on a
frontier and a weak model.

**Meta-agents / oversight.** Recent framing of "agents that manage agents"
([[meta-agents]] literature; the Meta-Agents workshop CFP) treats supervision and the
automated design of agent harnesses. A coordination planner is one such meta-level
control surface — it *governs* what other agents do. We frame the planner both as a
measurement target (Verify) and, in §9, as an oversight lever (Meta-Agents).

### Comparison table

| System / benchmark | Multi-agent? | Coordination guarantee | Proactive (vs reactive) | Measures parallel integration |
|---|---|---|---|---|
| AutoGen / CrewAI / MetaGPT / ChatDev | ✅ (roles/dialogue) | ❌ (emergent) | — | ❌ |
| SWE-bench (+ variants), HumanEval | ❌ (single agent) | n/a | n/a | ❌ |
| Workspace-awareness (Palantir/Crystal) | ✅ (humans) | ❌ (warn only) | ❌ reactive | partial (warns) |
| Build/merge DAG systems (Bazel-style) | n/a | ✅ (deps) | ✅ | ❌ (not agents) |
| Agent memory (MemGPT, gen-agents) | ~ | n/a | n/a | ❌ |
| **NP-Bench + planner (ours)** | ✅ | ✅ (disjoint scopes + merge order) | ✅ **proactive** | ✅ **CTSR / leakage / adaptation** |

### Citations to verify (do NOT submit unchecked)
AutoGen (Wu et al., Microsoft), CrewAI, MetaGPT (Hong et al.), ChatDev (Qian et al.),
SWE-bench (Jimenez et al.) + Verified/Multimodal, HumanEval (Chen et al.),
LiveCodeBench, Palantir / Crystal / Cassandra (workspace awareness; Sarma et al.),
Kahn (1962, topological sort), Bazel, MemGPT (Packer et al.), Generative Agents (Park
et al.), meta-agents workshop refs. Run a citation pass (WebSearch or the ACL/arXiv
anthology) to fix authors/venues/years and add bibkeys before the LaTeX build.
