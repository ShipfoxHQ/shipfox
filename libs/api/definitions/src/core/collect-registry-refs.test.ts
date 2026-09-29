import {collectRegistryRefs} from './collect-registry-refs.js';
import {parseWorkflowYaml} from './workflow-yaml/index.js';

const HEADER =
  '# shipfox-template: shipfox/ticket-to-pr@1.2.0; roles: source=github tracker=linear; options: feedback_loop=on';

function collect(yaml: string) {
  const document = parseWorkflowYaml(yaml, {actions: true, registryActions: true});
  return collectRegistryRefs({content: yaml, document});
}

describe('collectRegistryRefs', () => {
  it('records a registry template and a registry action of one definition', () => {
    const refs = collect(`${HEADER}
name: Ticket to PR
runner: ubuntu-latest
jobs:
  build:
    steps:
      - key: digest
        uses: shipfox/slack-thread-digest@1.4.2
      - run: echo done
`);

    expect(refs).toEqual([
      {
        kind: 'action',
        package: 'shipfox/slack-thread-digest',
        version: '1.4.2',
        steps: ['build.digest'],
      },
      {
        kind: 'template',
        package: 'shipfox/ticket-to-pr',
        version: '1.2.0',
        bindings: {source: 'github', tracker: 'linear'},
        options: {feedback_loop: 'on'},
      },
    ]);
  });

  it('groups the steps that use one version and names unkeyed steps by position', () => {
    const refs = collect(`name: Digests
runner: ubuntu-latest
jobs:
  first:
    steps:
      - uses: shipfox/slack-thread-digest@1.4.2
      - key: again
        uses: shipfox/slack-thread-digest@1.4.2
  second:
    steps:
      - uses: shipfox/slack-thread-digest@1.5.0
`);

    expect(refs).toEqual([
      {
        kind: 'action',
        package: 'shipfox/slack-thread-digest',
        version: '1.4.2',
        steps: ['first.0', 'first.again'],
      },
      {
        kind: 'action',
        package: 'shipfox/slack-thread-digest',
        version: '1.5.0',
        steps: ['second.0'],
      },
    ]);
  });

  it('records a legacy header as legacy', () => {
    const refs = collect(`# shipfox-template: ticket-to-pr@5 source=github tracker=linear
name: Ticket to PR
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: echo done
`);

    expect(refs).toEqual([{kind: 'template', legacy: true, id: 'ticket-to-pr', revision: 5}]);
  });

  it('ignores repository actions, a workflow with no header, and a header inside a prompt', () => {
    const refs = collect(`name: Plain
runner: ubuntu-latest
jobs:
  build:
    steps:
      - uses: ./.shipfox/actions/notify
      - prompt: |
          # shipfox-template: shipfox/ticket-to-pr@1.2.0
          Explain the header above.
`);

    expect(refs).toEqual([]);
  });

  it('ignores a malformed header', () => {
    const refs = collect(`# shipfox-template: shipfox/ticket-to-pr@1
name: Ticket to PR
runner: ubuntu-latest
jobs:
  build:
    steps:
      - run: echo done
`);

    expect(refs).toEqual([]);
  });
});
