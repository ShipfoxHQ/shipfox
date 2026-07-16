import {getLoadedConfig} from '@shipfox/client-config';
import {act, screen} from '@testing-library/react';
import {z} from 'zod';
import {defineClientFeature} from '#contract.js';
import {composeClientApp} from '#runtime/compose-client-app.js';

describe('composed config', () => {
  test('renders ConfigErrorScreen when a feature-required key is missing', async () => {
    window.__SHIPFOX_CONFIG__ = undefined;
    const element = document.createElement('div');
    document.body.append(element);
    const app = composeClientApp({
      features: [defineClientFeature({id: 'acme.config', configShape: {ssoIssuer: z.url()}})],
    });

    await act(async () => app.mount(element));

    expect(await screen.findByRole('heading', {name: 'Configuration error'})).toBeVisible();
    element.remove();
  });

  test('loads a present feature config value into the shared config', () => {
    const shape = z.string();
    window.__SHIPFOX_CONFIG__ = {SSO_ISSUER: 'https://id.example.test'};
    const app = composeClientApp({
      features: [defineClientFeature({id: 'acme.config', configShape: {ssoIssuer: shape}})],
    });
    expect(app).toBeDefined();
    expect(getLoadedConfig<{ssoIssuer: string}>()).toMatchObject({
      ssoIssuer: 'https://id.example.test',
    });
  });
});
