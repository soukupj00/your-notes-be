CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`role` text NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_unique` ON `accounts` (`username`);--> statement-breakpoint
CREATE TABLE `blobs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blobs_account_idx` ON `blobs` (`account_id`);--> statement-breakpoint
CREATE TABLE `codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`account_id` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `note_tags` (
	`account_id` text NOT NULL,
	`note_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`rev` integer NOT NULL,
	`seq` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `note_id`, `tag_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_tags_account_seq_idx` ON `note_tags` (`account_id`,`seq`);--> statement-breakpoint
CREATE TABLE `notes` (
	`account_id` text NOT NULL,
	`id` text NOT NULL,
	`rev` integer NOT NULL,
	`seq` integer NOT NULL,
	`header` text,
	`description` text,
	`body` text,
	`state` text NOT NULL,
	`pinned_at` text,
	`color` text,
	`trashed_at` text,
	`remind_at` text,
	`repeat` text,
	`attachments` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notes_account_seq_idx` ON `notes` (`account_id`,`seq`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`device_name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_account_idx` ON `sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`account_id` text NOT NULL,
	`id` text NOT NULL,
	`rev` integer NOT NULL,
	`seq` integer NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tags_account_seq_idx` ON `tags` (`account_id`,`seq`);--> statement-breakpoint
CREATE TABLE `tombstones` (
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`seq` integer NOT NULL,
	`deleted_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `kind`, `id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tombstones_account_seq_idx` ON `tombstones` (`account_id`,`seq`);