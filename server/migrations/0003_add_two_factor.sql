-- Migration: Add twoFactor table for Better Auth twoFactor plugin
-- Needed for: TOTP (authenticator apps) and email OTP 2FA

CREATE TABLE IF NOT EXISTS `twoFactor` (
  `id`          TEXT    NOT NULL PRIMARY KEY,
  `secret`      TEXT    NOT NULL,
  `backupCodes` TEXT    NOT NULL,
  `userId`      TEXT    NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `twoFactor_userId` ON `twoFactor` (`userId`);

-- Add twoFactorEnabled flag to user table
ALTER TABLE `user` ADD COLUMN `twoFactorEnabled` INTEGER DEFAULT 0;
