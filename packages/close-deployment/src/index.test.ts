import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inputs: new Map<string, string>(),
  accountAddress: "akash1n4uut3vxmkdp8wsrya3q0qyddgqey0rh9as4ee",
  resolveHealthyEndpoints: vi.fn(),
  fromMnemonic: vi.fn(),
  createChainNodeWebSDK: vi.fn(),
  createStargateClient: vi.fn(),
  closeBroadcast: vi.fn(),
  getDeployments: vi.fn(),
  getLeases: vi.fn(),
  generateToken: vi.fn(),
  getLeaseStatus: vi.fn(),
}));

vi.mock("@actions/core", () => ({
  error: vi.fn(),
  getInput: vi.fn((name: string) => mocks.inputs.get(name) ?? ""),
  info: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@akashnetwork/actions-utils", () => ({
  DEFAULT_RPC_ENDPOINTS: ["https://default.test"],
  parseEndpoints: (value: string | string[]) => Array.isArray(value) ? value : [value],
  resolveHealthyEndpoints: mocks.resolveHealthyEndpoints,
  generateToken: mocks.generateToken,
  getLeaseStatus: mocks.getLeaseStatus,
}));
vi.mock("@cosmjs/proto-signing", () => ({
  DirectSecp256k1HdWallet: { fromMnemonic: mocks.fromMnemonic },
}));
vi.mock("@akashnetwork/chain-sdk/web", () => ({
  createChainNodeWebSDK: mocks.createChainNodeWebSDK,
}));
vi.mock("@akashnetwork/chain-sdk", () => ({
  createStargateClient: mocks.createStargateClient,
}));

describe("close action true entry point", () => {
  const mutantFiles: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.inputs.clear();
    mocks.inputs.set("mnemonic", "test mnemonic");
    mocks.inputs.set("expected-owner", mocks.accountAddress);
    mocks.inputs.set("filter", 'dseq: "12345"');
    mocks.resolveHealthyEndpoints.mockResolvedValue({
      restUrl: "https://query.test",
      rpcUrl: "https://rpc.test",
    });
    const wallet = { getAccounts: vi.fn(async () => [{ address: mocks.accountAddress }]) };
    mocks.fromMnemonic.mockResolvedValue(wallet);
    mocks.closeBroadcast.mockImplementation(async (_message, options) => {
      options.afterBroadcast({ transactionHash: "CLOSE-TX" });
    });
    mocks.createChainNodeWebSDK.mockReturnValue({
      akash: {
        deployment: {
          v1beta4: {
            getDeployments: mocks.getDeployments,
            closeDeployment: mocks.closeBroadcast,
          },
        },
        market: { v1beta5: { getLeases: mocks.getLeases } },
        provider: { v1beta4: { getProvider: vi.fn() } },
      },
    });
    mocks.createStargateClient.mockReturnValue({});
  });

  afterEach(() => {
    for (const file of mutantFiles.splice(0)) fs.rmSync(file, { force: true });
  });

  it("rejects a non-string DSEQ before wallet, endpoint, query, or broadcast effects", async () => {
    mocks.inputs.set("filter", "dseq: 01");
    const { runPromise } = await import("./index.js");
    await runPromise;

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/quoted canonical decimal string/));
    expect(mocks.fromMnemonic).not.toHaveBeenCalled();
    expect(mocks.resolveHealthyEndpoints).not.toHaveBeenCalled();
    expect(mocks.createChainNodeWebSDK).not.toHaveBeenCalled();
    expect(mocks.closeBroadcast).not.toHaveBeenCalled();
  });

  it("rejects an owner mismatch before endpoint, query, or broadcast effects", async () => {
    mocks.inputs.set("expected-owner", "akash1differentowner");
    const { runPromise } = await import("./index.js");
    await runPromise;

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/does not match signing account/));
    expect(mocks.resolveHealthyEndpoints).not.toHaveBeenCalled();
    expect(mocks.createChainNodeWebSDK).not.toHaveBeenCalled();
    expect(mocks.closeBroadcast).not.toHaveBeenCalled();
  });

  it("resolves endpoints after ownership and broadcasts the exact DSEQ once with zero REST selectors", async () => {
    const { runPromise } = await import("./index.js");
    await runPromise;

    expect(mocks.resolveHealthyEndpoints).toHaveBeenCalledOnce();
    expect(mocks.getDeployments).not.toHaveBeenCalled();
    expect(mocks.getLeases).not.toHaveBeenCalled();
    expect(mocks.generateToken).not.toHaveBeenCalled();
    expect(mocks.getLeaseStatus).not.toHaveBeenCalled();
    expect(mocks.closeBroadcast).toHaveBeenCalledOnce();
    expect(mocks.closeBroadcast).toHaveBeenCalledWith(
      { id: { owner: mocks.accountAddress, dseq: "12345" } },
      expect.any(Object),
    );
  });

  it("executes the one owner-order mutant and exposes its precheck network effect", async () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf-8");
    const target = "    assertExpectedOwner(inputs.expectedOwner, account.address);";
    expect(source.split(target).length - 1).toBe(1);
    const mutantPath = path.resolve(process.cwd(), `src/.index-owner-mutant-${process.pid}.ts`);
    mutantFiles.push(mutantPath);
    fs.writeFileSync(mutantPath, source.replace(target, "    void inputs.expectedOwner; void account.address;"));
    mocks.inputs.set("expected-owner", "akash1differentowner");

    const { runPromise } = await import(/* @vite-ignore */ mutantPath);
    await runPromise;

    expect(mocks.resolveHealthyEndpoints).toHaveBeenCalledOnce();
    expect(mocks.closeBroadcast).not.toHaveBeenCalled();
  });
});
