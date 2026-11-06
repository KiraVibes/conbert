CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`target_id` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`mod_time` text,
	`kind` text NOT NULL,
	`item_key` text,
	`sha256` text,
	`status` text DEFAULT 'present' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen_at` integer NOT NULL,
	`sorted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `storage_targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_path_idx` ON `media_items` (`target_id`,`path`);--> statement-breakpoint
CREATE INDEX `media_items_status_idx` ON `media_items` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `media_items_name_idx` ON `media_items` (`user_id`,`name`,`size`);--> statement-breakpoint
CREATE INDEX `media_items_sha_idx` ON `media_items` (`user_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `swipe_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`committed_at` integer,
	`error` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `swipe_actions_user_idx` ON `swipe_actions` (`user_id`,`committed_at`);