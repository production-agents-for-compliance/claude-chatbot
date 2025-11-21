import { POST as complianceCheck } from "./api/compliance-check.ts";
import { POST as policyIngest } from "./api/policy-ingest.ts";
import { withCors, handleCorsPreflight, addCorsHeaders } from "./utils/cors.ts";
import os from "os";

const requiredEnvVars = ["ANTHROPIC_API_KEY", "DAYTONA_API_KEY"] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// CORS configuration
const corsOptions = {
  origin: "*", // Allow all origins (change to specific origin(s) in production)
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
};

const server = Bun.serve({
  hostname: "0.0.0.0", // Listen on all network interfaces
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/health": {
      GET: withCors(() => {
        return Response.json({ status: "ok", timestamp: new Date().toISOString() });
      }, corsOptions),
    },
    "/api/policies/ingest": {
      POST: withCors(policyIngest, corsOptions),
    },
    "/api/compliance/check": {
      POST: withCors(complianceCheck, corsOptions),
    },
  },
  fetch(request) {
    // Handle CORS preflight for unmatched routes
    const preflightResponse = handleCorsPreflight(request, corsOptions);
    if (preflightResponse) {
      return preflightResponse;
    }

    // Add CORS headers to 404 response
    const notFoundResponse = new Response("Not Found", { status: 404 });
    return addCorsHeaders(notFoundResponse, request, corsOptions);
  },
  error(error) {
    console.error("Unhandled server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
});

// Get network IP addresses
function getNetworkIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal (loopback) and non-IPv4 addresses
      // Handle both string ("IPv4") and number (4) family values
      const family = iface.family as string | number;
      const isIPv4 = family === "IPv4" || family === 4;
      if (isIPv4 && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  
  return ips;
}

const networkIPs = getNetworkIPs();
const port = server.port;

console.log(`\n${"=".repeat(70)}`);
console.log(`🚀 Bun server listening on http://localhost:${port}`);
console.log(`${"=".repeat(70)}`);
if (networkIPs.length > 0) {
  console.log(`📡 Network Access URLs:`);
  networkIPs.forEach((ip) => {
    console.log(`   http://${ip}:${port}`);
  });
  console.log(`${"=".repeat(70)}`);
  console.log(`✅ Server is accessible from your network!`);
  console.log(`   Share this URL with teammates: http://${networkIPs[0]}:${port}`);
} else {
  console.log(`⚠️  Could not detect network IP addresses`);
  console.log(`   Find your IP with: ifconfig | grep "inet " | grep -v 127.0.0.1`);
}
console.log(`${"=".repeat(70)}\n`);