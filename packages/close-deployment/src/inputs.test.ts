import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@actions/core";
import { load as parseYaml } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getInputs } from "./inputs.js";

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
}));

const getInput = vi.mocked(core.getInput);

describe(getInputs.name, () => {
  const mutantFiles: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    const values: Record<string, string> = {
      mnemonic: "test mnemonic",
      "expected-owner": "akash1expectedowner",
      filter: 'dseq: "12345"',
      "rest-url": "https://rpc.test/rest",
      "tx-rpc-url": "https://rpc.test/rpc",
    };
    getInput.mockImplementation(name => values[name] ?? "");
  });

  afterEach(() => {
    for (const file of mutantFiles.splice(0)) rmSync(file, { force: true });
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
      if (name === "filter") return 'owner: akash1ignored\ndseq: "12345"';
      if (name === "rest-url") return "https://rpc.test/rest";
      if (name === "tx-rpc-url") return "https://rpc.test/rpc";
      return "";
    });

    await expect(getInputs()).rejects.toThrow(/must be passed through the "expected-owner" input/);
  });

  it.each(["01", "1.0", "1e3", "9007199254740993"])(
    "rejects an unquoted or noncanonical DSEQ scalar %s before endpoint resolution",
    async dseq => {
      getInput.mockImplementation(name => {
        if (name === "mnemonic") return "test mnemonic";
        if (name === "expected-owner") return "akash1expectedowner";
        if (name === "filter") return `dseq: ${dseq}`;
        return "";
      });

      await expect(getInputs()).rejects.toThrow(/quoted canonical decimal string/);
    }
  );

  it.each(['"01"', '"1.0"', '"1e3"', '"0"', '"-1"'])(
    "rejects a quoted noncanonical DSEQ scalar %s",
    async dseq => {
      getInput.mockImplementation(name => {
        if (name === "mnemonic") return "test mnemonic";
        if (name === "filter") return `dseq: ${dseq}`;
        return "";
      });

      await expect(getInputs()).rejects.toThrow(/positive canonical decimal/);
    }
  );

  it("preserves an exact quoted uint64 DSEQ above the safe-integer range", async () => {
    getInput.mockImplementation(name => {
      if (name === "mnemonic") return "test mnemonic";
      if (name === "filter") return 'dseq: "9007199254740993"';
      if (name === "rest-url") return "https://rpc.test/rest";
      if (name === "tx-rpc-url") return "https://rpc.test/rpc";
      return "";
    });

    const inputs = await getInputs();
    expect(inputs.deploymentFilter.dseq).toBe("9007199254740993");
  });

  it("rejects a quoted DSEQ above uint64", async () => {
    getInput.mockImplementation(name => {
      if (name === "mnemonic") return "test mnemonic";
      if (name === "filter") return 'dseq: "18446744073709551616"';
      return "";
    });

    await expect(getInputs()).rejects.toThrow(/exceeds uint64/);
  });

  it("executes the one scalar-type mutant and observes normalization", async () => {
    const source = readFileSync(resolve(process.cwd(), "src/inputs.ts"), "utf-8");
    const target = [
      '    if (typeof filter.dseq !== "string") {',
      '      throw new Error(`"dseq" filter must be a quoted canonical decimal string`);',
      "    }",
    ].join("\n");
    expect(source.split(target).length - 1).toBe(1);
    const mutantPath = resolve(process.cwd(), `src/.inputs-dseq-mutant-${process.pid}.ts`);
    mutantFiles.push(mutantPath);
    writeFileSync(mutantPath, source.replace(target, "    // scalar type check deleted"), "utf-8");
    getInput.mockImplementation(name => {
      if (name === "mnemonic") return "test mnemonic";
      if (name === "filter") return "dseq: 01";
      return "";
    });

    const mutant = await import(/* @vite-ignore */ mutantPath);
    const inputs = await mutant.getInputs({ resolveEndpoints: false });
    expect(inputs.deploymentFilter.dseq).toBe(1);
  });
});
