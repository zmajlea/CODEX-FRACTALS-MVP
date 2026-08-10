"use client";

type Props = {
  studyName: string;
  accountId: string;
};

/** Commit 1 stub — full panel lands in commit 3. */
export function TreasuryCashModelPanel({ studyName, accountId }: Props) {
  return (
    <div
      className="panel p-6 space-y-2"
      style={{ border: "1px solid var(--line)" }}
    >
      <h2 className="rs-h">{studyName}</h2>
      <p className="treasury-meta">
        Cash model for account <code>{accountId}</code> — computation and charts
        ship in the next commits.
      </p>
      <p className="treasury-meta-fine">
        Primary study row is persisted; scenarios Base / Downside are seeded.
      </p>
    </div>
  );
}
