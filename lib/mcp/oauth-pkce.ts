import { createHash, randomBytes } from "crypto";

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string
): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  return codeChallengeS256(codeVerifier) === codeChallenge;
}
