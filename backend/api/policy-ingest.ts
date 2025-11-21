import { IterativePipeline } from "../services/iterative-pipeline.ts";

const pipeline = new IterativePipeline();

interface PolicyIngestRequest {
  firm_name?: string;
  policy_text?: string;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as PolicyIngestRequest;
    const firmName = body.firm_name?.trim();
    const policyText = body.policy_text?.trim();

    if (!firmName || !policyText) {
      return Response.json(
        {
          status: "ERROR",
          message: "firm_name and policy_text are required.",
        },
        { status: 400 },
      );
    }

    const rulesData = await pipeline.processPolicy(policyText, firmName);

    return Response.json({
      status: "SUCCESS",
      firm_name: firmName,
      rules_deployed: rulesData.rules.length,
      total_iterations: rulesData.total_iterations,
      rules: rulesData.rules.map((rule) => ({
        rule_name: rule.rule_name,
        description: rule.description,
        attempts: rule.generation_attempt,
        validated: rule.validation_history.at(-1)?.passed ?? false,
      })),
    });
  } catch (error) {
    console.error("Policy ingest failed:", error);
    return Response.json(
      {
        status: "ERROR",
        message: "Failed to ingest policy.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

