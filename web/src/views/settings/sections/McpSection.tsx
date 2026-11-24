/**
 * MCP 服务器：复用 skills-mcp 流的共享 <McpPanel/>。
 *
 * McpPanel is fully self-contained (fetches mcp.list, subscribes to mcp.updated,
 * wires mcp.add / mcp.remove / mcp.toggle) and ships its own header + styles, so
 * this section is a thin wrapper. Both the Settings console and the Skills view
 * render the same component against the same handlers, staying in sync.
 */
import { McpPanel } from '../../skills/McpPanel';

export function McpSection() {
  return (
    <section className="set-section set-section-mcp" aria-label="MCP 服务器">
      <McpPanel />
    </section>
  );
}
