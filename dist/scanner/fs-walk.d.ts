export declare function safeReadFile(p: string): Promise<string | null>;
export declare function safeReaddir(p: string): Promise<string[]>;
export declare function isDirectory(p: string): Promise<boolean>;
export declare function isBrokenSymlink(p: string): Promise<boolean>;
export declare function resolveRealPath(p: string): Promise<string>;
export declare function getDirSize(dir: string): Promise<number>;
export declare function runCommand(file: string, args: string[]): Promise<string>;
