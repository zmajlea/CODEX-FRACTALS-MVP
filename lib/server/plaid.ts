import "server-only";

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
} from "plaid";

function plaidEnv() {
  const raw = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  if (raw === "production") return PlaidEnvironments.production;
  if (raw === "development") return PlaidEnvironments.development;
  return PlaidEnvironments.sandbox;
}

const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SECRET;

if (!clientId || !secret) {
  console.warn(
    "[treasury] PLAID_CLIENT_ID or PLAID_SECRET missing — Plaid routes will fail until configured."
  );
}

const configuration = new Configuration({
  basePath: plaidEnv(),
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": clientId ?? "",
      "PLAID-SECRET": secret ?? "",
    },
  },
});

export const plaid = new PlaidApi(configuration);
