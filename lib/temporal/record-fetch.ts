"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { decryptStringWithPassword } from "@/lib/encryption";
import { getVaultSessionKey } from "@/lib/vault-session";
import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";

type TemporalRow = {
  id: string;
  vault_id: string;
  record_id: string;
  file_id: string | null;
  category: string | null;
  parsed_date: string | null;
  title_ciphertext: string;
  body_ciphertext: string | null;
  explanation_ciphertext: string | null;
  verified_at: string | null;
  lens_id: string | null;
  created_at: string;
  records: { title_plain: string | null } | null;
  files: { file_name_ciphertext: string | null } | null;
};

async function safeDecrypt(
  ciphertext: string | null | undefined,
  sessionKey: string
): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    return await decryptStringWithPassword(ciphertext, sessionKey);
  } catch {
    return null;
  }
}

export async function fetchVaultTemporalObjects(
  supabase: SupabaseClient<Database>,
  vaultId: string,
  vaultName: string
): Promise<PortfolioTemporalObject[]> {
  const sessionKey = getVaultSessionKey(vaultId);
  const isLocked = !sessionKey;

  const { data, error } = await supabase
    .from("temporal_objects")
    .select(
      `
      id, vault_id, record_id, file_id, category, parsed_date,
      title_ciphertext, body_ciphertext, explanation_ciphertext,
      verified_at, lens_id, created_at,
      records ( title_plain ),
      files ( file_name_ciphertext )
    `
    )
    .eq("vault_id", vaultId)
    .order("parsed_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);

  const results: PortfolioTemporalObject[] = [];
  for (const row of (data ?? []) as TemporalRow[]) {
    let title: string | null = null;
    let body: string | null = null;
    let explanation: string | null = null;
    let fileLabel: string | null = null;

    if (sessionKey) {
      title = await safeDecrypt(row.title_ciphertext, sessionKey);
      body = await safeDecrypt(row.body_ciphertext, sessionKey);
      explanation = await safeDecrypt(row.explanation_ciphertext, sessionKey);
      if (row.files?.file_name_ciphertext) {
        fileLabel = await safeDecrypt(
          row.files.file_name_ciphertext,
          sessionKey
        );
      }
    }

    results.push({
      id: row.id,
      vaultId: row.vault_id,
      vaultName,
      recordId: row.record_id,
      recordTitle: row.records?.title_plain ?? null,
      fileId: row.file_id,
      fileLabel:
        fileLabel ??
        (row.file_id ? `Document ${row.file_id.slice(0, 8)}…` : null),
      parsedDate: row.parsed_date,
      category: row.category,
      title,
      body,
      explanation,
      isLocked,
      isSealed: Boolean(row.verified_at),
      lensId: row.lens_id,
      createdAt: row.created_at,
    });
  }

  return results;
}
