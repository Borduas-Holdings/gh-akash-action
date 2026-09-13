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
  const mutantFiles: string[] = [];
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
    for (const file of mutantFiles.splice(0)) {
      fs.rmSync(file, { force: true });
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

  it.each([
    ["create callback", "{ onDeploymentCreated: publishReceipt }", "{}"],
    [
      "receipt publisher",
      "publishDeploymentReceipt(deploymentId, inputs.deploymentReceiptPath);",
      "void deploymentId;",
    ],
  ])("executes the %s mutant and loses the failure-path cleanup carrier", async (_name, target, replacement) => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf-8");
    const targetCount = source.split(target).length - 1;
    expect(targetCount).toBe(1);
    const mutated = source.replace(target, replacement);
    expect(mutated).not.toBe(source);
    const mutantPath = path.resolve(process.cwd(), `src/.index-mutant-${process.pid}-${_name.replaceAll(" ", "-")}.ts`);
    mutantFiles.push(mutantPath);
    fs.writeFileSync(mutantPath, mutated, "utf-8");

    mocks.createDeployment.mockImplementation(async (_sdk, _wallet, _inputs, options) => {
      await options?.onDeploymentCreated?.(deploymentId);
      throw new Error("post-create failure");
    });
    const module = await import(/* @vite-ignore */ mutantPath);
    await module.runPromise;

    const receiptPath = (await mocks.getInputs.mock.results[0].value).deploymentReceiptPath;
    expect(fs.existsSync(receiptPath)).toBe(false);
    expect(core.setOutput).not.toHaveBeenCalledWith("deployment-id", expect.anything());
    expect(core.setFailed).toHaveBeenCalled();
  });

  it("executes a replacement-create branch bypass and loses its failure-path carrier", async () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf-8");
    const target = '        core.info("Lease is no longer active — creating a new deployment...");\n' +
      "        prevDseq = existingDeploymentDetails.dseq;\n" +
      "        result = await createNewDeployment();";
    expect(source.split(target).length - 1).toBe(1);
    const mutated = source.replace(
      target,
      target.replace("result = await createNewDeployment();", "result = await createDeployment(sdk, wallet, inputs);")
    );
    const mutantPath = path.resolve(process.cwd(), `src/.index-mutant-${process.pid}-replacement-branch.ts`);
    mutantFiles.push(mutantPath);
    fs.writeFileSync(mutantPath, mutated, "utf-8");

    const existing = {
      dseq: "99999",
      lease: { id: { ...deploymentId, dseq: "99999", gseq: 1, oseq: 1, provider: "akash1provider" } },
    };
    mocks.getExistingDeploymentDetails.mockReturnValue(existing);
    mocks.createChainNodeWebSDK.mockReturnValue({
      akash: { market: { v1beta5: { getLeases: vi.fn().mockResolvedValue({ leases: [] }) } } },
    });
    mocks.createDeployment.mockImplementation(async (_sdk, _wallet, _inputs, options) => {
      await options?.onDeploymentCreated?.(deploymentId);
      throw new Error("replacement failed after create");
    });

    const original = await import("./index.ts");
    await original.runPromise;

    const receiptPath = (await mocks.getInputs.mock.results[0].value).deploymentReceiptPath;
    expect(JSON.parse(fs.readFileSync(receiptPath, "utf-8"))).toEqual({
      schema: "akash-gha-deployment-receipt/v1",
      ...deploymentId,
    });
    expect(core.setOutput).toHaveBeenCalledWith("deployment-id", `${deploymentId.owner}/${deploymentId.dseq}`);
    expect(core.setFailed).toHaveBeenCalledWith("replacement failed after create");

    fs.rmSync(receiptPath);
    vi.clearAllMocks();

    const module = await import(/* @vite-ignore */ mutantPath);
    await module.runPromise;

    expect(fs.existsSync(receiptPath)).toBe(false);
    expect(core.setOutput).not.toHaveBeenCalledWith("deployment-id", expect.anything());
    expect(core.setFailed).toHaveBeenCalledWith("replacement failed after create");
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
