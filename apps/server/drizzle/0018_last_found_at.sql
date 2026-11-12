ALTER TABLE `booru_subscriptions` ADD `last_found_at` integer;--> statement-breakpoint
ALTER TABLE `download_feeds` ADD `last_found_at` integer;--> statement-breakpoint
-- Older checks that found something: their check time is the best guess.
UPDATE `booru_subscriptions` SET `last_found_at` = `last_check_at` WHERE `last_new` > 0;--> statement-breakpoint
UPDATE `download_feeds` SET `last_found_at` = `last_check_at` WHERE `last_new` > 0;
