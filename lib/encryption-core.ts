"use client";

/**
 * Core encryption utilities using Web Crypto API.
 * AES-GCM with PBKDF2 key derivation.
 */

const PBKDF2_ITERATIONS = 250000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

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

  // Derive key
  const key = await deriveKey(password, salt);

  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    data
  );

  // Combine: salt (16) + iv (12) + ciphertext
  const combined = new Uint8Array(
    SALT_LENGTH + IV_LENGTH + encrypted.byteLength
  );
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);

  // Convert to base64
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

  // Derive key
  const key = await deriveKey(password, salt);

  try {
    // Decrypt
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

  // Derive key
  const key = await deriveKey(password, salt);

  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    data
  );

  // Combine: salt (16) + iv (12) + ciphertext
  const combined = new Uint8Array(
    SALT_LENGTH + IV_LENGTH + encrypted.byteLength
  );
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);

  // Return as blob
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

  // Derive key
  const key = await deriveKey(password, salt);

  // Decrypt
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
