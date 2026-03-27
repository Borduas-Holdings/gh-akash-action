import * as core from "@actions/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { guard as createFilter } from "@ucast/mongo2js";
import type { Bid } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import { load as parseYaml } from "js-yaml";
import { DEFAULT_RPC_ENDPOINTS, parseEndpoints, parseProviders, resolveHealthyEndpoints, type ResolvedEndpoints } from "@akashnetwork/actions-utils";

export interface ActionInputs {
  mnemonic: string;
  selectBid: (bids: JsonResponse<Bid>[]) => JsonResponse<Bid> | undefined;
  sdl: string;
  gas: string;
  gasMultiplier: string;
  fee: string;
  denom: string;
  deposit: string;
  queryRestUrl: string;
  txRpcUrl: string;
  leaseTimeout: number;
  deploymentDetailsPath?: string;
}

type SelectBidStrategy = "cheapest" | "first";

/**
 * Resolve RPC endpoints. If the legacy `rest-url` / `tx-rpc-url` inputs are
 * explicitly set, use those directly (backward compat). Otherwise, run failover
 * against the `rpc-endpoints` list (or built-in defaults).
 */
async function resolveRpc(): Promise<ResolvedEndpoints> {
  const legacyRest = core.getInput("rest-url");
  const legacyRpc = core.getInput("tx-rpc-url");

  // Legacy override — skip failover entirely
  if (legacyRest || legacyRpc) {
    core.info("Using explicit rest-url / tx-rpc-url (failover skipped)");
    return {
      restUrl: legacyRest || "https://rpc.akt.dev/rest",
      rpcUrl: legacyRpc || "https://rpc.akt.dev/rpc",
    };
  }

  const endpointsInput = core.getInput("rpc-endpoints");
  const endpoints = endpointsInput
    ? parseEndpoints(endpointsInput)
    : [...DEFAULT_RPC_ENDPOINTS];

  return resolveHealthyEndpoints(endpoints, { logger: core });
}

/**
 * Build the bid selector, merging `trusted-providers` with `bid-filter`.
 *
 * If `trusted-providers` is set, it generates a `{ "id.provider": { "$in": [...] } }`
 * filter. If `bid-filter` is also set, both filters must match (AND logic).
 */
function buildBidSelector(pickBidStrategy: SelectBidStrategy): ActionInputs['selectBid'] {
  const bidConditions = core.getInput("bid-filter");
  const trustedProvidersInput = core.getInput("trusted-providers");

  const filters: ((bid: JsonResponse<Bid>) => boolean)[] = [];

  // User-supplied bid-filter (ucast/mongo2js syntax)
  if (bidConditions) {
    filters.push(createFilter<JsonResponse<Bid>>(parseYaml(bidConditions) as any));
  }

  // trusted-providers → restrict to these wallet addresses
  if (trustedProvidersInput) {
    const providers = parseProviders(trustedProvidersInput);
    if (providers.length > 0) {
      core.info(`Restricting bids to ${providers.length} trusted provider(s): ${providers.join(", ")}`);
      const providerSet = new Set(providers);
      filters.push((bid) => providerSet.has(bid.id?.provider as string ?? ""));
    }
  }

  return (bids: JsonResponse<Bid>[]) => {
    let filteredBids = bids;
    for (const fn of filters) {
      filteredBids = filteredBids.filter(fn);
    }

    switch (pickBidStrategy) {
      case "first":
        return filteredBids[0];

      case "cheapest":
      default:
        return filteredBids.sort((a, b) => {
          const diff = parseFloat(a.price!.amount!) - parseFloat(b.price!.amount!);
          if (diff === 0) return 0;
          return diff > 0 ? 1 : -1;
        })[0];
    }
  };
}

export async function getInputs(): Promise<ActionInputs> {
  const sdlInput = core.getInput("sdl", { required: true });
  const sdl = resolveSdl(sdlInput);
  const pickBidStrategy = core.getInput("pick-bid-strategy") as SelectBidStrategy || "cheapest";

  const rpc = await resolveRpc();

  return {
    mnemonic: core.getInput("mnemonic", { required: true }),
    selectBid: buildBidSelector(pickBidStrategy),
    sdl,
    gas: core.getInput("gas") || "auto",
    gasMultiplier: core.getInput("gas-multiplier") || "1.5",
    fee: core.getInput("fee") || "",
    denom: core.getInput("denom") || "uakt",
    deposit: core.getInput("deposit") || "500000",
    queryRestUrl: rpc.restUrl,
    txRpcUrl: rpc.rpcUrl,
    leaseTimeout: parseInt(core.getInput("lease-timeout") || "180", 10),
    deploymentDetailsPath: core.getInput("deployment-details-path") || undefined,
  };
}

function resolveSdl(sdlInput: string): string {
  const trimmed = sdlInput.trim();

  if (
    trimmed.startsWith("./") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("../") ||
    (trimmed.endsWith(".yaml") || trimmed.endsWith(".yml")) && !trimmed.includes("\n")
  ) {
    const resolvedPath = path.resolve(process.cwd(), trimmed);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`SDL file not found: ${resolvedPath}`);
    }

    core.info(`Loading SDL from file: ${resolvedPath}`);
    return fs.readFileSync(resolvedPath, "utf-8");
  }

  core.info("Using inline SDL string");
  return trimmed;
}

export type JsonResponse<T> = {
  [K in keyof T]: T[K] extends import('long') | Uint8Array | Buffer | ArrayBuffer
    ? string
    : Exclude<T[K], undefined> extends any[]
      ? JsonResponse<Exclude<T[K], undefined>[number]>[]
      : Exclude<T[K], undefined> extends Record<string, any>
        ? JsonResponse<Exclude<T[K], undefined>>
        : T[K];
};
