import { Stack, Tags, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/**
 * Phase 1 intentionally defines no AWS resources. Phase 2 will add resources
 * after the AWS Learner Lab region, IAM, and CloudFormation restrictions are known.
 */
export class CloudSentinelStack extends Stack {
  public constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.templateOptions.description = 'CloudSentinel deployment health monitoring platform';
    Tags.of(this).add('Project', 'CloudSentinel');
    Tags.of(this).add('ManagedBy', 'AWS-CDK');
  }
}

