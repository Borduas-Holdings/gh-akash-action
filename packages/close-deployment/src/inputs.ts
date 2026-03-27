import * as core from "@actions/core";
import { load as parseYaml } from "js-yaml";
import { guard } from "@ucast/mongo2js";
import type { LeaseStatus } from "@akashnetwork/actions-utils";
import { DEFAULT_RPC_ENDPOINTS, parseEndpoints, resolveHealthyEndpoints, type ResolvedEndpoints } from "@akashnetwork/actions-utils";

export interface DeploymentContext {
  dseq: string;
  state: 'invalid' | "active" | "insufficient_funds" | "closed";
  status: LeaseStatus;
  provider: string;
  createdAt: string;
  closedOn?: string;
  closedReason?: 'lease_closed_invalid' | "lease_closed_owner" | "lease_closed_unstable" | "lease_closed_decommission" | "lease_closed_unspecified" | "lease_closed_manifest_timeout" | "lease_closed_insufficient_funds";
}

export interface ActionInputs {
  mnemonic: string;
  deploymentFilter: {
    dseq?: string;
    state?: string;
  };
  leaseFilter?: (lease: DeploymentContext) => boolean;
  gas: string;
  gasMultiplier: string;
  fee: string;
  denom: string;
  queryRestUrl: string;
  txRpcUrl: string;
}

/**
 * Resolve RPC endpoints. If the legacy `rest-url` / `tx-rpc-url` inputs are
 * explicitly set, use those directly (backward compat). Otherwise, run failover
 * against the `rpc-endpoints` list (or built-in defaults).
 */
async function resolveRpc(): Promise<ResolvedEndpoints> {
  const legacyRest = core.getInput("rest-url");
  const legacyRpc = core.getInput("tx-rpc-url");

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

export async function getInputs(): Promise<ActionInputs> {
  const mnemonic = core.getInput("mnemonic", { required: true });
  const gas = core.getInput("gas") || "auto";
  const gasMultiplier = core.getInput("gas-multiplier") || "1.5";
  const fee = core.getInput("fee") || "";
  const denom = core.getInput("denom") || "uakt";
  const { deploymentFilter, leaseFilter } = parseFilter(core.getInput("filter", { required: true }));

  const rpc = await resolveRpc();

  return {
    mnemonic,
    gas,
    gasMultiplier,
    fee,
    denom,
    queryRestUrl: rpc.restUrl,
    txRpcUrl: rpc.rpcUrl,
    deploymentFilter,
    leaseFilter
  };
}

function parseFilter(filter: string) {
  if (filter === 'all') return { deploymentFilter: {} };

  try {
    const { lease: leaseFilter, dseq } = varlidateFilter(parseYaml(filter));

    if (!leaseFilter && !dseq) {
      throw new Error("At least one of dseq, state, or lease filter must be provided");
    }

    return {
      deploymentFilter: { dseq, state: "active" },
      leaseFilter: leaseFilter ? guard<DeploymentContext>(leaseFilter) : undefined
    };
  } catch (error) {
    core.setFailed(`Failed to parse filter input: ${error}`);
    throw error;
  }
}

function varlidateFilter(rawFilter: unknown): { lease?: Record<string, unknown>; dseq?: string } {
  if (!rawFilter || typeof rawFilter !== "object") {
    throw new Error(`"filter" input must be an object`);
  }

  const filter = rawFilter as Record<string, unknown>;
  if (filter.dseq !== undefined && typeof filter.dseq !== "string" && typeof filter.dseq !== "number") {
    throw new Error(`"dseq" filter must be a string or number if provided`);
  }

  if (filter.lease && typeof filter.lease !== "object") {
    throw new Error(`"lease" filter must be an object if provided`);
  }

  return filter;
}
