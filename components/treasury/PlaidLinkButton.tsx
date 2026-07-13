"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

type Props = {
  onLinked?: () => void;
  label?: string;
  className?: string;
};

export function PlaidLinkButton({
  onLinked,
  label = "Connect a bank",
  className = "btn btn-primary",
}: Props) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/treasury/link-token", { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not start Plaid Link");
        }
        const data = (await res.json()) as { link_token: string };
        if (!cancelled) setLinkToken(data.link_token);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load Plaid");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string, metadata: { institution?: { name?: string } | null }) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/treasury/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_token: publicToken,
            institution_name: metadata.institution?.name,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to link account");
        }
        onLinked?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Link failed");
      } finally {
        setLoading(false);
      }
    },
    [onLinked]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  return (
    <div>
      <button
        type="button"
        className={className}
        disabled={!ready || !linkToken || loading}
        onClick={() => open()}
      >
        {loading ? "Linking…" : label}
      </button>
      {error ? (
        <p className="text-sm text-cinnabar mt-2" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
