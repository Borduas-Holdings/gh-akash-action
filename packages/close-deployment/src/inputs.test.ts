import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@actions/core";
import { load as parseYaml } from "js-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getInputs } from "./inputs.js";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
}));

const getInput = vi.mocked(core.getInput);

describe(getInputs.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values: Record<string, string> = {
      mnemonic: "test mnemonic",
      "expected-owner": "akash1expectedowner",
      filter: "dseq: 12345",
      "rest-url": "https://rpc.test/rest",
      "tx-rpc-url": "https://rpc.test/rpc",
    };
    getInput.mockImplementation(name => values[name] ?? "");
  });

  it("carries expected-owner from action input into the close contract", async () => {
    const inputs = await getInputs();

    expect(inputs.expectedOwner).toBe("akash1expectedowner");
  });

  it("declares expected-owner in the published action metadata", () => {
    const actionPath = resolve(process.cwd(), "action.yml");
    const action = parseYaml(readFileSync(actionPath, "utf8")) as {
      inputs?: Record<string, { required?: boolean }>;
    };

    expect(action.inputs?.["expected-owner"]).toEqual(expect.objectContaining({ required: false }));
  });

  it("rejects owner in filter instead of silently discarding its claimed constraint", async () => {
    getInput.mockImplementation(name => {
      if (name === "mnemonic") return "test mnemonic";
      if (name === "filter") return "owner: akash1ignored\ndseq: 12345";
      if (name === "rest-url") return "https://rpc.test/rest";
      if (name === "tx-rpc-url") return "https://rpc.test/rpc";
      return "";
    });

    await expect(getInputs()).rejects.toThrow(/must be passed through the "expected-owner" input/);
  });
});
