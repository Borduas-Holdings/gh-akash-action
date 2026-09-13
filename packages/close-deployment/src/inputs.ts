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
  expectedOwner?: string;
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

export async function resolveInputEndpoints(inputs: ActionInputs): Promise<ActionInputs> {
  const rpc = await resolveRpc();
  return {
    ...inputs,
    queryRestUrl: rpc.restUrl,
    txRpcUrl: rpc.rpcUrl,
  };
}

export async function getInputs(options: { resolveEndpoints?: boolean } = {}): Promise<ActionInputs> {
  const mnemonic = core.getInput("mnemonic", { required: true });
  const expectedOwner = core.getInput("expected-owner") || undefined;
  const gas = core.getInput("gas") || "auto";
  const gasMultiplier = core.getInput("gas-multiplier") || "1.5";
  const fee = core.getInput("fee") || "";
  const denom = core.getInput("denom") || "uakt";
  const { deploymentFilter, leaseFilter } = parseFilter(core.getInput("filter", { required: true }));

  const inputs: ActionInputs = {
    mnemonic,
    expectedOwner,
    gas,
    gasMultiplier,
    fee,
    denom,
    queryRestUrl: "",
    txRpcUrl: "",
    deploymentFilter,
    leaseFilter
  };

  return options.resolveEndpoints === false ? inputs : resolveInputEndpoints(inputs);
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
  if ("owner" in filter) {
    throw new Error(`"owner" must be passed through the "expected-owner" input, not the filter`);
  }
  if (filter.dseq !== undefined) {
    if (typeof filter.dseq !== "string") {
      throw new Error(`"dseq" filter must be a quoted canonical decimal string`);
    }
    if (!/^[1-9][0-9]*$/.test(filter.dseq)) {
      throw new Error(`"dseq" filter must be a positive canonical decimal`);
    }
    if (BigInt(filter.dseq) > 18_446_744_073_709_551_615n) {
      throw new Error(`"dseq" filter exceeds uint64`);
    }
  }

  if (filter.lease && typeof filter.lease !== "object") {
    throw new Error(`"lease" filter must be an object if provided`);
  }

  return filter;
}
