-- Add missing better-auth-cloudflare geolocation columns to session table
ALTER TABLE `session` ADD COLUMN `timezone`   TEXT;
ALTER TABLE `session` ADD COLUMN `regionCode` TEXT;
ALTER TABLE `session` ADD COLUMN `colo`       TEXT;
