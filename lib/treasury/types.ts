export type TreasuryTransaction = {
  date: string;
  name: string;
  amount: number;
  iso_currency_code: string | null;
  account_id: string;
  pending: boolean;
};

export type TreasuryAccountView = {
  account_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
};

export type TreasuryInstitutionView = {
  item_id: string;
  institution_name: string | null;
  needs_reconnect: boolean;
  key_destroyed?: boolean;
  accounts: TreasuryAccountView[];
};

export type TreasuryAccountsResponse = {
  institutions: TreasuryInstitutionView[];
  transactions: TreasuryTransaction[];
};
