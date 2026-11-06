-- Until now Gelbooru's image servers answered Conbert with an HTML page
-- (missing Referer), so every "downloaded" Gelbooru post is broken. Forget
-- them in the duplicate archive so they can be loaded again.
DELETE FROM `booru_archive` WHERE `site_id` = 'gelbooru';
