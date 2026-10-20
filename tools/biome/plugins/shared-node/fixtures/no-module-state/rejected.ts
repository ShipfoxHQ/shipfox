let client: object | undefined;
export let exportedClient: object | undefined;
var legacyClient: object | undefined;
const listeners = new Set<() => void>();
const methods: Map<string, number> = new Map();
const marks = new WeakMap<object, string>() as WeakMap<object, string>;

export function register(listener: () => void): object[] {
  client ??= {};
  exportedClient ??= {};
  legacyClient ??= {};
  listeners.add(listener);
  methods.set('name', 1);
  marks.set(listener, 'registered');
  return [client, exportedClient, legacyClient];
}
