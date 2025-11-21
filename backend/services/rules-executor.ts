import type { Employee, ComplianceResult, Rule, Security } from "../types/index.ts";
import { runPythonCode } from "../utils/python-bridge.ts";
import { RulesStorage } from "./rules-storage.ts";

interface RuleExecutionResult {
  allowed: boolean;
  reason?: string;
}

const PYTHON_RUNNER = `
import json
import sys
import textwrap

payload = json.loads(sys.stdin.read())
namespace = {}
exec(textwrap.dedent(payload["code"]), namespace)

rule_fn = None
for value in namespace.values():
    if callable(value):
        rule_fn = value
        break

if rule_fn is None:
    raise ValueError("No callable rule function found")

result = rule_fn(payload["employee"], payload["security"], payload["date"])
print(json.dumps(result))
`;

export class RulesExecutor {
  constructor(private readonly storage = new RulesStorage()) {}

  async checkCompliance(
    firmName: string,
    employee: Employee,
    security: Security,
    tradeDate: string,
  ): Promise<ComplianceResult> {
    const stored = await this.storage.loadRules(firmName);
    if (!stored) {
      return { allowed: true, reasons: [], policy_refs: [], rules_checked: [] };
    }

    const response: ComplianceResult = {
      allowed: true,
      reasons: [],
      policy_refs: [],
      rules_checked: [],
    };

    for (const rule of stored.rules) {
      if (!rule.active) continue;
      if (
        rule.applies_to_roles.length > 0 &&
        !rule.applies_to_roles.includes(employee.role)
      ) {
        continue;
      }

      response.rules_checked.push(rule.rule_name);

      try {
        const execution = await this.executeRule(
          rule,
          employee,
          security,
          tradeDate,
        );

        if (!execution.allowed) {
          response.allowed = false;
          if (execution.reason) {
            response.reasons.push(execution.reason);
          }
          response.policy_refs.push(rule.policy_reference);
        }
      } catch (error) {
        response.allowed = false;
        response.reasons.push(
          `Rule ${rule.rule_name} execution failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        response.policy_refs.push(rule.policy_reference);
      }
    }

    return response;
  }

  private async executeRule(
    rule: Rule,
    employee: Employee,
    security: Security,
    tradeDate: string,
  ): Promise<RuleExecutionResult> {
    const stdout = await runPythonCode(
      PYTHON_RUNNER,
      {
        code: rule.python_code,
        employee,
        security,
        date: tradeDate,
      },
      { timeoutMs: 10_000 },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new Error("Python bridge returned invalid JSON");
    }

    const result = parsed as RuleExecutionResult;
    if (typeof result.allowed !== "boolean") {
      throw new Error("Rule result missing boolean 'allowed'");
    }

    return result;
  }
}

