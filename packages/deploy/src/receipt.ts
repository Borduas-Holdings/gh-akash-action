import * as core from "@actions/core";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DeploymentResult } from "./deployment.js";

export const DEPLOYMENT_RECEIPT_SCHEMA = "akash-gha-deployment-receipt/v1";

export interface DeploymentReceipt {
  schema: typeof DEPLOYMENT_RECEIPT_SCHEMA;
  owner: string;
  dseq: string;
}

type OutputWriter = (name: string, value: string) => void;

/**
 * Publish the cleanup subject as soon as the create transaction succeeds.
 *
 * GitHub preserves outputs written before a later `setFailed`, while the optional
 * atomic file gives an `always()` step in the same job an independent copy. Both
 * carriers contain only the wallet-derived owner and the exact broadcast dseq.
 */
export function publishDeploymentReceipt(
  deploymentId: DeploymentResult["deploymentId"],
  receiptPath?: string,
  setOutput: OutputWriter = core.setOutput,
): DeploymentReceipt {
  const owner = deploymentId.owner.trim();
  const dseq = deploymentId.dseq.trim();
  if (!owner || !/^akash1[0-9a-z]+$/.test(owner)) {
    throw new Error("Cannot publish deployment receipt: owner is not an Akash address");
  }
  if (!/^[1-9][0-9]*$/.test(dseq)) {
    throw new Error("Cannot publish deployment receipt: dseq is not a positive canonical decimal");
  }

  const receipt: DeploymentReceipt = {
    schema: DEPLOYMENT_RECEIPT_SCHEMA,
    owner,
    dseq,
  };
  setOutput("deployment-owner", owner);
  setOutput("deployment-id", `${owner}/${dseq}`);
  setOutput("dseq", dseq);

  if (receiptPath) {
    const outPath = path.resolve(process.cwd(), receiptPath);
    const tempPath = `${outPath}.tmp-${process.pid}`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf-8", mode: 0o600 });
      fs.renameSync(tempPath, outPath);
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
    setOutput("deployment-receipt-path", outPath);
    core.info(`Deployment receipt written to: ${outPath}`);
  }
  return receipt;
}
