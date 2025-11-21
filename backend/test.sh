#!/bin/bash

# Test script for Policy-as-Code Server
# Make sure the server is running before executing this script

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "🧪 Testing Policy-as-Code Server"
echo "================================="
echo ""

# Test 1: Policy Ingestion
echo "📝 Test 1: Policy Ingestion"
echo "---------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/policies/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "firm_name": "Meridian",
    "policy_text": "Employees cannot trade within 5 days of earnings announcements. Analysts must obtain pre-approval for trades in covered securities."
  }')

echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Wait a bit for processing
echo "⏳ Waiting 5 seconds for rule generation..."
sleep 5
echo ""

# Test 2: Natural-language Compliance Check
echo "✅ Test 2: Compliance Check (NL query + demo_data_simple.json)"
echo "---------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/compliance/check" \
  -H "Content-Type: application/json" \
  -d '{
    "firm_name": "Meridian",
    "employee_id": "EMP006",
    "query": "Can I buy Tesla stock tomorrow?"
  }')

echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Test 3: Compliance Violation (should be blocked)
echo "🚫 Test 3: Compliance Violation (Should Be Blocked)"
echo "---------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/compliance/check" \
  -H "Content-Type: application/json" \
  -d '{
    "firm_name": "Meridian",
    "employee_id": "EMP002",
    "query": "Can I buy Apple stock?"
  }')

echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Test 4: Invalid Request (missing query)
echo "❌ Test 4: Invalid Request (Missing Query)"
echo "---------------------------------------------"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/compliance/check" \
  -H "Content-Type: application/json" \
  -d '{
    "firm_name": "Meridian",
    "employee_id": "EMP006"
  }')

echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

echo "✅ Tests completed!"
echo ""
echo "💡 Tip: Install 'jq' for prettier JSON output: brew install jq"

