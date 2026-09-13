import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEPLOYMENT_RECEIPT_SCHEMA, publishDeploymentReceipt } from "./receipt.js";

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
    expect(outputs).toEqual(new Map([
      ["deployment-owner", "akash1owner123"],
      ["deployment-id", "akash1owner123/12345"],
      ["dseq", "12345"],
      ["deployment-receipt-path", path.resolve(receiptPath)],
    ]));
    expect(fs.readdirSync(path.dirname(receiptPath))).toEqual(["receipt.json"]);
  });

  it.each([
    [{ owner: "", dseq: "12345" }, "owner"],
    [{ owner: "not-akash", dseq: "12345" }, "owner"],
    [{ owner: "akash1owner123", dseq: "0" }, "dseq"],
    [{ owner: "akash1owner123", dseq: "01" }, "dseq"],
  ])("refuses a malformed cleanup subject %#", (deploymentId, field) => {
    const setOutput = vi.fn();
    expect(() => publishDeploymentReceipt(deploymentId, undefined, setOutput)).toThrow(field);
    expect(setOutput).not.toHaveBeenCalled();
  });
});
