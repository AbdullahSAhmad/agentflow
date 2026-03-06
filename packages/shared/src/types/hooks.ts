/** Claude Code Hook event names (all 17 types) */
export type HookEventName =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Notification'
  | 'PreCompact'
  | 'TaskCompleted'
  | 'TeammateIdle'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove';

/** Raw hook event payload received from Claude Code via stdin → HTTP POST */
export interface HookEvent {
  hook_event_name: HookEventName;
  session_id: string;
  cwd?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  tool_use_id?: string;
  message?: string;
  title?: string;
  notification_type?: string;
  transcript_path?: string;
  last_assistant_message?: string;
  agent_id?: string;
  agent_type?: string;
  task_id?: string;
  task_subject?: string;
  permission_suggestions?: unknown[];
  terminal_pid?: number;
  shell_pid?: number;
}

/** Decision returned to Claude Code for a PermissionRequest hook */
export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  /** Modified tool input (for AskUserQuestion answers, ExitPlanMode feedback, etc.) */
  updatedInput?: unknown;
  /** New permission rules to add (for "always allow" flows) */
  updatedPermissions?: unknown[];
}

/** JSON response body for a PermissionRequest hook */
export interface PermissionResponse {
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest';
    decision: PermissionDecision;
  };
}

/** A pending permission request waiting for user resolution */
export interface PendingPermission {
  permissionId: string;
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  toolUseId: string;
  permissionSuggestions?: unknown[];
  timestamp: number;
}
