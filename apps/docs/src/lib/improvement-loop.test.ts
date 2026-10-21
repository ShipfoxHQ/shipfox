import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  buildFrames,
  cycleDescriptions,
  feedLength,
  runWindow,
  serializeImprovementLoop,
} from './improvement-loop';

const frames = buildFrames();

describe('improvement loop', () => {
  it('keeps the log and run strips within their slots', () => {
    for (const frame of frames) {
      assert.ok(frame.feed.length <= feedLength);
      assert.ok(frame.workflows.every((workflow) => workflow.runs.length <= runWindow));
    }
  });

  it('shows a pull request for review before it is approved', () => {
    const states = frames.flatMap((frame) =>
      frame.pullRequest ? [`${frame.pullRequest.number}:${frame.pullRequest.state}`] : [],
    );
    for (const approved of states.filter((state) => state.endsWith(':approved'))) {
      const number = approved.split(':')[0];
      assert.ok(states.indexOf(`${number}:review`) < states.indexOf(approved));
    }
  });

  it('ends with every workflow running and every improvement applied', () => {
    const last = frames.at(-1);
    assert.ok(last);
    assert.ok(last.workflows.every((workflow) => workflow.visible));
    assert.deepEqual(
      last.workflows.filter((workflow) => workflow.metric?.improved).map(({name}) => name),
      ['release-notes', 'pr-checks', 'alert-triage'],
    );
  });

  it('only counts up the runs Shippy AI watches', () => {
    const counts = frames.map((frame) => frame.watchedRuns);
    assert.deepEqual(
      counts,
      [...counts].sort((a, b) => a - b),
    );
  });

  it('serializes every cycle in order', () => {
    const markdown = serializeImprovementLoop();
    const positions = cycleDescriptions.map((summary) => markdown.indexOf(summary));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b),
    );
  });
});
