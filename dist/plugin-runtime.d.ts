/** Validates plugin name then shells out to `claude plugin disable <name>`. */
export declare function disablePlugin(name: string): Promise<void>;
/** Validates plugin name then shells out to `claude plugin enable <name>`. */
export declare function enablePlugin(name: string): Promise<void>;
