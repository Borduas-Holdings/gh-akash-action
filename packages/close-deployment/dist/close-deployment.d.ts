import * as core from "@actions/core";
import { generateToken, getLeaseStatus } from "@akashnetwork/actions-utils";
import type { createChainNodeWebSDK } from "@akashnetwork/chain-sdk/web";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import type { ActionInputs } from "./inputs.js";
type ChainSDK = ReturnType<typeof createChainNodeWebSDK>;
export type Logger = Pick<typeof core, "info" | "warning" | "error">;
export interface CloseDeploymentResult {
    dseq: string;
    txHash?: string;
}
export declare function closeDeployment(sdk: ChainSDK, wallet: DirectSecp256k1HdWallet, inputs: ActionInputs, options?: {
    logger?: Logger;
    getLeaseStatus?: typeof getLeaseStatus;
    generateToken?: typeof generateToken;
    getProviderHostUri?: typeof getProviderHostUri;
    assertExpectedOwner?: typeof assertExpectedOwner;
}): Promise<CloseDeploymentResult[]>;
/**
 * Bind a caller-supplied deployment subject to the account that will sign the
 * close transaction. This check deliberately runs before any chain query: a
 * rotated or misconfigured mnemonic must have no observable cleanup effect.
 */
export declare function assertExpectedOwner(expectedOwner: string | undefined, signerOwner: string): void;
declare function getProviderHostUri(sdk: ChainSDK, providerAddress?: string): Promise<string>;
export {};
//# sourceMappingURL=close-deployment.d.ts.map