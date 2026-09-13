import * as core from "@actions/core";
import { generateToken, getLeaseStatus } from "@akashnetwork/actions-utils";
import type { createChainNodeWebSDK, LeasePermission } from "@akashnetwork/chain-sdk/web";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";

import type { ActionInputs, DeploymentContext } from "./inputs.js";

type ChainSDK = ReturnType<typeof createChainNodeWebSDK>;

export type Logger = Pick<typeof core, "info" | "warning" | "error">;

export interface CloseDeploymentResult {
  dseq: string;
  txHash?: string;
}

export async function closeDeployment(
  sdk: ChainSDK,
  wallet: DirectSecp256k1HdWallet,
  inputs: ActionInputs,
  options?: {
    logger?: Logger;
    getLeaseStatus?: typeof getLeaseStatus;
    generateToken?: typeof generateToken;
    getProviderHostUri?: typeof getProviderHostUri;
    assertExpectedOwner?: typeof assertExpectedOwner;
  }
): Promise<CloseDeploymentResult[]> {
  const di = {
    logger: options?.logger || core,
    getLeaseStatus: options?.getLeaseStatus || getLeaseStatus,
    generateToken: options?.generateToken || generateToken,
    getProviderHostUri: options?.getProviderHostUri || getProviderHostUri,
    assertExpectedOwner: options?.assertExpectedOwner || assertExpectedOwner,
  };

  const [account] = await wallet.getAccounts();
  di.assertExpectedOwner(inputs.expectedOwner, account.address);
  di.logger.info(`Using account: ${account.address}`);

  const deploymentFilters = {
    ...inputs.deploymentFilter,
    owner: account.address,
  };

  di.logger.info(`Fetching deployments with filters: ${JSON.stringify(deploymentFilters)}`);
  const deploymentsResult = await sdk.akash.deployment.v1beta4.getDeployments({
    filters: deploymentFilters
  });

  di.logger.info(`Found ${deploymentsResult.deployments.length} deployments matching filters`);
  const leases = await Promise.all(deploymentsResult.deployments.map(async (deployment) => {
    const deploymenLeases = await sdk.akash.market.v1beta5.getLeases({
      filters: {
        owner: account.address,
        dseq: deployment.deployment?.id?.dseq,
      }
    });
    const permissions: LeasePermission[] = [];
    deploymenLeases.leases.map(lease => {
      permissions.push({
        access: "scoped",
        provider: lease.lease?.id?.provider!,
        scope: ["status"]
      });
    });
    const token = await di.generateToken(wallet, () => ({
      access: "granular",
      permissions,
    }));

    return await Promise.all(deploymenLeases.leases.map(async (lease) => {
      return {
        dseq: lease?.lease?.id?.dseq?.toString() || "",
        state: lease.lease?.state as unknown as DeploymentContext["state"],
        status: await di.getLeaseStatus({
          dseq: deployment.deployment?.id?.dseq?.toString() || "",
          token,
          providerHostUri: await di.getProviderHostUri(sdk, lease.lease?.id?.provider),
        }),
        provider: lease.lease?.id?.provider || "",
        createdAt: lease.lease?.createdAt?.toString() || "",
        closedOn: lease.lease?.closedOn?.toString(),
        closedReason: lease.lease?.reason as DeploymentContext["closedReason"],
      } satisfies DeploymentContext;
    }));
  }));
  let allLeases = leases.flat();
  di.logger.info(`Total leases found for deployments: ${allLeases.length}`);

  if (inputs.leaseFilter) {
    allLeases = inputs.leaseFilter ? allLeases.filter(inputs.leaseFilter) : allLeases;
    di.logger.info(`Leases after applying lease filter: ${allLeases.length}`);
  }

  const txOptions = buildTxOptions(inputs, "Deployment closed via GitHub Action");
  const results: CloseDeploymentResult[] = [];
  for (const lease of allLeases) {
    di.logger.info(`Closing deployment ${lease.dseq} with lease status: ${lease.state}`);
    const deploymentId = {
      owner: account.address,
      dseq: lease.dseq,
    };

    await sdk.akash.deployment.v1beta4.closeDeployment({ id: deploymentId }, {
      ...txOptions,
      afterBroadcast(tx) {
        results.push({ dseq: lease.dseq, txHash: tx.transactionHash });
      },
    });
    di.logger.info(`Deployment ${lease.dseq} has been closed successfully!`);
  }

  return results;
}

/**
 * Bind a caller-supplied deployment subject to the account that will sign the
 * close transaction. This check deliberately runs before any chain query: a
 * rotated or misconfigured mnemonic must have no observable cleanup effect.
 */
export function assertExpectedOwner(expectedOwner: string | undefined, signerOwner: string): void {
  if (expectedOwner && expectedOwner !== signerOwner) {
    throw new Error(
      `Refusing to close deployment: expected owner ${expectedOwner} does not match signing account ${signerOwner}`
    );
  }
}

function buildTxOptions(inputs: ActionInputs, memo: string) {
  const txOptions: {
    memo: string;
    fee?: { amount: { denom: string; amount: string }[]; gas: string };
    gasAdjustment?: number;
  } = {
    memo,
  };

  if (inputs.gas !== "auto") {
    txOptions.fee = {
      amount: [{ denom: inputs.denom, amount: inputs.fee || "0" }],
      gas: inputs.gas,
    };
  } else {
    txOptions.gasAdjustment = parseFloat(inputs.gasMultiplier);
  }

  return txOptions;
}

const providerHostUriCache: Record<string, Promise<string>> = {};
function getProviderHostUri(sdk: ChainSDK, providerAddress?: string): Promise<string> {
  if (!providerAddress) {
    throw new Error("Provider address is missing in lease information");
  }

  providerHostUriCache[providerAddress] ??= sdk.akash.provider.v1beta4.getProvider({ owner: providerAddress })
    .then(res => res.provider?.hostUri!);
  return providerHostUriCache[providerAddress];
}
