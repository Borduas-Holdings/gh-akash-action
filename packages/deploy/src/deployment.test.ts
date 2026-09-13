import type { Bid } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import type { createChainNodeWebSDK } from "@akashnetwork/chain-sdk/web";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { mock, mockDeep } from "vitest-mock-extended";
import { createDeployment, getExistingDeploymentDetails, updateDeploymentManifest, waitForBid, type Logger, type StoredDeploymentDetails } from "./deployment.js";
import type { ActionInputs, JsonResponse } from "./inputs.js";

type ChainSDK = ReturnType<typeof createChainNodeWebSDK>;

/**
 * Helper to run a promise with fake timers.
 * Advances timers repeatedly until the promise resolves.
 */
async function runWithFakeTimers<T>(promise: Promise<T>, maxIterations = 100): Promise<T> {
  let resolved = false;
  let result: T;
  let error: unknown;

  promise
    .then((r) => { resolved = true; result = r; })
    .catch((e) => { resolved = true; error = e; });

  for (let i = 0; i < maxIterations && !resolved; i++) {
    await vi.advanceTimersByTimeAsync(10_000);
  }

  if (error) throw error;
  return result!;
}

describe(waitForBid.name, () => {
  it("returns matching bid when found on first attempt", async () => {
    vi.useFakeTimers();
    const { sdk, mockBid, logger } = setup({
      bids: [{ provider: "akash1provider1", amount: "1000" }],
    });

    const deploymentId = { owner: "akash1testowner123", dseq: "12345" };
    const filter = (bids: JsonResponse<Bid>[]) => bids[0];

    const promise = waitForBid(sdk, deploymentId, 30, filter, logger);
    const [, result] = await Promise.all([vi.runAllTimersAsync(), promise]);
    vi.useRealTimers();

    expect(result).toEqual(mockBid);
    expect(sdk.akash.market.v1beta5.getBids).toHaveBeenCalledWith({
      filters: {
        owner: "akash1testowner123",
        dseq: "12345",
        gseq: 1,
        oseq: 1,
      },
      pagination: {
        limit: 1000,
      },
    });
  });

  it("retries until bid is found", async () => {
    vi.useFakeTimers();
    const { sdk, mockBid, logger } = setup({
      bidsSequence: [
        [],
        [{ provider: "akash1provider1", amount: "1000" }],
      ],
    });

    const deploymentId = { owner: "akash1testowner123", dseq: "12345" };
    const filter = (bids: JsonResponse<Bid>[]) => bids[0];

    const promise = waitForBid(sdk, deploymentId, 60, filter, logger);
    const [, result] = await Promise.all([vi.runAllTimersAsync(), promise]);
    vi.useRealTimers();

    expect(result).toEqual(mockBid);
    expect(sdk.akash.market.v1beta5.getBids).toHaveBeenCalledTimes(2);
  });

  it("throws error when no matching bid found after timeout", async () => {
    vi.useFakeTimers();
    const { sdk, logger } = setup({ bids: [] });

    const deploymentId = { owner: "akash1testowner123", dseq: "12345" };
    const filter = (bids: JsonResponse<Bid>[]) => bids[0];

    const promise = waitForBid(sdk, deploymentId, 20, filter, logger).catch(error => ({ error }));
    const [, result] = await Promise.all([vi.runAllTimersAsync(), promise]);

    expect((result as { error: Error }).error.message).toMatch(/No bid found that matches the filter criteria after/);
    vi.useRealTimers();
  });

  it("throws error when bids exist but none match filter", async () => {
    vi.useFakeTimers();
    const { sdk, logger } = setup({
      bids: [{ provider: "akash1provider1", amount: "1000" }],
    });

    const deploymentId = { owner: "akash1testowner123", dseq: "12345" };
    const filter = () => undefined;

    vi.useFakeTimers();
    const promise = waitForBid(sdk, deploymentId, 30, filter, logger).catch(error => ({ error }));
    const [, result] = await Promise.all([vi.runAllTimersAsync(), promise]);

    expect((result as { error: Error }).error.message).toMatch("No bid found that matches the filter criteria.");
  });

  it("applies custom filter to select specific bid", async () => {
    vi.useFakeTimers();
    const { sdk, logger } = setup({
      bids: [
        { provider: "akash1provider1", amount: "1000" },
        { provider: "akash1provider2", amount: "500" },
        { provider: "akash1provider3", amount: "750" },
      ],
    });

    const deploymentId = { owner: "akash1testowner123", dseq: "12345" };
    const filter = (bids: JsonResponse<Bid>[]) =>
      bids.sort((a, b) => Number(a.price!.amount) - Number(b.price!.amount))[0];

    const promise = waitForBid(sdk, deploymentId, 30, filter, logger);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.id?.provider).toBe("akash1provider2");
    expect(result.price?.amount).toBe("500");
  });

  it("selects bid by provider address using filter", async () => {
    vi.useFakeTimers();
    const { sdk, logger } = setup({
      bids: [
        { provider: "akash1provider1", amount: "1000" },
        { provider: "akash1targetprovider", amount: "2000" },
      ],
    });

    const deploymentId = { owner: "akash1testowner123", dseq: "12345" };
    const filter = (bids: JsonResponse<Bid>[]) =>
      bids.find((b) => b.id?.provider === "akash1targetprovider");

    const promise = waitForBid(sdk, deploymentId, 30, filter, logger);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.id?.provider).toBe("akash1targetprovider");
  });

  function setup(input: {
    bids?: { provider: string; amount: string }[];
    bidsSequence?: { provider: string; amount: string }[][];
  }) {
    const sdk = mockDeep<ChainSDK>();
    const logger = mock<Logger>();

    const createMockBid = (provider: string, amount: string): JsonResponse<Bid> => ({
      id: {
        owner: "akash1testowner123",
        dseq: "12345",
        gseq: 1,
        oseq: 1,
        provider,
        bseq: 0,
      },
      state: "open" as unknown as JsonResponse<Bid>["state"],
      price: {
        denom: "uakt",
        amount,
      },
      createdAt: "100",
      resourcesOffer: [],
    });

    let mockBid: JsonResponse<Bid> | undefined;

    if (input.bidsSequence) {
      input.bidsSequence.forEach((bids, index) => {
        const mockBids = bids.map((b) => ({ bid: createMockBid(b.provider, b.amount) }));
        if (index === input.bidsSequence!.length - 1 && mockBids.length > 0) {
          mockBid = mockBids[0].bid;
        }
        sdk.akash.market.v1beta5.getBids.mockResolvedValueOnce({
          bids: mockBids,
          pagination: undefined,
        } as any);
      });
    } else if (input.bids) {
      const mockBids = input.bids.map((b) => ({ bid: createMockBid(b.provider, b.amount) }));
      mockBid = mockBids[0]?.bid;
      sdk.akash.market.v1beta5.getBids.mockResolvedValue({
        bids: mockBids,
        pagination: undefined,
      } as any);
    }

    return { sdk, logger, mockBid };
  }
});

