/**
 * Tool names as a person reads them.
 *
 * An MCP tool is announced as `mcp__server__tool`. Shown raw it stretches the
 * permission card, squeezes the text into a one-word column and adds a
 * horizontal scrollbar; it also tells the human nothing.
 */
export function friendlyTool(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!mcp) return name;
  const server = mcp[1].split('_').filter(Boolean)[0] ?? mcp[1];
  return `${mcp[2].replace(/_/g, ' ')} (${server})`;
}
