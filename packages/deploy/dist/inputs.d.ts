import type { Bid } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
export interface ActionInputs {
    mnemonic: string;
    selectBid: (bids: JsonResponse<Bid>[]) => JsonResponse<Bid> | undefined;
    sdl: string;
    gas: string;
    gasMultiplier: string;
    fee: string;
    denom: string;
    deposit: string;
    queryRestUrl: string;
    txRpcUrl: string;
    leaseTimeout: number;
    deploymentDetailsPath?: string;
}
export declare function getInputs(): Promise<ActionInputs>;
export type JsonResponse<T> = {
    [K in keyof T]: T[K] extends import('long') | Uint8Array | Buffer | ArrayBuffer ? string : Exclude<T[K], undefined> extends any[] ? JsonResponse<Exclude<T[K], undefined>[number]>[] : Exclude<T[K], undefined> extends Record<string, any> ? JsonResponse<Exclude<T[K], undefined>> : T[K];
};
//# sourceMappingURL=inputs.d.ts.map