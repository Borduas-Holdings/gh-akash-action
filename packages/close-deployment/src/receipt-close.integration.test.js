import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeployment } from "../../deploy/src/deployment.ts";
import { publishDeploymentReceipt } from "../../deploy/src/receipt.ts";
import { closeDeployment } from "./close-deployment.ts";

const SDL = `
version: "2.0"
services:
  web:
    image: nginx:latest
    expose:
      - port: 80
        as: 80
        to:
          - global: true
profiles:
  compute:
    web:
      resources:
        cpu:
          units: 0.5
        memory:
          size: 512Mi
        storage:
          size: 512Mi
  placement:
    dcloud:
      pricing:
        web:
          denom: uakt
          amount: 10000
deployment:
  web:
    dcloud:
      profile: web
      count: 1
`;

async function settleWithTimers(promise) {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let attempt = 0; attempt < 20 && !settled; attempt++) {
    await vi.advanceTimersByTimeAsync(10_000);
  }
  return promise;
}

describe("real deploy create to exact close", () => {
  const directories = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("closes the emitted owner/DSEQ once when post-create bid lookup fails with no lease", async () => {
    const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix: "akash" });
    const [account] = await wallet.getAccounts();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "akash-create-close-"));
    directories.push(directory);
    const receiptPath = path.join(directory, "receipt.json");
    const outputs = new Map();
    const closeBroadcast = vi.fn(async (_message, options) => {
      options.afterBroadcast({ transactionHash: "CLOSE-TX" });
    });
    const getLeases = vi.fn(async () => ({ leases: [] }));
    const getProvider = vi.fn();
    const getDeployments = vi.fn(async () => {
      throw new Error("REST index unavailable");
    });
    const sdk = {
      cosmos: {
        base: {
          tendermint: {
            v1beta1: {
              getLatestBlock: vi.fn(async () => ({ block: { header: { height: "12345" } } })),
            },
          },
        },
      },
      akash: {
        deployment: {
          v1beta4: {
            createDeployment: vi.fn(async () => undefined),
            getDeployments,
            closeDeployment: closeBroadcast,
          },
        },
        market: {
          v1beta5: {
            getBids: vi.fn(async () => {
              throw new Error("no bids after create");
            }),
            getLeases,
          },
        },
        provider: { v1beta4: { getProvider } },
      },
    };
    const inputs = {
      mnemonic: wallet.mnemonic,
      selectBid: (bids) => bids[0],
      sdl: SDL,
      gas: "auto",
      gasMultiplier: "1.5",
      fee: "",
      denom: "uakt",
      deposit: "500000",
      queryRestUrl: "https://query.test",
      txRpcUrl: "https://tx.test",
      leaseTimeout: 30,
      deploymentReceiptPath: receiptPath,
    };
    const publishReceipt = (deploymentId) =>
      publishDeploymentReceipt(
        deploymentId,
        receiptPath,
        (name, value) => outputs.set(name, String(value)),
      );

    vi.useFakeTimers();
    const create = createDeployment(sdk, wallet, inputs, {
      logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
      onDeploymentCreated: publishReceipt,
    });
    await expect(settleWithTimers(create)).rejects.toThrow("no bids after create");
    vi.useRealTimers();

    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf-8"));
    expect(receipt).toEqual({
      schema: "akash-gha-deployment-receipt/v1",
      owner: account.address,
      dseq: "12345",
    });
    expect(Object.fromEntries(outputs)).toMatchObject({
      "deployment-owner": receipt.owner,
      "deployment-id": `${receipt.owner}/${receipt.dseq}`,
      dseq: receipt.dseq,
      "deployment-receipt-path": path.resolve(receiptPath),
    });

    const getLeaseStatus = vi.fn();
    const generateToken = vi.fn();
    const getProviderHostUri = vi.fn();
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
      {
        logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
        getLeaseStatus,
        generateToken,
        getProviderHostUri,
      },
    );

    expect(result).toEqual([{ dseq: "12345", txHash: "CLOSE-TX" }]);
    expect(closeBroadcast).toHaveBeenCalledOnce();
    expect(closeBroadcast).toHaveBeenCalledWith(
      { id: { owner: receipt.owner, dseq: receipt.dseq } },
      expect.any(Object),
    );
    expect(getLeases).not.toHaveBeenCalled();
    expect(getDeployments).not.toHaveBeenCalled();
    expect(generateToken).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
    expect(getProviderHostUri).not.toHaveBeenCalled();
    expect(getLeaseStatus).not.toHaveBeenCalled();
  });
});
