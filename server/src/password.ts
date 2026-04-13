/**
 * Shared password validation — imported by both the server (index.ts) and
 * the dashboard client (settings.tsx). Keeping it in one place ensures the
 * rules can never drift between frontend and backend.
 *
 * Rules:
 *  - Minimum 12 characters
 *  - At least one uppercase letter
 *  - At least one lowercase letter
 *  - At least one digit
 *  - At least one special character
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

/** Convenience: returns the first error message or null if valid. */
export function passwordError(password: string): string | null {
  const { errors } = validatePassword(password);
  return errors[0] ?? null;
}
