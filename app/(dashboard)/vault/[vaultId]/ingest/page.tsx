"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import VaultFileUpload from "@/components/VaultFileUpload";
import { useActiveVault } from "@/lib/context/active-vault";
import { getVaultSessionKey } from "@/lib/vault-session";
import { createClient } from "@/utils/supabase/client";

type ScanMode = "doc_identifier" | "full_scan";
type JobStatus =
  | "uploading"
  | "queued"
  | "scanning"
  | "complete"
  | "partial"
  | "failed"
  | "cancelled";

export default function IngestPage() {
  const params = useParams();
  const vaultId = params.vaultId as string;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { setActiveVault, isUnlocked } = useActiveVault();
  const [vaultName, setVaultName] = useState("");
  const [recordId, setRecordId] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>("doc_identifier");
  const [jobStatus, setJobStatus] = useState<JobStatus>("queued");

  useEffect(() => {
    if (!isUnlocked(vaultId)) {
      router.push(`/vault/${vaultId}`);
      return;
    }
    (async () => {
      const { data: vault } = await supabase
        .from("vaults")
        .select("name")
        .eq("id", vaultId)
        .single();
      if (vault) {
        setVaultName(vault.name);
        setActiveVault({ id: vaultId, name: vault.name });
      }
      const { data: rec } = await supabase
        .from("records")
        .select("id")
        .eq("vault_id", vaultId)
        .limit(1)
        .maybeSingle();
      if (rec) setRecordId(rec.id);
      else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { data: created } = await supabase
          .from("records")
          .insert({
            vault_id: vaultId,
            title_plain: "Inbox",
            status: "draft",
            created_by: user?.id ?? null,
          })
          .select("id")
          .single();
        setRecordId(created?.id ?? null);
      }
    })();
  }, [vaultId, supabase, router, isUnlocked, setActiveVault]);

  if (!getVaultSessionKey(vaultId)) {
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <button
        type="button"
        onClick={() => router.push(`/vault/${vaultId}`)}
        className="font-data text-[10px] uppercase tracking-ultra text-obsidian/50 mb-6"
      >
        ← Record Home
      </button>
      <h1 className="font-head text-2xl text-obsidian mb-2">Ingestion Pipeline</h1>
      <p className="font-data text-xs text-obsidian/50 mb-8">
        PDFs only · {vaultName}
      </p>

      <div className="flex gap-4 mb-8">
        <button
          type="button"
          onClick={() => setScanMode("doc_identifier")}
          className={
            "font-data text-[10px] uppercase px-4 py-2 border " +
            (scanMode === "doc_identifier"
              ? "border-oxford bg-oxford/5"
              : "border-bone")
          }
        >
          Doc Identifier (default)
        </button>
        <button
          type="button"
          onClick={() => setScanMode("full_scan")}
          className={
            "font-data text-[10px] uppercase px-4 py-2 border " +
            (scanMode === "full_scan" ? "border-oxford bg-oxford/5" : "border-bone")
          }
        >
          Full Scan
        </button>
      </div>

      <div className="border border-bone px-4 py-3 mb-6 font-data text-xs flex justify-between">
        <span>Job status</span>
        <span className="uppercase tracking-widest text-obsidian/60">
          {jobStatus}
        </span>
      </div>

      {recordId && (
        <VaultFileUpload
          vaultId={vaultId}
          recordId={recordId}
          onUploaded={() => {
            setJobStatus("scanning");
            setTimeout(() => setJobStatus("complete"), 800);
          }}
        />
      )}

      <a
        href={`/vault/${vaultId}/extract`}
        className="inline-block mt-8 font-data text-[10px] uppercase tracking-ultra border border-bone px-4 py-2 hover:bg-bone/10"
      >
        Open Temporal Extraction Engine →
      </a>
    </div>
  );
}
