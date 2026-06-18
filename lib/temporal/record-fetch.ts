"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mapInBatches } from "@/lib/async/map-in-batches";
import { decryptStringWithPassword } from "@/lib/encryption";
import { getVaultSessionKey } from "@/lib/vault-session";
import type { PortfolioTemporalObject } from "@/lib/temporal/portfolio-fetch";
import { resolvePulseLabel } from "@/lib/temporal/event-types";

export const DECRYPT_BATCH_SIZE = 50;

const TEMPORAL_ROW_SELECT = `
  id, vault_id, record_id, file_id, category, parsed_date, event_type,
  title_ciphertext, qualifier_ciphertext, body_ciphertext, explanation_ciphertext,
  verified_at, lens_id, created_at,
  records ( title_plain ),
  files ( file_name_ciphertext )
`;

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
  records: { title_plain: string | null } | null;
  files: { file_name_ciphertext: string | null } | null;
};

export type FetchProgress = {
  loaded: number;
  total: number;
  done: boolean;
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

async function mapTemporalRow(
  row: TemporalRow,
  vaultName: string,
  sessionKey: string | null,
  fileNameCache: Map<string, string | null>,
  loadDetails: boolean
): Promise<PortfolioTemporalObject> {
  const isLocked = !sessionKey;

  let title: string | null = null;
  let qualifier: string | null = null;
  let body: string | null = null;
  let explanation: string | null = null;
  let fileLabel: string | null = null;
  let detailsLoaded = loadDetails;

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
    vaultName,
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
    detailsLoaded,
    bodyCiphertext: loadDetails ? undefined : row.body_ciphertext,
    explanationCiphertext: loadDetails ? undefined : row.explanation_ciphertext,
    qualifierCiphertext: loadDetails ? undefined : row.qualifier_ciphertext,
  };
}

async function fetchTemporalRows(
  supabase: SupabaseClient<Database>,
  vaultId: string
): Promise<TemporalRow[]> {
  const { data, error } = await supabase
    .from("temporal_objects")
    .select(TEMPORAL_ROW_SELECT)
    .eq("vault_id", vaultId)
    .order("parsed_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as TemporalRow[];
}

async function decryptRows(
  rows: TemporalRow[],
  vaultName: string,
  sessionKey: string | null,
  loadDetails: boolean,
  onBatch?: (batch: PortfolioTemporalObject[], progress: FetchProgress) => void
): Promise<PortfolioTemporalObject[]> {
  const fileNameCache = new Map<string, string | null>();
  const total = rows.length;
  const all: PortfolioTemporalObject[] = [];

  for (let offset = 0; offset < rows.length; offset += DECRYPT_BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + DECRYPT_BATCH_SIZE);
    const batch = await Promise.all(
      chunk.map((row) =>
        mapTemporalRow(row, vaultName, sessionKey, fileNameCache, loadDetails)
      )
    );
    all.push(...batch);
    onBatch?.(batch, {
      loaded: all.length,
      total,
      done: all.length >= total,
    });
  }

  return all;
}

/** Lazy summary load: title + metadata only; body/explanation on demand. */
export async function fetchVaultTemporalObjects(
  supabase: SupabaseClient<Database>,
  vaultId: string,
  vaultName: string
): Promise<PortfolioTemporalObject[]> {
  const sessionKey = getVaultSessionKey(vaultId);
  const rows = await fetchTemporalRows(supabase, vaultId);
  return decryptRows(rows, vaultName, sessionKey, false);
}

/** Progressive summary decrypt — UI can paint after the first batch. */
export async function fetchVaultTemporalObjectsProgressive(
  supabase: SupabaseClient<Database>,
  vaultId: string,
  vaultName: string,
  onBatch: (batch: PortfolioTemporalObject[], progress: FetchProgress) => void
): Promise<PortfolioTemporalObject[]> {
  const sessionKey = getVaultSessionKey(vaultId);
  const rows = await fetchTemporalRows(supabase, vaultId);
  return decryptRows(rows, vaultName, sessionKey, false, onBatch);
}

/** Decrypt body/explanation for a single pulse when opening Inspector. */
export async function hydrateTemporalObjectDetails(
  obj: PortfolioTemporalObject
): Promise<PortfolioTemporalObject> {
  if (obj.detailsLoaded || obj.isLocked) return obj;

  const sessionKey = getVaultSessionKey(obj.vaultId);
  if (!sessionKey) return obj;

  const hasDeferred =
    obj.bodyCiphertext != null || obj.explanationCiphertext != null;
  if (!hasDeferred && (obj.body != null || obj.explanation != null)) {
    return { ...obj, detailsLoaded: true };
  }

  const [body, explanation] = await Promise.all([
    obj.bodyCiphertext
      ? safeDecrypt(obj.bodyCiphertext, sessionKey)
      : Promise.resolve(obj.body),
    obj.explanationCiphertext
      ? safeDecrypt(obj.explanationCiphertext, sessionKey)
      : Promise.resolve(obj.explanation),
  ]);

  return {
    ...obj,
    body,
    explanation,
    detailsLoaded: true,
    bodyCiphertext: undefined,
    explanationCiphertext: undefined,
  };
}
