/**
 * Shared password validation — mirrors the rules in server/src/password.ts.
 * Keeping them in sync ensures client and server always enforce the same policy.
 * If you change rules here, update server/src/password.ts too (and vice versa).
 */

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

const RULES: { test: (p: string) => boolean; message: string }[] = [
  { test: (p) => p.length >= 12, message: "At least 12 characters" },
  { test: (p) => /[A-Z]/.test(p), message: "At least one uppercase letter (A–Z)" },
  { test: (p) => /[a-z]/.test(p), message: "At least one lowercase letter (a–z)" },
  { test: (p) => /[0-9]/.test(p), message: "At least one number (0–9)" },
  { test: (p) => /[^A-Za-z0-9]/.test(p), message: "At least one special character (!@#$… etc.)" },
];

export function validatePassword(password: string): PasswordValidationResult {
  const errors = RULES.filter((r) => !r.test(password)).map((r) => r.message);
  return { valid: errors.length === 0, errors };
}

/** Returns the first failing rule message, or null if the password is valid. */
export function passwordError(password: string): string | null {
  const { errors } = validatePassword(password);
  return errors[0] ?? null;
}
