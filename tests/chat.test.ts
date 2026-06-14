import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../src/storage/db.ts";
import { runMigrations } from "../src/storage/migrate.ts";
import { registerAgent } from "../src/core/registry.ts";
import { sendChat, replyChat, threadMessages, listThreads, waitForChat, threadKey } from "../src/core/chat.ts";
import { sendMessage, peekMessages } from "../src/core/inbox.ts";
import { formatHookContext } from "../src/cli/hook.ts";

getDb(join(mkdtempSync(join(tmpdir(), "np-chat-")), "test.db"));
runMigrations();

const REPO = mkdtempSync(join(tmpdir(), "np-chat-repo-"));
async function pair(suffix: string) {
  const a = await registerAgent({ name: "a" + suffix, repoPath: REPO, worktreePath: REPO + "/wt-a-" + suffix });
  const b = await registerAgent({ name: "b" + suffix, repoPath: REPO, worktreePath: REPO + "/wt-b-" + suffix });
  return { a, b };
}

test("sendChat groups a pair's messages into one deterministic thread", async () => {
  const { a, b } = await pair("1");
  const first = sendChat({ senderAgentId: a.id, recipientAgentId: b.id, body: "hi B" });
  const second = sendChat({ senderAgentId: b.id, recipientAgentId: a.id, body: "hi A" });
  expect(first.threadId).toBe(threadKey(a.id, b.id));
  expect(second.threadId).toBe(first.threadId); // both directions share the thread
  const history = threadMessages(first.threadId);
  expect(history.map((m) => m.body)).toEqual(["hi B", "hi A"]); // ascending order
});

test("replyChat targets the thread's other participant", async () => {
  const { a, b } = await pair("2");
  const { threadId } = sendChat({ senderAgentId: a.id, recipientAgentId: b.id, body: "question?" });
  const r = replyChat({ agentId: b.id, threadId, body: "answer." });
  expect(r.recipients).toEqual([a.id]);
  expect(threadMessages(threadId).length).toBe(2);
});

test("listThreads reports unread counts and last message for an agent", async () => {
  const { a, b } = await pair("3");
  sendChat({ senderAgentId: a.id, recipientAgentId: b.id, body: "one" });
  sendChat({ senderAgentId: a.id, recipientAgentId: b.id, body: "two" });
  const threads = listThreads(b.id);
  const t = threads.find((x) => x.threadId === threadKey(a.id, b.id));
  expect(t).toBeDefined();
  expect(t!.unread).toBe(2);
  expect(t!.lastMessage.body).toBe("two");
  expect(t!.participants.sort()).toEqual([a.id, b.id].sort());
});

// NOTE: bun runs all test files in one process and getDb() is a singleton, so
// every file shares one DB. Assertions below are scoped to a specific thread or
// message id to stay robust against cross-file writes (e.g. the announce test's
// broadcast to all active agents).

test("waitForChat returns immediately when an unread message already exists", async () => {
  const { a, b } = await pair("4");
  const t = threadKey(a.id, b.id);
  sendChat({ senderAgentId: a.id, recipientAgentId: b.id, body: "already here" });
  const res = await waitForChat(b.id, { threadId: t, timeoutMs: 2000 });
  expect(res.timedOut).toBe(false);
  expect(res.messages.some((m) => m.body === "already here")).toBe(true);
  // marked read → a subsequent thread-scoped wait times out
  const again = await waitForChat(b.id, { threadId: t, timeoutMs: 150 });
  expect(again.timedOut).toBe(true);
});

test("waitForChat wakes in real time when a message arrives mid-wait", async () => {
  const { a, b } = await pair("5");
  const t = threadKey(a.id, b.id);
  const waiting = waitForChat(b.id, { threadId: t, timeoutMs: 3000 });
  // deliver shortly after the wait starts
  setTimeout(() => sendChat({ senderAgentId: a.id, recipientAgentId: b.id, body: "live!" }), 50);
  const res = await waiting;
  expect(res.timedOut).toBe(false);
  expect(res.messages.some((m) => m.body === "live!")).toBe(true);
});

test("waitForChat times out cleanly when nothing arrives", async () => {
  const { a, b } = await pair("6");
  const res = await waitForChat(b.id, { threadId: threadKey(a.id, b.id), timeoutMs: 150 });
  expect(res.timedOut).toBe(true);
  expect(res.messages.length).toBe(0);
});

test("peekMessages surfaces unread DMs and the hook renders them", async () => {
  const { a, b } = await pair("7");
  const { id } = sendMessage({ senderAgentId: a.id, recipientAgentId: b.id, subject: "heads up", body: "API changing" });
  const msgs = peekMessages(b.id, { ack: true });
  expect(msgs.some((m) => m.id === id && m.body === "API changing")).toBe(true);
  const ctx = formatHookContext([], msgs);
  expect(ctx).toContain("new direct message");
  expect(ctx).toContain("API changing");
  expect(ctx).toContain("chat");
  // acked → the same message is not returned again
  expect(peekMessages(b.id, { ack: true }).some((m) => m.id === id)).toBe(false);
});
