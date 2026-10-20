import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, Fn, Stack, type StackProps } from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(here, '..', '..', 'packages', 'simulator', 'dist-lambda');

export interface SimStackProps extends StackProps {
  table: dynamodb.ITable;
  userPool: cognito.IUserPool;
  cognitoDomain: string;
  serviceClientId: string;
  simulatorClientId: string;
  /** Venice spend cap per UTC day for the public simulator. */
  dailyCapUsd: number;
}

/**
 * The public web simulator. One function behind two Function URLs: "live"
 * serves the site and its API (LLM proxy, speech, demo households, guest
 * token), "sandbox" serves only the MCP Apps sandbox proxy, giving it an
 * origin of its own as the MCP Apps spec requires for web hosts.
 */
export class SimStack extends Stack {
  constructor(scope: Construct, id: string, props: SimStackProps) {
    super(scope, id, props);

    const WORKLOAD = 'alibi-simulator';
    const params = { api: '/alibi/public-origin', sim: '/alibi/sim/origin', sandbox: '/alibi/sim/sandbox-origin' };

    new agentcore.CfnWorkloadIdentity(this, 'Workload', { name: WORKLOAD });

    const fn = new lambda.Function(this, 'Sim', {
      functionName: 'alibi-sim',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(bundle),
      memorySize: 1024,
      timeout: Duration.seconds(30),
      environment: {
        TABLE: props.table.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_DOMAIN: props.cognitoDomain,
        SERVICE_CLIENT_ID: props.serviceClientId,
        SIM_CLIENT_ID: props.simulatorClientId,
        VENICE_WORKLOAD: WORKLOAD,
        VENICE_PROVIDER: 'venice',
        DAILY_CAP_USD: String(props.dailyCapUsd),
        HOST_VOICE: 'Brian',
        API_ORIGIN_PARAM: params.api,
        SIM_ORIGIN_PARAM: params.sim,
        SANDBOX_ORIGIN_PARAM: params.sandbox,
      },
    });

    props.table.grantReadWriteData(fn);
    fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword', 'cognito-idp:DescribeUserPoolClient'],
        resources: [props.userPool.userPoolArn],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:GetWorkloadAccessToken', 'bedrock-agentcore:GetResourceApiKey'],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default/workload-identity/${WORKLOAD}`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/apikeycredentialprovider/venice`,
        ],
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/apikey/venice-*`],
      }),
    );
    // By name: the values are this stack's own URLs (and the API's), which the function cannot reference directly.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameters', 'ssm:GetParameter'],
        resources: Object.values(params).map((p) => `arn:aws:ssm:${this.region}:${this.account}:parameter${p}`),
      }),
    );

    const live = new lambda.Alias(this, 'Live', { aliasName: 'live', version: fn.currentVersion });
    const sandbox = new lambda.Alias(this, 'Sandbox', { aliasName: 'sandbox', version: fn.currentVersion });
    const liveUrl = live.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE, invokeMode: lambda.InvokeMode.BUFFERED });
    const sandboxUrl = sandbox.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE, invokeMode: lambda.InvokeMode.BUFFERED });

    const origin = (u: lambda.FunctionUrl) => Fn.join('', ['https://', Fn.select(2, Fn.split('/', u.url))]);
    new ssm.StringParameter(this, 'SimOrigin', { parameterName: params.sim, stringValue: origin(liveUrl) });
    new ssm.StringParameter(this, 'SandboxOrigin', { parameterName: params.sandbox, stringValue: origin(sandboxUrl) });

    // Keeps one instance warm so the first page load does not wait for a cold start.
    new events.Rule(this, 'Warm', {
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [new targets.LambdaFunction(live, { event: events.RuleTargetInput.fromObject({ warm: true }) })],
    });

    new CfnOutput(this, 'SimulatorUrl', { value: liveUrl.url });
    new CfnOutput(this, 'SandboxUrl', { value: sandboxUrl.url });
  }
}
