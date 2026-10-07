import {type JobContainer, startJobContainer} from '@shipfox/runner-container';
import {z} from 'zod';

// The shape the server writes into the setup step config when the job has a `container`.
const setupContainerConfigSchema = z.object({
  image: z.string().min(1),
  options: z.string().default(''),
  docker_socket: z.boolean().default(true),
  env: z.record(z.string(), z.string()).default({}),
  /** Set when the registry username is a literal. A secret username arrives in the secrets. */
  username: z.string().optional(),
});

export type SetupContainerConfig = z.infer<typeof setupContainerConfigSchema>;

/** The container settings the server keeps out of the step config, pulled with the step secrets. */
export interface SetupContainerSecrets {
  username?: string | undefined;
  password?: string | undefined;
  env: Record<string, string>;
}

export interface SetupContainerContext {
  jobId: string;
  tempDir: string;
  agentStateDir: string;
  logsDir: string;
  credentialsDir: string;
  secrets: SetupContainerSecrets;
}

export interface SetupContainerLog {
  writeOutputLine(line: string, source?: 'stdout' | 'stderr'): void;
}

export interface StartedSetupContainer extends JobContainer {
  /** The environment every process in the container gets, secrets included. */
  readonly env: Readonly<Record<string, string>>;
}

export function parseSetupContainerConfig(config: unknown): SetupContainerConfig {
  const parsed = setupContainerConfigSchema.safeParse(config);
  if (!parsed.success) throw new Error('The job container configuration is invalid.');
  return parsed.data;
}

export async function startSetupContainer(params: {
  config: SetupContainerConfig;
  context: SetupContainerContext;
  workspaceDir: string;
  signal: AbortSignal;
  log?: SetupContainerLog | undefined;
}): Promise<StartedSetupContainer> {
  const {config, context} = params;
  const username = config.username ?? context.secrets.username;
  const password = context.secrets.password;
  const container = await startJobContainer({
    jobId: context.jobId,
    image: config.image,
    options: config.options,
    dockerSocket: config.docker_socket,
    registry: username !== undefined && password !== undefined ? {username, password} : undefined,
    workspaceDir: params.workspaceDir,
    tempDir: context.tempDir,
    agentStateDir: context.agentStateDir,
    credentialsDir: context.credentialsDir,
    logsDir: context.logsDir,
    signal: params.signal,
    onOutput: (line, source) => params.log?.writeOutputLine(line, source),
  });
  return {...container, env: {...config.env, ...context.secrets.env}};
}
