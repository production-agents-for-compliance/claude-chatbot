import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RulesData, Rule } from "./types/index.ts";

const RULES_DIR = join(process.cwd(), "rules", "dynamic");

interface ViewOptions {
  firmName?: string;
  showPython?: boolean;
  showValidation?: boolean;
  ruleId?: string;
}

async function listRuleFiles(): Promise<string[]> {
  try {
    const files = await readdir(RULES_DIR);
    return files.filter((f) => f.endsWith("_rules.json"));
  } catch (error) {
    console.error(`Error reading rules directory: ${error}`);
    return [];
  }
}

async function loadRulesFile(fileName: string): Promise<RulesData | null> {
  try {
    const filePath = join(RULES_DIR, fileName);
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as RulesData;
  } catch (error) {
    console.error(`Error loading ${fileName}: ${error}`);
    return null;
  }
}

function formatRule(rule: Rule, options: ViewOptions): string {
  let output = `\n${"=".repeat(80)}\n`;
  output += `Rule ID: ${rule.rule_id}\n`;
  output += `Name: ${rule.rule_name}\n`;
  output += `Description: ${rule.description}\n`;
  output += `Policy Reference: ${rule.policy_reference}\n`;
  output += `Status: ${rule.active ? "✅ Active" : "❌ Inactive"}\n`;
  output += `Applies to Roles: ${rule.applies_to_roles.length > 0 ? rule.applies_to_roles.join(", ") : "All"}\n`;
  output += `Generation Attempt: ${rule.generation_attempt}\n`;

  if (options.showValidation && rule.validation_history.length > 0) {
    output += `\nValidation History:\n`;
    rule.validation_history.forEach((attempt) => {
      output += `  Attempt ${attempt.attempt_number}: ${attempt.passed ? "✅ Passed" : "❌ Failed"}\n`;
      if (attempt.timestamp) {
        output += `    Timestamp: ${new Date(attempt.timestamp).toLocaleString()}\n`;
      }
      if (attempt.test_output) {
        output += `    Test Output: ${attempt.test_output}\n`;
      }
      if (attempt.error) {
        output += `    Error: ${attempt.error}\n`;
      }
    });
  }

  if (options.showPython !== false) {
    output += `\nPython Code:\n`;
    output += `${"-".repeat(80)}\n`;
    output += rule.python_code;
    output += `\n${"-".repeat(80)}\n`;
  }

  return output;
}

function formatRulesData(data: RulesData, options: ViewOptions): string {
  let output = `\n${"#".repeat(80)}\n`;
  output += `Firm: ${data.firm_name}\n`;
  output += `Policy Version: ${data.policy_version}\n`;
  output += `Last Updated: ${new Date(data.last_updated).toLocaleString()}\n`;
  output += `Total Iterations: ${data.total_iterations}\n`;
  output += `Total Rules: ${data.rules.length}\n`;
  output += `${"#".repeat(80)}\n`;

  const rulesToShow = options.ruleId
    ? data.rules.filter((r) => r.rule_id === options.ruleId)
    : data.rules;

  if (rulesToShow.length === 0) {
    output += `\nNo rules found${options.ruleId ? ` with ID: ${options.ruleId}` : ""}\n`;
    return output;
  }

  rulesToShow.forEach((rule) => {
    output += formatRule(rule, options);
  });

  return output;
}

async function viewRules(options: ViewOptions = {}) {
  const files = await listRuleFiles();

  if (files.length === 0) {
    console.log("No rule files found in", RULES_DIR);
    return;
  }

  console.log(`Found ${files.length} rule file(s):\n`);

  for (const file of files) {
    const data = await loadRulesFile(file);
    if (!data) continue;

    // Filter by firm name if specified
    if (options.firmName) {
      const normalizedFirmName = options.firmName.trim().toLowerCase().replace(/\s+/g, "_");
      const fileName = file.replace("_rules.json", "");
      if (fileName !== normalizedFirmName) {
        continue;
      }
    }

    console.log(formatRulesData(data, options));
  }
}

// Parse command line arguments
function parseArgs(): ViewOptions {
  const args = process.argv.slice(2);
  const options: ViewOptions = {
    showPython: true, // Show Python code by default
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--firm":
      case "-f":
        options.firmName = args[++i];
        break;
      case "--no-python":
        options.showPython = false;
        break;
      case "--python":
      case "-p":
        options.showPython = true;
        break;
      case "--validation":
      case "-v":
        options.showValidation = true;
        break;
      case "--rule":
      case "-r":
        options.ruleId = args[++i];
        break;
      case "--help":
      case "-h":
        console.log(`
Usage: bun run view-rules.ts [options]

Options:
  -f, --firm <name>        Filter by firm name (e.g., "TestFirm")
  -p, --python             Show Python code for each rule (default: enabled)
      --no-python          Hide Python code
  -v, --validation         Show validation history for each rule
  -r, --rule <id>          Show only a specific rule by ID
  -h, --help               Show this help message

Examples:
  bun run view-rules.ts
  bun run view-rules.ts --firm TestFirm
  bun run view-rules.ts --firm TestFirm --rule earnings_blackout_period
  bun run view-rules.ts --validation
  bun run view-rules.ts --no-python
        `);
        process.exit(0);
        break;
    }
  }

  return options;
}

// Main execution
const options = parseArgs();
viewRules(options).catch((error) => {
  console.error("Error viewing rules:", error);
  process.exit(1);
});

