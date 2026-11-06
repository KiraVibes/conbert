CREATE TABLE `booru_accounts` (
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`username` text NOT NULL,
	`api_key` text NOT NULL,
	`tag_limit` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `site_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `booru_archive` (
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`post_id` integer NOT NULL,
	`md5` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `site_id`, `post_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booru_archive_md5_idx` ON `booru_archive` (`user_id`,`md5`);--> statement-breakpoint
CREATE TABLE `booru_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`api` text NOT NULL,
	`base_url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booru_instances_user_idx` ON `booru_instances` (`user_id`);--> statement-breakpoint
CREATE TABLE `booru_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`query` text NOT NULL,
	`options` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`state` text NOT NULL,
	`subscription_id` text,
	`resume_at` integer,
	`error_key` text,
	`error_details` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booru_jobs_user_idx` ON `booru_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `booru_jobs_status_idx` ON `booru_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `booru_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`lock_hash` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `booru_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`query` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`interval_hours` integer DEFAULT 24 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`options` text NOT NULL,
	`last_post_id` integer,
	`last_check_at` integer,
	`next_check_at` integer,
	`last_new` integer DEFAULT 0 NOT NULL,
	`total_loaded` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booru_subscriptions_user_idx` ON `booru_subscriptions` (`user_id`);