describe(createDeployment.name, () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates deployment and returns deployment ID", async () => {
    const { sdk, wallet, inputs, fetch, generateToken, ownerAddress } = await setup();

    vi.useFakeTimers();
    const result = await runWithFakeTimers(
      createDeployment(sdk, wallet, inputs, { fetch, logger: mock<Logger>(), generateToken })
    );

    expect(result.deploymentId.owner).toBe(ownerAddress);
    expect(result.deploymentId.dseq).toBe("12345");
  });

  it("calls createDeployment with correct parameters", async () => {
    const { sdk, wallet, inputs, fetch, generateToken, ownerAddress } = await setup();

    vi.useFakeTimers();
    await runWithFakeTimers(
      createDeployment(sdk, wallet, inputs, { fetch, logger: mock<Logger>(), generateToken })
    );

    expect(sdk.akash.deployment.v1beta4.createDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: {
          owner: ownerAddress,
          dseq: "12345",
        },
        deposit: {
          amount: {
            denom: "uakt",
            amount: "500000",
          },
          sources: expect.any(Array),
        },
      }),
      expect.objectContaining({
        memo: "Deployment created via GitHub Action",
      })
    );
  });

  it("includes custom fee when gas is not auto", async () => {
    const { sdk, wallet, inputs, fetch, generateToken } = await setup({
      inputOverrides: { gas: "200000", fee: "5000" },
    });

    vi.useFakeTimers();
    await runWithFakeTimers(
      createDeployment(sdk, wallet, inputs, { fetch, logger: mock<Logger>(), generateToken })
    );

    expect(sdk.akash.deployment.v1beta4.createDeployment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        fee: {
          amount: [{ denom: "uakt", amount: "5000" }],
          gas: "200000",
        },
      })
    );
  });

  it("retains a created deployment on error for the caller's exact cleanup path", async () => {
    const { sdk, wallet, inputs, generateToken } = await setup({ getBidsError: new Error("Network error") });
    const logger = mock<Logger>();

    vi.useFakeTimers();
    await expect(
      runWithFakeTimers(
        createDeployment(sdk, wallet, inputs, { logger, generateToken })
      )
    ).rejects.toThrow("Network error");

    expect(sdk.akash.deployment.v1beta4.closeDeployment).not.toHaveBeenCalled();
    expect(logger.warning).toHaveBeenCalledWith(
      "Deployment was NOT auto-closed. Use close-deployment action to clean up if needed."
    );
  });

  it("publishes the wallet owner and dseq before a post-create bid failure", async () => {
    const { sdk, wallet, inputs, generateToken, ownerAddress } = await setup();
    const events: string[] = [];
    sdk.akash.deployment.v1beta4.createDeployment.mockImplementation(async () => {
      events.push("create-broadcast");
      return undefined as any;
    });
    sdk.akash.market.v1beta5.getBids.mockImplementation(async () => {
      events.push("bid-query");
      throw new Error("post-create bid failure");
    });
    const onDeploymentCreated = vi.fn(async () => {
      events.push("publish-receipt");
    });

    vi.useFakeTimers();
    await expect(
      runWithFakeTimers(
        createDeployment(sdk, wallet, inputs, {
          logger: mock<Logger>(),
          generateToken,
          onDeploymentCreated,
        })
      )
    ).rejects.toThrow("post-create bid failure");

    expect(onDeploymentCreated).toHaveBeenCalledOnce();
    expect(onDeploymentCreated).toHaveBeenCalledWith({ owner: ownerAddress, dseq: "12345" });
    expect(events.slice(0, 3)).toEqual(["create-broadcast", "publish-receipt", "bid-query"]);
    expect(sdk.akash.deployment.v1beta4.closeDeployment).not.toHaveBeenCalled();
  });

  it.each(["bid", "lease", "manifest", "status"] as const)(
    "retains the exact receipt through a post-create %s failure",
    async (phase) => {
      const { sdk, wallet, inputs, fetch, generateToken, ownerAddress } = await setup();
      const failure = new Error(`${phase} failed after create`);
      if (phase === "bid") {
        sdk.akash.market.v1beta5.getBids.mockRejectedValue(failure);
      } else if (phase === "lease") {
        sdk.akash.market.v1beta5.createLease.mockRejectedValue(failure);
      } else if (phase === "manifest") {
        fetch.mockImplementation(async (input) => {
          if (String(input).includes("/manifest")) {
            throw failure;
          }
          return new Response("", { status: 200 });
        });
      } else {
        fetch.mockImplementation(async (input) => {
          if (String(input).includes("/status")) {
            throw failure;
          }
          return new Response("", { status: 200 });
        });
      }
      const onDeploymentCreated = vi.fn();

      vi.useFakeTimers();
      await expect(
        runWithFakeTimers(
          createDeployment(sdk, wallet, inputs, {
            fetch,
            logger: mock<Logger>(),
            generateToken,
            onDeploymentCreated,
          })
        )
      ).rejects.toThrow(`${phase} failed after create`);

      expect(onDeploymentCreated).toHaveBeenCalledOnce();
      expect(onDeploymentCreated).toHaveBeenCalledWith({ owner: ownerAddress, dseq: "12345" });
      expect(sdk.akash.deployment.v1beta4.closeDeployment).not.toHaveBeenCalled();
    }
  );

  it("creates lease after finding bid", async () => {
    const { sdk, wallet, inputs, fetch, mockBid, generateToken } = await setup();

    vi.useFakeTimers();
    await runWithFakeTimers(
      createDeployment(sdk, wallet, inputs, { fetch, logger: mock<Logger>(), generateToken })
    );

    expect(sdk.akash.market.v1beta5.createLease).toHaveBeenCalledWith(
      expect.objectContaining({
        bidId: expect.objectContaining({
          owner: mockBid.id!.owner,
          provider: mockBid.id!.provider,
          gseq: mockBid.id!.gseq,
          oseq: mockBid.id!.oseq,
        }),
      }),
      expect.any(Object)
    );
  });

  it("verifies lease after creation", async () => {
    const { sdk, wallet, inputs, fetch, generateToken, ownerAddress, providerAddress } = await setup();

    vi.useFakeTimers();
    await runWithFakeTimers(
      createDeployment(sdk, wallet, inputs, { fetch, logger: mock<Logger>(), generateToken })
    );

    expect(sdk.akash.market.v1beta5.getLeases).toHaveBeenCalledWith({
      filters: {
        owner: ownerAddress,
        dseq: "12345",
        gseq: 1,
        oseq: 1,
        provider: providerAddress,
        state: "active",
        bseq: 0,
      },
    });
  });

  it("sends manifest to provider", async () => {
    const { sdk, wallet, inputs, fetch, generateToken } = await setup();

    vi.useFakeTimers();
    await runWithFakeTimers(
      createDeployment(sdk, wallet, inputs, { fetch, logger: mock<Logger>(), generateToken })
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/deployment/12345/manifest"),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      })
    );
  });

  it("gets lease status after manifest submission", async () => {
    const { sdk, wallet, inputs, fetch, generateToken } = await setup();

    vi.useFakeTimers();
    await runWithFakeTimers(
      createDeployment(sdk, wallet, inputs, { fetch, logger: mock<Logger>(), generateToken })
    );

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/lease/12345/1/1/status"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      })
    );
  });

  it("uses custom denom from inputs", async () => {
    const { sdk, wallet, inputs, fetch, generateToken } = await setup({
      inputOverrides: { denom: "uusd", deposit: "1000000" },
    });

    vi.useFakeTimers();
    await runWithFakeTimers(
      createDeployment(sdk, wallet, inputs, { fetch, logger: mock<Logger>(), generateToken })
    );

    expect(sdk.akash.deployment.v1beta4.createDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        deposit: expect.objectContaining({
          amount: {
            denom: "uusd",
            amount: "1000000",
          },
        }),
      }),
      expect.any(Object)
    );
  });

  async function setup(input?: {
    inputOverrides?: Partial<ActionInputs>;
    getBidsError?: Error;
  }) {
    const sdk = mockDeep<ChainSDK>();
    const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix: "akash" });
    const [account] = await wallet.getAccounts();
    const ownerAddress = account.address;
    const providerAddress = "akash1provider0000000000000000000000000000";

    // Mock fetch returns LeaseStatus structure for getLeaseStatus calls
    const leaseStatusResponse = {
      services: {
        web: { name: "web", available: 1, total: 1, uris: ["http://test.example.com"] }
      }
    };
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(leaseStatusResponse), { status: 200 })
    );
    const generateToken = vi.fn().mockResolvedValue("mock-jwt-token");

    const mockBid: JsonResponse<Bid> = {
      id: {
        owner: ownerAddress,
        dseq: "12345",
        gseq: 1,
        oseq: 1,
        provider: providerAddress,
        bseq: 0,
      },
      state: "open" as unknown as JsonResponse<Bid>["state"],
      price: {
        denom: "uakt",
        amount: "1000",
      },
      createdAt: "100",
      resourcesOffer: [],
    };

    sdk.cosmos.base.tendermint.v1beta1.getLatestBlock.mockResolvedValue({
      block: {
        header: {
          height: "12345",
        },
      },
    } as any);

    sdk.akash.deployment.v1beta4.createDeployment.mockResolvedValue(undefined as any);
    sdk.akash.deployment.v1beta4.closeDeployment.mockResolvedValue(undefined as any);

    if (input?.getBidsError) {
      sdk.akash.market.v1beta5.getBids.mockRejectedValue(input.getBidsError);
    } else {
      sdk.akash.market.v1beta5.getBids.mockResolvedValue({
        bids: [{ bid: mockBid }],
        pagination: undefined,
      } as any);
    }

    sdk.akash.market.v1beta5.createLease.mockResolvedValue(undefined as any);

    sdk.akash.market.v1beta5.getLeases.mockResolvedValue({
      leases: [
        {
          lease: {
            id: {
              owner: ownerAddress,
              dseq: "12345",
              gseq: 1,
              oseq: 1,
              provider: providerAddress,
            },
            state: "active",
            price: {
              amount: "1000",
              denom: "uakt",
            },
          },
        },
      ],
    } as any);

    sdk.akash.provider.v1beta4.getProvider.mockResolvedValue({
      provider: {
        owner: providerAddress,
        hostUri: "https://provider.test",
      },
    } as any);

    const inputs: ActionInputs = {
      mnemonic: wallet.mnemonic,
      selectBid: (bids) => bids[0],
      sdl: `
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
`,
      gas: "auto",
      gasMultiplier: "1.5",
      fee: "",
      denom: "uakt",
      deposit: "500000",
      queryRestUrl: "https://rpc.test/rest",
      txRpcUrl: "https://rpc.test/rpc",
      leaseTimeout: 30,
      ...input?.inputOverrides,
    };

    return { sdk, wallet, inputs, fetch, mockBid, generateToken, ownerAddress, providerAddress };
  }
});

