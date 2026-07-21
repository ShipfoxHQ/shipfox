import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer, build as viteBuild} from 'vite';
import {shipfoxClientManifest} from './manifest.js';

describe('shipfoxClientManifest', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shipfox-client-manifest-'));
    await Promise.all([
      writeFile(
        join(directory, 'index.html'),
        '<!doctype html><html><head></head><body><script type="module" src="/src/main.ts"></script></body></html>',
      ),
      mkdir(join(directory, 'src')),
    ]);
    await writeFile(join(directory, 'src', 'main.ts'), '');
  });

  afterEach(async () => {
    await rm(directory, {recursive: true, force: true});
  });

  test('injects canonical application identity tags', () => {
    const transform = shipfoxClientManifest().transformIndexHtml as {
      handler: () => unknown[];
    };

    expect(transform.handler()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({tag: 'title', children: 'Shipfox'}),
        expect.objectContaining({attrs: {rel: 'manifest', href: '/site.webmanifest'}}),
        expect.objectContaining({attrs: {name: 'theme-color', content: '#ff4b00'}}),
        expect.objectContaining({
          attrs: {name: 'apple-mobile-web-app-title', content: 'Shipfox'},
        }),
      ]),
    );
  });

  test('serves canonical assets during development', async () => {
    const server = await createServer({
      root: directory,
      logLevel: 'silent',
      plugins: [shipfoxClientManifest()],
      server: {host: '127.0.0.1', port: 0},
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected Vite to listen on a TCP port.');

    const response = await fetch(`http://127.0.0.1:${address.port}/favicon.svg`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    await server.close();
  });

  test('rejects applications that retain a canonical public asset', async () => {
    await mkdir(join(directory, 'public'));
    await writeFile(join(directory, 'public', 'favicon.ico'), 'conflict');

    await expect(
      viteBuild({root: directory, logLevel: 'silent', plugins: [shipfoxClientManifest()]}),
    ).rejects.toThrow('shipfoxClientManifest() owns /favicon.ico. Remove the conflicting files');
  });
});
