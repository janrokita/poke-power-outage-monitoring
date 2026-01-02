import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getOutageStatus } from "./lib/pge-api";

const PORT = parseInt(process.env.PORT || "8080", 10);
const LOCATION = process.env.POWER_OUTAGE_LOCATION;

if (!LOCATION) {
  throw new Error("POWER_OUTAGE_LOCATION environment variable is required");
}

// Create MCP server
const server = new McpServer({
  name: "power-outage-mcp",
  version: "1.0.0",
});

// Register the get_power_outages tool
server.tool(
  "get_power_outages",
  `Get current power outage status for location: ${LOCATION}. Returns outage information including start/stop times, duration, and affected addresses.`,
  {},
  async () => {
    try {
      const status = await getOutageStatus(LOCATION);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching power outage status: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Session management for WebStandardStreamableHTTPServerTransport
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

// Start HTTP server using Bun.serve
Bun.serve({
  port: PORT,
  idleTimeout: 10,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // Only handle /mcp endpoint
    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
        },
      });
    }

    const sessionId = req.headers.get("mcp-session-id");

    // Check for existing session
    let transport = sessionId ? sessions.get(sessionId) : undefined;

    if (!transport) {
      // Create new transport for this request
      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport!);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
        },
      });

      // Connect server to transport
      await server.connect(transport);
    }

    // Let the transport handle the request (POST, GET for SSE, DELETE)
    const response = await transport.handleRequest(req);

    // Add CORS headers
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
});

console.log(`MCP Server listening on http://localhost:${PORT}/mcp`);
console.log(`Monitoring location: ${LOCATION}`);
