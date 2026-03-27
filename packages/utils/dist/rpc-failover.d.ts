/**
 * RPC endpoint failover for Akash Network.
 *
 * Tries each endpoint in order, returning the first one that responds
 * to a Cosmos node_info query. Consumers get back a { restUrl, rpcUrl } pair.
 */
/** Well-known public Akash RPC endpoints (order = priority). */
export declare const DEFAULT_RPC_ENDPOINTS: readonly string[];
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
    logger?: {
        info(msg: string): void;
        warning?(msg: string): void;
    };
}
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
export declare function resolveHealthyEndpoints(endpoints: string | string[], options?: FailoverOptions): Promise<ResolvedEndpoints>;
/**
 * Parse a newline/comma-separated string or string[] into a clean array.
 */
export declare function parseEndpoints(input: string | string[]): string[];
/**
 * Parse a newline/comma-separated list of akash1... provider addresses.
 */
export declare function parseProviders(input: string | string[]): string[];
//# sourceMappingURL=rpc-failover.d.ts.map