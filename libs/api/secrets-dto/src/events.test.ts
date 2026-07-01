import {
  SECRET_CREATED,
  type SecretsEventMap,
  secretsEventSchemas,
  VARIABLE_DELETED,
} from './events.js';

describe('secrets events', () => {
  it('validates secret and variable management event payloads', () => {
    const payload = {
      actorId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      projectId: null,
      key: 'API_TOKEN',
    };

    expect(secretsEventSchemas[SECRET_CREATED].parse(payload)).toEqual(payload);
    expect(secretsEventSchemas[VARIABLE_DELETED].parse(payload)).toEqual(payload);
  });

  it('covers every event map key with a schema', () => {
    const eventNames = Object.keys(secretsEventSchemas);

    expect(eventNames).toEqual([
      'secrets.secret.created',
      'secrets.secret.updated',
      'secrets.secret.deleted',
      'secrets.variable.created',
      'secrets.variable.updated',
      'secrets.variable.deleted',
    ] satisfies Array<keyof SecretsEventMap>);
  });
});
