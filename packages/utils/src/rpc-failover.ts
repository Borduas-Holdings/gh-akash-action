/**
 * RPC endpoint failover for Akash Network.
 *
 * Tries each endpoint in order, returning the first one that responds
 * to a Cosmos node_info query. Consumers get back a { restUrl, rpcUrl } pair.
 */

/** Well-known public Akash RPC endpoints (order = priority). */
export const DEFAULT_RPC_ENDPOINTS: readonly string[] = [
  "https://rpc.akt.dev",
  "https://akash-rpc.polkachu.com",
  "https://rpc.akash.bronbro.io",
  "https://akash-rpc.publicnode.com",
  "https://rpc-akash.ecostake.com",
  "https://rpc.akashnet.net",
];

export interface ResolvedEndpoints {
  /** REST API URL (e.g. https://rpc.akt.dev/rest) */
  restUrl: string;
  /** Tendermint RPC URL (e.g. https://rpc.akt.dev:443/rpc) */
  rpcUrl: string;
}

export interface FailoverOptions {
  /** Per-endpoint health-check timeout in ms. Default: 10000 */
  timeout?: number;
  /** Custom fetch implementation (for testing). */
  fetch?: typeof globalThis.fetch;
  /** Logger — defaults to console. */
  logger?: { info(msg: string): void; warning?(msg: string): void };
}

const NODE_INFO_PATH = "/cosmos/base/tendermint/v1beta1/node_info";

/**
 * Resolves a healthy REST + RPC pair from a list of base endpoint URLs.
 *
 * For each endpoint it tries:
 *   1. `${base}/rest${NODE_INFO_PATH}` (the /rest suffix convention)
 *   2. `${base}${NODE_INFO_PATH}` (nodes that serve REST at the root)
 *
 * @param endpoints — newline-separated string or array of base URLs.
 * @param options — timeout, fetch override, logger.
 * @returns The first healthy endpoint pair.
 * @throws If no endpoint is reachable.
 */
export async function resolveHealthyEndpoints(
  endpoints: string | string[],
  options: FailoverOptions = {},
): Promise<ResolvedEndpoints> {
  const list = parseEndpoints(endpoints);
  const timeoutMs = options.timeout ?? 10_000;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const logger = options.logger ?? console;

  for (const base of list) {
    const trimmed = base.replace(/\/+$/, "");

    // Strategy 1: /rest suffix
    const restWithSuffix = `${trimmed}/rest`;
    if (await isHealthy(restWithSuffix, timeoutMs, fetchFn, logger)) {
      const rpcUrl = deriveRpcUrl(trimmed);
      logger.info(`RPC failover: using ${trimmed} (REST at ${restWithSuffix})`);
      return { restUrl: restWithSuffix, rpcUrl };
    }

    // Strategy 2: REST at root
    if (await isHealthy(trimmed, timeoutMs, fetchFn, logger)) {
      const rpcUrl = deriveRpcUrl(trimmed);
      logger.info(`RPC failover: using ${trimmed} (REST at root)`);
      return { restUrl: trimmed, rpcUrl };
    }

    logger.info(`RPC failover: ${trimmed} — unreachable`);
  }

  throw new Error(
    `All Akash RPC endpoints unreachable. Tried: ${list.join(", ")}`,
  );
}

/**
 * Parse a newline/comma-separated string or string[] into a clean array.
 */
export function parseEndpoints(input: string | string[]): string[] {
  if (Array.isArray(input)) return input.map(s => s.trim()).filter(Boolean);
  return input
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Parse a newline/comma-separated list of akash1... provider addresses.
 */
export function parseProviders(input: string | string[]): string[] {
  const list = Array.isArray(input) ? input : input.split(/[\n,]+/);
  return list.map(s => s.trim()).filter(s => s.startsWith("akash1"));
}

async function isHealthy(
  restBase: string,
  timeoutMs: number,
  fetchFn: typeof globalThis.fetch,
  logger?: { info(msg: string): void },
): Promise<boolean> {
  const url = `${restBase}${NODE_INFO_PATH}`;
  try {
    const res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.info(`  health-check failed: ${url} — ${msg}`);
    // If fetch fails (e.g. undici TLS issue), try Node.js https as fallback
    try {
      return await httpsProbe(url, timeoutMs);
    } catch {
      return false;
    }
  }
}

/**
 * Fallback health probe using Node.js built-in https module.
 * Some environments (GitHub Actions Node 24) have undici issues with
 * certain TLS configurations that the built-in https module handles fine.
 */
function httpsProbe(url: string, timeoutMs: number): Promise<boolean> {
  const https = require("node:https");
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res: any) => {
      res.resume(); // drain the response
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/**
 * Derive the Tendermint RPC URL from a base URL.
 * Convention: append :443/rpc (most Akash RPCs expose this).
 */
function deriveRpcUrl(base: string): string {
  const url = new URL(base);
  // If port is already explicit, just append /rpc
  if (url.port) {
    return `${base}/rpc`;
  }
  // Default: add :443/rpc for HTTPS
  if (url.protocol === "https:") {
    return `${url.origin.replace(/:443$/, "")}:443/rpc`;
  }
  return `${base}/rpc`;
}
