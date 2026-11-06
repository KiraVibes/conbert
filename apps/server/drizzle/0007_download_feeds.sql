CREATE TABLE `download_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`platform` text NOT NULL,
	`tool` text NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`name` text DEFAULT '' NOT NULL,
	`interval_minutes` integer DEFAULT 360 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`ended` integer DEFAULT false NOT NULL,
	`only_new` integer DEFAULT true NOT NULL,
	`initialized` integer DEFAULT false NOT NULL,
	`options` text NOT NULL,
	`last_check_at` integer,
	`next_check_at` integer,
	`last_new` integer DEFAULT 0 NOT NULL,
	`total_loaded` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `download_feeds_user_idx` ON `download_feeds` (`user_id`);--> statement-breakpoint
ALTER TABLE `downloads` ADD `feed_id` text;