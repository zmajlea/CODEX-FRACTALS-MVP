"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mapInBatches } from "@/lib/async/map-in-batches";
import { decryptStringWithPassword } from "@/lib/encryption";
import { getVaultSessionKey } from "@/lib/vault-session";
import { resolvePulseLabel } from "@/lib/temporal/event-types";

const DECRYPT_BATCH_SIZE = 50;

export type PortfolioTemporalObject = {
  id: string;
  vaultId: string;
  vaultName: string;
  recordId: string;
  recordTitle: string | null;
  fileId: string | null;
  fileLabel: string | null;
  parsedDate: string | null;
  category: string | null;
  /** Legacy composed title; prefer eventType + qualifier + composedLabel. */
  title: string | null;
  eventType: string | null;
  qualifier: string | null;
  composedLabel: string;
  body: string | null;
  explanation: string | null;
  isLocked: boolean;
  isSealed: boolean;
  lensId: string | null;
  createdAt: string;
  /** Set when body/explanation are deferred for lazy decrypt. */
  detailsLoaded?: boolean;
  bodyCiphertext?: string | null;
  explanationCiphertext?: string | null;
  qualifierCiphertext?: string | null;
};

type TemporalRow = {
  id: string;
  vault_id: string;
  record_id: string;
  file_id: string | null;
  category: string | null;
  parsed_date: string | null;
  event_type: string | null;
  title_ciphertext: string;
  qualifier_ciphertext: string | null;
  body_ciphertext: string | null;
  explanation_ciphertext: string | null;
  verified_at: string | null;
  lens_id: string | null;
  created_at: string;
  vaults: { name: string } | null;
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

const TEMPORAL_SELECT = `
      id,
      vault_id,
      record_id,
      file_id,
      category,
      parsed_date,
      event_type,
      title_ciphertext,
      qualifier_ciphertext,
      body_ciphertext,
      explanation_ciphertext,
      verified_at,
      lens_id,
      created_at,
      vaults ( name ),
      records ( title_plain ),
      files ( file_name_ciphertext )
    `;

async function mapTemporalRow(
  row: TemporalRow,
  fileNameCache: Map<string, string | null>,
  loadDetails = false
): Promise<PortfolioTemporalObject> {
  const sessionKey = getVaultSessionKey(row.vault_id);
  const isLocked = !sessionKey;

  let title: string | null = null;
  let qualifier: string | null = null;
  let body: string | null = null;
  let explanation: string | null = null;
  let fileLabel: string | null = null;

  if (sessionKey) {
    title = await safeDecrypt(row.title_ciphertext, sessionKey);
    qualifier = row.qualifier_ciphertext
      ? await safeDecrypt(row.qualifier_ciphertext, sessionKey)
      : null;
    if (loadDetails) {
      [body, explanation] = await Promise.all([
        safeDecrypt(row.body_ciphertext, sessionKey),
        safeDecrypt(row.explanation_ciphertext, sessionKey),
      ]);
    }

    if (row.file_id && row.files?.file_name_ciphertext) {
      const cacheKey = `${row.vault_id}:${row.file_id}`;
      if (fileNameCache.has(cacheKey)) {
        fileLabel = fileNameCache.get(cacheKey) ?? null;
      } else {
        fileLabel = await safeDecrypt(
          row.files.file_name_ciphertext,
          sessionKey
        );
        fileNameCache.set(cacheKey, fileLabel);
      }
    }
  }

  const label = resolvePulseLabel(row.event_type, qualifier, title);

  return {
    id: row.id,
    vaultId: row.vault_id,
    vaultName: row.vaults?.name ?? "Vault",
    recordId: row.record_id,
    recordTitle: row.records?.title_plain ?? null,
    fileId: row.file_id,
    fileLabel:
      fileLabel ??
      (row.file_id ? `Document ${row.file_id.slice(0, 8)}…` : null),
    parsedDate: row.parsed_date,
    category: row.category,
    title: label.composedLabel,
    eventType: label.eventType || row.event_type,
    qualifier: label.qualifier,
    composedLabel: label.composedLabel,
    body,
    explanation,
    isLocked,
    isSealed: Boolean(row.verified_at),
    lensId: row.lens_id,
    createdAt: row.created_at,
    detailsLoaded: loadDetails,
    bodyCiphertext: loadDetails ? undefined : row.body_ciphertext,
    explanationCiphertext: loadDetails ? undefined : row.explanation_ciphertext,
    qualifierCiphertext: loadDetails ? undefined : row.qualifier_ciphertext,
  };
}

async function mapTemporalRows(
  rows: TemporalRow[]
): Promise<PortfolioTemporalObject[]> {
  const fileNameCache = new Map<string, string | null>();
  return mapInBatches(rows, DECRYPT_BATCH_SIZE, (row) =>
    mapTemporalRow(row, fileNameCache)
  );
}

/** Fetch all temporal_objects for the interactive Nautilus graph. */
export async function fetchPortfolioObjects(
  supabase: SupabaseClient<Database>
): Promise<PortfolioTemporalObject[]> {
  const { data, error } = await supabase
    .from("temporal_objects")
    .select(TEMPORAL_SELECT)
    .order("parsed_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);
  return mapTemporalRows((data ?? []) as TemporalRow[]);
}

/**
 * Fetch Date-category temporal_objects across all vaults the user can access (RLS),
 * decrypt title/body client-side when a vault session key exists.
 * Rows without a session key remain locked (Grey Pulse).
 */
export async function fetchPortfolioDateObjects(
  supabase: SupabaseClient<Database>
): Promise<PortfolioTemporalObject[]> {
  const { data, error } = await supabase
    .from("temporal_objects")
    .select(TEMPORAL_SELECT)
    .ilike("category", "Date")
    .order("parsed_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);
  return mapTemporalRows((data ?? []) as TemporalRow[]);
}

/** Chronological sort for decrypted timeline rows; locked rows sink to bottom. */
export function sortPortfolioChronologically(
  objects: PortfolioTemporalObject[]
): PortfolioTemporalObject[] {
  return [...objects].sort((a, b) => {
    if (a.isLocked !== b.isLocked) return a.isLocked ? 1 : -1;
    const da = a.parsedDate ?? a.createdAt.slice(0, 10);
    const db = b.parsedDate ?? b.createdAt.slice(0, 10);
    return da.localeCompare(db);
  });
}
