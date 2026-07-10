import {AGENT_INTEGRATION_MCP_ENDPOINT} from '@shipfox/api-agent-dto';
import {type LeaseTokenSource, readLeaseToken} from '#api-client.js';
import {config} from '#config.js';

const baseUrl = config.SHIPFOX_API_URL.endsWith('/')
  ? config.SHIPFOX_API_URL
  : `${config.SHIPFOX_API_URL}/`;
const LEADING_SLASH_REGEX = /^\//;

export function integrationToolsGatewayUrl(): URL {
  return new URL(AGENT_INTEGRATION_MCP_ENDPOINT.replace(LEADING_SLASH_REGEX, ''), baseUrl);
}

export function createIntegrationToolsGatewayFetch(
  leaseToken: LeaseTokenSource,
  gatewayUrl: URL,
): typeof fetch {
  return (input, init) => {
    const requestUrl = input instanceof Request ? new URL(input.url) : new URL(input);
    if (!isIntegrationToolsGatewayRequest(requestUrl, gatewayUrl)) {
      return Promise.reject(
        new Error(
          `Integration tools gateway fetch refused request to ${requestUrl.origin}${requestUrl.pathname}`,
        ),
      );
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });
    }
    headers.set('Authorization', `Bearer ${readLeaseToken(leaseToken)}`);

    return fetch(input, {...init, headers, redirect: 'error'});
  };
}

function isIntegrationToolsGatewayRequest(requestUrl: URL, gatewayUrl: URL): boolean {
  return requestUrl.origin === gatewayUrl.origin && requestUrl.pathname === gatewayUrl.pathname;
}
