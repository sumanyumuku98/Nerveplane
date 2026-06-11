<script lang="ts">
  type Dict = Record<string, any>;

  let data = $state<Dict>({ agents: [], tasks: [], events: [], conflicts: [], decisions: [], services: [], contracts: [] });
  let tab = $state<"agents" | "tasks" | "timeline" | "conflicts" | "decisions" | "services">("agents");
  let connected = $state(false);
  let announce = $state({ subject: "", body: "" });

  async function api(path: string, method = "GET", body?: unknown): Promise<any> {
    const r = await fetch("/api/v1" + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  }

  async function load() {
    data = await api("/dashboard");
  }

  // Initial load + live refresh via SSE (each event is a "something changed" signal).
  $effect(() => {
    load();
    const es = new EventSource("/events");
    let timer: ReturnType<typeof setTimeout> | null = null;
    es.onopen = () => (connected = true);
    es.onerror = () => (connected = false);
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        data = { ...data, events: [evt, ...data.events].slice(0, 100) };
      } catch {}
      if (!timer) timer = setTimeout(() => { timer = null; load(); }, 400); // debounce refetch
    };
    return () => es.close();
  });

  const openConflicts = $derived(data.conflicts.filter((c: Dict) => c.status === "open"));
  const sev = (s: string) => ({ info: "#888", low: "#5a8", medium: "#d90", high: "#e63", blocking: "#c00" })[s] ?? "#888";

  async function resolveConflict(id: string) { await api(`/conflicts/${id}/resolve`, "POST", {}); load(); }
  async function dismissConflict(id: string) { await api(`/conflicts/${id}/dismiss`, "POST", { reason: "dismissed from dashboard" }); load(); }
  async function setDecision(id: string, status: string) { await api(`/decisions/${id}/status`, "POST", { status }); load(); }
  async function sendAnnounce() {
    if (!announce.body.trim()) return;
    await api("/announce", "POST", { subject: announce.subject, body: announce.body, priority: "high" });
    announce = { subject: "", body: "" };
  }
</script>

<header>
  <h1>🧠 Nerveplane</h1>
  <span class="conn" class:on={connected}>{connected ? "live" : "offline"}</span>
</header>

