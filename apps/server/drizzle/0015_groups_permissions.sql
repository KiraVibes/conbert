CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_members_user_idx` ON `group_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`builtin` text,
	`permissions` text DEFAULT '{}' NOT NULL,
	`grants_admin` integer DEFAULT false NOT NULL,
	`ldap_dn` text,
	`proxy_name` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_idx` ON `groups` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `groups_ldap_dn_idx` ON `groups` (`ldap_dn`);--> statement-breakpoint
CREATE UNIQUE INDEX `groups_builtin_idx` ON `groups` (`builtin`);--> statement-breakpoint
ALTER TABLE `users` ADD `auth_source` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `ldap_dn` text;--> statement-breakpoint
ALTER TABLE `users` ADD `permission_overrides` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `users` SET `auth_source` = 'proxy' WHERE `password_hash` IS NULL;--> statement-breakpoint
INSERT INTO `groups` (`id`, `name`, `builtin`) VALUES ('everyone', 'everyone', 'everyone');
