export type ZoneId =
  | 'files'
  | 'terminal'
  | 'search'
  | 'web'
  | 'thinking'
  | 'messaging'
  | 'tasks'
  | 'idle'
  | 'spawn';

export interface ZoneConfig {
  id: ZoneId;
  label: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  icon: string;
  /** Grid column start (0-based, 12-column grid) */
  colStart: number;
  /** Grid column span */
  colSpan: number;
  /** Grid row index (0-based) */
  rowStart: number;
  /** Grid row span */
  rowSpan: number;
}
