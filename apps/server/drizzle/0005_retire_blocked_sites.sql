-- Danbooru, e621 and e926 were taken out of the site list (Cloudflare blocks
-- server requests). Stored keys for them are useless, subscriptions pause.
DELETE FROM `booru_accounts` WHERE `site_id` IN ('danbooru', 'e621', 'e926');
--> statement-breakpoint
UPDATE `booru_subscriptions` SET `paused` = 1 WHERE `site_id` IN ('danbooru', 'e621', 'e926');
