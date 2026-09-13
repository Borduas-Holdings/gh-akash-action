import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEPLOYMENT_RECEIPT_SCHEMA,
  publishDeploymentReceipt,
} from "./receipt.js";

describe(publishDeploymentReceipt.name, () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes one atomic receipt and all exact cleanup outputs", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "akash-receipt-"));
    directories.push(directory);
    const receiptPath = path.join(directory, "nested", "receipt.json");
    const outputs = new Map<string, string>();

    const receipt = publishDeploymentReceipt(
      { owner: "akash1owner123", dseq: "12345" },
      receiptPath,
      (name, value) => outputs.set(name, value),
    );

    expect(receipt).toEqual({
      schema: DEPLOYMENT_RECEIPT_SCHEMA,
      owner: "akash1owner123",
      dseq: "12345",
    });
    expect(JSON.parse(fs.readFileSync(receiptPath, "utf-8"))).toEqual(receipt);
    expect(outputs).toEqual(
      new Map([
        ["deployment-owner", "akash1owner123"],
        ["deployment-id", "akash1owner123/12345"],
        ["dseq", "12345"],
        ["deployment-receipt-path", path.resolve(receiptPath)],
      ]),
    );
    expect(fs.readdirSync(path.dirname(receiptPath))).toEqual(["receipt.json"]);
  });

  it.each([
    [{ owner: "", dseq: "12345" }, "owner"],
    [{ owner: "not-akash", dseq: "12345" }, "owner"],
    [{ owner: "akash1owner123", dseq: "0" }, "dseq"],
    [{ owner: "akash1owner123", dseq: "01" }, "dseq"],
  ])("refuses a malformed cleanup subject %#", (deploymentId, field) => {
    const setOutput = vi.fn();
    expect(() =>
      publishDeploymentReceipt(deploymentId, undefined, setOutput),
    ).toThrow(field);
    expect(setOutput).not.toHaveBeenCalled();
  });

  it("retains the atomic receipt and attempts every output when the output carrier fails", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "akash-receipt-output-failure-"),
    );
    directories.push(directory);
    const receiptPath = path.join(directory, "receipt.json");
    const attempted: string[] = [];
    const setOutput = vi.fn((name: string) => {
      attempted.push(name);
      if (name === "deployment-owner")
        throw new Error("github output unavailable");
    });

    expect(() =>
      publishDeploymentReceipt(
        { owner: "akash1owner123", dseq: "12345" },
        receiptPath,
        setOutput,
      ),
    ).toThrow("publication was incomplete");

    expect(JSON.parse(fs.readFileSync(receiptPath, "utf-8"))).toEqual({
      schema: DEPLOYMENT_RECEIPT_SCHEMA,
      owner: "akash1owner123",
      dseq: "12345",
    });
    expect(attempted).toEqual([
      "deployment-owner",
      "deployment-id",
      "dseq",
      "deployment-receipt-path",
    ]);
  });

  it("publishes the complete output tuple when the atomic file carrier fails", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "akash-receipt-file-failure-"),
    );
    directories.push(directory);
    const outputs = new Map<string, string>();

    expect(() =>
      publishDeploymentReceipt(
        { owner: "akash1owner123", dseq: "12345" },
        directory,
        (name, value) => outputs.set(name, value),
      ),
    ).toThrow("publication was incomplete");

    expect(outputs).toEqual(
      new Map([
        ["deployment-owner", "akash1owner123"],
        ["deployment-id", "akash1owner123/12345"],
        ["dseq", "12345"],
      ]),
    );
  });
});
