import Link from "next/link";

/** Ana overview.html:31 — ‹ All clients */
export function TreasuryRecordRailBack() {
  return (
    <Link className="rback" href="/operator/treasury">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M15 6l-6 6 6 6" />
      </svg>
      All clients
    </Link>
  );
}
