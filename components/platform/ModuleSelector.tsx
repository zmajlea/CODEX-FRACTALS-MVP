"use client";

import { useRouter } from "next/navigation";

type Grant = {
  id: string;
  modules: { slug: string; name: string; route_base: string } | null;
};

type Props = {
  grants: Grant[];
  activeGrantId?: string;
};

export function ModuleSelector({ grants, activeGrantId }: Props) {
  const router = useRouter();

  if (grants.length === 0) {
    return <span className="text-sm text-codex-muted">No modules</span>;
  }

  return (
    <select
      className="text-sm border border-bone rounded-lg px-2 py-1 bg-white"
      value={activeGrantId ?? grants[0]?.id ?? ""}
      onChange={(e) => {
        const grant = grants.find((g) => g.id === e.target.value);
        document.cookie = `active_grant_id=${e.target.value};path=/;max-age=31536000`;
        const base = grant?.modules?.route_base ?? "/bcn";
        router.push(`/client${base}`);
        router.refresh();
      }}
    >
      {grants.map((g) => (
        <option key={g.id} value={g.id}>
          {g.modules?.name ?? "Module"}
        </option>
      ))}
    </select>
  );
}
