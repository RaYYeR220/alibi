import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface AuthStackProps extends StackProps {
  /** Prefix for the hosted Cognito domain, must be globally unique. */
  domainPrefix: string;
  /** Redirect URIs for the Alexa account-linking client. */
  alexaCallbackUrls: string[];
  /** Redirect URIs for the web simulator (public PKCE client). */
  simulatorCallbackUrls: string[];
}

export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly issuerUrl: string;
  readonly clientIds: string[];
  readonly cognitoDomain: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'Households', {
      userPoolName: 'alibi-households',
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      passwordPolicy: { minLength: 10, requireSymbols: false },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: props.domainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    const service = new cognito.ResourceServerScope({ scopeName: 'mcp:service', scopeDescription: 'Catalog and guest play' });
    const tools = new cognito.ResourceServerScope({ scopeName: 'mcp:tools', scopeDescription: 'Household tools' });
    const resources = new cognito.ResourceServerScope({ scopeName: 'mcp:resources', scopeDescription: 'Household resources' });
    const api = this.userPool.addResourceServer('Api', {
      identifier: 'alibi',
      userPoolResourceServerName: 'alibi',
      scopes: [service, tools, resources],
    });

    const tokenValidity = { accessTokenValidity: Duration.hours(1), idTokenValidity: Duration.hours(1) };
    const userScopes = [
      cognito.OAuthScope.resourceServer(api, tools),
      cognito.OAuthScope.resourceServer(api, resources),
    ];

    const serviceClient = this.userPool.addClient('Service', {
      userPoolClientName: 'alexa-service',
      generateSecret: true,
      oAuth: { flows: { clientCredentials: true }, scopes: [cognito.OAuthScope.resourceServer(api, service)] },
      ...tokenValidity,
    });

    const householdClient = this.userPool.addClient('Household', {
      userPoolClientName: 'alexa-household',
      generateSecret: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: userScopes,
        callbackUrls: props.alexaCallbackUrls,
      },
      refreshTokenValidity: Duration.days(30),
      ...tokenValidity,
    });

    const simulatorClient = this.userPool.addClient('Simulator', {
      userPoolClientName: 'alibi-simulator',
      generateSecret: false,
      authFlows: { userPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: userScopes,
        callbackUrls: props.simulatorCallbackUrls,
      },
      refreshTokenValidity: Duration.days(1),
      ...tokenValidity,
    });

    // Managed login (version 2) shows "Login pages unavailable" until a client has a branding style.
    for (const [name, client] of [
      ['HouseholdLogin', householdClient],
      ['SimulatorLogin', simulatorClient],
    ] as const) {
      new cognito.CfnManagedLoginBranding(this, name, {
        userPoolId: this.userPool.userPoolId,
        clientId: client.userPoolClientId,
        useCognitoProvidedValues: true,
      });
    }

    this.issuerUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;
    this.cognitoDomain = domain.baseUrl();
    this.clientIds = [serviceClient.userPoolClientId, householdClient.userPoolClientId, simulatorClient.userPoolClientId];

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'IssuerUrl', { value: this.issuerUrl });
    new CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'ServiceClientId', { value: serviceClient.userPoolClientId });
    new CfnOutput(this, 'HouseholdClientId', { value: householdClient.userPoolClientId });
    new CfnOutput(this, 'SimulatorClientId', { value: simulatorClient.userPoolClientId });
  }
}
