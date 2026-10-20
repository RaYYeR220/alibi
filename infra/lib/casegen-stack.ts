import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface CasegenStackProps extends StackProps {
  /** Extra statements (table, bucket, Polly) granted once those stacks exist. */
  extraStatements?: iam.PolicyStatement[];
  environment?: Record<string, string>;
}

/**
 * Case generation runs the Strands pipeline on Lambda (container image). The
 * Venice key is read at runtime from AgentCore Identity through the
 * "alibi-casegen" workload identity.
 */
export class CasegenStack extends Stack {
  readonly worker: lambda.DockerImageFunction;

  constructor(scope: Construct, id: string, props: CasegenStackProps = {}) {
    super(scope, id, props);

    this.worker = new lambda.DockerImageFunction(this, 'Worker', {
      functionName: 'alibi-casegen',
      code: lambda.DockerImageCode.fromImageAsset(path.join(here, '..', '..', 'casegen'), {
        file: 'Dockerfile.lambda',
        // x86_64: z3-solver's aarch64 wheel needs glibc 2.38, newer than the Lambda base image.
        platform: Platform.LINUX_AMD64,
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 2048,
      timeout: Duration.minutes(15),
      environment: { ALIBI_KEY_SOURCE: 'identity', ALIBI_WORKLOAD: 'alibi-casegen', ...props.environment },
    });

    this.worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:GetWorkloadAccessToken', 'bedrock-agentcore:GetResourceApiKey'],
        resources: [
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default/workload-identity/alibi-casegen`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
          `arn:aws:bedrock-agentcore:${this.region}:${this.account}:token-vault/default/apikeycredentialprovider/venice`,
        ],
      }),
    );
    this.worker.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/apikey/venice-*`],
      }),
    );
    for (const statement of props.extraStatements ?? []) this.worker.addToRolePolicy(statement);

    new CfnOutput(this, 'WorkerArn', { value: this.worker.functionArn });
  }
}

