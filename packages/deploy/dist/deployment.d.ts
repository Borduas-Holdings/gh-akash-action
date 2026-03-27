import * as core from "@actions/core";
import { type DeploymentID } from "@akashnetwork/chain-sdk/private-types/akash.v1";
import { Bid } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import { createChainNodeWebSDK, type QueryInput } from "@akashnetwork/chain-sdk/web";
import { generateToken } from "@akashnetwork/actions-utils";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import type { ActionInputs, JsonResponse } from "./inputs.js";
type ChainSDK = ReturnType<typeof createChainNodeWebSDK>;
export type Logger = Pick<typeof core, "info" | "warning" | "error">;
export interface StoredDeploymentDetails {
    dseq: string;
    lease: {
        id: {
            owner: string;
            dseq: string;
            gseq: number;
            oseq: number;
            provider: string;
        };
    };
}
export interface DeploymentResult {
    deploymentId: {
        owner: string;
        dseq: string;
    };
    isNew: boolean;
    lease?: {
        id: {
            owner: string;
            dseq: string;
            gseq: number;
            oseq: number;
            provider: string;
        };
        state: string;
        price: {
            amount: string;
            denom: string;
        };
    };
}
export declare function createDeployment(sdk: ChainSDK, wallet: DirectSecp256k1HdWallet, inputs: ActionInputs, options?: {
    fetch?: typeof globalThis.fetch;
    logger?: Logger;
    generateToken?: typeof generateToken;
}): Promise<DeploymentResult>;
export declare function updateDeploymentManifest(sdk: ChainSDK, wallet: DirectSecp256k1HdWallet, inputs: ActionInputs, existingDeployment: StoredDeploymentDetails, options?: {
    fetch?: typeof globalThis.fetch;
    logger?: Logger;
    generateToken?: typeof generateToken;
}): Promise<DeploymentResult>;
export declare function waitForBid(sdk: ChainSDK, deploymentId: QueryInput<DeploymentID>, timeoutSeconds: number, findMatchingBid: ActionInputs['selectBid'], logger: Logger): Promise<JsonResponse<Bid>>;
export declare function getExistingDeploymentDetails(deploymentDetailsPath: string | undefined | null): StoredDeploymentDetails | null;
export {};
//# sourceMappingURL=deployment.d.ts.map