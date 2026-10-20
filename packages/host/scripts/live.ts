/**
 * Plays a few spoken turns against a deployed endpoint with a real model.
 *   VENICE_API_KEY=... SERVICE_TOKEN=... tsx scripts/live.ts https://<origin>/mcp "turn one" "turn two"
 */
import { createHost, createVeniceClient, connectMcp } from '../src/index.js';

const [url, ...turns] = process.argv.slice(2);
const mcp = await connectMcp({ url: url!, getToken: async () => process.env.SERVICE_TOKEN });
const host = createHost({ llm: createVeniceClient({ apiKey: process.env.VENICE_API_KEY }), mcp, model: process.env.HOST_MODEL ?? 'claude-haiku-5-5' });
for (const t of turns) {
  const t0 = performance.now();
  const r = await host.turn(t);
  console.log(`\n> ${t}\n< ${r.speech}\n  tools: ${r.toolCalls.map((c) => `${c.name}(${c.ms}ms ${c.status})`).join(', ') || '-'}  ui: ${r.ui.map((u) => u.resourceUri).join(', ') || '-'}  total ${Math.round(performance.now() - t0)}ms`);
}
await mcp.close();
