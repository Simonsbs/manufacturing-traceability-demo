CREATE TABLE `access_keys` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer NOT NULL,
	`body_json` text NOT NULL,
	`previous_hash` text NOT NULL,
	`event_hash` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_revision` ON `audit` (`workspace_id`,`revision`);--> statement-breakpoint
CREATE TABLE `batches` (
	`workspace_id` text NOT NULL,
	`code` text NOT NULL,
	`material` text NOT NULL,
	`line` text NOT NULL,
	`planned_at` text NOT NULL,
	`specification_version` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `code`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`request_key` text NOT NULL,
	`digest` text NOT NULL,
	`source` text NOT NULL,
	`row_count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_request` ON `imports` (`workspace_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`row_id` text,
	`batch_code` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`field` text NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`detected_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`row_id`) REFERENCES `source_rows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_status` ON `issues` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `measurements` (
	`row_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`batch_code` text,
	`sample_id` text,
	`stage` text,
	`parameter` text,
	`value` real,
	`unit` text,
	`measured_at` text,
	`equipment` text,
	`effective_json` text NOT NULL,
	`version` integer NOT NULL,
	FOREIGN KEY (`row_id`) REFERENCES `source_rows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `measurement_batch` ON `measurements` (`workspace_id`,`batch_code`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`row_id` text NOT NULL,
	`base_version` integer NOT NULL,
	`field` text NOT NULL,
	`proposed_json` text NOT NULL,
	`reason` text NOT NULL,
	`submitted_by` text NOT NULL,
	`submitted_at` text NOT NULL,
	`status` text NOT NULL,
	`reviewed_by` text,
	`review_reason` text,
	`reviewed_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`row_id`) REFERENCES `source_rows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposal_workspace` ON `proposals` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `source_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`import_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`raw_json` text NOT NULL,
	`raw_hash` text NOT NULL,
	`natural_key` text,
	`duplicate_of` text,
	`duplicate_kind` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_ordinal` ON `source_rows` (`import_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `source_workspace` ON `source_rows` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`mutation_token` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_expiry` ON `workspaces` (`expires_at`);--> statement-breakpoint
CREATE INDEX `workspace_created` ON `workspaces` (`created_at`);