import type { ScanResult } from '../types.js';
export interface ScanOptions {
    lookbackDays?: number;
}
export declare function scan(opts?: ScanOptions): Promise<ScanResult>;
