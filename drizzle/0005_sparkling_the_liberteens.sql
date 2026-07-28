CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`author_agent_id` text,
	`kind` text DEFAULT 'note' NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`repo_id` text,
	`task_id` text,
	`branch` text,
	`service_id` text,
	`file` text,
	`tags_json` text,
	`pinned` integer DEFAULT false NOT NULL,
	`supersedes` text,
	`embedding` blob,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_memories_repo` ON `memories` (`repo_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_memories_task` ON `memories` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_memories_author` ON `memories` (`author_agent_id`);--> statement-breakpoint
CREATE VIRTUAL TABLE `memories_fts` USING fts5(title, body, content='memories', content_rowid='rowid');--> statement-breakpoint
CREATE TRIGGER `memories_ai` AFTER INSERT ON `memories` BEGIN
  INSERT INTO memories_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;--> statement-breakpoint
CREATE TRIGGER `memories_ad` AFTER DELETE ON `memories` BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
END;--> statement-breakpoint
CREATE TRIGGER `memories_au` AFTER UPDATE ON `memories` BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
  INSERT INTO memories_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;