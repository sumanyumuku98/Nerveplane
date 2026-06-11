CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text,
	`status` text NOT NULL,
	`current_task_id` text,
	`repo_id` text,
	`service_id` text,
	`worktree_path` text,
	`branch` text,
	`base_branch` text,
	`cwd` text,
	`metadata` text,
	`registered_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_agents_identity` ON `agents` (`name`,`worktree_path`);--> statement-breakpoint
CREATE INDEX `idx_agents_status` ON `agents` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agents_repo` ON `agents` (`repo_id`);--> statement-breakpoint
CREATE TABLE `capabilities` (
	`agent_id` text NOT NULL,
	`capability` text NOT NULL,
	PRIMARY KEY(`agent_id`, `capability`)
);
--> statement-breakpoint
CREATE TABLE `conflict_warnings` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`summary` text NOT NULL,
	`agent_ids_json` text,
	`repo_scope_json` text,
	`service_scope_json` text,
	`evidence_json` text,
	`suggested_action` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_conflicts_status` ON `conflict_warnings` (`status`);--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`service_id` text,
	`path` text,
	`version` text,
	`provider_service_id` text,
	`consumer_service_ids_json` text,
	`schema_hash` text,
	`last_changed_at` text
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`scope_json` text,
	`status` text NOT NULL,
	`created_by` text,
	`supersedes` text,
	`related_artifacts_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`recipient_agent_id` text NOT NULL,
	`priority` text NOT NULL,
	`reason` text,
	`required_action` text,
	`read_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_deliveries_recipient` ON `deliveries` (`recipient_agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deliveries_unread` ON `deliveries` (`recipient_agent_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`producer_agent_id` text,
	`severity` text NOT NULL,
	`summary` text NOT NULL,
	`body` text,
	`repo_scope_json` text,
	`service_scope_json` text,
	`affected_files_json` text,
	`affected_contracts_json` text,
	`artifacts_json` text,
	`required_action` text,
	`routing_reasons_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_created` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `events` (`type`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text,
	`sender_agent_id` text,
	`recipient_agent_id` text,
	`recipient_group` text,
	`subject` text,
	`body` text NOT NULL,
	`related_event_id` text,
	`priority` text NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_recipient` ON `messages` (`recipient_agent_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `repos` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`remote_url` text,
	`default_branch` text,
	`metadata_json` text
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_id` text,
	`owners_json` text,
	`deployment_unit` text,
	`metadata_json` text
);
--> statement-breakpoint
CREATE TABLE `suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`recipient_agent_id` text,
	`reason` text,
	`suppressed_until` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_suppressions_fp` ON `suppressions` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `sync_markers` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`last_sync_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`owner_agent_id` text,
	`requester_agent_id` text,
	`status` text NOT NULL,
	`required_capabilities_json` text,
	`repo_scope_json` text,
	`service_scope_json` text,
	`dependencies_json` text,
	`blockers_json` text,
	`input_artifacts_json` text,
	`output_artifacts_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_owner` ON `tasks` (`owner_agent_id`);