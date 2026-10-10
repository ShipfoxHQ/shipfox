import type {ProviderToolCatalog} from '#generated/tool-catalog.js';
import type {DownloadedFile, ToolResult} from '#tool-result.js';

export type ToolArguments = Record<string, unknown>;

export interface ToolCallOptions {
  signal?: AbortSignal;
}

export interface ToolDownloadOptions extends ToolCallOptions {
  /** Relative to the step working directory. A trailing `/` means a directory. */
  destination: string;
}

/** The tools of an alias whose provider is not declared in `Aliases`. */
export interface AliasTools {
  /** Calls a granted tool. Throws `ToolCallError` when the call fails. */
  call(tool: string, args?: ToolArguments, options?: ToolCallOptions): Promise<ToolResult>;
  /** Calls a granted file tool and writes the file into the workspace. */
  download(
    tool: string,
    args: ToolArguments,
    options: ToolDownloadOptions,
  ): Promise<DownloadedFile>;
}

/** A provider slug with generated tool types, such as `slack`. */
export type ToolProvider = keyof ProviderToolCatalog;

/** A tool id or `family.method` name of a provider. */
export type ProviderToolName<P extends ToolProvider> = keyof ProviderToolCatalog[P] & string;

export type ProviderToolArguments<
  P extends ToolProvider,
  T extends ProviderToolName<P>,
> = ProviderToolCatalog[P][T] extends {arguments: infer Arguments} ? Arguments : never;

/** The structured result of a tool, or `unknown` when its catalog declares no output schema. */
export type ProviderToolResult<
  P extends ToolProvider,
  T extends ProviderToolName<P>,
> = ProviderToolCatalog[P][T] extends {structured: infer Structured} ? Structured : unknown;

type ProviderToolNameOfKind<P extends ToolProvider, Kind extends 'json' | 'file'> = {
  [T in ProviderToolName<P>]: ProviderToolCatalog[P][T] extends {result: Kind} ? T : never;
}[ProviderToolName<P>];

// Arguments stay optional when the tool has no required argument.
type CallParameters<Arguments> =
  Partial<Arguments> extends Arguments
    ? [args?: Arguments, options?: ToolCallOptions]
    : [args: Arguments, options?: ToolCallOptions];

/** The tools of an alias, typed by its provider catalog. */
export interface ProviderTools<P extends ToolProvider> {
  /** Calls a granted tool. Throws `ToolCallError` when the call fails. */
  call<T extends ProviderToolNameOfKind<P, 'json'>>(
    tool: T,
    ...parameters: CallParameters<ProviderToolArguments<P, T>>
  ): Promise<ToolResult<ProviderToolResult<P, T>>>;
  /** Calls a granted file tool and writes the file into the workspace. */
  download<T extends ProviderToolNameOfKind<P, 'file'>>(
    tool: T,
    args: ProviderToolArguments<P, T>,
    options: ToolDownloadOptions,
  ): Promise<DownloadedFile>;
}

/**
 * Maps manifest integration aliases to provider slugs, to type tool arguments and results. Action
 * code declares it once, with every alias of its manifest:
 *
 * ```ts
 * declare module '@shipfox/actions' {
 *   interface Aliases {
 *     slack: 'slack';
 *   }
 * }
 * ```
 *
 * Without it, every alias accepts any tool name and `Record<string, unknown>` arguments, and
 * results are `unknown`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: action code fills it through module augmentation.
export interface Aliases {}

export type ToolsFor<AliasProviders> = [keyof AliasProviders] extends [never]
  ? Readonly<Record<string, AliasTools>>
  : {
      readonly [Alias in keyof AliasProviders]: AliasProviders[Alias] extends ToolProvider
        ? ProviderTools<AliasProviders[Alias]>
        : AliasTools;
    };

/** Tool clients by manifest integration alias, for example `tools.slack`. */
export type Tools = ToolsFor<Aliases>;
