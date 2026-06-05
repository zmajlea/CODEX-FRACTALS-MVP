export type GateOutcome =
  | { kind: "hidden" }
  | { kind: "disabled"; reason: string }
  | { kind: "allowed" }
  | { kind: "error"; message: string };

export type GateInput = {
  hidden?: boolean;
  disabledReason?: string | null;
  allowed?: boolean;
  errorMessage?: string | null;
};

/** S12 gating contract: Hidden | Disabled+reason | Allowed | Error-on-attempt */
export function resolveGate(input: GateInput): GateOutcome {
  if (input.hidden) return { kind: "hidden" };
  if (input.errorMessage) return { kind: "error", message: input.errorMessage };
  if (input.disabledReason) return { kind: "disabled", reason: input.disabledReason };
  if (input.allowed === false) {
    return { kind: "disabled", reason: "Not permitted for your role." };
  }
  return { kind: "allowed" };
}

export function isGateAllowed(outcome: GateOutcome): boolean {
  return outcome.kind === "allowed";
}
