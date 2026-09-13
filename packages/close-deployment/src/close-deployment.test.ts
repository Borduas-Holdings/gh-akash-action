import type { generateToken, getLeaseStatus } from "@akashnetwork/actions-utils";
import type { createChainNodeWebSDK } from "@akashnetwork/chain-sdk/web";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { describe, expect, it, vi } from "vitest";
import { mock, mockDeep } from "vitest-mock-extended";
import { closeDeployment, type Logger } from "./close-deployment.js";
import type { ActionInputs, DeploymentContext } from "./inputs.js";

type ChainSDK = ReturnType<typeof createChainNodeWebSDK>;

describe(closeDeployment.name, () => {
  it("returns empty array when no deployments match filters", async () => {
    const { sdk, wallet, inputs, options } = await setup({ deployments: [] });

    const result = await closeDeployment(sdk, wallet, inputs, options);

    expect(result).toEqual([]);
    expect(sdk.akash.deployment.v1beta4.closeDeployment).not.toHaveBeenCalled();
  });

  it("refuses an expected-owner mismatch before querying or broadcasting", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
      inputOverrides: { expectedOwner: "akash1differentowner" },
    });

    await expect(closeDeployment(sdk, wallet, inputs, options)).rejects.toThrow(
      /expected owner akash1differentowner does not match signing account/
    );

    expect(sdk.akash.deployment.v1beta4.getDeployments).not.toHaveBeenCalled();
    expect(sdk.akash.market.v1beta5.getLeases).not.toHaveBeenCalled();
    expect(sdk.akash.deployment.v1beta4.closeDeployment).not.toHaveBeenCalled();
  });

  it("accepts an expected owner matching the signing account", async () => {
    const fixture = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
    });
    fixture.inputs.expectedOwner = fixture.ownerAddress;

    const result = await closeDeployment(fixture.sdk, fixture.wallet, fixture.inputs, fixture.options);

    expect(result).toHaveLength(1);
    expect(fixture.sdk.akash.deployment.v1beta4.closeDeployment).toHaveBeenCalledTimes(1);
  });

  it("calls the owner-enforcement boundary before any cleanup effect", async () => {
    const fixture = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
    });
    const enforcement = vi.fn(() => {
      throw new Error("owner-enforcement-effect");
    });

    await expect(
      closeDeployment(fixture.sdk, fixture.wallet, fixture.inputs, {
        ...fixture.options,
        assertExpectedOwner: enforcement,
      })
    ).rejects.toThrow("owner-enforcement-effect");

    expect(enforcement).toHaveBeenCalledWith(undefined, fixture.ownerAddress);
    expect(fixture.sdk.akash.deployment.v1beta4.getDeployments).not.toHaveBeenCalled();
    expect(fixture.sdk.akash.deployment.v1beta4.closeDeployment).not.toHaveBeenCalled();
  });

  it("returns empty array when no leases found for a deployment", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [],
    });

    const result = await closeDeployment(sdk, wallet, inputs, options);

    expect(result).toEqual([]);
    expect(sdk.akash.deployment.v1beta4.closeDeployment).not.toHaveBeenCalled();
  });

  it("closes deployment and returns result with dseq", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
    });

    const result = await closeDeployment(sdk, wallet, inputs, options);

    expect(result).toHaveLength(1);
    expect(result[0].dseq).toBe("12345");
  });

  it("calls closeDeployment with correct deployment id and memo", async () => {
    const { sdk, wallet, inputs, ownerAddress, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
    });

    await closeDeployment(sdk, wallet, inputs, options);

    expect(sdk.akash.deployment.v1beta4.closeDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: { owner: ownerAddress, dseq: "12345" },
      }),
      expect.objectContaining({
        memo: "Deployment closed via GitHub Action",
      })
    );
  });

  it("uses auto gas with multiplier by default", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
    });

    await closeDeployment(sdk, wallet, inputs, options);

    expect(sdk.akash.deployment.v1beta4.closeDeployment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ gasAdjustment: 1.5 })
    );
  });

  it("uses custom fee when gas is not auto", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
      inputOverrides: { gas: "200000", fee: "5000" },
    });

    await closeDeployment(sdk, wallet, inputs, options);

    expect(sdk.akash.deployment.v1beta4.closeDeployment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        fee: { amount: [{ denom: "uakt", amount: "5000" }], gas: "200000" },
      })
    );
  });

  it("uses custom denom from inputs", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
      inputOverrides: { gas: "200000", fee: "1000", denom: "uusd" },
    });

    await closeDeployment(sdk, wallet, inputs, options);

    expect(sdk.akash.deployment.v1beta4.closeDeployment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        fee: { amount: [{ denom: "uusd", amount: "1000" }], gas: "200000" },
      })
    );
  });

  it("returns transaction hash from afterBroadcast callback", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
      txHash: "ABC123TXHASH",
    });

    const result = await closeDeployment(sdk, wallet, inputs, options);

    expect(result[0].txHash).toBe("ABC123TXHASH");
  });

  it("excludes leases that do not pass the lease filter", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1", state: "closed" }],
      inputOverrides: {
        leaseFilter: (lease: DeploymentContext) => lease.state === "active",
      },
    });

    const result = await closeDeployment(sdk, wallet, inputs, options);

    expect(result).toHaveLength(0);
    expect(sdk.akash.deployment.v1beta4.closeDeployment).not.toHaveBeenCalled();
  });

  it("includes leases that pass the lease filter", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1", state: "active" }],
      inputOverrides: {
        leaseFilter: (lease: DeploymentContext) => lease.state === "active",
      },
    });

    const result = await closeDeployment(sdk, wallet, inputs, options);

    expect(result).toHaveLength(1);
    expect(sdk.akash.deployment.v1beta4.closeDeployment).toHaveBeenCalledTimes(1);
  });

  it("closes all leases across multiple deployments", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "11111" }, { dseq: "22222" }],
      leases: [
        { dseq: "11111", provider: "akash1provider1" },
        { dseq: "22222", provider: "akash1provider2" },
      ],
    });

    const result = await closeDeployment(sdk, wallet, inputs, options);

    expect(result).toHaveLength(2);
    expect(sdk.akash.deployment.v1beta4.closeDeployment).toHaveBeenCalledTimes(2);
    expect(result.map((r) => r.dseq)).toEqual(expect.arrayContaining(["11111", "22222"]));
  });

  it("fetches deployments with owner address merged into deployment filter", async () => {
    const { sdk, wallet, inputs, ownerAddress, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
    });

    await closeDeployment(sdk, wallet, inputs, options);

    expect(sdk.akash.deployment.v1beta4.getDeployments).toHaveBeenCalledWith({
      filters: { owner: ownerAddress, dseq: "12345" },
    });
  });

  it("fetches leases for each deployment filtered by owner and dseq", async () => {
    const { sdk, wallet, inputs, ownerAddress, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
    });

    await closeDeployment(sdk, wallet, inputs, options);

    expect(sdk.akash.market.v1beta5.getLeases).toHaveBeenCalledWith({
      filters: { owner: ownerAddress, dseq: "12345" },
    });
  });

  it("calls getProviderHostUri for each lease with its provider address", async () => {
    const sharedProvider = "akash1sharedprovider";
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "11111" }, { dseq: "22222" }],
      leases: [
        { dseq: "11111", provider: sharedProvider },
        { dseq: "22222", provider: sharedProvider },
      ],
    });

    await closeDeployment(sdk, wallet, inputs, options);

    expect(options.getProviderHostUri).toHaveBeenCalledTimes(2);
    expect(options.getProviderHostUri).toHaveBeenCalledWith(sdk, sharedProvider);
  });

  it("calls generateToken once per deployment with lease permissions", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
    });

    await closeDeployment(sdk, wallet, inputs, options);

    expect(options.generateToken).toHaveBeenCalledTimes(1);
    expect(options.generateToken).toHaveBeenCalledWith(wallet, expect.any(Function));
  });

  it("calls getLeaseStatus with token and provider host URI for each lease", async () => {
    const { sdk, wallet, inputs, options } = await setup({
      deployments: [{ dseq: "12345" }],
      leases: [{ dseq: "12345", provider: "akash1provider1" }],
    });

    await closeDeployment(sdk, wallet, inputs, options);

    expect(options.getLeaseStatus).toHaveBeenCalledTimes(1);
    expect(options.getLeaseStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        dseq: "12345",
        token: "mock-jwt-token",
        providerHostUri: "https://provider.akash.test",
      })
    );
  });

  async function setup(input?: {
    deployments?: { dseq: string }[];
    leases?: { dseq: string; provider: string; state?: string }[];
    txHash?: string;
    inputOverrides?: Partial<ActionInputs>;
  }) {
    const sdk = mockDeep<ChainSDK>();
    const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix: "akash" });
    const [account] = await wallet.getAccounts();
    const ownerAddress = account.address;

    const deployments = input?.deployments ?? [{ dseq: "12345" }];

    sdk.akash.deployment.v1beta4.getDeployments.mockResolvedValue({
      deployments: deployments.map((d) => ({
        deployment: { id: { owner: ownerAddress, dseq: d.dseq }, state: 1 },
      })),
      pagination: undefined,
    } as any);

    // Build a map from dseq to leases so each deployment gets the right leases.
    const leaseList = input?.leases ?? [];
    const leaseMap = leaseList.reduce<Record<string, typeof leaseList>>((acc, l) => {
      (acc[l.dseq] ??= []).push(l);
      return acc;
    }, {});

    sdk.akash.market.v1beta5.getLeases.mockImplementation(async (params: any) => {
      const dseq = params?.filters?.dseq?.toString();
      const leasesForDseq = dseq ? (leaseMap[dseq] ?? []) : [];
      return {
        leases: leasesForDseq.map((l) => ({
          lease: {
            id: { owner: ownerAddress, dseq: l.dseq, gseq: 1, oseq: 1, provider: l.provider },
            state: (l.state ?? "closed") as any,
            createdAt: "100",
          },
        })),
        pagination: undefined,
      } as any;
    });

    sdk.akash.deployment.v1beta4.closeDeployment.mockImplementation(async (_, opts) => {
      opts?.afterBroadcast?.({ transactionHash: input?.txHash } as any);
      return {} as any;
    });

    const getLeaseStatusMock = vi.fn<typeof getLeaseStatus>().mockResolvedValue({ services: {} });
    const generateTokenMock = vi.fn<typeof generateToken>().mockResolvedValue("mock-jwt-token");
    const getProviderHostUriMock = vi.fn().mockResolvedValue("https://provider.akash.test");

    const inputs: ActionInputs = {
      mnemonic: wallet.mnemonic,
      deploymentFilter: { dseq: "12345" },
      gas: "auto",
      gasMultiplier: "1.5",
      fee: "",
      denom: "uakt",
      queryRestUrl: "https://rpc.test/rest",
      txRpcUrl: "https://rpc.test/rpc",
      ...input?.inputOverrides,
    };

    const options = {
      logger: mock<Logger>(),
      getLeaseStatus: getLeaseStatusMock,
      generateToken: generateTokenMock,
      getProviderHostUri: getProviderHostUriMock,
    };

    return { sdk, wallet, inputs, ownerAddress, options };
  }
});
