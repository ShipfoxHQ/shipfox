import {planLaunches, templateAvailableSlots} from '#capacity.js';
import type {ProvisionerTemplate} from '#types.js';

function template(
  overrides: Partial<ProvisionerTemplate<null>> & {key: string},
): ProvisionerTemplate<null> {
  return {
    labels: ['ubuntu22'],
    maxConcurrency: 100,
    cost: 1,
    spec: null,
    ...overrides,
  };
}

describe('templateAvailableSlots', () => {
  it('subtracts starting and running from the concurrency cap', () => {
    const slots = templateAvailableSlots(template({key: 'a', maxConcurrency: 100}), {
      starting: 12,
      running: 68,
    });

    expect(slots).toBe(20);
  });

  it('never returns a negative number when over-subscribed', () => {
    const slots = templateAvailableSlots(template({key: 'a', maxConcurrency: 5}), {
      starting: 4,
      running: 4,
    });

    expect(slots).toBe(0);
  });
});

describe('planLaunches', () => {
  it('plans one group bounded by the reservation count', () => {
    const templates = [template({key: 'small'})];

    const planned = planLaunches({
      reservations: [{reservationId: 'r1', labels: ['ubuntu22'], count: 25}],
      templates,
      availableByKey: new Map([['small', 80]]),
    });

    expect(planned).toEqual([{reservationId: 'r1', template: templates[0], count: 25}]);
  });

  it('never plans more than the free slots', () => {
    const templates = [template({key: 'small'})];

    const planned = planLaunches({
      reservations: [{reservationId: 'r1', labels: ['ubuntu22'], count: 100}],
      templates,
      availableByKey: new Map([['small', 20]]),
    });

    expect(planned.map((group) => group.count)).toEqual([20]);
  });

  it('fills the cheapest template first and spills the rest to the next match', () => {
    const cheap = template({key: 'cheap', labels: ['ubuntu22', 'ubuntu22-2cpu'], cost: 2});
    const pricey = template({key: 'pricey', labels: ['ubuntu22', 'ubuntu22-4cpu'], cost: 4});

    const planned = planLaunches({
      reservations: [{reservationId: 'r1', labels: ['ubuntu22'], count: 30}],
      templates: [pricey, cheap],
      availableByKey: new Map([
        ['cheap', 10],
        ['pricey', 50],
      ]),
    });

    expect(planned).toEqual([
      {reservationId: 'r1', template: cheap, count: 10},
      {reservationId: 'r1', template: pricey, count: 20},
    ]);
  });

  it('shares capacity across reservations without double-counting a slot', () => {
    const templates = [template({key: 'small'})];

    const planned = planLaunches({
      reservations: [
        {reservationId: 'r1', labels: ['ubuntu22'], count: 60},
        {reservationId: 'r2', labels: ['ubuntu22'], count: 60},
      ],
      templates,
      availableByKey: new Map([['small', 100]]),
    });

    expect(planned).toEqual([
      {reservationId: 'r1', template: templates[0], count: 60},
      {reservationId: 'r2', template: templates[0], count: 40},
    ]);
  });

  it('plans nothing when no template satisfies the reservation labels', () => {
    const templates = [template({key: 'linux', labels: ['ubuntu22']})];

    const planned = planLaunches({
      reservations: [{reservationId: 'r1', labels: ['macos'], count: 5}],
      templates,
      availableByKey: new Map([['linux', 100]]),
    });

    expect(planned).toEqual([]);
  });

  it('does not mutate the caller capacity map', () => {
    const templates = [template({key: 'small'})];
    const availableByKey = new Map([['small', 100]]);

    planLaunches({
      reservations: [{reservationId: 'r1', labels: ['ubuntu22'], count: 40}],
      templates,
      availableByKey,
    });

    expect(availableByKey.get('small')).toBe(100);
  });
});
