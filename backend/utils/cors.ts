/**
 * CORS utility for Bun server
 * Handles CORS headers and preflight requests
 */

export interface CorsOptions {
  origin?: string | string[] | ((origin: string | null) => string | null | boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

const defaultOptions: Required<CorsOptions> = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: [],
  credentials: false,
  maxAge: 86400, // 24 hours
};

/**
 * Resolves the origin value based on the configuration
 */
function resolveOrigin(
  requestOrigin: string | null,
  config: CorsOptions,
): string | null {
  const originConfig = config.origin ?? defaultOptions.origin;

  if (originConfig === "*") {
    return "*";
  }

  if (typeof originConfig === "function") {
    const result = originConfig(requestOrigin);
    if (typeof result === "boolean") {
      return result ? requestOrigin || "*" : null;
    }
    return result;
  }

  if (Array.isArray(originConfig)) {
    return requestOrigin && originConfig.includes(requestOrigin)
      ? requestOrigin
      : null;
  }

  return originConfig;
}

/**
 * Creates CORS headers for a response
 */
export function createCorsHeaders(
  request: Request,
  options: CorsOptions = {},
): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  const resolvedOrigin = resolveOrigin(origin, options);

  if (resolvedOrigin) {
    headers.set("Access-Control-Allow-Origin", resolvedOrigin);
  }

  const methods = options.methods ?? defaultOptions.methods;
  headers.set("Access-Control-Allow-Methods", methods.join(", "));

  const allowedHeaders =
    options.allowedHeaders ?? defaultOptions.allowedHeaders;
  headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));

  if (options.exposedHeaders && options.exposedHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", options.exposedHeaders.join(", "));
  }

  if (options.credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  const maxAge = options.maxAge ?? defaultOptions.maxAge;
  headers.set("Access-Control-Max-Age", maxAge.toString());

  return headers;
}

/**
 * Handles CORS preflight (OPTIONS) requests
 */
export function handleCorsPreflight(
  request: Request,
  options: CorsOptions = {},
): Response | null {
  if (request.method !== "OPTIONS") {
    return null;
  }

  const headers = createCorsHeaders(request, options);
  return new Response(null, { status: 204, headers });
}

/**
 * Adds CORS headers to an existing response
 */
export function addCorsHeaders(
  response: Response,
  request: Request,
  options: CorsOptions = {},
): Response {
  const corsHeaders = createCorsHeaders(request, options);

  // Copy CORS headers to the response
  corsHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });

  return response;
}

/**
 * Wraps a fetch handler with CORS support
 */
export function withCors(
  handler: (request: Request) => Response | Promise<Response>,
  options: CorsOptions = {},
): (request: Request) => Response | Promise<Response> {
  return async (request: Request) => {
    // Handle preflight requests
    const preflightResponse = handleCorsPreflight(request, options);
    if (preflightResponse) {
      return preflightResponse;
    }

    // Execute the handler
    const response = await handler(request);

    // Add CORS headers to the response
    return addCorsHeaders(response, request, options);
  };
}

