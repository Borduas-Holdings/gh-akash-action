import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDeployment } from "../../close-deployment/src/close-deployment.js";

const harness = vi.hoisted(() => ({
  inputs: undefined,
  outputs: new Map(),
  sdk: undefined,
  setFailed: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: harness.setFailed,
  setOutput: vi.fn((name, value) => harness.outputs.set(name, String(value))),
}));
vi.mock("@akashnetwork/chain-sdk", () => ({ createStargateClient: vi.fn(() => ({})) }));
vi.mock("@akashnetwork/chain-sdk/web", async (importOriginal) => ({
  ...(await importOriginal()),
  createChainNodeWebSDK: vi.fn(() => harness.sdk),
}));
vi.mock("./inputs.ts", () => ({
  getInputs: vi.fn(async () => harness.inputs),
}));

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

describe("deploy action entry point to exact close", () => {
  const directories = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
    harness.outputs.clear();
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("closes its real receipt once when bid lookup fails after create", async () => {
    const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix: "akash" });
    const [account] = await wallet.getAccounts();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "akash-entrypoint-close-"));
    directories.push(directory);
    const receiptPath = path.join(directory, "receipt.json");
    const closeBroadcast = vi.fn(async (_message, options) => {
      options.afterBroadcast({ transactionHash: "CLOSE-TX" });
    });
    const getLeases = vi.fn(async () => ({ leases: [] }));
    const getProvider = vi.fn();
    harness.sdk = {
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
            getDeployments: vi.fn(async () => ({
              deployments: [{ deployment: { id: { owner: account.address, dseq: "12345" } } }],
            })),
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
    harness.inputs = {
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

    vi.useFakeTimers();
    const { runPromise } = await import("./index.ts");
    await settleWithTimers(runPromise);
    vi.useRealTimers();

    expect(harness.setFailed).toHaveBeenCalledWith("no bids after create");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf-8"));
    expect(receipt).toEqual({
      schema: "akash-gha-deployment-receipt/v1",
      owner: account.address,
      dseq: "12345",
    });
    expect(Object.fromEntries(harness.outputs)).toMatchObject({
      "deployment-owner": receipt.owner,
      "deployment-id": `${receipt.owner}/${receipt.dseq}`,
      dseq: receipt.dseq,
      "deployment-receipt-path": path.resolve(receiptPath),
    });

    const getLeaseStatus = vi.fn();
    const generateToken = vi.fn();
    const getProviderHostUri = vi.fn();
    const result = await closeDeployment(
      harness.sdk,
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
    expect(generateToken).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
    expect(getProviderHostUri).not.toHaveBeenCalled();
    expect(getLeaseStatus).not.toHaveBeenCalled();
  }, 5_000);
});
