/**
 * Fetches a tier-1 (client credentials) token the way Alexa+ does — HTTP Basic,
 * `resource` parameter, `mcp:service` scope — and prints the claims that the
 * MCP server's verifier relies on.
 *
 * usage: tsx scripts/token-check.ts <cognitoDomain> <clientId> <clientSecret> <resourceUrl>
 */
const [domain, clientId, clientSecret, resource] = process.argv.slice(2);
if (!domain || !clientId || !clientSecret || !resource) {
  console.error('usage: token-check <cognitoDomain> <clientId> <clientSecret> <resourceUrl>');
  process.exit(2);
}

async function requestToken(withResource: boolean) {
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: 'alibi/mcp:service' });
  if (withResource) body.set('resource', resource!);
  const res = await fetch(`${domain}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

for (const withResource of [true, false]) {
  const { status, json } = await requestToken(withResource);
  const label = withResource ? 'with resource' : 'without resource';
  if (status !== 200) {
    console.log(`${label}: HTTP ${status} ${JSON.stringify(json)}`);
    continue;
  }
  const claims = JSON.parse(Buffer.from(String(json.access_token).split('.')[1]!, 'base64url').toString());
  console.log(`${label}: HTTP 200 scope=${claims.scope} aud=${claims.aud ?? '-'} client_id=${claims.client_id} exp_in=${claims.exp - Math.floor(Date.now() / 1000)}s`);
}
