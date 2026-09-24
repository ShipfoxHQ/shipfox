import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CallToolResultSchema, ErrorCode, type McpError} from '@modelcontextprotocol/sdk/types.js';
import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import {
  type AgentAccessEnvelopeDto,
  agentAccessEnvelopeSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  type TriggersInterModuleClient,
  triggersInterModuleContract,
} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {getShippedSkillResource} from '@shipfox/workflow-templates';
import {createAgentAccessActionTools} from '#core/action-tools.js';
import {agentAccessSuccess} from '#core/envelope.js';
import {AGENT_ACCESS_INTEGRATION_TOOL_NAMES} from '#core/integration-tools.js';
import {createAgentAccessTools} from '#core/paged-tools.js';
import {createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import type {AgentAccessTool} from '#core/tools.js';
import {createAgentAccessFixtureActionTool, createAgentAccessFixtureTool} from '#core/tools.js';
import {AGENT_ACCESS_PACKAGE_VERSION} from '#version.js';
import {buildAgentAccessMcpServer} from './mcp-server.js';

const sha256HexPattern = /^[0-9a-f]{64}$/u;

const context: AgentAccessContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  credential: {kind: 'oauth_grant', grantId: 'grant-1', clientId: 'client-1'},
};

describe('buildAgentAccessMcpServer', () => {
  test('declares immutable resources and lists the same files for different grants', async () => {
    const first = await connectClient();
    const second = await connectClient(undefined, undefined, undefined, undefined, undefined, {
      ...context,
      credential: {kind: 'oauth_grant', grantId: 'grant-2', clientId: 'client-2'},
    });

    const resources = await first.client.listResources();
    const otherResources = await second.client.listResources();

    expect(first.client.getServerCapabilities()?.resources).toEqual({});
    expect(resources.nextCursor).toBeUndefined();
    expect(resources.resources).toEqual(otherResources.resources);
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      'skill://shipfox/create-workflow-from-template/SKILL.md',
    );
    expect(
      resources.resources.every((resource) => resource.annotations?.priority === undefined),
    ).toBe(true);
    expect(
      resources.resources
        .filter((resource) => resource.uri.endsWith('.md'))
        .every((resource) => resource.annotations?.audience?.includes('assistant')),
    ).toBe(true);

    await first.close();
    await second.close();
  });

  test('returns an empty resource template list', async () => {
    const {client, close} = await connectClient();
    expect(await client.listResourceTemplates()).toEqual({resourceTemplates: []});
    await close();
  });

  test('serves resource reads after the tool-call limit is exhausted', async () => {
    const limiter = createAgentAccessRateLimiter({limit: 1, now: () => 1_000});
    const {client, close} = await connectClient(limiter);
    await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'consume limit'}},
      CallToolResultSchema,
    );
    const resource = await client.readResource({uri: 'skill://shipfox/index'});
    expect(resource.contents).toHaveLength(1);
    await close();
  });

  test('reads exact embedded bytes with matching digest and size and audits the read', async () => {
    const recordCall = vi.fn();
    const {client, close} = await connectClient(undefined, undefined, recordCall);
    const {resources} = await client.listResources();
    for (const resource of resources) {
      const result = await client.readResource({uri: resource.uri});
      expect(result.contents).toHaveLength(1);
      const content = result.contents[0];
      expect(content).toMatchObject({uri: resource.uri, mimeType: resource.mimeType});
      if (content === undefined || !('text' in content)) throw new Error('Expected text');
      expect(Buffer.byteLength(content.text, 'utf8')).toBe(resource.size);
      expect(createHash('sha256').update(content.text).digest('hex')).toBe(resource._meta?.sha256);
      expect(content.text).toBe(getShippedSkillResource(resource.uri)?.text);
    }
    expect(recordCall).toHaveBeenCalledWith({
      kind: 'resource',
      tool: 'resources/read',
      outcome: 'success',
      errorCode: 'none',
      context,
      target: {uri: resources.at(-1)?.uri},
    });
    await close();
  });

  test('rejects unknown resource URIs with a JSON-RPC invalid params error', async () => {
    const {client, close} = await connectClient();
    const uri = 'skill://shipfox/../secret';
    await expect(client.readResource({uri})).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      data: {uri},
    } satisfies Partial<McpError>);
    await close();
  });

  test('lists only the fixture tool and returns a schema-valid serialized envelope', async () => {
    const {client, close} = await connectClient();

    const tools = await client.listTools();
    const result = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'hello'}},
      CallToolResultSchema,
    );
    await close();

    expect(client.getServerVersion()).toEqual({
      name: 'shipfox',
      version: AGENT_ACCESS_PACKAGE_VERSION,
    });
    expect(client.getInstructions()).not.toContain('list_integration_connections');
    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0]).toMatchObject({
      name: 'agent_access_fixture',
      annotations: {readOnlyHint: true},
      outputSchema: {type: 'object'},
    });
    expect(tools.tools[0]?.outputSchema).not.toHaveProperty('oneOf');
    expect(result.isError).not.toBe(true);
    expect(agentAccessEnvelopeSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(result.content).toEqual([
      {type: 'text', text: JSON.stringify(result.structuredContent)},
    ]);
  });

  test('advertises integration discovery only when both integration tools are registered', async () => {
    const fixture = createAgentAccessFixtureTool();
    const integrationTools = AGENT_ACCESS_INTEGRATION_TOOL_NAMES.map((name) => ({
      ...fixture,
      name,
    }));
    const {client, close} = await connectClient(undefined, integrationTools);

    expect(client.getInstructions()).toContain(
      'Call list_integration_connections before writing a trigger source',
    );
    await close();
  });

  test('returns a tool error with retry metadata without raising a JSON-RPC error', async () => {
    const limiter = createAgentAccessRateLimiter({limit: 1, now: () => 1_000});
    const {client, close} = await connectClient(limiter);

    await client.listTools();
    const first = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'first'}},
      CallToolResultSchema,
    );
    const second = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'second'}},
      CallToolResultSchema,
    );
    await close();

    expect(first.isError).not.toBe(true);
    expect(second.isError).toBe(true);
    expect(second.structuredContent).toEqual({
      ok: false,
      error: {code: 'rate-limited', retry_after_seconds: 60},
    });
    expect(second.content).toEqual([
      {type: 'text', text: JSON.stringify(second.structuredContent)},
    ]);
  });

  test('audits a shared-window action rejection before checking authority', async () => {
    const limiter = createAgentAccessRateLimiter({limit: 1, now: () => 1_000});
    const recordCall = vi.fn();
    const read = createAgentAccessFixtureTool();
    const action = createAgentAccessFixtureActionTool();
    const {client, close} = await connectClient(limiter, [read, action], recordCall);

    await client.callTool(
      {name: read.name, arguments: {message: 'consume the shared window'}},
      CallToolResultSchema,
    );
    const result = await client.callTool(
      {name: action.name, arguments: {message: 'blocked action'}},
      CallToolResultSchema,
    );
    await close();

    expect(result.structuredContent).toEqual({
      ok: false,
      error: {code: 'rate-limited', retry_after_seconds: 60},
    });
    expect(recordCall).toHaveBeenLastCalledWith({
      tool: action.name,
      outcome: 'rate-limited',
      errorCode: 'rate-limited',
      context,
      action: {
        kind: action.name,
        target: {},
        inputs_supplied: false,
        idempotency_key: false,
        authority_outcome: 'not-checked',
      },
    });
  });

  test('forwards oversized local content to the producer for a domain refusal', async () => {
    const createDevRun = vi
      .fn()
      .mockRejectedValue(
        createInterModuleKnownError(
          triggersInterModuleContract.methods.createDevRun,
          'content-too-large',
          {configPath: '.shipfox/workflow.yml'},
        ),
      );
    const triggers = {createDevRun} as unknown as TriggersInterModuleClient;
    const tools = createAgentAccessActionTools({
      workflows: {} as unknown as WorkflowsModuleClient,
      triggers,
    });
    const auth = {
      checkAgentGrantAuthority: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthInterModuleClient;
    const recordCall = vi.fn();
    const {client, close} = await connectClient(
      createAgentAccessRateLimiter(),
      tools,
      recordCall,
      auth,
    );
    const content = 'x'.repeat(300 * 1024);

    const result = await client.callTool(
      {
        name: 'create_dev_run',
        arguments: {
          project_id: '00000000-0000-4000-8000-000000000001',
          content,
          config_path: '.shipfox/workflow.yml',
          trigger: 'manual',
        },
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {code: 'content-too-large'},
    });
    expect(createDevRun).toHaveBeenCalledTimes(1);
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          definition_source: 'local',
          content_hash: expect.stringMatching(sha256HexPattern),
        }),
      }),
    );
  });

  test('audits dry-run mode separately from real dev runs', async () => {
    const checkDevRun = vi.fn().mockResolvedValue({
      checkPassed: true,
      triggerKind: 'replay',
      eventChecked: true,
      ref: 'main',
      commit: 'a'.repeat(40),
      warnings: [],
    });
    const triggers = {checkDevRun} as unknown as TriggersInterModuleClient;
    const tools = createAgentAccessActionTools({
      workflows: {} as unknown as WorkflowsModuleClient,
      triggers,
    });
    const auth = {
      checkAgentGrantAuthority: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthInterModuleClient;
    const recordCall = vi.fn();
    const {client, close} = await connectClient(
      createAgentAccessRateLimiter(),
      tools,
      recordCall,
      auth,
    );

    const result = await client.callTool(
      {
        name: 'create_dev_run',
        arguments: {
          project_id: '00000000-0000-4000-8000-000000000001',
          ref: 'main',
          config_path: '.shipfox/workflow.yml',
          trigger: 'on_pull_request',
          replay_event_id: '00000000-0000-4000-8000-000000000002',
          dry_run: true,
        },
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.structuredContent).toEqual({
      ok: true,
      result: {
        dry_run: true,
        check_passed: true,
        event_checked: true,
        ref: 'main',
        commit: 'a'.repeat(40),
        warnings: [],
      },
    });
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({dry_run: true}),
      }),
    );
  });

  test('does not audit malformed content as unhashed local content', async () => {
    const createDevRun = vi.fn();
    const triggers = {createDevRun} as unknown as TriggersInterModuleClient;
    const tools = createAgentAccessActionTools({
      workflows: {} as unknown as WorkflowsModuleClient,
      triggers,
    });
    const recordCall = vi.fn();
    const {client, close} = await connectClient(createAgentAccessRateLimiter(), tools, recordCall);

    const result = await client.callTool(
      {
        name: 'create_dev_run',
        arguments: {
          project_id: '00000000-0000-4000-8000-000000000001',
          ref: 'main',
          content: null,
          config_path: '.shipfox/workflow.yml',
          trigger: 'manual',
        },
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.structuredContent).toEqual({ok: false, error: {code: 'invalid-request'}});
    expect(createDevRun).not.toHaveBeenCalled();
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'invalid-request',
        action: expect.objectContaining({definition_source: 'ref'}),
      }),
    );
    expect(recordCall.mock.calls[0]?.[0].action).not.toHaveProperty('content_hash');
  });

  test('rejects multibyte input at the MCP boundary before calling a producer', async () => {
    const listWorkflowRuns = vi.fn();
    const tool = createAgentAccessTools({
      projects: {} as unknown as ProjectsModuleClient,
      definitions: {} as unknown as DefinitionsInterModuleClient,
      workflows: {listWorkflowRuns} as unknown as WorkflowsModuleClient,
      annotations: {} as unknown as AnnotationsInterModuleClient,
      triggers: {} as unknown as TriggersInterModuleClient,
    }).find((candidate) => candidate.name === 'list_workflow_runs');
    if (!tool) throw new Error('Expected list_workflow_runs tool');

    const {client, close} = await connectClient(createAgentAccessRateLimiter(), [tool]);
    const result = await client.callTool(
      {
        name: 'list_workflow_runs',
        arguments: {
          project_id: '00000000-0000-4000-8000-000000000001',
          trigger_source: '🙂'.repeat(129),
        },
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ok: false, error: {code: 'invalid-request'}});
    expect(listWorkflowRuns).not.toHaveBeenCalled();
  });

  test('rejects invalid workflow results at the MCP validation boundary', async () => {
    const workflowTool = createAgentAccessTools({
      projects: {} as unknown as ProjectsModuleClient,
      definitions: {} as unknown as DefinitionsInterModuleClient,
      workflows: {} as unknown as WorkflowsModuleClient,
      annotations: {} as unknown as AnnotationsInterModuleClient,
      triggers: {} as unknown as TriggersInterModuleClient,
    }).find((candidate) => candidate.name === 'get_workflow_run');
    if (!workflowTool) throw new Error('Expected get_workflow_run tool');

    const invalidResultTool = {
      ...workflowTool,
      name: 'invalid_workflow_result',
      execute: () => agentAccessSuccess({}),
    };
    const invalidEnvelopeTool = {
      ...workflowTool,
      name: 'invalid_workflow_envelope',
      execute: () => ({ok: true}) as unknown as AgentAccessEnvelopeDto,
    };
    const {client, close} = await connectClient(undefined, [
      invalidResultTool,
      invalidEnvelopeTool,
    ]);

    const invalidResult = await client.callTool(
      {
        name: 'invalid_workflow_result',
        arguments: {run_id: '00000000-0000-4000-8000-000000000001'},
      },
      CallToolResultSchema,
    );
    const invalidEnvelope = await client.callTool(
      {
        name: 'invalid_workflow_envelope',
        arguments: {run_id: '00000000-0000-4000-8000-000000000001'},
      },
      CallToolResultSchema,
    );
    await close();

    expect(invalidResult.isError).toBe(true);
    expect(invalidResult.structuredContent).toEqual({
      ok: false,
      error: {code: 'invalid-tool-response'},
    });
    expect(invalidEnvelope.isError).toBe(true);
    expect(invalidEnvelope.structuredContent).toEqual({
      ok: false,
      error: {code: 'invalid-tool-response'},
    });
  });

  test('records only the exception when serializing a tool result fails', async () => {
    const recordCall = vi.fn();
    const fixture = createAgentAccessFixtureTool();
    const unserializableTool = {
      ...fixture,
      name: 'unserializable_fixture',
      execute: () => agentAccessSuccess({value: BigInt(1)}),
    };
    const {client, close} = await connectClient(
      createAgentAccessRateLimiter(),
      [unserializableTool],
      recordCall,
    );

    const result = await client.callTool(
      {name: 'unserializable_fixture', arguments: {message: 'ignored'}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ok: false, error: {code: 'tool-failed'}});
    expect(recordCall).toHaveBeenCalledTimes(1);
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'unserializable_fixture',
        outcome: 'exception',
      }),
    );
  });

  test('returns schema-valid tool errors with the serialized envelope duplicate', async () => {
    const {client, close} = await connectClient();

    const result = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 123}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(agentAccessEnvelopeSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        message: 'message must be a string of at most 256 characters with no extra properties',
      },
    });
    expect(result.content).toEqual([
      {type: 'text', text: JSON.stringify(result.structuredContent)},
    ]);
  });

  test('converts an oversized unpaged success into a bounded content-too-large error', async () => {
    const fixture = createAgentAccessFixtureTool();
    const oversizedTool = {
      ...fixture,
      name: 'oversized_fixture',
      execute: () => agentAccessSuccess({message: 'x'.repeat(128 * 1024)}),
    };
    const {client, close} = await connectClient(createAgentAccessRateLimiter(), [oversizedTool]);

    const result = await client.callTool(
      {name: 'oversized_fixture', arguments: {message: 'ignored'}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {code: 'content-too-large'},
    });
    expect(agentAccessEnvelopeSchema.safeParse(result.structuredContent).success).toBe(true);
  });

  test('does not count tool discovery against the credential window', async () => {
    const limiter = createAgentAccessRateLimiter({limit: 1, now: () => 1_000});
    const {client, close} = await connectClient(limiter);

    await client.listTools();
    const result = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'discovery is free'}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ok: true});
  });

  test('passes action annotations through and orders validation, action window, authority, and execution', async () => {
    const events: string[] = [];
    const fixture = createAgentAccessFixtureActionTool();
    const actionTool = {
      ...fixture,
      validateInput: () => {
        events.push('validate');
        return true;
      },
      execute: (call: Parameters<typeof fixture.execute>[0]) => {
        events.push('execute');
        return fixture.execute(call);
      },
    };
    const auth = {
      checkAgentGrantAuthority: () => {
        events.push('authority');
        return {ok: true as const};
      },
    } as unknown as AuthInterModuleClient;
    const {client, close} = await connectClient(
      undefined,
      [actionTool],
      undefined,
      auth,
      createAgentAccessRateLimiter({limit: 10}),
    );

    const tools = await client.listTools();
    const result = await client.callTool(
      {name: actionTool.name, arguments: {message: 'act'}},
      CallToolResultSchema,
    );
    await close();

    expect(tools.tools[0]?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(result.isError).not.toBe(true);
    expect(events).toEqual(['validate', 'authority', 'execute']);
  });

  test('bounds actions separately while leaving read tools unaffected', async () => {
    const action = createAgentAccessFixtureActionTool();
    const read = createAgentAccessFixtureTool();
    const auth = {checkAgentGrantAuthority: vi.fn(async () => ({ok: true as const}))};
    const {client, close} = await connectClient(
      createAgentAccessRateLimiter(),
      [read, action],
      undefined,
      auth as unknown as AuthInterModuleClient,
      createAgentAccessRateLimiter({limit: 1, now: () => 1_000}),
    );

    const firstRead = await client.callTool(
      {name: read.name, arguments: {message: 'read one'}},
      CallToolResultSchema,
    );
    const secondRead = await client.callTool(
      {name: read.name, arguments: {message: 'read two'}},
      CallToolResultSchema,
    );
    const firstAction = await client.callTool(
      {name: action.name, arguments: {message: 'action one'}},
      CallToolResultSchema,
    );
    const secondAction = await client.callTool(
      {name: action.name, arguments: {message: 'action two'}},
      CallToolResultSchema,
    );
    await close();

    expect(firstRead.isError).not.toBe(true);
    expect(secondRead.isError).not.toBe(true);
    expect(firstAction.isError).not.toBe(true);
    expect(secondAction.structuredContent).toEqual({
      ok: false,
      error: {code: 'rate-limited', retry_after_seconds: 60},
    });
    expect(auth.checkAgentGrantAuthority).toHaveBeenCalledTimes(1);
  });

  test('maps authority revocation without calling the producer and preserves dependency failures', async () => {
    const action = createAgentAccessFixtureActionTool();
    const execute = vi.fn(action.execute);
    const revokedAuth = {
      checkAgentGrantAuthority: vi.fn(() => {
        throw createInterModuleKnownError(
          authInterModuleContract.methods.checkAgentGrantAuthority,
          'authority-revoked',
          {reason: 'membership-revoked'},
        );
      }),
    };
    const {client, close} = await connectClient(
      undefined,
      [{...action, execute}],
      undefined,
      revokedAuth as unknown as AuthInterModuleClient,
    );

    const revoked = await client.callTool(
      {name: action.name, arguments: {message: 'blocked'}},
      CallToolResultSchema,
    );
    await close();

    expect(revoked.structuredContent).toEqual({
      ok: false,
      error: {code: 'authority-revoked', message: 'Agent authority revoked: membership-revoked'},
    });
    expect(execute).not.toHaveBeenCalled();

    const outageAuth = {
      checkAgentGrantAuthority: vi.fn(() => {
        throw new Error('workspaces unavailable');
      }),
    };
    const outageConnection = await connectClient(
      undefined,
      [{...action, execute: vi.fn(action.execute)}],
      undefined,
      outageAuth as unknown as AuthInterModuleClient,
    );
    const outage = await outageConnection.client.callTool(
      {name: action.name, arguments: {message: 'outage'}},
      CallToolResultSchema,
    );
    await outageConnection.close();
    expect(outage.structuredContent).toEqual({ok: false, error: {code: 'tool-failed'}});
  });
});

async function connectClient(
  rateLimiter = createAgentAccessRateLimiter(),
  tools: readonly AgentAccessTool[] = [createAgentAccessFixtureTool()],
  recordCall?: Parameters<typeof buildAgentAccessMcpServer>[0]['recordCall'],
  auth?: AuthInterModuleClient,
  actionRateLimiter?: Parameters<typeof buildAgentAccessMcpServer>[0]['actionRateLimiter'],
  requestContext: AgentAccessContext = context,
): Promise<{client: Client; close: () => Promise<void>}> {
  const server = buildAgentAccessMcpServer({
    context: requestContext,
    tools,
    rateLimiter,
    actionRateLimiter,
    auth,
    recordCall,
  });
  const client = new Client({name: 'test-client', version: '0.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
