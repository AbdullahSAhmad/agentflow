export interface ToolTransition {
  from: string;
  to: string;
  count: number;
}

export interface ToolChainData {
  transitions: ToolTransition[];
  tools: string[];
  toolCounts: Record<string, number>;
  /** Hook-sourced: number of successful completions per tool */
  toolSuccesses: Record<string, number>;
  /** Hook-sourced: number of failed completions per tool */
  toolFailures: Record<string, number>;
  /** Hook-sourced: average duration in ms per tool (only for tools with timing data) */
  toolAvgDuration: Record<string, number>;
}
