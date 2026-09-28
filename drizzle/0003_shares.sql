CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`note_id` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_unique` ON `shares` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `shares_account_note_idx` ON `shares` (`account_id`,`note_id`);