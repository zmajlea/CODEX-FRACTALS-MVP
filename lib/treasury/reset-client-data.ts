export type ResetClientDataCounts = {
  transactions: number;
  accounts: number;
  rules: number;
  rule_rejections: number;
  studies: number;
  recommendations: number;
  /** Recommendations/questions already sent (status !== draft) or sealed. */
  sent_recommendations: number;
};