describe(updateDeploymentManifest.name, () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls updateDeployment on-chain with new manifest hash", async () => {
    const { sdk, wallet, inputs, fetch, generateToken, existingDeployment } = await setup();

    await updateDeploymentManifest(sdk, wallet, inputs, existingDeployment, { fetch, logger: mock<Logger>(), generateToken });

    expect(sdk.akash.deployment.v1beta4.updateDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: { owner: existingDeployment.lease.id.owner, dseq: existingDeployment.dseq },
      }),
      expect.objectContaining({ memo: "Deployment updated via GitHub Action" })
    );
  });

  it("sends updated manifest to provider", async () => {
    const { sdk, wallet, inputs, fetch, generateToken, existingDeployment } = await setup();

    await updateDeploymentManifest(sdk, wallet, inputs, existingDeployment, { fetch, logger: mock<Logger>(), generateToken });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/deployment/${existingDeployment.dseq}/manifest`),
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("returns isNew: false", async () => {
    const { sdk, wallet, inputs, fetch, generateToken, existingDeployment } = await setup();

    const result = await updateDeploymentManifest(sdk, wallet, inputs, existingDeployment, { fetch, logger: mock<Logger>(), generateToken });

    expect(result.isNew).toBe(false);
  });

  it("returns the existing deployment id and lease", async () => {
    const { sdk, wallet, inputs, fetch, generateToken, existingDeployment } = await setup();

    const result = await updateDeploymentManifest(sdk, wallet, inputs, existingDeployment, { fetch, logger: mock<Logger>(), generateToken });

    expect(result.deploymentId).toEqual({ owner: existingDeployment.lease.id.owner, dseq: existingDeployment.dseq });
    expect(result.lease).toEqual(existingDeployment.lease);
  });

  async function setup() {
    const sdk = mockDeep<ChainSDK>();
    const wallet = await DirectSecp256k1HdWallet.generate(12, { prefix: "akash" });
    const [account] = await wallet.getAccounts();
    const providerAddress = "akash1provider0000000000000000000000000000";

    const existingDeployment: StoredDeploymentDetails = {
      dseq: "99999",
      lease: {
        id: {
          owner: account.address,
          dseq: "99999",
          gseq: 1,
          oseq: 1,
          provider: providerAddress,
        },
      },
    };

    const leaseStatusResponse = {
      services: {
        web: { name: "web", available: 1, total: 1, uris: ["http://test.example.com"] },
      },
    };
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(leaseStatusResponse), { status: 200 })
    );
    const generateToken = vi.fn().mockResolvedValue("mock-jwt-token");

    sdk.akash.deployment.v1beta4.updateDeployment.mockResolvedValue(undefined as any);
    sdk.akash.provider.v1beta4.getProvider.mockResolvedValue({
      provider: { owner: providerAddress, hostUri: "https://provider.test" },
    } as any);

    const inputs: ActionInputs = {
      mnemonic: wallet.mnemonic,
      selectBid: (bids) => bids[0],
      sdl: `
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
`,
      gas: "auto",
      gasMultiplier: "1.5",
      fee: "",
      denom: "uakt",
      deposit: "500000",
      queryRestUrl: "https://rpc.test/rest",
      txRpcUrl: "https://rpc.test/rpc",
      leaseTimeout: 30,
    };

    return { sdk, wallet, inputs, fetch, generateToken, existingDeployment, providerAddress };
  }
});

describe(getExistingDeploymentDetails.name, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "akash-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const validDetails: StoredDeploymentDetails = {
    dseq: "12345",
    lease: {
      id: {
        owner: "akash1owner",
        dseq: "12345",
        gseq: 1,
        oseq: 1,
        provider: "akash1provider",
      },
    },
  };

  it("returns null when path is undefined", () => {
    expect(getExistingDeploymentDetails(undefined)).toBeNull();
  });

  it("returns null when file does not exist", () => {
    expect(getExistingDeploymentDetails(path.join(tmpDir, "nonexistent.json"))).toBeNull();
  });

  it("returns parsed details for a valid file", () => {
    const filePath = path.join(tmpDir, "deployment.json");
    fs.writeFileSync(filePath, JSON.stringify(validDetails));

    expect(getExistingDeploymentDetails(filePath)).toEqual(validDetails);
  });

  it("throws when file contains invalid JSON", () => {
    const filePath = path.join(tmpDir, "deployment.json");
    fs.writeFileSync(filePath, "not-json{{{");

    expect(() => getExistingDeploymentDetails(filePath)).toThrow(/Failed to parse deployment details/);
  });

  it.each([
    ["missing dseq", { ...validDetails, dseq: undefined }],
    ["empty dseq", { ...validDetails, dseq: "" }],
    ["missing lease", { ...validDetails, lease: undefined }],
    ["missing lease.id", { ...validDetails, lease: { ...validDetails.lease, id: undefined } }],
    ["missing lease.id.owner", { ...validDetails, lease: { ...validDetails.lease, id: { ...validDetails.lease.id, owner: "" } } }],
    ["missing lease.id.dseq", { ...validDetails, lease: { ...validDetails.lease, id: { ...validDetails.lease.id, dseq: "" } } }],
    ["lease.id.gseq not a number", { ...validDetails, lease: { ...validDetails.lease, id: { ...validDetails.lease.id, gseq: "1" } } }],
    ["lease.id.oseq not a number", { ...validDetails, lease: { ...validDetails.lease, id: { ...validDetails.lease.id, oseq: "1" } } }],
    ["missing lease.id.provider", { ...validDetails, lease: { ...validDetails.lease, id: { ...validDetails.lease.id, provider: "" } } }],
  ])("throws for invalid shape: %s", (_label, invalid) => {
    const filePath = path.join(tmpDir, "deployment.json");
    fs.writeFileSync(filePath, JSON.stringify(invalid));

    expect(() => getExistingDeploymentDetails(filePath)).toThrow(/Invalid deployment details/);
  });
});
