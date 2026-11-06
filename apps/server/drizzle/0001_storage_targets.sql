CREATE TABLE `storage_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`base_path` text DEFAULT '' NOT NULL,
	`as_target` integer DEFAULT true NOT NULL,
	`as_source` integer DEFAULT true NOT NULL,
	`conflict_policy` text DEFAULT 'rename' NOT NULL,
	`subfolder_pattern` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`settings` text NOT NULL,
	`secrets` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `storage_targets_user_idx` ON `storage_targets` (`user_id`);