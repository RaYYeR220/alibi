import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { casegenImage, veniceKeyAccess } from './casegen-stack.js';

export interface CasegenPipelineProps {
  /** The single "alibi" table: job records, custom cases, inbox. */
  table: dynamodb.ITable;
  /** Assets bucket: drafts under casegen/, art and voice clips under assets/. */
  bucket: s3.IBucket;
  /** Public base URL that serves the bucket's assets/ prefix (CloudFront), used for anchor audio URLs. */
  assetBaseUrl?: string;
  /** Random plays the red-team stage runs against each case. */
  redteamRuns?: number;
}

const STAGES = ['moderate', 'plot', 'compile', 'prove', 'anchors', 'redteam', 'art', 'voices', 'publish'] as const;
type StageName = (typeof STAGES)[number];

/**
 * Custom-case generation as a Step Functions Standard workflow. Each state runs
 * one pipeline stage on the stage worker (one container image, op "stage");
 * the draft travels through S3, so states pass only {jobId}. Start an execution
 * with input {"jobId": "..."}; using the job id as the execution name makes a
 * repeated dispatch harmless.
 *
 *   moderate > plot > compile > prove --proven--> anchors > redteam > art > voices > publish
 *                        ^__________| not yet (the prove stage fails the job after 3 attempts)
 *
 * Any error after retries goes to MarkFailed (op "fail"), which marks the job
 * failed and drops a custom_failed item in the household inbox.
 */
export class CasegenPipeline extends Construct {
  readonly worker: lambda.DockerImageFunction;
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: CasegenPipelineProps) {
    super(scope, id);

    this.worker = new lambda.DockerImageFunction(this, 'StageWorker', {
      code: casegenImage(),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      timeout: Duration.minutes(15),
      environment: {
        ALIBI_KEY_SOURCE: 'identity',
        ALIBI_WORKLOAD: 'alibi-casegen',
        ALIBI_TABLE: props.table.tableName,
        ALIBI_BUCKET: props.bucket.bucketName,
        ALIBI_REDTEAM_RUNS: String(props.redteamRuns ?? 500),
        ...(props.assetBaseUrl ? { ALIBI_ASSET_BASE_URL: props.assetBaseUrl } : {}),
      },
    });
    props.table.grantReadWriteData(this.worker);
    props.bucket.grantReadWrite(this.worker);
    const stack = Stack.of(this);
    for (const statement of veniceKeyAccess(stack)) this.worker.addToRolePolicy(statement);
    this.worker.addToRolePolicy(new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }));

    const markFailed = new tasks.LambdaInvoke(this, 'MarkFailed', {
      lambdaFunction: this.worker,
      payload: sfn.TaskInput.fromObject({
        op: 'fail',
        jobId: sfn.JsonPath.stringAt('$.jobId'),
        error: sfn.JsonPath.objectAt('$.error'),
      }),
      payloadResponseOnly: true,
    }).next(new sfn.Fail(this, 'JobFailed', { error: 'JobFailed', causePath: '$.jobId' }));

    const stage = (name: StageName) => {
      const task = new tasks.LambdaInvoke(this, `Stage ${name}`, {
        lambdaFunction: this.worker,
        payload: sfn.TaskInput.fromObject({ op: 'stage', stage: name, jobId: sfn.JsonPath.stringAt('$.jobId') }),
        payloadResponseOnly: true,
        retryOnServiceExceptions: false,
        taskTimeout: sfn.Timeout.duration(Duration.minutes(15)),
      });
      // A JobFailed is a verdict, not a glitch: never retry it.
      task.addRetry({ errors: ['JobFailed'], maxAttempts: 0 });
      task.addRetry({ errors: ['States.ALL'], interval: Duration.seconds(10), backoffRate: 2, maxAttempts: 2 });
      task.addCatch(markFailed, { errors: ['States.ALL'], resultPath: '$.error' });
      return task;
    };

    const compile = stage('compile');
    const finish = stage('anchors')
      .next(stage('redteam'))
      .next(stage('art'))
      .next(stage('voices'))
      .next(stage('publish'))
      .next(new sfn.Succeed(this, 'Published'));
    const proven = new sfn.Choice(this, 'Proven?')
      .when(sfn.Condition.booleanEquals('$.proven', true), finish)
      .otherwise(compile);

    const definition = stage('moderate').next(stage('plot')).next(compile).next(stage('prove')).next(proven);

    this.stateMachine = new sfn.StateMachine(this, 'Workflow', {
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(1),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'WorkflowLogs', {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ERROR,
      },
    });

    new CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
    new CfnOutput(this, 'StageWorkerName', { value: this.worker.functionName });
  }

  /** For the job dispatcher: start executions of the workflow. */
  grantStart(grantee: iam.IGrantable): iam.Grant {
    return this.stateMachine.grantStartExecution(grantee);
  }
}
