import { experimental_createMCPClient as createMCPClient, type ToolSet } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Connector } from "./types";
import { assertPublicUrl } from "./net";

type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);

function authHeaders(c: Connector): Record<string, string> {
  const token = c.token?.trim();
  if (!token) return {};
  const name = c.headerName?.trim() || "Authorization";
  const value = name.toLowerCase() === "authorization" && !/^(bearer|basic)\s/i.test(token) ? `Bearer ${token}` : token;
  return { [name]: value };
}

/** Connect via Streamable HTTP, falling back to legacy SSE. */
export async function connectMCP(c: Connector): Promise<MCPClient> {
  const url = assertPublicUrl(c.url);
  const headers = authHeaders(c);
  try {
    return await withTimeout(
      createMCPClient({ transport: new StreamableHTTPClientTransport(url, { requestInit: { headers } }) }),
      10_000, c.name
    );
  } catch (first) {
    try {
      return await withTimeout(
        createMCPClient({
          transport: new SSEClientTransport(url, {
            requestInit: { headers },
            eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } }) },
          }),
        }),
        10_000, c.name
      );
    } catch {
      throw first instanceof Error ? first : new Error(String(first));
    }
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "mcp";

export async function loadConnectorTools(list: Connector[]) {
  const enabled = list.filter((c) => c.enabled !== false && c.url).slice(0, 8);
  const clients: MCPClient[] = [];
  const tools: ToolSet = {};
  const errors: string[] = [];
  const names: string[] = [];

  await Promise.all(enabled.map(async (c) => {
    try {
      const client = await connectMCP(c);
      clients.push(client);
      const t = await withTimeout(client.tools(), 10_000, c.name);
      const prefix = slug(c.name);
      for (const [name, def] of Object.entries(t)) tools[`${prefix}__${name}`.slice(0, 64)] = def;
      names.push(c.name);
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }));

  let closed = false;
  const close = async () => { if (closed) return; closed = true; await Promise.allSettled(clients.map((c) => c.close())); };
  return { tools, errors, names, close };
}
