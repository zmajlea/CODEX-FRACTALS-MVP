import Link from "next/link";
import { getTenantByDomain } from "@/lib/bcn/tenant";

type Props = {
  params: Promise<{ domain: string }>;
};

export default async function TenantHomePage({ params }: Props) {
  const { domain } = await params;
  const tenant = await getTenantByDomain(domain);

  if (!tenant) return null;

  return (
    <div className="ff-landing mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="ff-crest mx-auto mb-6" aria-hidden>
        <svg viewBox="0 0 64 72" className="h-16 w-14">
          <path
            d="M32 2.5 58.5 11v22.5C58.5 51 47.6 63.4 32 69.5 16.4 63.4 5.5 51 5.5 33.5V11L32 2.5Z"
            fill="var(--cinnabar)"
          />
          <text
            x="32"
            y="44"
            textAnchor="middle"
            fontFamily="Georgia, serif"
            fontWeight="700"
            fontSize="20"
            fill="#fff"
          >
            FF
          </text>
        </svg>
      </div>
      <h1 className="font-head text-3xl text-obsidian mb-3">
        Business Continuity Navigator
      </h1>
      <p className="text-codex-muted mb-2">{tenant.name}</p>
      <p className="text-sm text-codex-muted italic mb-10">
        Preparation is an act of love.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Link href={`/${domain}/wizard`} className="ff-btn ff-btn-primary">
          Begin continuity record
        </Link>
        <Link href={`/${domain}/admin`} className="ff-btn ff-btn-ghost">
          Firm admin
        </Link>
      </div>
    </div>
  );
}
