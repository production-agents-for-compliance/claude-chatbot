import { CodeLanguage, Daytona, Sandbox } from "@daytonaio/sdk";
import type { Rule, ValidationResult } from "../types/index.ts";

interface SecurityCheck {
  safe: boolean;
  reason?: string;
}

const DANGEROUS_SNIPPETS = [
  "import os",
  "import subprocess",
  "from subprocess",
  "open(",
  "exec(",
  "eval(",
  "__import__",
  "os.system",
  "sys.stdout",
  "sys.stderr",
];

function assertEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const preserveSandbox =
  (process.env.DAYTONA_PRESERVE_SANDBOXES ?? "").toLowerCase() === "true";

export class DaytonaValidator {
  private client: Daytona;

  constructor() {
    const apiKey = assertEnvVar("DAYTONA_API_KEY");
    this.client = new Daytona({
      apiKey,
      target: process.env.DAYTONA_TARGET,
      apiUrl: process.env.DAYTONA_API_URL,
    });
  }

  checkSecurity(code: string): SecurityCheck {
    const lowerCode = code.toLowerCase();
    for (const snippet of DANGEROUS_SNIPPETS) {
      const needle = snippet.toLowerCase();
      if (lowerCode.includes(needle)) {
        return {
          safe: false,
          reason: `Code contains insecure pattern: ${snippet}`,
        };
      }
    }
    return { safe: true };
  }

