export interface ValidationAttempt {
  attempt_number: number;
  passed: boolean;
  error?: string;
  test_output?: string;
  feedback_to_llm?: string;
  timestamp: string;
}

export interface Rule {
  rule_id: string;
  rule_name: string;
  description: string;
  policy_reference: string;
  python_code: string;
  applies_to_roles: string[];
  active: boolean;
  generation_attempt: number;
  validation_history: ValidationAttempt[];
}

export interface RulesData {
  firm_name: string;
  policy_version: string;
  last_updated: string;
  generated_by_llm: true;
  total_iterations: number;
  rules: Rule[];
}

export interface PreviousAttemptContext {
  code: string;
  error: string;
  test_results: string;
}

export interface GenerationContext {
  policy_text: string;
  firm_name: string;
  previous_attempt?: PreviousAttemptContext;
}

export interface Employee extends Record<string, unknown> {
  id: string;
  role: string;
  division?: string;
  firm: string;
  covered_tickers?: string[];
  tier?: number;
  department?: string;
  sector?: string;
  restricted_tickers?: string[];
  can_trade?: string[];
  can_trade_reason?: string;
  restriction_reason?: string;
  trading_desk?: string;
  active_deals?: unknown[];
  coverage_stocks?: unknown[];
  quiet_periods?: unknown[];
  family_conflicts?: unknown[];
  recently_overheard?: unknown[];
  firm_restrictions?: unknown;
  quick_reference?: Record<string, unknown>;
}

export interface Security extends Record<string, unknown> {
  ticker: string;
  earnings_date?: string;
  market_cap?: number;
  requested_action?: string;
}

export interface ComplianceResult {
  allowed: boolean;
  reasons: string[];
  policy_refs: string[];
  rules_checked: string[];
}

export interface ValidationResult {
  passed: boolean;
  syntax_error?: string;
  runtime_error?: string;
  test_failure?: string;
  security_issue?: string;
  error?: string;
  test_output?: string;
}

