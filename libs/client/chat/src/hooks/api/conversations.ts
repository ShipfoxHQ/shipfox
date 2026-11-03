import {
  CONVERSATION_MESSAGE_MAX_BYTES,
  conversationDetailDtoSchema,
  conversationItemDtoSchema,
  createConversationResponseSchema,
  listConversationItemsResponseSchema,
  listConversationsResponseSchema,
} from '@shipfox/api-agent-dto';
import {checkedApiRequest, emptyResponseSchema, isErrorWithCode} from '@shipfox/client-api';
import type {AgentPageContext} from '@shipfox/client-shell/runtime';
import {
  type InfiniteData,
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ConversationDetail,
  ConversationItem,
  ConversationItemsPage,
  ConversationList,
  ConversationSummary,
} from '#core/conversation.js';
import {
  toConversationDetail,
  toConversationItem,
  toConversationItemsPage,
  toConversationList,
  toConversationSummary,
  toPageContextDto,
} from './conversation-mapper.js';

/** How often a conversation with no open stream is read again, as run pages do. */
export const CONVERSATION_POLL_INTERVAL_MS = 5_000;
const CONVERSATION_PAGE_SIZE = 50;
const ITEMS_PAGE_SIZE = 100;

export const CONVERSATION_NOT_FOUND_CODE = 'conversation-not-found';
export const CONVERSATION_TURN_RUNNING_CODE = 'conversation-turn-running';

/** The API refuses a longer message, so the composer says so before sending. */
export function isMessageTooLong(body: string): boolean {
  return new TextEncoder().encode(body).length > CONVERSATION_MESSAGE_MAX_BYTES;
}

export const conversationQueryKeys = {
  all: ['conversations'] as const,
  list: (projectId: string) => [...conversationQueryKeys.all, 'list', projectId] as const,
  detail: (conversationId: string) =>
    [...conversationQueryKeys.all, 'detail', conversationId] as const,
  items: (conversationId: string) =>
    [...conversationQueryKeys.all, 'items', conversationId] as const,
};

function conversationPath(conversationId: string, suffix = ''): string {
  return `/conversations/${encodeURIComponent(conversationId)}${suffix}`;
}

/** A conversation that was deleted, or that this user never owned, reads the same. */
export function isConversationNotFound(error: unknown): boolean {
  return isErrorWithCode(error, CONVERSATION_NOT_FOUND_CODE);
}

function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  return !isConversationNotFound(error) && failureCount < 2;
}

export async function listConversations(params: {
  projectId: string;
  cursor?: string | undefined;
  signal?: AbortSignal | undefined;
}): Promise<ConversationList> {
  const query = new URLSearchParams({limit: String(CONVERSATION_PAGE_SIZE)});
  if (params.cursor) query.set('cursor', params.cursor);
  return toConversationList(
    await checkedApiRequest(
      listConversationsResponseSchema,
      `/projects/${encodeURIComponent(params.projectId)}/conversations?${query.toString()}`,
      {signal: params.signal},
    ),
  );
}

export function conversationListQueryOptions(projectId: string) {
  return infiniteQueryOptions({
    queryKey: conversationQueryKeys.list(projectId),
    queryFn: ({pageParam, signal}) => listConversations({projectId, cursor: pageParam, signal}),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: ConversationList) => page.nextCursor,
  });
}

/** The project's conversations, latest first. */
export function useConversationListQuery(projectId: string) {
  return useInfiniteQuery(conversationListQueryOptions(projectId));
}

export async function getConversation(params: {
  conversationId: string;
  signal?: AbortSignal | undefined;
}): Promise<ConversationDetail> {
  return toConversationDetail(
    await checkedApiRequest(conversationDetailDtoSchema, conversationPath(params.conversationId), {
      signal: params.signal,
    }),
  );
}

export function conversationDetailQueryOptions(params: {conversationId: string; poll: boolean}) {
  return queryOptions({
    queryKey: conversationQueryKeys.detail(params.conversationId),
    queryFn: ({signal}) => getConversation({conversationId: params.conversationId, signal}),
    refetchInterval: params.poll ? CONVERSATION_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    retry: retryUnlessNotFound,
  });
}

export function useConversationDetailQuery(params: {
  conversationId: string | undefined;
  poll: boolean;
}) {
  return useQuery({
    ...conversationDetailQueryOptions({
      conversationId: params.conversationId ?? '',
      poll: params.poll,
    }),
    enabled: params.conversationId !== undefined,
  });
}

export async function listConversationItems(params: {
  conversationId: string;
  beforeSeq?: number | undefined;
  signal?: AbortSignal | undefined;
}): Promise<ConversationItemsPage> {
  const query = new URLSearchParams({limit: String(ITEMS_PAGE_SIZE)});
  if (params.beforeSeq !== undefined) query.set('before_seq', String(params.beforeSeq));
  return toConversationItemsPage(
    await checkedApiRequest(
      listConversationItemsResponseSchema,
      conversationPath(params.conversationId, `/items?${query.toString()}`),
      {signal: params.signal},
    ),
  );
}

/** Pages are newest first. The next page holds older items. */
export function conversationItemsQueryOptions(params: {conversationId: string; poll: boolean}) {
  return infiniteQueryOptions({
    queryKey: conversationQueryKeys.items(params.conversationId),
    queryFn: ({pageParam, signal}) =>
      listConversationItems({conversationId: params.conversationId, beforeSeq: pageParam, signal}),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page: ConversationItemsPage) =>
      page.hasMore ? (page.items[0]?.seq ?? undefined) : undefined,
    refetchInterval: params.poll ? CONVERSATION_POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    retry: retryUnlessNotFound,
  });
}

