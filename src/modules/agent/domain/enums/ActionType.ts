// ── ActionType ────────────────────────────────────────────────────────────────
// Whitelist of every action the AI agent is allowed to propose.
// No action can be executed unless it appears here — this is the security
// boundary that prevents arbitrary tool execution.

export enum ActionType {
  RETRY_PAYMENT = "RETRY_PAYMENT",
  SEND_COLLECTION_EMAIL = "SEND_COLLECTION_EMAIL",
  FLAG_HIGH_RISK_ACCOUNT = "FLAG_HIGH_RISK_ACCOUNT",
  GENERATE_INVOICE = "GENERATE_INVOICE",
  DISABLE_SUBSCRIPTION = "DISABLE_SUBSCRIPTION",
  NOTIFY_FINANCE_TEAM = "NOTIFY_FINANCE_TEAM",
  // Phase-4 additions
  REFUND_PAYMENT = "REFUND_PAYMENT",
  FIX_INVOICE = "FIX_INVOICE",
  SEND_NOTIFICATION = "SEND_NOTIFICATION",
  UPDATE_SUBSCRIPTION = "UPDATE_SUBSCRIPTION",
  MARK_REVENUE_RECOVERED = "MARK_REVENUE_RECOVERED",
}

export const ALL_ACTION_TYPES = Object.values(ActionType);

/** The strict Phase-4 whitelist — only these actions may be executed. */
export const ACTION_WHITELIST = new Set<ActionType>(ALL_ACTION_TYPES);

/** Human-readable labels for UI / audit logs */
export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  [ActionType.RETRY_PAYMENT]: "Retry failed payment",
  [ActionType.SEND_COLLECTION_EMAIL]: "Send collection email",
  [ActionType.FLAG_HIGH_RISK_ACCOUNT]: "Flag high-risk account",
  [ActionType.GENERATE_INVOICE]: "Generate invoice",
  [ActionType.DISABLE_SUBSCRIPTION]: "Disable subscription",
  [ActionType.NOTIFY_FINANCE_TEAM]: "Notify finance team",
  [ActionType.REFUND_PAYMENT]: "Refund payment",
  [ActionType.FIX_INVOICE]: "Fix invoice",
  [ActionType.SEND_NOTIFICATION]: "Send notification",
  [ActionType.UPDATE_SUBSCRIPTION]: "Update subscription",
  [ActionType.MARK_REVENUE_RECOVERED]: "Mark revenue recovered",
};

/** Financial action types that require double approval */
export const FINANCIAL_ACTION_TYPES = new Set<ActionType>([
  ActionType.RETRY_PAYMENT,
  ActionType.REFUND_PAYMENT,
  ActionType.FIX_INVOICE,
  ActionType.GENERATE_INVOICE,
  ActionType.UPDATE_SUBSCRIPTION,
]);

/** Whether the given string is a valid ActionType */
export function isValidActionType(value: string): value is ActionType {
  return ALL_ACTION_TYPES.includes(value as ActionType);
}

/** Whether the given ActionType is in the execution whitelist */
export function isWhitelistedAction(value: string): boolean {
  return ACTION_WHITELIST.has(value as ActionType);
}
