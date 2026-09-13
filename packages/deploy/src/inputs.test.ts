import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@actions/core";
import { load as parseYaml } from "js-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInputs } from "./inputs.js";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  info: vi.fn(),
}));

const getInput = vi.mocked(core.getInput);

describe(getInputs.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values: Record<string, string> = {
      mnemonic: "test mnemonic",
      sdl: "version: '2.0'",
      "rest-url": "https://query.test",
      "tx-rpc-url": "https://tx.test",
      "deployment-receipt-path": "/tmp/exact-deployment-receipt.json",
    };
    getInput.mockImplementation(name => values[name] ?? "");
  });

  it("carries the receipt path from action input to the create entry point", async () => {
    const inputs = await getInputs();

    expect(inputs.deploymentReceiptPath).toBe("/tmp/exact-deployment-receipt.json");
  });

  it("declares the receipt input and failure-path outputs in action metadata", () => {
    const action = parseYaml(readFileSync(resolve(process.cwd(), "action.yml"), "utf8")) as {
      inputs?: Record<string, { required?: boolean }>;
      outputs?: Record<string, unknown>;
    };

    expect(action.inputs?.["deployment-receipt-path"]).toEqual(expect.objectContaining({ required: false }));
    expect(action.outputs).toEqual(
      expect.objectContaining({
        "deployment-owner": expect.any(Object),
        "deployment-id": expect.any(Object),
        dseq: expect.any(Object),
        "deployment-receipt-path": expect.any(Object),
      })
    );
  });
});
