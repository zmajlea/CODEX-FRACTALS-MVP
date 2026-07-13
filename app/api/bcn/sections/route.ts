import { NextResponse } from "next/server";
import type { BcnSectionPayload } from "@/lib/bcn/sections";
import { resolveBcnVaultAccess } from "@/lib/server/bcn-vault-access";
import { decryptForClient, encryptForClient } from "@/lib/server/envelope-crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/utils/supabase/server";

export type BcnSectionRow = {
  section_id: string;
  payload: BcnSectionPayload;
  sealed_at: string | null;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vaultId = new URL(request.url).searchParams.get("vault_id")?.trim();
  if (!vaultId) {
    return NextResponse.json({ error: "Missing vault_id" }, { status: 400 });
  }

  const access = await resolveBcnVaultAccess(supabase, user.id, vaultId);
  if (!access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await admin
    .from("ff_continuity_sections")
    .select("section_id, payload_ciphertext, sealed_at")
    .eq("vault_id", vaultId);

  if (error) {
    console.error("[bcn/sections GET]", error);
    return NextResponse.json({ error: "Failed to load sections" }, { status: 500 });
  }

  const sections: BcnSectionRow[] = [];

  for (const row of rows ?? []) {
    let payload: BcnSectionPayload = {};
    if (row.payload_ciphertext) {
      try {
        const plain = await decryptForClient(
          admin,
          access.ownerUserId,
          row.payload_ciphertext
        );
        payload = JSON.parse(plain) as BcnSectionPayload;
      } catch (err) {
        console.warn("[bcn/sections GET] decrypt failed", row.section_id, err);
      }
    }
    sections.push({
      section_id: row.section_id,
      payload,
      sealed_at: row.sealed_at,
    });
  }

  return NextResponse.json({ sections });
}

type PutBody = {
  vault_id?: string;
  section_id?: string;
  payload?: BcnSectionPayload;
  sealed_at?: string | null;
  unseal?: boolean;
};

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const vaultId = body.vault_id?.trim();
  const sectionId = body.section_id?.trim();
  if (!vaultId || !sectionId) {
    return NextResponse.json({ error: "Missing vault_id or section_id" }, { status: 400 });
  }

  const access = await resolveBcnVaultAccess(supabase, user.id, vaultId);
  if (!access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const payload = body.payload ?? {};
  const ciphertext = await encryptForClient(
    admin,
    access.ownerUserId,
    JSON.stringify(payload)
  );

  const sealedAt = body.unseal ? null : body.sealed_at ?? undefined;

  const row: {
    vault_id: string;
    section_id: string;
    payload_ciphertext: string;
    sealed_at?: string | null;
  } = {
    vault_id: vaultId,
    section_id: sectionId,
    payload_ciphertext: ciphertext,
  };

  if (body.unseal || body.sealed_at !== undefined) {
    row.sealed_at = sealedAt ?? null;
  }

  const { error } = await admin
    .from("ff_continuity_sections")
    .upsert(row, { onConflict: "vault_id,section_id" });

  if (error) {
    console.error("[bcn/sections PUT]", error);
    return NextResponse.json({ error: "Failed to save section" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
