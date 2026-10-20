export interface WellKnownConfig {
  mcpUrl: string;
  issuer: string;
  cognitoDomain: string;
}

/** Cognito scope strings carry the resource-server prefix. */
export const SCOPES = ['alibi/mcp:service', 'alibi/mcp:tools', 'alibi/mcp:resources'];

/** RFC 9728 protected resource metadata for the MCP endpoint. */
export function protectedResourceMetadata(cfg: WellKnownConfig) {
  return {
    resource: cfg.mcpUrl,
    resource_name: 'Alibi',
    authorization_servers: [cfg.issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
  };
}

/** RFC 8414 metadata mirroring the Cognito user pool's OAuth endpoints. */
export function authorizationServerMetadata(cfg: WellKnownConfig) {
  return {
    issuer: cfg.issuer,
    authorization_endpoint: `${cfg.cognitoDomain}/oauth2/authorize`,
    token_endpoint: `${cfg.cognitoDomain}/oauth2/token`,
    revocation_endpoint: `${cfg.cognitoDomain}/oauth2/revoke`,
    jwks_uri: `${cfg.issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    scopes_supported: SCOPES,
  };
}
