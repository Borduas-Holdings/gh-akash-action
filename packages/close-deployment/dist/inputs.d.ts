import type { LeaseStatus } from "@akashnetwork/actions-utils";
export interface DeploymentContext {
    dseq: string;
    state: 'invalid' | "active" | "insufficient_funds" | "closed";
    status: LeaseStatus;
    provider: string;
    createdAt: string;
    closedOn?: string;
    closedReason?: 'lease_closed_invalid' | "lease_closed_owner" | "lease_closed_unstable" | "lease_closed_decommission" | "lease_closed_unspecified" | "lease_closed_manifest_timeout" | "lease_closed_insufficient_funds";
}
export interface ActionInputs {
    mnemonic: string;
    deploymentFilter: {
        dseq?: string;
        state?: string;
    };
    leaseFilter?: (lease: DeploymentContext) => boolean;
    gas: string;
    gasMultiplier: string;
    fee: string;
    denom: string;
    queryRestUrl: string;
    txRpcUrl: string;
}
export declare function getInputs(): Promise<ActionInputs>;
//# sourceMappingURL=inputs.d.ts.map