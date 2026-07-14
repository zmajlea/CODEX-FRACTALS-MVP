"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

type PlaidMetadata = {
  institution?: { name?: string; institution_id?: string } | null;
};

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
  const [alreadyLinked, setAlreadyLinked] = useState<{
    institutionName: string;
    publicToken: string;
    metadata: PlaidMetadata;
  } | null>(null);
  const pendingRef = useRef<{ publicToken: string; metadata: PlaidMetadata } | null>(null);

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

  const submitExchange = useCallback(
    async (publicToken: string, metadata: PlaidMetadata, force = false) => {
      setLoading(true);
      setError(null);
      setAlreadyLinked(null);
      try {
        const res = await fetch("/api/treasury/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_token: publicToken,
            institution_name: metadata.institution?.name,
            institution_id: metadata.institution?.institution_id,
            force,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          status?: string;
          institution_name?: string | null;
        };
        if (!res.ok) {
          throw new Error(body.error ?? "Failed to link account");
        }
        if (body.status === "already_linked") {
          const name = body.institution_name ?? metadata.institution?.name ?? "This bank";
          setAlreadyLinked({ institutionName: name, publicToken, metadata });
          return;
        }
        pendingRef.current = null;
        onLinked?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Link failed");
      } finally {
        setLoading(false);
      }
    },
    [onLinked]
  );

  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidMetadata) => {
      pendingRef.current = { publicToken, metadata };
      await submitExchange(publicToken, metadata, false);
    },
    [submitExchange]
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
      {alreadyLinked ? (
        <div className="mt-3 p-3 rounded text-sm panel" style={{ border: "1px solid var(--line)" }}>
          <p>
            <strong>{alreadyLinked.institutionName}</strong> is already connected.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              className="btn btn-secondary text-xs"
              disabled={loading}
              onClick={() =>
                void submitExchange(
                  alreadyLinked.publicToken,
                  alreadyLinked.metadata,
                  true
                )
              }
            >
              Link anyway
            </button>
            <button
              type="button"
              className="text-xs treasury-meta-fine underline"
              onClick={() => setAlreadyLinked(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-cinnabar mt-2" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