  async validateRule(rule: Rule): Promise<ValidationResult> {
    const security = this.checkSecurity(rule.python_code);
    if (!security.safe) {
      return { passed: false, security_issue: security.reason };
    }

    let sandbox: Sandbox | null = null;
    try {
      sandbox = await this.client.create({
        language: CodeLanguage.PYTHON,
        networkBlockAll: true,
        autoStopInterval: 15,
        autoArchiveInterval: 0,
        autoDeleteInterval: 0,
        ephemeral: true,
      });
      console.log(
        `[DaytonaValidator] Sandbox ${sandbox.id ?? "unknown"} created for rule ${rule.rule_name}`,
      );

      const syntaxResult = await this.checkSyntax(sandbox, rule.python_code);
      if (!syntaxResult.passed) {
        return { passed: false, syntax_error: syntaxResult.error };
      }

      const runtimeResult = await this.runTests(sandbox, rule);
      if (!runtimeResult.passed) {
        return runtimeResult;
      }

      return { passed: true, test_output: runtimeResult.test_output };
    } catch (error) {
      console.error("Daytona validation error:", error);
      return {
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (sandbox) {
        try {
          if (preserveSandbox) {
            console.warn(
              `[DaytonaValidator] DAYTONA_PRESERVE_SANDBOXES=true, skipping cleanup for sandbox ${sandbox.id}`,
            );
          } else {
            await this.client.delete(sandbox);
            console.log(
              `[DaytonaValidator] Sandbox ${sandbox.id ?? "unknown"} deleted`,
            );
          }
        } catch (cleanupError) {
          console.warn("Failed to clean up Daytona sandbox:", cleanupError);
        }
      }
    }
  }

  private async checkSyntax(
    sandbox: Sandbox,
    pythonCode: string,
  ): Promise<{ passed: boolean; error?: string }> {
    const script = `
import ast
import base64
import sys
import textwrap

code = base64.b64decode("${toBase64(pythonCode)}").decode("utf-8")
code = textwrap.dedent(code)

try:
    ast.parse(code)
    print("SYNTAX_VALID")
except SyntaxError as exc:
    print("SYNTAX_ERROR:", exc)
    sys.exit(1)
`;

    const result = await sandbox.process.codeRun(script, undefined, 60);
    const stdout = result.artifacts?.stdout ?? result.result ?? "";
    const isValid = stdout.includes("SYNTAX_VALID");
    return {
      passed: isValid,
      error: isValid ? undefined : stdout.trim() || "Unknown syntax error",
    };
  }

  private async runTests(sandbox: Sandbox, rule: Rule): Promise<ValidationResult> {
    const payload = {
      code: rule.python_code,
      employee: {
        id: "validator-emp",
        role: "Equity Research Analyst - Technology",
        division: "Research",
        department: "Research",
        sector: "Technology",
        tier: 2,
        firm: rule.policy_reference,
        restricted_tickers: ["AAPL", "TSLA", "MSFT", "GOOGL"],
        can_trade: ["SPY", "VTI", "BND"],
        coverage_stocks: [
          { ticker: "AAPL", company: "Apple Inc", rating: "Buy", price_target: 250 },
          { ticker: "MSFT", company: "Microsoft", rating: "Buy", price_target: 475 },
          { ticker: "GOOGL", company: "Alphabet", rating: "Hold", price_target: 185 },
          { ticker: "TSLA", company: "Tesla", rating: "Watch", price_target: 200 }
        ],
        active_deals: [
          { ticker: "CVAI", deal_type: "IPO", reason: "Lead banker on IPO deal" }
        ],
        can_trade_reason: "Sample validator data",
        covered_tickers: ["AAPL", "MSFT", "GOOGL", "TSLA"]
      },
      security: {
        ticker: "TSLA",
        earnings_date: "2025-11-20",
        next_earnings_date: "2025-11-20",
        last_earnings_date: "2025-08-15",
        market_cap: 1_000_000_000,
        is_covered: true,
        requires_preapproval: false
      },
      trade_date: new Date().toISOString().slice(0, 10),
    };

    const script = `
import base64
import json
import textwrap
from datetime import datetime

payload = json.loads(base64.b64decode("${toBase64(JSON.stringify(payload))}").decode("utf-8"))
namespace = {}
code = textwrap.dedent(payload["code"])
exec(code, namespace)

rule_fn = None
for value in namespace.values():
    if callable(value):
        rule_fn = value
        break

if rule_fn is None:
    raise ValueError("No callable rule function found in python_code")

def _parse_date(value):
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return value
    return value

employee = payload["employee"]
security = payload["security"]

for key in ("earnings_date", "next_earnings_date", "last_earnings_date"):
    if key in security:
        security[key] = _parse_date(security[key])

trade_date = payload["trade_date"]
result = rule_fn(employee, security, trade_date)

if not isinstance(result, dict):
    raise ValueError("Rule must return a dict with an 'allowed' key")

if "allowed" not in result:
    raise ValueError("Result dict is missing 'allowed'")

print("__RULE_OUTPUT__")
print(json.dumps(result))
print("__RULE_OUTPUT_END__")
`;

    const execResult = await sandbox.process.codeRun(script, undefined, 120);
    const stdout = execResult.artifacts?.stdout ?? execResult.result ?? "";

    if (execResult.exitCode !== 0) {
      const runtimeError = stdout || "Runtime error while executing rule";
      return { passed: false, runtime_error: runtimeError.trim() };
    }

    const output = extractBetween(stdout, "__RULE_OUTPUT__", "__RULE_OUTPUT_END__");

    if (!output) {
      return {
        passed: false,
        test_failure: "Rule execution did not return structured output",
      };
    }

    try {
      const parsed = JSON.parse(output);
      if (typeof parsed.allowed !== "boolean") {
        return {
          passed: false,
          test_failure: "Rule output missing boolean 'allowed'",
        };
      }

      return {
        passed: true,
        test_output: JSON.stringify(parsed),
      };
    } catch (error) {
      return {
        passed: false,
        runtime_error: `Failed to parse rule output: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}

function toBase64(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64");
}

function extractBetween(content: string, start: string, end: string): string | null {
  const startIndex = content.indexOf(start);
  if (startIndex === -1) return null;
  const endIndex = content.indexOf(end, startIndex + start.length);
  if (endIndex === -1) return null;
  return content.slice(startIndex + start.length, endIndex).trim();
}

