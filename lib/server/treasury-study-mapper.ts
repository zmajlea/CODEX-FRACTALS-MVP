import type {
  CashModelDerivedSnapshot,
  CashModelParams,
  CashModelScenario,
} from "@/lib/treasury/cash-model-types";
import type {
  DerivedSnapshot,
  StudyParams,
  StudyScope,
  TreasuryStudyRow,
} from "@/lib/treasury/studies";
import type { SpendPlanScenario } from "@/lib/treasury/spend-plan";
import type { Database } from "@/lib/database.types";

type StudyDbRow = Database["public"]["Tables"]["treasury_studies"]["Row"];

function baseFields(row: StudyDbRow) {
  return {
    id: row.id,
    client_user_id: row.client_user_id,
    operator_tenant_id: row.operator_tenant_id,
    created_by: row.created_by,
    name: row.name,
    scope: row.scope as StudyScope,
    is_primary: row.is_primary ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function asTreasuryStudyRow(row: StudyDbRow): TreasuryStudyRow {
  if (row.type === "cash_model") {
    return {
      ...baseFields(row),
      type: "cash_model",
      params: row.params as CashModelParams,
      scenarios: row.scenarios as CashModelScenario[],
      derived_snapshot: row.derived_snapshot as CashModelDerivedSnapshot,
    };
  }
  return {
    ...baseFields(row),
    type: "spend_plan",
    params: row.params as StudyParams,
    scenarios: row.scenarios as SpendPlanScenario[],
    derived_snapshot: row.derived_snapshot as DerivedSnapshot,
  };
}
