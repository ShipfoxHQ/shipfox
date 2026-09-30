type Callback = (result: {observe: (value: number) => void}) => void;

const metricMocks = vi.hoisted(() => {
  const counters = new Map<string, {add: ReturnType<typeof vi.fn>}>();
  const callbacks = new Map<string, Callback>();
  const createCounter = vi.fn((name: string) => {
    const counter = {add: vi.fn()};
    counters.set(name, counter);
    return counter;
  });
  const createObservableGauge = vi.fn((name: string) => ({
    addCallback: (callback: Callback) => callbacks.set(name, callback),
  }));

  return {callbacks, counters, createCounter, createObservableGauge};
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  instanceMetrics: {
    getMeter: () => ({
      createCounter: metricMocks.createCounter,
      createObservableGauge: metricMocks.createObservableGauge,
    }),
  },
}));

const metrics = await import('./instance.js');

function observed(name: string): number[] {
  const values: number[] = [];
  metricMocks.callbacks.get(name)?.({observe: (value) => values.push(value)});
  return values;
}

describe('Discord Gateway metrics', () => {
  it('records counters with bounded outcome labels', () => {
    metrics.recordDiscordGatewayIdentify('sent');
    metrics.recordDiscordGatewayResume('invalid_session');
    metrics.recordDiscordGatewayDispatch({event: 'message_create', outcome: 'duplicate'});

    expect(
      metricMocks.counters.get('integrations_discord_gateway_identifies')?.add,
    ).toHaveBeenCalledWith(1, {outcome: 'sent'});
    expect(
      metricMocks.counters.get('integrations_discord_gateway_resumes')?.add,
    ).toHaveBeenCalledWith(1, {outcome: 'invalid_session'});
    expect(
      metricMocks.counters.get('integrations_discord_gateway_dispatches')?.add,
    ).toHaveBeenCalledWith(1, {event: 'message_create', outcome: 'duplicate'});
  });

  it('reports the connected gauge as 0 until the socket is ready', () => {
    expect(observed('integrations_discord_gateway_connected')).toEqual([0]);

    metrics.setDiscordGatewayConnected(true);

    expect(observed('integrations_discord_gateway_connected')).toEqual([1]);
  });

  it('observes the leader gauges only once they have a value', () => {
    expect(observed('integrations_discord_identify_remaining')).toEqual([]);
    expect(observed('integrations_discord_guilds')).toEqual([]);
    expect(observed('integrations_discord_gateway_cursor_lag')).toEqual([]);

    metrics.setDiscordIdentifyRemaining(950);
    metrics.setDiscordGuildCount(7);
    metrics.setDiscordGatewayCursorLagSource(() => 3);

    expect(observed('integrations_discord_identify_remaining')).toEqual([950]);
    expect(observed('integrations_discord_guilds')).toEqual([7]);
    expect(observed('integrations_discord_gateway_cursor_lag')).toEqual([3]);

    metrics.setDiscordGatewayCursorLagSource(undefined);

    expect(observed('integrations_discord_gateway_cursor_lag')).toEqual([]);
  });
});
