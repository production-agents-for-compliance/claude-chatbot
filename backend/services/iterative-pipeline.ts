import type {
  GenerationContext,
  Rule,
  RulesData,
  ValidationAttempt,
} from "../types/index.ts";
import { DaytonaValidator } from "./daytona-validator.ts";
import { LLMGenerator } from "./llm-generator.ts";
import { RulesStorage } from "./rules-storage.ts";

interface ValidationLoopResult {
  validated: boolean;
  rule: Rule;
  iterations: number;
}

export class IterativePipeline {
  private readonly maxIterationsPerRule: number;

  constructor(
    private readonly llmGenerator = new LLMGenerator(),
    private readonly validator = new DaytonaValidator(),
    private readonly storage = new RulesStorage(),
    options?: { maxIterationsPerRule?: number },
  ) {
    this.maxIterationsPerRule = options?.maxIterationsPerRule ?? 5;
  }

  async processPolicy(policyText: string, firmName: string): Promise<RulesData> {
    console.log(
      `[IterativePipeline] Processing policy for ${firmName}. length=${policyText.length}`,
    );

    const initialRules = await this.llmGenerator.generateRules({
      policy_text: policyText,
      firm_name: firmName,
    });

    const validatedRules: Rule[] = [];
    let totalIterations = 0;

    for (const rule of initialRules) {
      const result = await this.validateAndRefineRule(rule, policyText, firmName);
      totalIterations += result.iterations;
      if (result.validated) {
        validatedRules.push(result.rule);
        console.log(
          `[IterativePipeline] Rule ${result.rule.rule_name} validated in ${result.iterations} attempts.`,
        );
      } else {
        console.warn(
          `[IterativePipeline] Rule ${rule.rule_name} failed after ${result.iterations} attempts.`,
        );
      }
    }

    return this.storage.saveRules(firmName, validatedRules, totalIterations);
  }

  async validateAndRefineRule(
    initialRule: Rule,
    policyText: string,
    firmName: string,
  ): Promise<ValidationLoopResult> {
    let currentRule: Rule = { ...initialRule, validation_history: [] };
    let attempt = 0;

    while (attempt < this.maxIterationsPerRule) {
      attempt += 1;
      currentRule.generation_attempt = attempt;

      const validationResult = await this.validator.validateRule(currentRule);
      const historyEntry: ValidationAttempt = {
        attempt_number: attempt,
        passed: validationResult.passed,
        error:
          validationResult.error ||
          validationResult.syntax_error ||
          validationResult.runtime_error ||
          validationResult.test_failure ||
          validationResult.security_issue,
        test_output: validationResult.test_output,
        feedback_to_llm: validationResult.passed
          ? undefined
          : createFeedbackForLLM(validationResult),
        timestamp: new Date().toISOString(),
      };
      currentRule.validation_history.push(historyEntry);

      if (validationResult.passed) {
        return { validated: true, rule: currentRule, iterations: attempt };
      }

      if (attempt >= this.maxIterationsPerRule) {
        break;
      }

      const context: GenerationContext = {
        policy_text: policyText,
        firm_name: firmName,
        previous_attempt: {
          code: currentRule.python_code,
          error:
            validationResult.error ||
            validationResult.syntax_error ||
            validationResult.runtime_error ||
            validationResult.test_failure ||
            validationResult.security_issue ||
            "Unknown validation error",
          test_results: validationResult.test_output ?? "No test output",
        },
      };

      console.log(
        `[IterativePipeline] Regenerating rule ${currentRule.rule_name} (attempt ${attempt + 1})`,
      );

      const regenerated = await this.llmGenerator.regenerateRule(context);
      if (!regenerated.length) {
        console.warn(
          "[IterativePipeline] LLM returned no rules during regeneration.",
        );
        break;
      }

      const nextRule = regenerated[0];
      currentRule = {
        ...nextRule,
        rule_id: initialRule.rule_id,
        validation_history: currentRule.validation_history,
        generation_attempt: attempt,
      } as Rule;
    }

    return { validated: false, rule: currentRule, iterations: attempt };
  }
}

export function createFeedbackForLLM(validation: {
  syntax_error?: string;
  runtime_error?: string;
  test_failure?: string;
  security_issue?: string;
  error?: string;
}): string {
  const feedback: string[] = [];

  if (validation.syntax_error) {
    feedback.push(`Fix syntax issues: ${validation.syntax_error}`);
  }
  if (validation.runtime_error) {
    feedback.push(`Runtime failure: ${validation.runtime_error}`);
  }
  if (validation.test_failure) {
    feedback.push(`Logical/test failure: ${validation.test_failure}`);
  }
  if (validation.security_issue) {
    feedback.push(`Security violation: ${validation.security_issue}`);
  }
  if (validation.error && feedback.length === 0) {
    feedback.push(`General validation error: ${validation.error}`);
  }

  return (
    feedback.join(" ") ||
    "Validation failed for unspecified reasons. Re-check rule robustness."
  );
}

