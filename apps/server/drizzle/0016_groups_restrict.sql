-- Groups now take functions away instead of granting them: false = blocked
-- for the members, missing = open. "Everyone" always allows everything.
-- A group that already allowed some functions keeps exactly those: every
-- other function becomes blocked. A group without any (e.g. freshly imported
-- from LDAP) restricts nothing.
UPDATE `groups` SET `permissions` = CASE
  WHEN `builtin` IS NULL
    AND EXISTS (SELECT 1 FROM json_each(`groups`.`permissions`) AS p WHERE p.value = 1)
  THEN (
    SELECT json_group_object(f.value, json('false'))
    FROM json_each('["convert","serverConvert","downloader","booru","workflows","storage","media","ai","workshop","pdf","apiTokens"]') AS f
    WHERE coalesce(json_extract(`groups`.`permissions`, '$.' || f.value), 0) != 1
  )
  ELSE '{}'
END;
