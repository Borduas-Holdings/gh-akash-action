import * as core from "@actions/core";
import { type DeploymentID, Source } from "@akashnetwork/chain-sdk/private-types/akash.v1";
import type { MsgCreateDeployment, MsgUpdateDeployment, QueryProviderResponse } from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import { Bid, MsgCreateLease, QueryBidsResponse } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import {
  createChainNodeWebSDK,
  type QueryInput,
  generateManifest,
  generateManifestVersion,
  yaml,
  type TxInput,
  manifestToSortedJSON,
} from "@akashnetwork/chain-sdk/web";
import { generateToken, getLeaseStatus, sendManifest } from "@akashnetwork/actions-utils";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import path from "node:path";
import fs from "node:fs";
import type { ActionInputs, JsonResponse } from "./inputs.js";

type ChainSDK = ReturnType<typeof createChainNodeWebSDK>;

/**
 * using globalThis.setTimeout to have possibility to mock it in tests
 */
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export type Logger = Pick<typeof core, "info" | "warning" | "error">;

export interface StoredDeploymentDetails {
  dseq: string;
  lease: {
    id: {
      owner: string;
      dseq: string;
      gseq: number;
      oseq: number;
      provider: string;
    };
  };
}

export interface DeploymentResult {
  deploymentId: {
    owner: string;
    dseq: string;
  };
  isNew: boolean;
  lease?: {
    id: {
      owner: string;
      dseq: string;
      gseq: number;
      oseq: number;
      provider: string;
    };
    state: string;
    price: {
      amount: string;
      denom: string;
    };
  };
}

