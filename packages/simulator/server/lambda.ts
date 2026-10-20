import { readFileSync } from 'node:fs';
import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { handle } from 'hono/aws-lambda';
import type { LambdaContext, LambdaEvent } from 'hono/aws-lambda';
import { createSimApp } from './app.js';
import { cognitoClientSecret, cognitoVisitors, identityApiKey, pollySpeech, serviceTokens, veniceChat } from './aws.js';
import { configFromEnv } from './config.js';
import { dynamoCounters } from './counters.js';
import { loadSite, sandboxRoutes, siteRoutes } from './site.js';

const env = process.env;

/*
 * One function, two Function URLs: the "live" alias serves the simulator and
 * its API, the "sandbox" alias serves only the MCP Apps sandbox proxy, so the
 * proxy gets an origin of its own. Origins are published to SSM by the stack
 * (a function cannot reference its own URLs) and read once per cold start.
 */
const names = {
  api: env.API_ORIGIN_PARAM ?? '/alibi/public-origin',
  sim: env.SIM_ORIGIN_PARAM ?? '/alibi/sim/origin',
  sandbox: env.SANDBOX_ORIGIN_PARAM ?? '/alibi/sim/sandbox-origin',
};
const params = await new SSMClient({}).send(new GetParametersCommand({ Names: Object.values(names) }));
const param = (name: string) => {
  const v = params.Parameters?.find((p) => p.Name === name)?.Value;
  if (!v) throw new Error(`missing SSM parameter ${name}`);
  return v.replace(/\/$/, '');
};
const apiOrigin = param(names.api);
const simOrigin = param(names.sim);
const sandboxOrigin = param(names.sandbox);

const cognitoDomain = env.COGNITO_DOMAIN!;
const userPoolId = env.USER_POOL_ID!;
const key = identityApiKey({ workload: env.VENICE_WORKLOAD ?? 'alibi-simulator', provider: env.VENICE_PROVIDER ?? 'venice' });

const app = createSimApp({
  counters: dynamoCounters(env.TABLE ?? 'alibi'),
  clock: Date.now,
  config: configFromEnv(env),
  venice: veniceChat({ key }),
  polly: pollySpeech(),
  visitors: cognitoVisitors({ userPoolId }),
  serviceToken: serviceTokens({ cognitoDomain, clientId: env.SERVICE_CLIENT_ID!, secret: cognitoClientSecret({ userPoolId, clientId: env.SERVICE_CLIENT_ID! }) }),
  publicConfig: async () => ({
    mcpUrl: `${apiOrigin}/mcp`,
    ucpBase: `${apiOrigin}/ucp`,
    cognitoDomain,
    clientId: env.SIM_CLIENT_ID!,
    sandboxOrigin,
  }),
  merchant: (path, init) => fetch(`${apiOrigin}/ucp${path}`, init),
  ipOf: (_req, c) => (c.env as { requestContext?: { http?: { sourceIp?: string } } } | undefined)?.requestContext?.http?.sourceIp ?? 'unknown',
});
app.route('/', siteRoutes(loadSite('./web')));

const sandbox = sandboxRoutes(readFileSync('./sandbox.html', 'utf8'), [simOrigin]);

const live = handle(app);
const proxy = handle(sandbox);

export const handler = async (event: LambdaEvent | { warm: true }, context: LambdaContext) => {
  // The scheduled warm-up only needs the cold start above to have happened.
  if ('warm' in event) return { warm: true };
  return context.invokedFunctionArn.endsWith(':sandbox') ? proxy(event, context) : live(event, context);
};
