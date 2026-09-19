const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseStripeSignature(header: string): { timestamp: number; signatures: string[] } | null {
  const parts = header.split(",");
  const signatures: string[] = [];
  let timestamp: number | null = null;

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t" && value) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }

  if (!timestamp || !Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export async function verifyStripeWebhookSignature(
  body: string,
  signatureHeader: string,
  secret: string,
  nowMs = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS
): Promise<boolean> {
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed) return false;

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - parsed.timestamp);
  if (ageSeconds > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parsed.timestamp}.${body}`)));
  return parsed.signatures.some(sig => constantTimeEqual(expected, sig));
}
