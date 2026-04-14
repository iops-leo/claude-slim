export declare function initTokenizer(): Promise<void>;
export declare function countTokens(text: string): number;
export declare function countTokensCached(text: string, filePath: string): number;
export declare function flushCache(): Promise<void>;
export declare function isUsingFallback(): boolean;
