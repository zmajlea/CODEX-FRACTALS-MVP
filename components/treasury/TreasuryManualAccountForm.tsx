"use client";

import { useState } from "react";
import type { TreasuryAccountView } from "@/lib/treasury/types";

const TYPE_OPTIONS = [
  { value: "depository", label: "Checking / savings", subtype: "checking" },
  { value: "credit", label: "Credit card", subtype: "credit card" },
  { value: "loan", label: "Loan", subtype: "loan" },
  { value: "investment", label: "Investment", subtype: "investment" },
  { value: "other", label: "Other", subtype: "other" },
] as const;

type Props = {
  account?: TreasuryAccountView | null;
  onSaved: () => void;
  onCancel: () => void;
};

export function TreasuryManualAccountForm({ account, onSaved, onCancel }: Props) {
  const isEdit = Boolean(account);
  const [name, setName] = useState(account?.name ?? "");
  const [typeKey, setTypeKey] = useState<string>(() => {
    const match = TYPE_OPTIONS.find((o) => o.value === account?.type);
    return match?.value ?? "depository";
  });
  const [balance, setBalance] = useState(
    account?.current_balance != null ? String(account.current_balance) : ""
  );
  const [currency, setCurrency] = useState(account?.iso_currency_code ?? "USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = TYPE_OPTIONS.find((o) => o.value === typeKey) ?? TYPE_OPTIONS[0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      name: name.trim(),
      type: selected.value,
      subtype: selected.subtype,
      current_balance: balance.trim() === "" ? null : Number(balance),
      available_balance: balance.trim() === "" ? null : Number(balance),
      iso_currency_code: currency.trim() || "USD",
    };
    if (Number.isNaN(payload.current_balance as number)) {
      setError("Balance must be a number");
      setBusy(false);
      return;
    }
    try {
      const url = isEdit
        ? `/api/treasury/manual-accounts/${encodeURIComponent(account!.account_id)}`
        : "/api/treasury/manual-accounts";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Save failed");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="src-account-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="src-account-form-grid">
        <label className="text-xs">
          Name
          <input
            className="input mt-1 w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isEdit}
            placeholder="Operating"
          />
        </label>
        <label className="text-xs">
          Type
          <select
            className="input mt-1 w-full"
            value={typeKey}
            onChange={(e) => setTypeKey(e.target.value)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Balance
          <input
            className="input mt-1 w-full tabular-nums"
            type="number"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="text-xs">
          Currency
          <input
            className="input mt-1 w-full"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
          />
        </label>
      </div>
      {error ? (
        <p className="text-xs text-cinnabar mt-2" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="submit" className="btn btn-primary text-xs" disabled={busy}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Add account"}
        </button>
        <button type="button" className="btn btn-secondary text-xs" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
