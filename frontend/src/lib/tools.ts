/**
 * Single source of truth for tool name → user-facing label.
 */
export const TOOL_LABELS: Record<string, string> = {
  load_skill: "Load skill",
  write_file: "Write file",
  edit_file: "Edit file",
  read_file: "Read file",
  bash: "Run command",
  read_url: "Read webpage",
  read_document: "Read document",
  compact: "Summarize conversation",
  create_task: "Create task",
  update_task: "Update task",
  spawn_subagent: "Spawn sub-agent",
};

export function localizeToolName(tool: string, fallback?: string): string {
  if (tool in TOOL_LABELS) {
    return TOOL_LABELS[tool];
  }
  if (fallback !== undefined) {
    return fallback;
  }
  return tool;
}
