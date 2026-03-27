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
}): Promise<CloseDeploymentResult[]>;
declare function getProviderHostUri(sdk: ChainSDK, providerAddress?: string): Promise<string>;
export {};
//# sourceMappingURL=close-deployment.d.ts.map