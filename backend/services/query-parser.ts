import Anthropic from "@anthropic-ai/sdk";

const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";
const DEFAULT_QUERY_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5";

export type QueryAction = "buy" | "sell" | "trade";

export interface ParsedComplianceQuery {
	ticker: string;
	trade_date?: string;
	action?: QueryAction;
}

const QUERY_SCHEMA = {
	type: "object",
	properties: {
		ticker: {
			type: "string",
			description:
				"Uppercase ticker symbol mentioned in the query. Return UNKNOWN if you cannot determine it.",
		},
		trade_date: {
			type: "string",
			format: "date",
			description:
				"ISO 8601 date (YYYY-MM-DD) if the user mentions a specific trade date.",
		},
		action: {
			type: "string",
			enum: ["buy", "sell", "trade"],
			description: "Requested action inferred from the query, if any.",
		},
	},
	required: ["ticker"],
	additionalProperties: false,
} as const;

function assertEnvVar(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

export class QueryParser {
	private client: Anthropic;
	private model: string;

	constructor(model: string = DEFAULT_QUERY_MODEL) {
		const apiKey = assertEnvVar("ANTHROPIC_API_KEY");
		this.client = new Anthropic({ apiKey });
		this.model = model;
	}

	async parseQuery(
		query: string,
		context?: { firmName?: string; employeeId?: string }
	): Promise<ParsedComplianceQuery> {
		if (!query?.trim()) {
			throw new Error("Query text is required.");
		}

		const prompt = [
			"You are a compliance assistant that extracts structured details from employee trading questions.",
			"Return JSON that matches the provided schema.",
			"Rules:",
			"- Always output an uppercase ticker symbol.",
			'- If you cannot determine the ticker, set ticker to "UNKNOWN".',
			"- trade_date should be ISO 8601 (YYYY-MM-DD) if the user mentions a specific date.",
			"- action is optional and should be one of buy, sell, or trade when implied.",
			"",
			context?.firmName ? `Firm: ${context.firmName}` : "Firm: (not specified)",
			context?.employeeId
				? `Employee ID: ${context.employeeId}`
				: "Employee ID: (not specified)",
			"",
			"User query:",
			query.trim(),
		].join("\n");

		const response = await this.client.beta.messages.create({
			model: this.model,
			max_tokens: 512,
			betas: [STRUCTURED_OUTPUTS_BETA],
			messages: [
				{
					role: "user",
					content: prompt,
				},
			],
			output_format: {
				type: "json_schema",
				schema: QUERY_SCHEMA,
			},
		});

		const outputBlock = response.content.find(
			(block) => block.type === "text"
		) as { type: "text"; text: string } | undefined;

		if (!outputBlock?.text) {
			throw new Error("Query parser did not return structured output.");
		}

		let parsed: ParsedComplianceQuery;
		try {
			parsed = JSON.parse(outputBlock.text) as ParsedComplianceQuery;
		} catch (error) {
			throw new Error(
				`Failed to parse structured output: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}

		const ticker = parsed.ticker?.toUpperCase().trim();
		if (!ticker || ticker === "UNKNOWN") {
			throw new Error("Could not determine the ticker from the query.");
		}

		return {
			ticker,
			trade_date: parsed.trade_date,
			action: parsed.action,
		};
	}
}
