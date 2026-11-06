CREATE TABLE `downloader_cookies` (
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `platform`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`platform` text NOT NULL,
	`tool` text NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`options` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`total` integer,
	`files` text NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`saved_to` text,
	`error_key` text,
	`error_details` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `downloads_user_idx` ON `downloads` (`user_id`);