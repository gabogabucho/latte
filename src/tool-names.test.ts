import { describe, expect, it } from 'vitest';
import { friendlyTool } from './tool-names';

describe('Permission cards name the tool in a readable way', () => {
  it('turns an MCP tool id into something a person can read', () => {
    // Seen in a real session: this exact name stretched the card and pushed the
    // text into a one-word column with a horizontal scrollbar.
    expect(friendlyTool('mcp__plugin_engram_engram__mem_search')).toBe('mem search (plugin)');
    expect(friendlyTool('mcp__notion__create_page')).toBe('create page (notion)');
  });

  it('leaves an ordinary tool name alone', () => {
    expect(friendlyTool('Write')).toBe('Write');
    expect(friendlyTool('Bash')).toBe('Bash');
    expect(friendlyTool('edit')).toBe('edit');
  });
});
