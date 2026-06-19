import type {DomainEvent, EventMapLike, EventType} from '@shipfox/node-outbox';

// Nominal brand: only `subscriberFactory` can mint a ModuleSubscriber. The symbol is
// module-private, so a raw `{event, handler}` literal in a feature package fails to
// type-check (it cannot name the brand) and cannot reintroduce a hand-cast payload.
const subscriberBrand: unique symbol = Symbol('moduleSubscriber');

export interface ModuleSubscriber {
  event: string;
  handler: (event: DomainEvent) => Promise<void>;
  readonly [subscriberBrand]: true;
}

/**
 * Binds outbox event names to their payload types for one module's subscribers.
 *
 * Call once per module with the intersection of the event maps it subscribes to, then
 * register each subscriber through the returned function. The event name is checked
 * against the map and the handler's `payload` is typed to that exact event, so a wrong
 * event name or a mismatched payload fails to compile and no handler hand-casts.
 *
 * The intersected maps must keep disjoint event names; the module-namespaced event
 * strings (`definitions.*`, `workflows.*`, ...) already guarantee this. A shared key with
 * differing payloads would silently intersect to `never` rather than failing to compile.
 *
 * Curried because TypeScript has no partial type-argument inference: the outer call
 * fixes `TMap`, the inner call infers the event key `K` from the `event` argument.
 */
export function subscriberFactory<TMap extends EventMapLike>() {
  return <K extends EventType<TMap>>(
    event: K,
    handler: (payload: TMap[K], event: DomainEvent<TMap[K]>) => Promise<void>,
  ): ModuleSubscriber => ({
    event,
    // The single cast at the framework boundary: the drained payload is `unknown` from
    // JSONB, narrowed here once instead of in every handler.
    handler: (e: DomainEvent): Promise<void> =>
      handler(e.payload as TMap[K], e as DomainEvent<TMap[K]>),
    [subscriberBrand]: true,
  });
}
