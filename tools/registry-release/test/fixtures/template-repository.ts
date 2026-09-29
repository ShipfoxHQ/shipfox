import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

export const TEMPLATE_PATH = 'libs/shared/workflow/catalog/templates/fixture-template';

export const TEMPLATE_MANIFEST = `title: Fixture template
summary: A small template used to test the release tool.
keywords: [fixture]
starts: A ticket starts the test workflow
flow: []
writes: []
prerequisites: []
related: []
roles:
  tracker:
    providers: [linear, github]
  source:
    from: project
    providers: [github]
options:
  - id: ticket_write_back
    question: How should the workflow update the ticket?
    choices:
      - id: comment
        label: Add a comment
        default: true
      - id: none
        label: Do not update the ticket
slots: []
secrets: []
variables: []
`;

const WORKFLOW = `name: Fixture template
triggers:
  # bind:tracker
  # part:tracker.trigger
jobs:
  implement:
    steps:
      # part:tracker.read_ticket
      - key: test
        run: echo hello
        gate:
          success: step.exit_code == 0
      # option:ticket_write_back=comment begin
      # part:tracker.write_back
      # option:ticket_write_back=comment end
      # part:source.open_pr
`;

const TRACKER_PARTS = (provider: string, event: string) => `trigger: |
  ticket:
    source: ${provider}_fixture
    event: ${event}
read_ticket: |
  - key: read_ticket
    prompt: Read the ticket and summarize the requested change.
    integrations:
      - connection: ${provider}_fixture
        include: [issue_read.get]
write_back: |
  - key: write_back
    tool: issue_write.update
    connection: ${provider}_fixture
`;

const SOURCE_PART = `open_pr: |
  - key: open_pr
    prompt: Open a pull request with the completed change.
    integrations:
      - connection: github_fixture
        include: [pull_request_write.create]
`;

export const TEMPLATE_FILES: Record<string, string> = {
  'package.json': `${JSON.stringify(
    {name: '@shipfox/template-fixture-template', license: 'MIT', private: true, version: '1.0.0'},
    null,
    2,
  )}\n`,
  'template.yaml': TEMPLATE_MANIFEST,
  'workflow.yml': WORKFLOW,
  'GUIDE.md': '# Fixture template\n\nA guide for tests.\n',
  'parts/tracker/linear.yml': TRACKER_PARTS('linear', 'issue.created'),
  'parts/tracker/github.yml': TRACKER_PARTS('github', 'issues.opened'),
  'parts/source/github.yml': SOURCE_PART,
  'README.md': 'Overview of the fixture template.\n',
};

/** A throwaway Git repository holding one template package and a `.changeset` inbox. */
export class TemplateRepository {
  readonly root = mkdtempSync(join(tmpdir(), 'registry-release-'));
  readonly directory = join(this.root, TEMPLATE_PATH);

  constructor(files: Record<string, string> = TEMPLATE_FILES) {
    this.git('init', '--quiet', '--initial-branch=main');
    this.git('config', 'user.email', 'test@example.com');
    this.git('config', 'user.name', 'Test');
    this.git('config', 'commit.gpgsign', 'false');
    for (const [path, content] of Object.entries(files)) this.write(path, content);
    this.commit();
  }

  /** Writes below the package directory. */
  write(path: string, content: string): void {
    this.writeAt(join(TEMPLATE_PATH, path), content);
  }

  writeAt(path: string, content: string): void {
    const file = join(this.root, path);
    mkdirSync(dirname(file), {recursive: true});
    writeFileSync(file, content);
  }

  /** Commits every change and returns the commit. */
  commit(): string {
    this.git('add', '--all');
    this.git('commit', '--quiet', '--allow-empty', '-m', 'Update');
    return this.git('rev-parse', 'HEAD').trim();
  }

  remove(): void {
    rmSync(this.root, {recursive: true, force: true});
  }

  private git(...args: string[]): string {
    return execFileSync('git', args, {cwd: this.root, encoding: 'utf8'});
  }
}