<nav>
  {#each ["agents", "tasks", "timeline", "conflicts", "decisions", "services"] as t}
    <button class:active={tab === t} onclick={() => (tab = t as typeof tab)}>
      {t}{t === "conflicts" && openConflicts.length ? ` (${openConflicts.length})` : ""}
    </button>
  {/each}
</nav>

<main>
  {#if tab === "agents"}
    <table>
      <thead><tr><th>status</th><th>name</th><th>branch</th><th>capabilities</th></tr></thead>
      <tbody>
        {#each data.agents as a}
          <tr><td><span class="dot" style="background:{a.status === 'offline' ? '#aaa' : '#3a3'}"></span>{a.status}</td>
          <td>{a.name}</td><td>{a.branch ?? "—"}</td><td class="muted">{(a.capabilities ?? []).join(", ")}</td></tr>
        {/each}
        {#if !data.agents.length}<tr><td colspan="4" class="muted">no agents registered</td></tr>{/if}
      </tbody>
    </table>

  {:else if tab === "tasks"}
    <table>
      <thead><tr><th>status</th><th>title</th><th>owner</th></tr></thead>
      <tbody>
        {#each data.tasks as t}<tr><td>{t.status}</td><td>{t.title}</td><td class="muted">{t.ownerAgentId ?? "—"}</td></tr>{/each}
        {#if !data.tasks.length}<tr><td colspan="3" class="muted">no open tasks</td></tr>{/if}
      </tbody>
    </table>

  {:else if tab === "timeline"}
    <ul class="timeline">
      {#each data.events as e}
        <li><span class="pill" style="background:{sev(e.severity)}">{e.severity}</span>
          <span class="type">{e.type}</span> {e.summary}
          <time>{new Date(e.createdAt).toLocaleTimeString()}</time></li>
      {/each}
      {#if !data.events.length}<li class="muted">no events yet</li>{/if}
    </ul>

  {:else if tab === "conflicts"}
    {#each openConflicts as c}
      <div class="card">
        <div><span class="pill" style="background:{sev(c.severity)}">{c.severity}</span> <b>{c.type}</b></div>
        <div>{c.summary}</div>
        {#if c.suggestedAction}<div class="muted">→ {c.suggestedAction}</div>{/if}
        <div class="actions">
          <button onclick={() => resolveConflict(c.id)}>Resolve</button>
          <button class="ghost" onclick={() => dismissConflict(c.id)}>Dismiss</button>
        </div>
      </div>
    {/each}
    {#if !openConflicts.length}<p class="muted">no open conflicts 🎉</p>{/if}

  {:else if tab === "decisions"}
    {#each data.decisions as d}
      <div class="card">
        <div><b>{d.title}</b> <span class="muted">[{d.status}]</span></div>
        {#if d.description}<div class="muted">{d.description}</div>{/if}
        <div class="actions">
          <button onclick={() => setDecision(d.id, "active")}>Approve</button>
          <button class="ghost" onclick={() => setDecision(d.id, "rejected")}>Reject</button>
        </div>
      </div>
    {/each}
    {#if !data.decisions.length}<p class="muted">no decisions recorded</p>{/if}

  {:else if tab === "services"}
    <h3>Services</h3>
    <ul>{#each data.services as s}<li>{s.name}</li>{/each}{#if !data.services.length}<li class="muted">none (run `nerveplane service scan`)</li>{/if}</ul>
    <h3>Contracts</h3>
    <ul>{#each data.contracts as ct}<li><b>{ct.type}</b> {ct.name} <span class="muted">{ct.path ?? ""} ({ct.serviceId})</span></li>{/each}</ul>
  {/if}

  <section class="announce">
    <h3>Broadcast announcement</h3>
    <input placeholder="subject" bind:value={announce.subject} />
    <input placeholder="message to all active agents…" bind:value={announce.body} onkeydown={(e) => e.key === "Enter" && sendAnnounce()} />
    <button onclick={sendAnnounce}>Send</button>
  </section>
</main>

<style>
  :global(body) { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: #0e1116; color: #e6e6e6; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #222; }
  h1 { font-size: 18px; margin: 0; }
  .conn { font-size: 12px; color: #888; border: 1px solid #333; border-radius: 10px; padding: 1px 8px; }
  .conn.on { color: #3a3; border-color: #2a4; }
  nav { display: flex; gap: 4px; padding: 8px 16px; border-bottom: 1px solid #222; }
  nav button { background: none; border: 0; color: #aaa; padding: 6px 12px; border-radius: 6px; cursor: pointer; text-transform: capitalize; }
  nav button.active { background: #1d2530; color: #fff; }
  main { padding: 16px 20px; max-width: 900px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #1c222b; }
  th { color: #888; font-weight: 500; font-size: 12px; }
  .muted { color: #777; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .pill { color: #111; border-radius: 4px; padding: 1px 6px; font-size: 11px; font-weight: 600; }
  .type { color: #79b8ff; font-family: ui-monospace, monospace; font-size: 12px; }
  .timeline { list-style: none; padding: 0; }
  .timeline li { padding: 6px 0; border-bottom: 1px solid #1c222b; display: flex; gap: 8px; align-items: center; }
  .timeline time { margin-left: auto; color: #666; font-size: 12px; }
  .card { background: #151b23; border: 1px solid #232c38; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
  .actions { margin-top: 8px; display: flex; gap: 8px; }
  .actions button { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 5px 12px; cursor: pointer; }
  .actions button.ghost { background: #2a2f38; }
  .announce { margin-top: 28px; border-top: 1px solid #222; padding-top: 16px; }
  .announce input { background: #151b23; border: 1px solid #2a323d; color: #eee; border-radius: 6px; padding: 6px 10px; margin-right: 8px; }
  .announce button { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
</style>