export function useConversationItemsQuery(params: {
  conversationId: string | undefined;
  poll: boolean;
}) {
  return useInfiniteQuery({
    ...conversationItemsQueryOptions({
      conversationId: params.conversationId ?? '',
      poll: params.poll,
    }),
    enabled: params.conversationId !== undefined,
  });
}

type ItemsData = InfiniteData<ConversationItemsPage, number | undefined>;

/** Shows a sent message at once. The next read replaces it with what the server holds. */
function withQueuedItem(data: ItemsData | undefined, item: ConversationItem): ItemsData {
  const [first, ...rest] = data?.pages ?? [];
  const page: ConversationItemsPage = first ?? {items: [], queued: [], hasMore: false};
  const known = [...page.items, ...page.queued].some((candidate) => candidate.id === item.id);
  const nextFirst = known ? page : {...page, queued: [...page.queued, item]};
  return {
    pages: [nextFirst, ...rest],
    pageParams: data?.pageParams ?? [undefined],
  };
}

export interface SendMessageInput {
  clientMessageId: string;
  body: string;
  pageContext: AgentPageContext | undefined;
}

function messageBody(input: SendMessageInput) {
  const pageContext = input.pageContext ? toPageContextDto(input.pageContext) : undefined;
  return {
    client_message_id: input.clientMessageId,
    body: input.body,
    ...(pageContext ? {page_context: pageContext} : {}),
  };
}

export async function createConversation(
  params: SendMessageInput & {projectId: string},
): Promise<{conversation: ConversationSummary; item: ConversationItem}> {
  const response = await checkedApiRequest(
    createConversationResponseSchema,
    `/projects/${encodeURIComponent(params.projectId)}/conversations`,
    {method: 'POST', body: messageBody(params)},
  );
  return {
    conversation: toConversationSummary(response.conversation),
    item: toConversationItem(response.item),
  };
}

export function useCreateConversationMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendMessageInput) => createConversation({...input, projectId}),
    onSuccess: async ({conversation, item}) => {
      queryClient.setQueryData<ItemsData>(conversationQueryKeys.items(conversation.id), (data) =>
        withQueuedItem(data, item),
      );
      await queryClient.invalidateQueries({queryKey: conversationQueryKeys.list(projectId)});
    },
  });
}

export async function postConversationMessage(
  params: SendMessageInput & {conversationId: string},
): Promise<ConversationItem> {
  return toConversationItem(
    await checkedApiRequest(
      conversationItemDtoSchema,
      conversationPath(params.conversationId, '/messages'),
      {method: 'POST', body: messageBody(params)},
    ),
  );
}

export function useSendConversationMessageMutation(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      postConversationMessage({...input, conversationId: conversationId ?? ''}),
    onSuccess: async (item) => {
      if (!conversationId) return;
      queryClient.setQueryData<ItemsData>(conversationQueryKeys.items(conversationId), (data) =>
        withQueuedItem(data, item),
      );
      await queryClient.invalidateQueries({queryKey: conversationQueryKeys.detail(conversationId)});
    },
  });
}

export async function stopConversation(conversationId: string): Promise<void> {
  await checkedApiRequest(emptyResponseSchema, conversationPath(conversationId, '/stop'), {
    method: 'POST',
  });
}

export function useStopConversationMutation(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => stopConversation(conversationId ?? ''),
    onSuccess: async () => {
      if (!conversationId) return;
      await queryClient.invalidateQueries({queryKey: conversationQueryKeys.detail(conversationId)});
    },
  });
}

export async function retryConversation(conversationId: string): Promise<void> {
  await checkedApiRequest(emptyResponseSchema, conversationPath(conversationId, '/retry'), {
    method: 'POST',
  });
}

export function useRetryConversationMutation(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => retryConversation(conversationId ?? ''),
    onSuccess: async () => {
      if (!conversationId) return;
      await Promise.all([
        queryClient.invalidateQueries({queryKey: conversationQueryKeys.detail(conversationId)}),
        queryClient.invalidateQueries({queryKey: conversationQueryKeys.items(conversationId)}),
      ]);
    },
  });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await checkedApiRequest(emptyResponseSchema, conversationPath(conversationId), {
    method: 'DELETE',
  });
}

export function useDeleteConversationMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => deleteConversation(conversationId),
    onSuccess: async (_result, conversationId) => {
      queryClient.removeQueries({queryKey: conversationQueryKeys.detail(conversationId)});
      queryClient.removeQueries({queryKey: conversationQueryKeys.items(conversationId)});
      await queryClient.invalidateQueries({queryKey: conversationQueryKeys.list(projectId)});
    },
  });
}

export async function markConversationRead(params: {
  conversationId: string;
  lastReadSeq: number;
}): Promise<void> {
  await checkedApiRequest(emptyResponseSchema, conversationPath(params.conversationId, '/read'), {
    method: 'POST',
    body: {last_read_seq: params.lastReadSeq},
  });
}

export function useMarkConversationReadMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markConversationRead,
    onSuccess: async (_result, {conversationId}) => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: conversationQueryKeys.list(projectId)}),
        queryClient.invalidateQueries({queryKey: conversationQueryKeys.detail(conversationId)}),
      ]);
    },
  });
}

/** Reads the conversation again once a stream ends, because polling paused while it was open. */
export function useConversationRefresh(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  return async () => {
    if (!conversationId) return;
    await Promise.all([
      queryClient.invalidateQueries({queryKey: conversationQueryKeys.detail(conversationId)}),
      queryClient.invalidateQueries({queryKey: conversationQueryKeys.items(conversationId)}),
    ]);
  };
}
