import Anthropic from "@anthropic-ai/sdk";
import type { GenerationContext, Rule } from "../types/index.ts";

const DEFAULT_MODEL = process.env.CLAUDE_MODEL ?? "claude-3-7-sonnet-latest";
const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";

function assertEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

type StructuredRule = {
  rule_id: string;
  rule_name: string;
  description: string;
  policy_reference: string;
  applies_to_roles?: string[];
  python_code: string;
};

const RULE_GENERATION_SCHEMA = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule_id: {
            type: "string",
            description: "Machine-readable identifier for the rule (snake_case).",
          },
          rule_name: {
            type: "string",
            description: "Human-readable name for the rule.",
          },
          description: {
            type: "string",
            description: "Short explanation of what the rule enforces.",
          },
          policy_reference: {
            type: "string",
            description: "Policy section reference, e.g. 'Section 3.2.1'.",
          },
          applies_to_roles: {
            type: "array",
            items: { type: "string" },
            description: "Roles this rule applies to. Use [] for ALL roles.",
            default: [],
          },
          python_code: {
            type: "string",
            description:
              "Complete Python function named 'rule' that checks employee/security data and returns {'allowed': bool, 'reason': str | None, 'policy_ref': str | None}.",
          },
        },
        required: [
          "rule_id",
          "rule_name",
          "description",
          "policy_reference",
          "python_code",
        ],
        additionalProperties: false,
      },
      default: [],
    },
  },
  required: ["rules"],
  additionalProperties: false,
} as const;

export class LLMGenerator {
  private client: Anthropic;
  private model: string;

  constructor(model: string = DEFAULT_MODEL) {
    const apiKey = assertEnvVar("ANTHROPIC_API_KEY");
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateRules(context: GenerationContext): Promise<Rule[]> {
    const prompt = buildInitialPrompt(context);
    return this.requestStructuredRules(prompt);
  }

  async regenerateRule(context: GenerationContext): Promise<Rule[]> {
    if (!context.previous_attempt) {
      throw new Error("previous_attempt is required when regenerating a rule");
    }
    const prompt = buildRegenerationPrompt(context);
    return this.requestStructuredRules(prompt);
  }

  private async requestStructuredRules(prompt: string): Promise<Rule[]> {
    const message = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 4000,
      temperature: 0,
      betas: [STRUCTURED_OUTPUTS_BETA],
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      output_format: {
        type: "json_schema",
        schema: RULE_GENERATION_SCHEMA,
      },
    });

    const blocks = message.content ?? [];
    const textBlock = blocks.find(
      (block) => block.type === "text",
    ) as { text: string } | undefined;
    if (!textBlock?.text?.trim()) {
      throw new Error("LLM did not return structured rule output.");
    }

    let parsed: { rules?: StructuredRule[] };
    try {
      parsed = JSON.parse(textBlock.text) as { rules?: StructuredRule[] };
    } catch (error) {
      throw new Error(
        `Failed to parse structured rule output: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const structuredRules = parsed.rules ?? [];
    const mapped = structuredRules
      .map((rule) => convertStructuredRule(rule))
      .filter((rule): rule is Rule => Boolean(rule));

    return mapped;
  }
}

function convertStructuredRule(candidate: StructuredRule): Rule | null {
  const baseFieldsPresent =
    candidate.rule_id &&
    candidate.rule_name &&
    candidate.description &&
    candidate.policy_reference &&
    candidate.python_code;

  if (!baseFieldsPresent) {
    console.warn(
      "Skipping structured rule because required fields were missing:",
      candidate,
    );
    return null;
  }

  const appliesToRoles = Array.isArray(candidate.applies_to_roles)
    ? candidate.applies_to_roles.filter((role) => role && role.trim().length)
    : [];

  return {
    rule_id: candidate.rule_id,
    rule_name: candidate.rule_name,
    description: candidate.description,
    policy_reference: candidate.policy_reference,
    python_code: candidate.python_code,
    applies_to_roles: appliesToRoles,
    active: true,
    generation_attempt: 1,
    validation_history: [],
  };
}

function buildInitialPrompt(context: GenerationContext): string {
  return [
    "You are an expert compliance engineer. Convert the provided policy text into executable Python compliance rules.",
    "",
    "Employee object schema (JSON):",
    JSON.stringify(
      {
        id: "string",
        role:
          "string, e.g. 'Equity Research Analyst - Technology', 'VP - Healthcare Investment Banking'",
        tier: "number (1-4, where 1 is most restricted)",
        department: "string",
        sector: "string",
        restricted_tickers: "string[] - ALWAYS block these tickers",
        can_trade: "string[] - allowed tickers for tier-based exceptions",
        coverage_stocks:
          "Array<{ticker, company, rating, price_target}> - for analysts",
        active_deals:
          "Array<{ticker, deal_type, reason}> - for bankers with live deals",
      },
      null,
      2,
    ),
    "",
    "Security object example:",
    JSON.stringify(
      {
        ticker: "TSLA",
        earnings_date: "2025-11-20 (ISO)",
        last_earnings_date: "2025-08-15",
        next_earnings_date: "2025-11-20",
        market_cap: 1_000_000_000,
      },
      null,
      2,
    ),
    "",
    "Rules must:",
    "- Always check employee.restricted_tickers first.",
    "- For analysts, block trades in coverage_stocks unless explicit pre-approval is recorded in employee data.",
    "- Respect employee tiers (tier 1 is most restricted).",
    "- Return a dict with boolean 'allowed', and optional 'reason' / 'policy_ref'.",
    "- Use only Python stdlib.",
    "",
    `Firm: ${context.firm_name}`,
    "Policy text:",
    context.policy_text,
  ].join("\n");
}

function buildRegenerationPrompt(context: GenerationContext): string {
  const previous = context.previous_attempt!;
  return [
    "You are refining an existing compliance rule based on validator feedback.",
    "Original policy text and firm context remain the same.",
    "Revise the rule while keeping the same intent.",
    "",
    "Employee data reminders:",
    "- employee.restricted_tickers: string[] — block immediately if ticker is here.",
    "- employee.coverage_stocks: array<{ticker,...}> — analysts must not trade these without pre-approval data in employee object.",
    "- employee.tier: number — tier 1 is most restricted.",
    "",
    "Previous attempt code:",
    "```python",
    previous.code.trim(),
    "```",
    "",
    "Validator error details:",
    previous.error,
    "",
    "Test results / runtime output:",
    previous.test_results,
    "",
    "Return ONLY structured rules that match the provided schema. Do not include commentary.",
    "",
    `Firm: ${context.firm_name}`,
    "Policy text:",
    context.policy_text,
  ].join("\n");
}
