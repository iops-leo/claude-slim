import type { ScanResult, ManifestEntry } from './types.js';
export interface BreakdownRow {
    label: string;
    before: string;
    after: string;
    saved: string;
}
export interface ReportData {
    before: number;
    after: number;
    saved: number;
    percent: number;
    topOffenders: Array<{
        name: string;
        tokens: number;
    }>;
    monthlySavings: number;
    sessionsPerDay: number;
    breakdown: BreakdownRow[];
}
export declare function calculateReport(scanBefore: ScanResult, scanAfter: ScanResult, movedEntries: ManifestEntry[], sessionsPerDay?: number): ReportData;
export declare function formatReportBox(data: ReportData): string;
export declare function formatScanSummary(result: ScanResult): string;
