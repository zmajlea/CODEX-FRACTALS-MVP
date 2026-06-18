"use client";

/**
 * Core encryption utilities using Web Crypto API.
 * AES-GCM with PBKDF2 key derivation.
 */

const PBKDF2_ITERATIONS = 250000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/** In-memory cache: password+salt → derived AES-GCM CryptoKey (avoids repeat PBKDF2). */
const derivedKeyCache = new Map<string, Promise<CryptoKey>>();

/** Cache PBKDF2 password import key per session password. */
const passwordImportKeyCache = new Map<string, Promise<CryptoKey>>();

function saltCacheKey(password: string, salt: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < salt.length; i++) {
    hex += salt[i].toString(16).padStart(2, "0");
  }
  return `${password}\0${hex}`;
}

/** Clear cached derived keys (e.g. on sign-out). */
export function clearDerivedKeyCache(): void {
  derivedKeyCache.clear();
  passwordImportKeyCache.clear();
}

async function getPasswordImportKey(password: string): Promise<CryptoKey> {
  let pending = passwordImportKeyCache.get(password);
  if (!pending) {
    const encoder = new TextEncoder();
    pending = crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );
    passwordImportKeyCache.set(password, pending);
    void pending.catch(() => {
      if (passwordImportKeyCache.get(password) === pending) {
        passwordImportKeyCache.delete(password);
      }
    });
  }
  return pending;
}

/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const passwordKey = await getPasswordImportKey(password);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function getOrDeriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const cacheKey = saltCacheKey(password, salt);
  let pending = derivedKeyCache.get(cacheKey);
  if (!pending) {
    pending = deriveKey(password, salt);
    derivedKeyCache.set(cacheKey, pending);
    void pending.catch(() => {
      if (derivedKeyCache.get(cacheKey) === pending) {
        derivedKeyCache.delete(cacheKey);
      }
    });
  }
  return pending;
}

/**
 * Encrypt string with password using AES-GCM
 */
export async function encryptStringWithPassword(
  plaintext: string,
  password: string
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const key = await getOrDeriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    data
  );

  const combined = new Uint8Array(
    SALT_LENGTH + IV_LENGTH + encrypted.byteLength
  );
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt string with password using AES-GCM
 */
export async function decryptStringWithPassword(
  encryptedBase64: string,
  password: string
): Promise<string> {
  // Decode base64
  const combined = Uint8Array.from(
    atob(encryptedBase64),
    c => c.charCodeAt(0)
  );

  // Extract salt, IV, and ciphertext
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const key = await getOrDeriveKey(password, salt);

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      key,
      ciphertext
    );

    // Convert to string
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (err) {
    // Normalize low-level OperationError into a regular Error so callers can
    // handle invalid keys / corrupted ciphertext cleanly.
    console.warn("decryptStringWithPassword failed:", err);
    throw new Error("Invalid encryption key or corrupted encrypted value");
  }
}

/**
 * Encrypt file blob with password using AES-GCM
 */
export async function encryptFileBlob(
  fileBlob: Blob,
  password: string
): Promise<Blob> {
  // Read file as array buffer
  const arrayBuffer = await fileBlob.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const key = await getOrDeriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    data
  );

  const combined = new Uint8Array(
    SALT_LENGTH + IV_LENGTH + encrypted.byteLength
  );
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);

  return new Blob([combined], { type: "application/octet-stream" });
}

/**
 * Decrypt file blob with password using AES-GCM
 */
export async function decryptFileBlob(
  encryptedBlob: Blob,
  password: string
): Promise<Blob> {
  // Read encrypted blob as array buffer
  const arrayBuffer = await encryptedBlob.arrayBuffer();
  const combined = new Uint8Array(arrayBuffer);

  // Extract salt, IV, and ciphertext
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const key = await getOrDeriveKey(password, salt);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    ciphertext
  );

  // Return as blob
  return new Blob([decrypted]);
}
