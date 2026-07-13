import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-vellum text-obsidian flex flex-col items-center justify-center px-6">
      <div className="max-w-lg text-center">
        <p className="text-xs uppercase tracking-wide text-codex-muted mb-2">Fractals Platform</p>
        <h1 className="font-head text-4xl mb-4">Business continuity, white-labeled</h1>
        <p className="text-codex-muted mb-10">
          Operator firms distribute modules to clients. CodexOne operates the platform.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/portal/login"
            className="px-6 py-3 rounded-lg bg-oxford text-white font-medium"
          >
            Staff portal
          </Link>
          <Link
            href="/client/login"
            className="px-6 py-3 rounded-lg border border-bone bg-white font-medium"
          >
            Client login
          </Link>
        </div>
      </div>
    </main>
  );
}
