# Policy-as-Code Server

A Bun backend that converts firm policies into validated Python compliance rules using an iterative LLM + Daytona validation loop.

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment Variables

Create a `.env` file in the `server/` directory with the following required variables:

```bash
# Required: Anthropic API key for Claude LLM
ANTHROPIC_API_KEY=your-anthropic-api-key-here

# Required: Daytona API key for sandbox validation
DAYTONA_API_KEY=your-daytona-api-key-here

# Optional: Claude model name (defaults to claude-3-7-sonnet-latest)
CLAUDE_MODEL=claude-3-7-sonnet-latest

# Optional: Daytona API URL (defaults to https://app.daytona.io/api)
DAYTONA_API_URL=https://app.daytona.io/api

# Optional: Daytona target environment
DAYTONA_TARGET=us

# Optional: Server port (defaults to 3000)
PORT=3000

# Optional: Python executable path (defaults to "python")
PYTHON_BIN=python

# Optional: Skip deleting Daytona sandboxes (for debugging)
DAYTONA_PRESERVE_SANDBOXES=false

# Optional: Override the Anthropic model for NL query parsing
# Defaults to CLAUDE_MODEL, or claude-3-7-sonnet-latest if unset
CLAUDE_QUERY_MODEL=claude-3-7-sonnet-latest
```

**Note:** Bun automatically loads `.env` files, so no additional configuration is needed.

### 3. Ensure Python is Available

The system requires Python for rule execution. Verify it's available:

```bash
python --version
# or
python3 --version
```

If using `python3`, set `PYTHON_BIN=python3` in your `.env` file.

## Running the Server

```bash
bun run index.ts
```

The server will start on `http://localhost:3000` (or your configured `PORT`).

## Testing

### 1. Policy Ingestion

Ingest a policy to generate compliance rules:

```bash
curl -X POST http://localhost:3000/api/policies/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "firm_name": "JPMorgan",
    "policy_text": "Employees cannot trade within 5 days of earnings announcements. Analysts must obtain pre-approval for trades in covered securities."
  }'
```

**Expected Response:**
```json
{
  "status": "SUCCESS",
  "firm_name": "JPMorgan",
  "rules_deployed": 2,
  "total_iterations": 3,
  "rules": [
    {
      "rule_name": "Earnings Announcement Trading Restriction",
      "description": "Blocks trades within 5 days of earnings",
      "attempts": 2,
      "validated": true
    },
    {
      "rule_name": "Analyst Pre-Approval Requirement",
      "description": "Requires pre-approval for covered securities",
      "attempts": 1,
      "validated": true
    }
  ]
}
```

### 2. Natural-Language Compliance Check

`demo_data_simple.json` (located at the project root) acts as the in-memory “database” for employees and firm-wide restrictions. To run a compliance check:

```bash
curl -X POST http://localhost:3000/api/compliance/check \
  -H "Content-Type: application/json" \
  -d '{
    "firm_name": "Meridian",
    "employee_id": "EMP006",
    "query": "Can I buy Tesla stock tomorrow?"
  }'
```

**Expected Response (shape):**
```json
{
  "status": "SUCCESS",
  "firm_name": "Meridian",
  "employee_id": "EMP006",
  "parsed_query": {
    "ticker": "TSLA",
    "action": "buy",
    "trade_date": "2025-11-19"
  },
  "compliance": {
    "allowed": true,
    "reasons": [],
    "policy_refs": [],
    "rules_checked": [
      "Earnings Announcement Trading Blackout",
      "Analyst Pre-approval Requirement"
    ]
  }
}
```

> ⚠️ The exact `rules_checked` list depends on the rules currently stored in `rules/dynamic/`. The key point is that you provide a **natural-language query** plus an **employee ID**, and the API parses the ticker/action/date automatically using Anthropic structured outputs.

For additional manual tests, use the `test_scenarios` array inside `demo_data_simple.json`—each entry already contains an `employee_id`, `query`, and the expected outcome.

## Testing Script

A simple test script is available:

```bash
# Make sure the server is running first
bun run test.sh
```

Or manually test with the examples above.

## Architecture

- **API Layer** (`api/`): HTTP handlers for policy ingestion and compliance checks
- **Services** (`services/`): Core business logic (LLM generation, Daytona validation, rule execution)
- **Types** (`types/`): TypeScript interfaces for all data structures
- **Utils** (`utils/`): Python bridge for rule execution
- **Storage** (`rules/dynamic/`): JSON files storing validated rules per firm

## Troubleshooting

- **Missing API keys**: Ensure both `ANTHROPIC_API_KEY` and `DAYTONA_API_KEY` are set in `.env`
- **Python not found**: Set `PYTHON_BIN` to your Python executable path
- **Daytona sandbox errors / not visible**: Sandboxes are deleted immediately after validation. Set `DAYTONA_PRESERVE_SANDBOXES=true` to inspect them manually (remember to delete them later).
- **Rule validation failures**: Check server logs for detailed error messages from the iterative pipeline

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
