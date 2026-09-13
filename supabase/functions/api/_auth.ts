/**
 * _auth.ts — JWT signing/verification and PBKDF2 password hashing.
 *
 * Password format is identical to the Python database.py implementation:
 *   "{hex_salt}${hex_digest}"   PBKDF2-SHA-256, 600 000 iterations
 * This keeps all existing stored hashes valid without a migration.
 */

const ENC = new TextEncoder();

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2-SHA-256, 600 000 iterations)
// ---------------------------------------------------------------------------

function randomHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function passwordHash(
  password: string,
  salt?: string,
): Promise<string> {
  const s = salt ?? randomHex(16);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    ENC.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: ENC.encode(s), iterations: 600_000 },
    keyMaterial,
    256,
  );
  const hex = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${s}$${hex}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt] = stored.split("$");
  const hashed = await passwordHash(password, salt);
  // Constant-time comparison
  if (hashed.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < hashed.length; i++) {
    diff |= hashed.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Secure random password generation (mirrors Python generate_password)
// ---------------------------------------------------------------------------

export function generatePassword(length = 12): string {
  if (length < 6) throw new Error("Password must be at least 6 characters.");
  const groups = [
    "abcdefghijkmnopqrstuvwxyz",
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "23456789",
    "!@#$%&*?",
  ];
  const rand = (max: number) =>
    crypto.getRandomValues(new Uint32Array(1))[0] % max;
  const chars: string[] = groups.map((g) => g[rand(g.length)]);
  const alphabet = groups.join("");
  while (chars.length < length) chars.push(alphabet[rand(alphabet.length)]);
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ---------------------------------------------------------------------------
// JWT (HS-256)
// ---------------------------------------------------------------------------

function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function b64urlDecode(str: string): string {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    ENC.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface JwtPayload {
  sub: number;
  role: string;
  name: string;
  exp: number;
  [key: string]: unknown;
}

export async function signJwt(
  payload: JwtPayload,
  secret: string,
): Promise<string> {
  const header = b64url(ENC.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(ENC.encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  const key = await signingKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, ENC.encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(
  token: string,
  secret: string,
): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const key = await signingKey(secret);
  const sigBytes = Uint8Array.from(
    b64urlDecode(sigB64),
    (c) => c.charCodeAt(0),
  );
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, ENC.encode(data));
  if (!valid) return null;
  const payload: JwtPayload = JSON.parse(b64urlDecode(payloadB64));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
