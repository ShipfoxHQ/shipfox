describe('gitea client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    vi.doMock('./config.js', () => ({
      config: {
        E2E_GITEA_URL: 'https://gitea.example.test/',
        E2E_GITEA_ADMIN_USERNAME: 'admin',
        E2E_GITEA_ADMIN_PASSWORD: 'secret',
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('sends authenticated JSON requests to the Gitea API', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({id: 123})));
    const {giteaFetchJson} = await import('./gitea-client.js');

    const result = await giteaFetchJson<{id: number}>('orgs', {
      method: 'POST',
      json: {username: 'e2e-org'},
    });

    expect(fetch).toHaveBeenCalledWith('https://gitea.example.test/api/v1/orgs', {
      method: 'POST',
      headers: {
        authorization: 'Basic YWRtaW46c2VjcmV0',
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({username: 'e2e-org'}),
    });
    expect(result).toEqual({id: 123});
  });

  test('wraps non-OK responses with parsed details', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({message: 'already exists'}), {status: 409}),
    );
    const {GiteaInstanceError, giteaFetch} = await import('./gitea-client.js');

    const result = giteaFetch('orgs', {method: 'POST'});

    await expect(result).rejects.toMatchObject({
      name: 'GiteaInstanceError',
      status: 409,
      details: {message: 'already exists'},
    });
    await expect(result).rejects.toBeInstanceOf(GiteaInstanceError);
  });
});
