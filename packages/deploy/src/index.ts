import * as core from "@actions/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { createDeployment, type DeploymentResult, getExistingDeploymentDetails, updateDeploymentManifest, type StoredDeploymentDetails } from "./deployment.ts";
import { getInputs } from "./inputs.ts";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { createChainNodeWebSDK } from "@akashnetwork/chain-sdk/web";
import { createStargateClient } from "@akashnetwork/chain-sdk";

async function run(): Promise<void> {
  try {
    core.info("Starting Akash deployment action...");

    const inputs = await getInputs();

    core.info("Initializing wallet...");
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(inputs.mnemonic, {
      prefix: "akash",
    });

    core.info("Initializing Akash Chain SDK...");
    const sdk = createChainNodeWebSDK({
      query: {
        baseUrl: inputs.queryRestUrl,
      },
      tx: {
        signer: createStargateClient({
          baseUrl: inputs.txRpcUrl,
          signer: wallet,
          gasMultiplier: parseFloat(inputs.gasMultiplier),
        }),
      },
    });

    let result: DeploymentResult;
    let prevDseq: string | undefined;
    const existingDeploymentDetails = getExistingDeploymentDetails(inputs.deploymentDetailsPath);

    if (existingDeploymentDetails) {
      core.info(`Reading deployment details from: ${inputs.deploymentDetailsPath}`);

      core.info(`Checking lease status for dseq: ${existingDeploymentDetails.dseq}...`);
      const leaseQuery = await sdk.akash.market.v1beta5.getLeases({
        filters: {
          owner: existingDeploymentDetails.lease.id.owner,
          dseq: existingDeploymentDetails.dseq,
          gseq: existingDeploymentDetails.lease.id.gseq,
          oseq: existingDeploymentDetails.lease.id.oseq,
          provider: existingDeploymentDetails.lease.id.provider,
          state: "active",
          bseq: 0,
        },
      });

      if (leaseQuery?.leases?.length) {
        core.info("Lease is active — updating manifest on existing deployment...");
        result = await updateDeploymentManifest(sdk, wallet, inputs, existingDeploymentDetails);
      } else {
        core.info("Lease is no longer active — creating a new deployment...");
        prevDseq = existingDeploymentDetails.dseq;
        result = await createDeployment(sdk, wallet, inputs);
      }
    } else {
      core.info("Creating a deployment on Akash Network...");
      result = await createDeployment(sdk, wallet, inputs);
    }

    core.setOutput("is-new", result.isNew.toString());
    if (prevDseq) {
      core.setOutput("prev-dseq", prevDseq);
    }
    core.setOutput("deployment-id", `${result.deploymentId.owner}/${result.deploymentId.dseq}`);
    core.setOutput("dseq", result.deploymentId.dseq.toString());

    if (result.lease) {
      core.setOutput(
        "lease-id",
        `${result.lease.id.owner}/${result.lease.id.dseq}/${result.lease.id.gseq}/${result.lease.id.oseq}/${result.lease.id.provider}`
      );
      core.setOutput("provider", result.lease.id.provider);
      core.setOutput("lease-status", result.lease.state);
    }

    if (result.isNew && inputs.deploymentDetailsPath && result.lease) {
      const outPath = path.resolve(process.cwd(), inputs.deploymentDetailsPath);
      const details: StoredDeploymentDetails = {
        dseq: result.deploymentId.dseq.toString(),
        lease: {
          id: {
            owner: result.lease.id.owner,
            dseq: result.lease.id.dseq.toString(),
            gseq: Number(result.lease.id.gseq),
            oseq: Number(result.lease.id.oseq),
            provider: result.lease.id.provider,
          },
        },
      };
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(details, null, 2), "utf-8");
      core.info(`Deployment details written to: ${outPath}`);
    }

    core.info("Deployment completed successfully!");
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
