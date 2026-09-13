import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishDeploymentReceipt } from "../../deploy/src/receipt.ts";
import { closeDeployment } from "./close-deployment.ts";

describe("post-create receipt to exact close", () => {
  const directories = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("closes the created owner/DSEQ even when bid failure left no lease", async () => {
    const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix: "akash" });
    const [account] = await wallet.getAccounts();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "akash-receipt-close-"));
    directories.push(directory);
    const receiptPath = path.join(directory, "receipt.json");

    // This is the deploy action's real post-create publisher. A bid failure occurs
    // after this boundary, so the resulting deployment legitimately has no lease.
    publishDeploymentReceipt(
      { owner: account.address, dseq: "12345" },
      receiptPath,
      vi.fn(),
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf-8"));

    const closeBroadcast = vi.fn(async (_message, options) => {
      options.afterBroadcast({ transactionHash: "CLOSE-TX" });
    });
    const getLeases = vi.fn(async () => ({ leases: [] }));
    const sdk = {
      akash: {
        deployment: {
          v1beta4: {
            getDeployments: vi.fn(async () => ({
              deployments: [{ deployment: { id: { owner: receipt.owner, dseq: receipt.dseq } } }],
            })),
            closeDeployment: closeBroadcast,
          },
        },
        market: { v1beta5: { getLeases } },
      },
    };

    const result = await closeDeployment(
      sdk,
      wallet,
      {
        mnemonic: wallet.mnemonic,
        expectedOwner: receipt.owner,
        deploymentFilter: { dseq: receipt.dseq },
        gas: "auto",
        gasMultiplier: "1.5",
        fee: "",
        denom: "uakt",
        queryRestUrl: "https://query.test",
        txRpcUrl: "https://tx.test",
      },
      { logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn() } },
    );

    expect(result).toEqual([{ dseq: "12345", txHash: "CLOSE-TX" }]);
    expect(closeBroadcast).toHaveBeenCalledOnce();
    expect(closeBroadcast).toHaveBeenCalledWith(
      { id: { owner: receipt.owner, dseq: receipt.dseq } },
      expect.any(Object),
    );
    expect(getLeases).not.toHaveBeenCalled();
  });
});
