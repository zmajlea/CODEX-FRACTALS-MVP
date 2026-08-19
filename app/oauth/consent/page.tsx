import Link from "next/link";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function param(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string {
  const v = sp[key];
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

export default async function OAuthConsentPage({ searchParams }: Props) {
  const sp = await searchParams;
  const clientName = param(sp, "client_name") || param(sp, "client_id");
  const scope = param(sp, "scope") || "treasury:read treasury:write";

  const hidden = [
    "client_id",
    "redirect_uri",
    "state",
    "code_challenge",
    "code_challenge_method",
    "scope",
  ] as const;

  return (
    <main className="auth-page">
      <div className="auth-card max-w-md space-y-4">
        <h1 className="text-lg font-semibold">Connect Claude to CODEXONE</h1>
        <p className="text-sm text-slate-600">
          Allow <strong>{clientName}</strong> to access your treasury data via MCP?
        </p>
        <p className="treasury-meta text-sm">Scopes: {scope}</p>
        <form action="/api/oauth/consent" method="post" className="flex gap-2">
          <input type="hidden" name="decision" value="allow" />
          {hidden.map((k) => (
            <input key={k} type="hidden" name={k} value={param(sp, k)} />
          ))}
          <button type="submit" className="chip">
            Allow
          </button>
        </form>
        <form action="/api/oauth/consent" method="post">
          <input type="hidden" name="decision" value="deny" />
          {hidden.map((k) => (
            <input key={k} type="hidden" name={k} value={param(sp, k)} />
          ))}
          <button type="submit" className="chip">
            Deny
          </button>
        </form>
        <p className="text-xs text-slate-500">
          <Link href="/operator/treasury">Back to treasury</Link>
        </p>
      </div>
    </main>
  );
}
