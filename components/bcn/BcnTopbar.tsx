import Link from "next/link";

type Props = {
  name: string;
  logoUrl: string | null;
  domain: string;
};

export function BcnTopbar({ name, logoUrl, domain }: Props) {
  return (
    <header className="ff-topbar border-b border-bone/80 bg-vellum/90 backdrop-blur-sm sticky top-0 z-40">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link href={`/${domain}`} className="flex items-center gap-3 min-w-0">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-9 w-auto object-contain" />
          ) : (
            <span className="ff-topbar-mark" aria-hidden>
              FF
            </span>
          )}
          <span className="font-head text-lg truncate text-obsidian">{name}</span>
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href={`/${domain}/wizard`} className="ff-nav-link">
            Continuity
          </Link>
          <Link href={`/${domain}/admin`} className="ff-nav-link">
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}
