-- Migration: Add missing 'verified' column to twoFactor table
-- Better Auth's twoFactor plugin stores whether TOTP setup has been
-- confirmed by the user (i.e. they successfully scanned and verified
-- the QR code at least once).

ALTER TABLE `twoFactor` ADD COLUMN `verified` INTEGER DEFAULT 0;
