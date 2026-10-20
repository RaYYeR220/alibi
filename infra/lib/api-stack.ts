import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CasegenPipeline } from './casegen-pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(here, '..', '..', 'packages', 'server', 'dist-lambda');

export interface ApiStackProps extends StackProps {
  table: dynamodb.ITable;
  issuerUrl: string;
  cognitoDomain: string;
  clientIds: string[];
  corsOrigins: string[];
  demoMode: boolean;
}

/**
 * One Lambda serves MCP (both eras), the UCP checkout API, the well-known
 * documents and case assets; it is kept warm so every tool call stays well
 * inside the Alexa+ 500 ms budget.
 */
export class ApiStack extends Stack {
  readonly publicOrigin: string;
  readonly assets: s3.Bucket;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Case art and voice clips, stored under assets/ and served by the API at /assets/*.
    this.assets = new s3.Bucket(this, 'Assets', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Custom-case generation (Step Functions over the stage worker) shares the table and bucket.
    const casegen = new CasegenPipeline(this, 'Casegen', { table: props.table, bucket: this.assets });

    const code = lambda.Code.fromAsset(bundle);
    const LAB_GROUP = 'alibi-labs';
    const ORIGIN_PARAM = '/alibi/public-origin';

    const lab = new lambda.Function(this, 'LabReady', {
      functionName: 'alibi-lab-ready',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'lab.handler',
      code,
      memorySize: 512,
      timeout: Duration.seconds(15),
      environment: { TABLE: props.table.tableName, CASES_DIR: './cases' },
    });
    props.table.grantReadWriteData(lab);

    new scheduler.CfnScheduleGroup(this, 'LabGroup', { name: LAB_GROUP });
    const schedulerRole = new iam.Role(this, 'SchedulerRole', { assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com') });
    lab.grantInvoke(schedulerRole);

    const api = new lambda.Function(this, 'Api', {
      functionName: 'alibi-api',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      environment: {
        TABLE: props.table.tableName,
        ISSUER: props.issuerUrl,
        COGNITO_DOMAIN: props.cognitoDomain,
        CLIENT_IDS: props.clientIds.join(','),
        CORS_ORIGINS: props.corsOrigins.join(','),
        LAB_SCHEDULE_GROUP: LAB_GROUP,
        LAB_TARGET_ARN: lab.functionArn,
        LAB_SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
        PUBLIC_ORIGIN_PARAM: ORIGIN_PARAM,
        DEMO_MODE: props.demoMode ? '1' : '0',
        CASES_DIR: './cases',
        VIEWS_DIR: './views',
        ASSETS_BUCKET: this.assets.bucketName,
        ASSETS_PREFIX: 'assets/',
        STATE_MACHINE_ARN: casegen.stateMachine.stateMachineArn,
      },
    });
    props.table.grantReadWriteData(api);
    // By name, not by reference: the parameter holds the CloudFront domain, which depends on this function.
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${ORIGIN_PARAM}`],
      }),
    );
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['scheduler:CreateSchedule'],
        resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/${LAB_GROUP}/*`],
      }),
    );
    schedulerRole.grantPassRole(api.role!);
    casegen.grantStart(api);

    // Provisioned concurrency is not available on this account (concurrency limit 10), so a
    // warmer below keeps an instance hot instead.
    const live = api.addAlias('live');
    const url = live.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE, invokeMode: lambda.InvokeMode.RESPONSE_STREAM });

    // CloudFront is unavailable on this account until AWS verifies it, so the Function URL is the
    // public origin; it serves /assets/* from the private bucket itself.
    this.publicOrigin = Fn.join('', ['https://', Fn.select(2, Fn.split('/', url.url))]);
    this.assets.grantRead(api);
    new ssm.StringParameter(this, 'PublicOrigin', { parameterName: ORIGIN_PARAM, stringValue: this.publicOrigin });

    const warmer = new lambda.Function(this, 'Warmer', {
      functionName: 'alibi-warmer',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      timeout: Duration.seconds(10),
      code: lambda.Code.fromInline(
        "exports.handler = async () => { const r = await fetch(process.env.URL); return { status: r.status }; };",
      ),
      environment: { URL: `${this.publicOrigin}/healthz` },
    });
    new events.Rule(this, 'Warm', { schedule: events.Schedule.rate(Duration.minutes(4)), targets: [new targets.LambdaFunction(warmer)] });

    new CfnOutput(this, 'ApiUrl', { value: this.publicOrigin });
    new CfnOutput(this, 'McpUrl', { value: `${this.publicOrigin}/mcp` });
    new CfnOutput(this, 'FunctionUrl', { value: url.url });
    new CfnOutput(this, 'AssetsBucket', { value: this.assets.bucketName });
  }
}
