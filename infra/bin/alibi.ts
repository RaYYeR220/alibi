import { App } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { CasegenStack } from '../lib/casegen-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { SimStack } from '../lib/sim-stack.js';

const app = new App();

/** The public web simulator (AlibiSim's Function URL). */
const SIMULATOR_ORIGIN = 'https://hpvy2ltkeeas5m5n3lygwqnuki0lsylt.lambda-url.us-east-1.on.aws';
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' };

const auth = new AuthStack(app, 'AlibiAuth', {
  env,
  domainPrefix: 'alibi-casefile',
  alexaCallbackUrls: [
    'https://pitangui.amazon.com/api/skill/link/ALIBI',
    'https://layla.amazon.com/api/skill/link/ALIBI',
    'https://alexa.amazon.co.jp/api/skill/link/ALIBI',
  ],
  simulatorCallbackUrls: ['http://localhost:5173/callback', `${SIMULATOR_ORIGIN}/callback`],
});

new CasegenStack(app, 'AlibiCasegen', { env });

const data = new DataStack(app, 'AlibiData', { env });

new ApiStack(app, 'AlibiApi', {
  env,
  table: data.table,
  issuerUrl: auth.issuerUrl,
  cognitoDomain: auth.cognitoDomain,
  clientIds: auth.clientIds,
  corsOrigins: ['http://localhost:5173', SIMULATOR_ORIGIN],
  demoMode: true,
});

new SimStack(app, 'AlibiSim', {
  env,
  table: data.table,
  userPool: auth.userPool,
  cognitoDomain: auth.cognitoDomain,
  serviceClientId: auth.clientIds[0]!,
  simulatorClientId: auth.clientIds[2]!,
  dailyCapUsd: Number(process.env.SIM_DAILY_CAP_USD ?? 10),
});
