import { App } from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { CasegenStack } from '../lib/casegen-stack.js';

const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' };

new AuthStack(app, 'AlibiAuth', {
  env,
  domainPrefix: 'alibi-casefile',
  alexaCallbackUrls: [
    'https://pitangui.amazon.com/api/skill/link/ALIBI',
    'https://layla.amazon.com/api/skill/link/ALIBI',
    'https://alexa.amazon.co.jp/api/skill/link/ALIBI',
  ],
  simulatorCallbackUrls: ['http://localhost:5173/callback'],
});

new CasegenStack(app, 'AlibiCasegen', { env });
