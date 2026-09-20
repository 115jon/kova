-- Better Auth 1.6 twoFactor schema added lockout fields after 0004.
ALTER TABLE `twoFactor` ADD COLUMN `failedVerificationCount` INTEGER DEFAULT 0;
ALTER TABLE `twoFactor` ADD COLUMN `lockedUntil` INTEGER;
