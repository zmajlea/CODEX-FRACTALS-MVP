export type VaultSummary = {
  id: string;
  name: string;
  created_by: string | null;
  encryption_test: string | null;
  role: string;
};

export type RecordSummary = {
  id: string;
  vault_id: string;
  title_plain: string | null;
  status: string;
};

export type { TriageSuggestion } from "@/lib/temporal/seal-batch";
export type { ExtractSuggestion } from "@/app/api/gemini-extract/route";

export type VaultFileRow = {
  id: string;
  vault_id: string;
  record_id: string;
  storage_path: string;
  mime_type: string | null;
  encrypted: boolean;
  file_name_ciphertext: string | null;
  created_at: string;
};
