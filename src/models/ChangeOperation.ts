import { ChangeSource } from './ChangeSource';

export type OperationType =
  | 'accept-change'
  | 'reject-change'
  | 'accept-file'
  | 'reject-file'
  | 'reject-new-file'
  | 'accept-all'
  | 'reject-all';

export interface FileSnapshot {
  fileUri: string;
  baselineBefore: string;
  baselineAfter: string;
  documentBefore: string;
  documentAfter: string;
}

export interface ChangeOperation {
  id: string;
  fileUri: string;
  timestamp: number;
  source: ChangeSource;
  operationType: OperationType;
  transactionType?: 'ACCEPT_CHANGE' | 'REJECT_CHANGE' | 'ACCEPT_FILE' | 'REJECT_FILE' | 'ACCEPT_ALL' | 'REJECT_ALL' | 'UNDO';
  changeIds?: string[];
  affectedRanges: { startLine: number; endLine: number }[];
  fileSnapshots: FileSnapshot[];
  description: string;
}
