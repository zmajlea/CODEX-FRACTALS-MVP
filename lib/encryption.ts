"use client";

import { Firestore, collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { decryptStringWithPassword, encryptStringWithPassword } from "./encryption-core";

/**
 * Validate encryption key by attempting to decrypt the vault's encryptionTest field.
 * Returns true if key successfully decrypts the test string.
 */
export async function validateEncryptionKey(
  vaultId: string,
  key: string,
  db: Firestore
): Promise<boolean> {
  try {
    // Check vaults collection (plural - correct format)
    const vaultDoc = await getDoc(doc(db, "vaults", vaultId));
    
    if (!vaultDoc.exists()) {
      console.warn("Vault not found for key validation:", vaultId);
      return false;
    }

    const vaultData = vaultDoc.data();
    
    // Check if vault has encryptionTest field
    if (!vaultData.encryptionTest) {
      // No encryption test - consider key valid for new vaults
      return true;
    }

    // Try to decrypt the encryptionTest field
    try {
      const decrypted = await decryptStringWithPassword(vaultData.encryptionTest, key);
      // Verify it decrypts to the expected validation string
      return decrypted.startsWith("CODEXONE_KEY_VALIDATION");
    } catch (decryptError) {
      // Decryption failed - key is incorrect
      console.error("Key validation failed:", decryptError);
      return false;
    }
  } catch (error) {
    console.error("Error validating encryption key:", error);
    return false;
  }
}

/**
 * Set encryption key test string in vault document.
 * This allows validation without requiring actual encrypted artifacts.
 */
export async function setVaultEncryptionKeyTest(
  vaultId: string,
  key: string,
  db: Firestore
): Promise<void> {
  try {
    const { encryptStringWithPassword } = await import("./encryption-core");
    const testString = "CODEXONE_KEY_VALIDATION";
    const encryptedTest = await encryptStringWithPassword(testString, key);

    await updateDoc(doc(db, "vaults", vaultId), {
      encryptionTest: encryptedTest,
      encryptionTestUpdatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Error setting encryption key test:", error);
    throw error;
  }
}

/**
 * Re-encrypt all artifacts in a vault with a new encryption key.
 * This function:
 * 1. Re-encrypts record titles (encryptedTitle field)
 * 2. Re-encrypts artifact bodies (body field in objects where encrypted: true)
 * 
 * @param vaultId - The vault ID
 * @param oldKey - The current encryption key
 * @param newKey - The new encryption key
 * @param db - Firestore instance
 * @returns Object with success status, count of re-encrypted items, and error message if any
 */
export async function reencryptAllArtifacts(
  vaultId: string,
  oldKey: string,
  newKey: string,
  db: Firestore
): Promise<{ success: boolean; count: number; error?: string }> {
  let reencryptedCount = 0;
  const errors: string[] = [];

  try {
    // 1. Re-encrypt record titles
    const recordsQuery = query(
      collection(db, "records"),
      where("vaultId", "==", vaultId)
    );
    const recordsSnapshot = await getDocs(recordsQuery);

    let batch = writeBatch(db);
    let batchCount = 0;
    const MAX_BATCH_SIZE = 500; // Firestore batch limit

    const commitBatch = async () => {
      if (batchCount > 0) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    };

    for (const recordDoc of recordsSnapshot.docs) {
      const recordData = recordDoc.data();
      
      // Re-encrypt encryptedTitle if it exists
      if (recordData.encryptedTitle) {
        try {
          // Decrypt with old key
          const decryptedTitle = await decryptStringWithPassword(
            recordData.encryptedTitle,
            oldKey
          );
          
          // Re-encrypt with new key
          const newEncryptedTitle = await encryptStringWithPassword(
            decryptedTitle,
            newKey
          );
          
          const recordRef = doc(db, "records", recordDoc.id);
          batch.update(recordRef, {
            encryptedTitle: newEncryptedTitle,
            updatedAt: serverTimestamp(),
          });
          
          reencryptedCount++;
          batchCount++;
          
          // Commit batch if it reaches the limit
          if (batchCount >= MAX_BATCH_SIZE) {
            await commitBatch();
          }
        } catch (err: any) {
          errors.push(`Record ${recordDoc.id}: ${err.message}`);
        }
      }

      // 2. Re-encrypt artifact bodies in this record
      try {
        const docsRef = collection(db, "records", recordDoc.id, "docs");
        const docsSnapshot = await getDocs(docsRef);

        for (const docDoc of docsSnapshot.docs) {
          const objectsRef = collection(
            db,
            "records",
            recordDoc.id,
            "docs",
            docDoc.id,
            "objects"
          );
          const objectsSnapshot = await getDocs(objectsRef);

          for (const objectDoc of objectsSnapshot.docs) {
            const objectData = objectDoc.data();
            
            // Only re-encrypt if the object is marked as encrypted
            if (objectData.encrypted && objectData.body) {
              try {
                // Decrypt with old key
                const decryptedBody = await decryptStringWithPassword(
                  objectData.body,
                  oldKey
                );
                
                // Re-encrypt with new key
                const newEncryptedBody = await encryptStringWithPassword(
                  decryptedBody,
                  newKey
                );
                
                const objectRef = doc(
                  db,
                  "records",
                  recordDoc.id,
                  "docs",
                  docDoc.id,
                  "objects",
                  objectDoc.id
                );
                batch.update(objectRef, {
                  body: newEncryptedBody,
                  updatedAt: serverTimestamp(),
                });
                
                reencryptedCount++;
                batchCount++;
                
                // Commit batch if it reaches the limit
                if (batchCount >= MAX_BATCH_SIZE) {
                  await commitBatch();
                }
              } catch (err: any) {
                errors.push(
                  `Object ${objectDoc.id} in record ${recordDoc.id}: ${err.message}`
                );
              }
            }
          }
        }
      } catch (err: any) {
        errors.push(`Error processing docs for record ${recordDoc.id}: ${err.message}`);
      }
    }

    // Commit any remaining batched updates
    await commitBatch();

    if (errors.length > 0) {
      return {
        success: false,
        count: reencryptedCount,
        error: `Some items failed to re-encrypt: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ""}`,
      };
    }

    return {
      success: true,
      count: reencryptedCount,
    };
  } catch (error: any) {
    return {
      success: false,
      count: reencryptedCount,
      error: error.message || "Unknown error during re-encryption",
    };
  }
}

// Re-export core encryption functions
export { encryptStringWithPassword, decryptStringWithPassword } from "./encryption-core";
