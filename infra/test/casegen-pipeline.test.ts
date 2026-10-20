import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { beforeAll, describe, expect, it } from 'vitest';
import { CasegenPipeline, stateMachineArnFor } from '../lib/casegen-pipeline.js';

let template: Template;
let definition: { StartAt: string; States: Record<string, any> };

beforeAll(() => {
  const app = new App();
  const stack = new Stack(app, 'T', { env: { account: '123456789012', region: 'us-east-1' } });
  const table = new dynamodb.Table(stack, 'Table', { partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING }, sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING } });
  const bucket = new s3.Bucket(stack, 'Assets');
  new CasegenPipeline(stack, 'Casegen', { table, bucket, assetBaseUrl: 'https://cdn.example.com' });
  template = Template.fromStack(stack);
  const sm = Object.values(template.findResources('AWS::StepFunctions::StateMachine'))[0] as any;
  const parts = sm.Properties.DefinitionString['Fn::Join'][1] as unknown[];
  definition = JSON.parse(parts.map((p) => (typeof p === 'string' ? p : 'ARN')).join(''));
}, 120_000);

describe('CasegenPipeline', () => {
  it('chains every stage from moderate to publish', () => {
    expect(definition.StartAt).toBe('Stage moderate');
    const order = ['moderate', 'plot', 'compile', 'prove'];
    for (let i = 0; i < order.length - 1; i++) expect(definition.States[`Stage ${order[i]}`].Next).toBe(`Stage ${order[i + 1]}`);
    expect(definition.States['Stage prove'].Next).toBe('Proven?');
    const tail = ['anchors', 'redteam', 'art', 'voices', 'publish'];
    for (let i = 0; i < tail.length - 1; i++) expect(definition.States[`Stage ${tail[i]}`].Next).toBe(`Stage ${tail[i + 1]}`);
    expect(definition.States['Stage publish'].Next).toBe('Published');
  });

  it('loops back to compile until the case is proven', () => {
    const choice = definition.States['Proven?'];
    expect(choice.Type).toBe('Choice');
    expect(choice.Choices[0]).toMatchObject({ Variable: '$.proven', BooleanEquals: true, Next: 'Stage anchors' });
    expect(choice.Default).toBe('Stage compile');
  });

  it('passes only the job id to each stage and never retries a deliberate failure', () => {
    const task = definition.States['Stage plot'];
    expect(task.Parameters).toEqual({ op: 'stage', stage: 'plot', 'jobId.$': '$.jobId' });
    expect(task.Retry[0]).toMatchObject({ ErrorEquals: ['JobFailed', 'JobCancelled'], MaxAttempts: 0 });
    expect(task.Retry[1]).toMatchObject({ ErrorEquals: ['States.ALL'], MaxAttempts: 2 });
    expect(task.Catch[0]).toMatchObject({ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'MarkFailed' });
    expect(definition.States.MarkFailed.Parameters).toEqual({ op: 'fail', 'jobId.$': '$.jobId', 'error.$': '$.error' });
    expect(definition.States.MarkFailed.Next).toBe('JobFailed');
  });

  it('has a fixed name so a dispatcher can address it by ARN', () => {
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', { StateMachineName: 'alibi-casegen' });
    const stack = new Stack(new App(), 'X', { env: { account: '123456789012', region: 'us-east-1' } });
    expect(stateMachineArnFor(stack)).toBe(`arn:${stack.partition}:states:us-east-1:123456789012:stateMachine:alibi-casegen`);
  });

  it('configures the stage worker for the table, bucket and asset URL', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      PackageType: 'Image',
      Architectures: ['x86_64'],
      Timeout: 900,
      Environment: {
        Variables: Match.objectLike({
          ALIBI_KEY_SOURCE: 'identity',
          ALIBI_ASSET_BASE_URL: 'https://cdn.example.com',
          ALIBI_TABLE: Match.anyValue(),
          ALIBI_BUCKET: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: 'polly:SynthesizeSpeech' })]) },
    });
  });
});
