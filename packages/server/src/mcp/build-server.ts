import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { registerViews } from '../apps/registry.js';
import type { Deps } from '../deps.js';
import { registerAccuseTool } from '../tools/accuse.js';
import { registerCatalogTools } from '../tools/catalog.js';
import { registerInterrogationTools } from '../tools/interrogate.js';
import { registerInvestigationTools } from '../tools/investigate.js';

export const SERVER_INFO = { name: 'alibi', title: 'Alibi', version: '0.1.0' };

const INSTRUCTIONS = `Alibi is a detective game. The player questions suspects out loud, searches places, shows suspects evidence and finally accuses someone.
When a tool returns a performance brief, speak as that suspect using only the statements it lists; never invent facts, never reveal anything the brief does not contain, and never say which statements might be false.
Keep the game_id from start_case and pass it to every later call. Keep narration short: this is a voice game.`;

/** Builds the per-request MCP server; the caller's verified auth decides which household it acts for. */
export function buildServer(deps: Deps, ctx: { authInfo?: AuthInfo }): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const toolCtx = { deps, authInfo: ctx.authInfo };
  registerViews(server, deps.appHtml);
  registerCatalogTools(server, toolCtx);
  registerInterrogationTools(server, toolCtx);
  registerInvestigationTools(server, toolCtx);
  registerAccuseTool(server, toolCtx);
  return server;
}
