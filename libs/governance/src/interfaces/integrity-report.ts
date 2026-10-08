export interface IntegrityReport {
  valid: boolean;
  checked: number;
  brokenAtSequence: number | null;
}
