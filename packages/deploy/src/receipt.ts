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
    throw new Error(
      "Cannot publish deployment receipt: owner is not an Akash address",
    );
  }
  if (!/^[1-9][0-9]*$/.test(dseq)) {
    throw new Error(
      "Cannot publish deployment receipt: dseq is not a positive canonical decimal",
    );
  }

  const receipt: DeploymentReceipt = {
    schema: DEPLOYMENT_RECEIPT_SCHEMA,
    owner,
    dseq,
  };
  const failures: Error[] = [];
  let outPath: string | undefined;
  if (receiptPath) {
    outPath = path.resolve(process.cwd(), receiptPath);
    const tempPath = `${outPath}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(tempPath, `${JSON.stringify(receipt)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
      });
      fs.renameSync(tempPath, outPath);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
      outPath = undefined;
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
    if (outPath) {
      core.info(`Deployment receipt written to: ${outPath}`);
    }
  }

  // The file and GitHub outputs are independent recovery carriers. Attempt the
  // durable file first, then every output even if either carrier fails, so one
  // broken channel cannot suppress the other after an on-chain create.
  const outputs: [string, string][] = [
    ["deployment-owner", owner],
    ["deployment-id", `${owner}/${dseq}`],
    ["dseq", dseq],
  ];
  if (outPath) {
    outputs.push(["deployment-receipt-path", outPath]);
  }
  for (const [name, value] of outputs) {
    try {
      setOutput(name, value);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      "Deployment receipt publication was incomplete",
    );
  }
  return receipt;
}
