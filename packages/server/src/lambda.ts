import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { streamHandle } from 'hono/aws-lambda';
import { createApp } from './http/app.js';
import { configFromEnv, depsFromEnv, loadCases, loadViews } from './prod.js';

const env = process.env;

// The public URL is published to SSM by the stack (a function cannot reference its own URL),
// so it is read once per cold start.
const origin = (
  env.PUBLIC_ORIGIN ??
  (await new SSMClient({}).send(new GetParameterCommand({ Name: env.PUBLIC_ORIGIN_PARAM ?? '/alibi/public-origin' }))).Parameter!.Value!
).replace(/\/$/, '');

const cases = loadCases(env.CASES_DIR ?? './cases');
const views = loadViews(env.VIEWS_DIR ?? './views');
const app = createApp(depsFromEnv(env, origin, cases, views), configFromEnv(env, origin));

export const handler: ReturnType<typeof streamHandle> = streamHandle(app);
