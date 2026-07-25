import { type UpdateCheckResult } from './update-check.js';
export type DoctorStatus = 'ok' | 'warn' | 'fail';
export interface DoctorCheck {
    label: string;
    status: DoctorStatus;
    detail: string;
    hint?: string;
}
export interface DoctorReport {
    checks: DoctorCheck[];
}
export declare function isSupportedRuntimeNode(version: string): boolean;
export declare function collectDoctorReport(opts?: {
    lookbackDays?: number;
    checkUpdate?: boolean | (() => Promise<UpdateCheckResult>);
}): Promise<DoctorReport>;
export declare function formatDoctorReport(report: DoctorReport): string;
