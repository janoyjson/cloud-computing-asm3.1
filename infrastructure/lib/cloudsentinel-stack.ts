import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  aws_apigatewayv2 as apigwv2,
  aws_apigatewayv2_integrations as integrations,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_ec2 as ec2,
  aws_ecr as ecr,
  aws_ecs as ecs,
  aws_glue as glue,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_secretsmanager as secretsmanager,
  type StackProps,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export class CloudSentinelStack extends Stack {
  public constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const webBucket = new s3.Bucket(this, 'WebBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: true, ignorePublicAcls: true, blockPublicPolicy: false, restrictPublicBuckets: false }),
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const resultsBucket = new s3.Bucket(this, 'ResultsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const monitorsTable = this.createTable('MonitorsTable', 'id');
    const checksTable = this.createTable('ChecksTable', 'endpointId', 'checkedAt');
    const incidentsTable = this.createTable('IncidentsTable', 'endpointId', 'openedAt');
    const performanceTable = this.createTable('PerformanceTable', 'endpointId', 'measuredAt');

    const workerRepository = new ecr.Repository(this, 'WorkerRepository', {
      repositoryName: 'cloudsentinel-monitor-worker',
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const notificationSecret = new secretsmanager.Secret(this, 'NotificationSecret', {
      secretName: 'cloudsentinel/discord-webhook',
      description: 'JSON object containing the CloudSentinel Discord webhook URL.',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2, natGateways: 0, subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }] });
    const workerSecurityGroup = new ec2.SecurityGroup(this, 'WorkerSecurityGroup', { vpc, allowAllOutbound: false });
    workerSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
    workerSecurityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.udp(53));
    workerSecurityGroup.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(53));
    const logGroup = new logs.LogGroup(this, 'WorkerLogGroup', { logGroupName: '/ecs/cloudsentinel-monitor-worker', retention: logs.RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY });
    const ecsCluster = new ecs.Cluster(this, 'EcsCluster', { vpc, clusterName: 'cloudsentinel-cluster' });
    const taskRole = new iam.Role(this, 'WorkerTaskRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    const executionRole = new iam.Role(this, 'WorkerExecutionRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    workerRepository.grantPull(executionRole);
    resultsBucket.grantWrite(taskRole);
    monitorsTable.grantReadWriteData(taskRole);
    checksTable.grantReadWriteData(taskRole);
    incidentsTable.grantReadWriteData(taskRole);
    notificationSecret.grantRead(taskRole);

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'WorkerTaskDefinition', { family: 'cloudsentinel-monitor-worker', cpu: 256, memoryLimitMiB: 512, taskRole, executionRole });
    taskDefinition.addContainer('monitor-worker', {
      image: ecs.ContainerImage.fromEcrRepository(workerRepository, '0.3.0'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'worker', logGroup }),
      environment: { MONITORS_TABLE_NAME: monitorsTable.tableName, CHECKS_TABLE_NAME: checksTable.tableName, INCIDENTS_TABLE_NAME: incidentsTable.tableName, RESULTS_BUCKET_NAME: resultsBucket.bucketName, NOTIFICATION_SECRET_ID: notificationSecret.secretName },
    });

    const schedulerRole = new iam.Role(this, 'SchedulerRole', { assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com') });
    schedulerRole.addToPolicy(new iam.PolicyStatement({ actions: ['ecs:RunTask'], resources: [taskDefinition.taskDefinitionArn, `${taskDefinition.taskDefinitionArn}:*`] }));
    schedulerRole.addToPolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [taskRole.roleArn, executionRole.roleArn] }));

    const apiRole = new iam.Role(this, 'ApiRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    apiRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    monitorsTable.grantReadWriteData(apiRole);
    performanceTable.grantReadWriteData(apiRole);
    incidentsTable.grantReadData(apiRole);
    resultsBucket.grantReadWrite(apiRole);
    apiRole.addToPolicy(new iam.PolicyStatement({ actions: ['ecs:RunTask'], resources: [taskDefinition.taskDefinitionArn, `${taskDefinition.taskDefinitionArn}:*`] }));
    apiRole.addToPolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [taskRole.roleArn, executionRole.roleArn] }));
    apiRole.addToPolicy(new iam.PolicyStatement({ actions: ['scheduler:CreateSchedule', 'scheduler:UpdateSchedule', 'scheduler:DeleteSchedule'], resources: ['*'] }));
    apiRole.addToPolicy(new iam.PolicyStatement({ actions: ['athena:StartQueryExecution', 'athena:GetQueryExecution', 'athena:GetQueryResults'], resources: ['*'] }));

    const apiFunction = new lambda.Function(this, 'ApiFunction', {
      functionName: 'CloudSentinelApi',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(repositoryRoot, 'services', 'api', 'dist-lambda')),
      role: apiRole,
      memorySize: 256,
      timeout: Duration.seconds(35),
      environment: {
        MONITORS_TABLE_NAME: monitorsTable.tableName,
        PERFORMANCE_TABLE_NAME: performanceTable.tableName,
        INCIDENTS_TABLE_NAME: incidentsTable.tableName,
        ECS_CLUSTER: ecsCluster.clusterName,
        ECS_CLUSTER_ARN: ecsCluster.clusterArn,
        ECS_TASK_DEFINITION: taskDefinition.taskDefinitionArn,
        ECS_TASK_DEFINITION_ARN: taskDefinition.taskDefinitionArn,
        ECS_SUBNET_IDS: vpc.publicSubnets.map((subnet) => subnet.subnetId).join(','),
        ECS_SECURITY_GROUP_IDS: workerSecurityGroup.securityGroupId,
        ECS_CONTAINER_NAME: 'monitor-worker',
        ECS_ASSIGN_PUBLIC_IP: 'true',
        SCHEDULER_EXECUTION_ROLE_ARN: schedulerRole.roleArn,
        SCHEDULER_GROUP_NAME: 'default',
        ATHENA_DATABASE: 'cloudsentinel',
        ATHENA_CHECKS_TABLE: 'checks',
        ATHENA_OUTPUT_LOCATION: `s3://${resultsBucket.bucketName}/athena/`,
      },
    });
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', { apiName: 'CloudSentinelHttpApi', corsPreflight: { allowHeaders: ['content-type', 'authorization'], allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.PATCH, apigwv2.CorsHttpMethod.DELETE, apigwv2.CorsHttpMethod.OPTIONS], allowOrigins: ['*'] } });
    const integration = new integrations.HttpLambdaIntegration('ApiIntegration', apiFunction);
    for (const [routePath, method] of [
      ['/v1/health', apigwv2.HttpMethod.GET], ['/v1/endpoints', apigwv2.HttpMethod.GET], ['/v1/endpoints', apigwv2.HttpMethod.POST], ['/v1/endpoints/{id}', apigwv2.HttpMethod.PATCH], ['/v1/endpoints/{id}', apigwv2.HttpMethod.DELETE], ['/v1/endpoints/{id}/checks', apigwv2.HttpMethod.POST], ['/v1/endpoints/{id}/performance', apigwv2.HttpMethod.GET], ['/v1/endpoints/{id}/performance', apigwv2.HttpMethod.POST], ['/v1/endpoints/{id}/incidents', apigwv2.HttpMethod.GET], ['/v1/analytics/overview', apigwv2.HttpMethod.GET],
    ] as const) {
      httpApi.addRoutes({ path: routePath, methods: [method], integration });
    }

    const database = new glue.CfnDatabase(this, 'GlueDatabase', { catalogId: this.account, databaseInput: { name: 'cloudsentinel' } });
    const glueRole = new iam.Role(this, 'GlueRole', { assumedBy: new iam.ServicePrincipal('glue.amazonaws.com') });
    resultsBucket.grantRead(glueRole);
    const crawler = new glue.CfnCrawler(this, 'ChecksCrawler', { name: 'cloudsentinel-checks-crawler', role: glueRole.roleArn, databaseName: database.ref, targets: { s3Targets: [{ path: `s3://${resultsBucket.bucketName}/checks/` }] }, schemaChangePolicy: { deleteBehavior: 'LOG', updateBehavior: 'UPDATE_IN_DATABASE' } });
    crawler.addDependency(database);

    const distribution = new cloudfront.Distribution(this, 'WebDistribution', { defaultRootObject: 'index.html', defaultBehavior: { origin: new origins.S3Origin(webBucket), viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS }, errorResponses: [{ httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' }, { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' }] });
    new s3deploy.BucketDeployment(this, 'WebDeployment', { sources: [s3deploy.Source.asset(path.join(repositoryRoot, 'apps', 'web', 'dist'))], destinationBucket: webBucket, distribution, distributionPaths: ['/*'] });

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'WebUrl', { value: `https://${distribution.domainName}` });
    new CfnOutput(this, 'ResultsBucketName', { value: resultsBucket.bucketName });
    new CfnOutput(this, 'WorkerRepositoryUri', { value: workerRepository.repositoryUri });
    Tags.of(this).add('Project', 'CloudSentinel');
    Tags.of(this).add('ManagedBy', 'AWS-CDK');
  }

  private createTable(id: string, partitionKey: string, sortKey?: string): dynamodb.Table {
    return new dynamodb.Table(this, id, { partitionKey: { name: partitionKey, type: dynamodb.AttributeType.STRING }, sortKey: sortKey ? { name: sortKey, type: dynamodb.AttributeType.STRING } : undefined, billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, encryption: dynamodb.TableEncryption.AWS_MANAGED, removalPolicy: RemovalPolicy.RETAIN });
  }
}
