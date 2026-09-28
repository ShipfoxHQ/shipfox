import type {ToolResult} from '#tool-result.js';
import type {AliasTools, ProviderToolArguments, Tools, ToolsFor} from '#tool-types.js';

describe('tool argument types', () => {
  it('types one tool of each provider from its catalog input schema', () => {
    expectTypeOf<ProviderToolArguments<'clickup', 'get_task'>>().toEqualTypeOf<{
      task_id: string;
      custom_task_id?: boolean;
      include_subtasks?: boolean;
    }>();
    expectTypeOf<ProviderToolArguments<'gitea', 'get_issue'>>().toEqualTypeOf<{
      repo: string;
      index: number;
    }>();
    expectTypeOf<ProviderToolArguments<'github', 'issue_read.get'>>().toEqualTypeOf<{
      owner: string;
      repo: string;
      issue_number: number;
      page?: number;
      per_page?: number;
    }>();
    expectTypeOf<ProviderToolArguments<'jira', 'get_user'>>().toEqualTypeOf<{
      accountId: string;
      expand?: string;
    }>();
    expectTypeOf<ProviderToolArguments<'linear', 'get_attachment'>>().toEqualTypeOf<{
      id: string;
    }>();
    expectTypeOf<ProviderToolArguments<'notion', 'get_page'>>().toEqualTypeOf<{
      page_id: string;
    }>();
    expectTypeOf<ProviderToolArguments<'posthog', 'survey-get'>>().toEqualTypeOf<{
      id: string;
      [k: string]: unknown;
    }>();
    expectTypeOf<ProviderToolArguments<'sentry', 'get-issue'>>().toEqualTypeOf<{
      issueId: string;
    }>();
    expectTypeOf<ProviderToolArguments<'shipfox', 'list_projects'>>().toEqualTypeOf<{
      limit?: number;
      cursor?: string;
    }>();
    expectTypeOf<ProviderToolArguments<'slack', 'read_user_profile'>>().toEqualTypeOf<{
      user_id: string;
      include_locale?: boolean;
    }>();
  });

  it('keeps the method argument on a family tool id', () => {
    expectTypeOf<ProviderToolArguments<'github', 'issue_read'>['method']>().toEqualTypeOf<
      'get' | 'get_comments' | 'get_sub_issues' | 'get_parent' | 'get_labels'
    >();
  });

  it('types calls through the aliases an action declares', () => {
    const typeOnly = async (tools: ToolsFor<{chat: 'slack'; code: 'github'; ci: 'shipfox'}>) => {
      expectTypeOf(
        await tools.chat.call('read_user_profile', {user_id: 'U1'}),
      ).toEqualTypeOf<ToolResult>();
      await tools.chat.call('read_channel_info', {channel_id: 'C1'}, {signal: AbortSignal.abort()});
      await tools.code.call('issue_read.get', {owner: 'o', repo: 'r', issue_number: 1});
      await tools.ci.call('list_projects');

      // @ts-expect-error: a required argument is missing.
      await tools.chat.call('read_user_profile', {});
      // @ts-expect-error: the argument has the wrong type.
      await tools.chat.call('read_user_profile', {user_id: 1});
      // @ts-expect-error: the provider has no such tool.
      await tools.chat.call('read_everything', {});
      // @ts-expect-error: the alias is not declared.
      await tools.other.call('read_user_profile', {user_id: 'U1'});
      // @ts-expect-error: only file tools can be downloaded.
      await tools.chat.download('read_user_profile', {user_id: 'U1'}, {destination: 'out/'});
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  it('falls back to untyped tools without declared aliases or for unknown providers', () => {
    expectTypeOf<Tools>().toEqualTypeOf<Readonly<Record<string, AliasTools>>>();
    expectTypeOf<ToolsFor<{legacy: 'unknown-provider'}>['legacy']>().toEqualTypeOf<AliasTools>();
  });
});
