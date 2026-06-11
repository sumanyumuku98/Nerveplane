CREATE TABLE `agent_worktree_state` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`repo_id` text,
	`changed_files_json` text,
	`branch` text,
	`head_sha` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `conflict_warnings` ADD `fingerprint` text;--> statement-breakpoint
CREATE INDEX `idx_conflicts_fp` ON `conflict_warnings` (`fingerprint`,`status`);