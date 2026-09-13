import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as core from "@actions/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDeployment: vi.fn(),
  getExistingDeploymentDetails: vi.fn(),
  updateDeploymentManifest: vi.fn(),
  getInputs: vi.fn(),
  fromMnemonic: vi.fn(),
  createChainNodeWebSDK: vi.fn(),
  createStargateClient: vi.fn(),
}));

vi.mock("./deployment.ts", () => ({
  createDeployment: mocks.createDeployment,
  getExistingDeploymentDetails: mocks.getExistingDeploymentDetails,
  updateDeploymentManifest: mocks.updateDeploymentManifest,
}));
vi.mock("./inputs.ts", () => ({ getInputs: mocks.getInputs }));
vi.mock("@cosmjs/proto-signing", () => ({
  DirectSecp256k1HdWallet: { fromMnemonic: mocks.fromMnemonic },
}));
vi.mock("@akashnetwork/chain-sdk/web", () => ({
  createChainNodeWebSDK: mocks.createChainNodeWebSDK,
}));
vi.mock("@akashnetwork/chain-sdk", () => ({
  createStargateClient: mocks.createStargateClient,
}));
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
}));

describe("deploy action entry point", () => {
  const directories: string[] = [];
  const deploymentId = {
    owner: "akash1n4uut3vxmkdp8wsrya3q0qyddgqey0rh9as4ee",
    dseq: "12345",
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "akash-index-receipt-"));
    directories.push(directory);
    mocks.getInputs.mockResolvedValue({
      mnemonic: "test mnemonic",
      queryRestUrl: "https://query.test",
      txRpcUrl: "https://tx.test",
      gasMultiplier: "1.5",
      deploymentReceiptPath: path.join(directory, "receipt.json"),
    });
    mocks.fromMnemonic.mockResolvedValue({ getAccounts: vi.fn() });
    mocks.createStargateClient.mockReturnValue({});
    mocks.createChainNodeWebSDK.mockReturnValue({
      akash: { market: { v1beta5: { getLeases: vi.fn() } } },
    });
    mocks.getExistingDeploymentDetails.mockReturnValue(undefined);
  });

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("publishes the exact receipt and outputs when fresh create later fails", async () => {
    mocks.createDeployment.mockImplementation(async (_sdk, _wallet, _inputs, options) => {
      await options?.onDeploymentCreated?.(deploymentId);
      throw new Error("manifest failed after create");
    });

    const { runPromise } = await import("./index.ts");
    await runPromise;

    const receiptPath = (await mocks.getInputs.mock.results[0].value).deploymentReceiptPath;
    expect(JSON.parse(fs.readFileSync(receiptPath, "utf-8"))).toEqual({
      schema: "akash-gha-deployment-receipt/v1",
      ...deploymentId,
    });
    expect(core.setOutput).toHaveBeenCalledWith("deployment-owner", deploymentId.owner);
    expect(core.setOutput).toHaveBeenCalledWith("deployment-id", `${deploymentId.owner}/${deploymentId.dseq}`);
    expect(core.setOutput).toHaveBeenCalledWith("dseq", deploymentId.dseq);
    expect(core.setFailed).toHaveBeenCalledWith("manifest failed after create");
  });

  it("keeps the fresh-create callback at one load-bearing entry-point call site", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf-8");
    const target = "{ onDeploymentCreated: publishReceipt }";
    const targetCount = source.split(target).length - 1;
    expect(targetCount).toBe(1);
    const mutated = source.replace(target, "{}");
    expect(mutated).not.toBe(source);
    expect(mutated.split(target).length - 1).toBe(0);
    expect(mutated).toContain("createDeployment(sdk, wallet, inputs, {})");
  });

  it("publishes an adopted deployment through the separate success fallback", async () => {
    const existing = {
      dseq: deploymentId.dseq,
      lease: {
        id: { ...deploymentId, gseq: 1, oseq: 1, provider: "akash1provider" },
      },
    };
    const sdk = {
      akash: {
        market: {
          v1beta5: {
            getLeases: vi.fn().mockResolvedValue({ leases: [{ lease: existing.lease }] }),
          },
        },
      },
    };
    mocks.getExistingDeploymentDetails.mockReturnValue(existing);
    mocks.createChainNodeWebSDK.mockReturnValue(sdk);
    mocks.updateDeploymentManifest.mockResolvedValue({ deploymentId, isNew: false });

    const { runPromise } = await import("./index.ts");
    await runPromise;

    expect(mocks.createDeployment).not.toHaveBeenCalled();
    expect(mocks.updateDeploymentManifest).toHaveBeenCalledOnce();
    expect(core.setOutput).toHaveBeenCalledWith("deployment-id", `${deploymentId.owner}/${deploymentId.dseq}`);
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