export async function createDeployment(sdk: ChainSDK, wallet: DirectSecp256k1HdWallet, inputs: ActionInputs, options?: {
  fetch?: typeof globalThis.fetch,
  logger?: Logger,
  generateToken?: typeof generateToken,
}): Promise<DeploymentResult> {
  const logger = options?.logger || core;
  const tokenGenerator = options?.generateToken || generateToken;
  logger.info("Parsing SDL...");
  const manifest = parseSDL(inputs.sdl, logger);

  const latestBlockResponse = await sdk.cosmos.base.tendermint.v1beta1.getLatestBlock();
  const dseq = latestBlockResponse.block?.header?.height!;

  logger.info(`Creating deployment with dseq: ${dseq}`);

  const [account] = await wallet.getAccounts();
  logger.info(`Using account: ${account.address}`);

  const deploymentMessage: TxInput<MsgCreateDeployment> = {
    id: {
      owner: account.address,
      dseq,
    },
    groups: manifest.groupSpecs,
    hash: await generateManifestVersion(manifest.groups),
    deposit: {
      amount: {
        denom: inputs.denom,
        amount: inputs.deposit,
      },
      sources: [Source.balance],
    },
  };

  const txOptions = buildTxOptions(inputs, "Deployment created via GitHub Action");

  await sdk.akash.deployment.v1beta4.createDeployment(deploymentMessage, txOptions);
  logger.info("✅ Deployment created successfully!");

  const deploymentId: TxInput<DeploymentID> = {
    owner: account.address,
    dseq: deploymentMessage.id!.dseq,
  };

  const result: DeploymentResult = {
    deploymentId: {
      owner: deploymentId.owner,
      dseq: dseq.toString(),
    },
    isNew: true,
  };

  try {
    logger.info("Waiting for providers to create bids...");
    const selectedBid = await waitForBid(sdk, deploymentId, inputs.leaseTimeout, inputs.selectBid, logger);

    logger.info(
      `✅ Selected bid: Provider ${selectedBid?.id?.provider}, Price: ${selectedBid?.price?.amount}${selectedBid?.price?.denom}`
    );

    logger.info("Creating lease from selected bid...");
    const leaseMessage = MsgCreateLease.fromPartial({
      bidId: selectedBid?.id,
    });

    const leaseTxOptions = buildTxOptions(inputs, "Lease created via GitHub Action");
    await sdk.akash.market.v1beta5.createLease(leaseMessage, leaseTxOptions);
    logger.info("✅ Lease created successfully!");

    logger.info("Verifying lease creation...");
    const leaseQuery = await sdk.akash.market.v1beta5.getLeases({
      filters: {
        owner: deploymentId.owner,
        dseq: deploymentId.dseq,
        gseq: 1,
        oseq: 1,
        provider: selectedBid?.id.provider!,
        state: "active",
        bseq: 0,
      },
    });

    const createdLease = leaseQuery!.leases![0]!.lease!;
    result.lease = createdLease as unknown as DeploymentResult['lease'];
    logger.info(`✅ Lease verified: ${createdLease.id?.owner}/${createdLease.id?.dseq}/${createdLease.id?.gseq}/${createdLease.id?.oseq}/${createdLease.id?.provider}`);

    logger.info(`Prepare manifest submission (provider: ${createdLease.id?.provider})...`);
    const serviceNames = manifest.groups.map(g => g.services.map(s => s.name)).flat();
    const token = await tokenGenerator(wallet, () => ({
      access: "granular",
      permissions: [
        {
          access: "granular",
          provider: createdLease.id?.provider!,
          deployments: [
            {
              dseq: Number(createdLease.id?.dseq!),
              services: serviceNames,
              scope: ["send-manifest", "status"]
            }
          ]
        }
      ]
    }));
    const provider = await sdk.akash.provider.v1beta4.getProvider({ owner: createdLease.id?.provider }) as unknown as JsonResponse<QueryProviderResponse>;
    logger.info(`Submitting manifest to provider: ${provider.provider.hostUri}`);
    await sendManifest({
      manifest: manifestToSortedJSON(manifest.groups),
      token,
      providerHostUri: provider.provider.hostUri,
      dseq: selectedBid?.id?.dseq!.toString(),
      fetch: options?.fetch,
    });
    logger.info("✅ Manifest submitted successfully!");

    logger.info(`Getting lease status...`);
    const leaseStatus = await getLeaseStatus({
      token,
      providerHostUri: provider.provider.hostUri,
      dseq: selectedBid?.id?.dseq!.toString(),
      fetch: options?.fetch,
    });

    const services = Object.keys(leaseStatus.services).map(name => {
      const uris = leaseStatus.services[name]?.uris;
      return `${name}: ${uris?.length ? uris.join("\n") : "(no public URIs)"}`;
    });

    logger.info(`🚀 Deployment is ready`);
    logger.info(services.join("\n"));
  } catch (error) {
    logger.error(`Deployment failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logger.error(`Stack: ${error.stack}`);
    }

    // Do NOT auto-close deployment on error — the deployment may be functional
    // even if the status check failed (e.g. URIs not yet assigned for multi-service SDLs).
    // The caller is responsible for cleanup via the close-deployment action.
    logger.warning("Deployment was NOT auto-closed. Use close-deployment action to clean up if needed.");

    throw error;
  }

  return result;
}

export async function updateDeploymentManifest(
  sdk: ChainSDK,
  wallet: DirectSecp256k1HdWallet,
  inputs: ActionInputs,
  existingDeployment: StoredDeploymentDetails,
  options?: {
    fetch?: typeof globalThis.fetch;
    logger?: Logger;
    generateToken?: typeof generateToken;
  }
): Promise<DeploymentResult> {
  const logger = options?.logger || core;
  const tokenGenerator = options?.generateToken || generateToken;

  logger.info("Parsing SDL...");
  const manifest = parseSDL(inputs.sdl, logger);

  const { lease } = existingDeployment;
  const deploymentId = { owner: lease.id.owner, dseq: existingDeployment.dseq };

  logger.info(`Updating deployment on-chain (dseq: ${existingDeployment.dseq})...`);
  const updateMessage: TxInput<MsgUpdateDeployment> = {
    id: deploymentId,
    hash: await generateManifestVersion(manifest.groups),
  };
  await sdk.akash.deployment.v1beta4.updateDeployment(updateMessage, buildTxOptions(inputs, "Deployment updated via GitHub Action"));
  logger.info("✅ Deployment updated on-chain successfully!");

  const token = await tokenGenerator(wallet, () => ({
    access: "granular",
    permissions: [
      {
        access: "granular",
        provider: lease.id?.provider!,
        deployments: [
          {
            dseq: Number(lease.id?.dseq!),
            services: manifest.groups.map(g => g.services.map(s => s.name)).flat(),
            scope: ["send-manifest", "status"]
          }
        ]
      }
    ]
  }));
  const provider = await sdk.akash.provider.v1beta4.getProvider({ owner: lease.id.provider }) as unknown as JsonResponse<QueryProviderResponse>;

  logger.info(`Submitting updated manifest to provider: ${provider.provider.hostUri}`);
  await sendManifest({
    manifest: manifestToSortedJSON(manifest.groups),
    token,
    providerHostUri: provider.provider.hostUri,
    dseq: existingDeployment.dseq,
    fetch: options?.fetch,
  });
  logger.info("✅ Manifest updated successfully!");

  logger.info("Getting lease status...");
  const leaseStatus = await getLeaseStatus({
    token,
    providerHostUri: provider.provider.hostUri,
    dseq: existingDeployment.dseq,
    fetch: options?.fetch,
  });

  const services = Object.keys(leaseStatus.services).map(name => {
    const uris = leaseStatus.services[name]?.uris;
    return `${name}: ${uris?.length ? uris.join("\n") : "(no public URIs)"}`;
  });
  logger.info("🚀 Deployment is ready");
  logger.info(services.join("\n"));

  return {
    deploymentId,
    isNew: false,
    lease: lease as DeploymentResult["lease"],
  };
}

export async function waitForBid(
  sdk: ChainSDK,
  deploymentId: QueryInput<DeploymentID>,
  timeoutSeconds: number,
  findMatchingBid: ActionInputs['selectBid'],
  logger: Logger
): Promise<JsonResponse<Bid>> {
  const maxAttempts = Math.ceil(timeoutSeconds / 10);
  let attempts = 0;

  logger.info(`Deployment ID: ${deploymentId.owner}/${deploymentId.dseq}`);
  logger.info(`Will wait up to ${timeoutSeconds} seconds for bids...`);

  while (attempts < maxAttempts) {
    await wait(10_000);
    attempts++;

    logger.info(`Checking for bids (attempt ${attempts}/${maxAttempts})...`);

    const bidsResponse = await sdk.akash.market.v1beta5.getBids({
      filters: {
        owner: deploymentId.owner,
        dseq: deploymentId.dseq,
        gseq: 1,
        oseq: 1,
      },
      pagination: {
        limit: 1000,
      }
    }) as unknown as JsonResponse<QueryBidsResponse>

    const bidCount = bidsResponse?.bids?.length || 0;
    logger.info(`Found ${bidCount} bids`);
    if (bidCount === 0) {
      logger.info("No bids found, waiting for next attempt...");
      continue;
    }

    bidsResponse?.bids?.forEach((bidResponse, index) => {
      const bid = bidResponse.bid;
      logger.info(
        `  - Provider ${bid?.id?.provider}, Price: ${bid?.price?.amount}${bid?.price?.denom}`
      );
    });

    logger.info("Filtering bids by filter criteria...");
    const foundBid = findMatchingBid(bidsResponse?.bids!.map(bid => bid.bid!));

    if (!foundBid) {
      throw new Error("No bid found that matches the filter criteria.");
    }

    return foundBid;
  }

  throw new Error(`No bid found that matches the filter criteria after ${attempts} attempts.`);
}

function buildTxOptions(
  inputs: ActionInputs,
  memo: string
): { memo: string; fee?: { amount: { denom: string; amount: string }[]; gas: string }; gasAdjustment?: number } {
  const options: {
    memo: string;
    fee?: { amount: { denom: string; amount: string }[]; gas: string };
    gasAdjustment?: number;
  } = {
    memo,
  };

  if (inputs.gas !== "auto" && inputs.fee) {
    options.fee = {
      amount: [
        {
          denom: inputs.denom,
          amount: inputs.fee,
        },
      ],
      gas: inputs.gas,
    };
  } else {
    // When using auto gas, apply the multiplier
    options.gasAdjustment = parseFloat(inputs.gasMultiplier);
  }

  return options;
}

function parseSDL(sdlInput: string, logger: Logger) {
  const manifest = generateManifest(yaml.template(sdlInput));

  if (!manifest.ok) {
    logger.error('SDL parsing error: ');
    manifest.value.forEach(error => logger.error(error.message));
    throw new Error(`Failed to parse SDL`);
  }
  return manifest.value;
}

export function getExistingDeploymentDetails(deploymentDetailsPath: string | undefined | null): StoredDeploymentDetails | null {
  if (!deploymentDetailsPath) return null;

  const filePath = path.resolve(process.cwd(), deploymentDetailsPath);
  if (!fs.existsSync(filePath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    throw new Error(`Failed to parse deployment details from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return validateStoredDeploymentDetails(parsed);
  } catch (error) {
    throw new Error(`Invalid deployment details in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateStoredDeploymentDetails(data: unknown): StoredDeploymentDetails {
  if (typeof data !== "object" || data === null) {
    throw new Error("must be an object");
  }

  const d = data as Record<string, unknown>;

  if (typeof d.dseq !== "string" || !d.dseq) {
    throw new Error("'dseq' must be a non-empty string");
  }

  if (typeof d.lease !== "object" || d.lease === null) {
    throw new Error("'lease' must be an object");
  }

  const lease = d.lease as Record<string, unknown>;

  if (typeof lease.id !== "object" || lease.id === null) {
    throw new Error("'lease.id' must be an object");
  }

  const id = lease.id as Record<string, unknown>;

  if (typeof id.owner !== "string" || !id.owner) {
    throw new Error("'lease.id.owner' must be a non-empty string");
  }
  if (typeof id.dseq !== "string" || !id.dseq) {
    throw new Error("'lease.id.dseq' must be a non-empty string");
  }
  if (typeof id.gseq !== "number") {
    throw new Error("'lease.id.gseq' must be a number");
  }
  if (typeof id.oseq !== "number") {
    throw new Error("'lease.id.oseq' must be a number");
  }
  if (typeof id.provider !== "string" || !id.provider) {
    throw new Error("'lease.id.provider' must be a non-empty string");
  }

  return data as StoredDeploymentDetails;
}
