-- Models Phase 2 — allow the new engine kinds on treasury_studies.type.
-- The type CHECK constraint (last set in 20260819120000_mcp_b1.sql) only permitted
-- spend_plan / cash_model / external_model, so inserting a 'forecast' or
-- 'seasonality' row via POST /studies failed with treasury_studies_type_check.
-- Phase 1 assumed the column was free text; it is not. Extend the allow-list.

alter table public.treasury_studies
  drop constraint if exists treasury_studies_type_check;

alter table public.treasury_studies
  add constraint treasury_studies_type_check
  check (type in ('spend_plan', 'cash_model', 'external_model', 'forecast', 'seasonality'));
