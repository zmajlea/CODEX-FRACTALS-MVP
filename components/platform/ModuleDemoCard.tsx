import { demoForModule, type ModuleDemo } from "@/lib/platform/module-demos";

type Props = {
  demo: ModuleDemo;
  compact?: boolean;
};

export function ModuleDemoCard({ demo, compact = false }: Props) {
  return (
    <div
      className={`border border-bone rounded-xl bg-white ${compact ? "p-4" : "p-6"}`}
      style={{ borderTopWidth: 4, borderTopColor: "var(--cinnabar, #E67E50)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-head text-lg">{demo.name}</h3>
        {demo.status === "beta" && (
          <span className="text-xs uppercase tracking-wide text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
            Beta
          </span>
        )}
      </div>
      <p className="text-sm text-codex-muted mb-3">{demo.tagline}</p>
      {!compact && (
        <ul className="text-sm space-y-1.5 mb-4">
          {demo.highlights.map((h) => (
            <li key={h} className="flex gap-2">
              <span className="text-emerald-600">✓</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-codex-muted">
        Client preview path: <code>/client{demo.routeBase}</code>
      </p>
    </div>
  );
}

export function ModuleDemoFromSlug({
  slug,
  name,
  compact,
}: {
  slug: string;
  name?: string;
  compact?: boolean;
}) {
  return <ModuleDemoCard demo={demoForModule(slug, name)} compact={compact} />;
}
