import * as core from "@actions/core";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { createChainNodeWebSDK } from "@akashnetwork/chain-sdk/web";
import { createStargateClient } from "@akashnetwork/chain-sdk";
import { closeDeployment } from "./close-deployment.js";
import { getInputs } from "./inputs.js";

async function run(): Promise<void> {
  try {
    const inputs = await getInputs();

    core.info("Initializing wallet...");
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(inputs.mnemonic, {
      prefix: "akash",
    });

    core.info("Connecting to Akash network...");
    const sdk = createChainNodeWebSDK({
      query: {
        baseUrl: inputs.queryRestUrl,
      },
      tx: {
        signer: createStargateClient({
          baseUrl: inputs.txRpcUrl,
          signer: wallet,
        }),
      },
    });

    const result = await closeDeployment(sdk, wallet, inputs);

    core.setOutput("closed_deployments_json", JSON.stringify(result));

    core.info(`Successfully closed deployments: ${result.map(r => r.dseq)}`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unknown error occurred");
    }
  }
}

run();
