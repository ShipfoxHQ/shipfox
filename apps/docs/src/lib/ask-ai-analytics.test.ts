import assert from 'node:assert/strict';
import test from 'node:test';
import {
  askAiAnswerProperties,
  askAiFailureReason,
  askAiQuestionProperties,
} from './ask-ai-analytics';
import type {AskAiAnswerMetadata, AskAiMessage} from './ask-ai-core';

function answer(parts: AskAiMessage['parts'], metadata?: AskAiAnswerMetadata): AskAiMessage {
  return {id: 'answer', role: 'assistant', parts, metadata};
}

function readPart(url: string): AskAiMessage['parts'][number] {
  return {
    type: 'tool-read_page',
    toolCallId: `call-${url}`,
    state: 'output-available',
    input: {url},
    output: {title: url, url, content: '# page'},
  };
}

function failedReadPart(url: string): AskAiMessage['parts'][number] {
  return {
    type: 'tool-read_page',
    toolCallId: `call-${url}`,
    state: 'output-error',
    input: {url},
    errorText: `No documentation page at "${url}".`,
  };
}

test('keeps a plain question and reports its real length', () => {
  const properties = askAiQuestionProperties('  How do I   choose a RUNNER? ');

  assert.deepEqual(properties, {
    question: 'how do i choose a runner?',
    question_length: 25,
    question_redacted: false,
  });
});

test('drops a question that carries a secret instead of truncating it', () => {
  const properties = askAiQuestionProperties('why does api_key=abc123 fail');

  assert.equal(properties.question, '[redacted]');
  assert.equal(properties.question_redacted, true);
});

test('truncates a long question but keeps far more than a catalog search', () => {
  const long = 'how do I choose a runner for this job and then group the logs '.repeat(8);
  const properties = askAiQuestionProperties(long);

  assert.equal(properties.question.length, 240);
  assert.equal(properties.question_redacted, false);
  assert.equal(properties.question_length > 240, true);
});

test('redacts an unbroken run long enough to be a credential', () => {
  assert.equal(askAiQuestionProperties('a'.repeat(400)).question, '[redacted]');
});

test('counts the pages read and the answer text across steps', () => {
  const properties = askAiAnswerProperties({
    question: 'how do I choose a runner',
    model: 'z-ai/glm-5.3-flash',
    answer: answer(
      [
        readPart('/a'),
        readPart('/b'),
        {type: 'text', text: 'Set the top-level '},
        {type: 'text', text: '`runner` field.'},
      ],
      {finish_reason: 'stop', provider: 'Fireworks', steps: 2},
    ),
  });

  assert.equal(properties.pages_read, 2);
  assert.equal(properties.failed_reads, 0);
  assert.equal(properties.answer_length, 33);
  assert.equal(properties.has_answer, true);
  assert.equal(properties.finish_reason, 'stop');
  assert.equal(properties.provider, 'Fireworks');
  assert.equal(properties.steps, 2);
  assert.equal(properties.model, 'z-ai/glm-5.3-flash');
  assert.equal(properties.question, 'how do i choose a runner');
});

test('flags a page the model asked for that does not exist', () => {
  const properties = askAiAnswerProperties({
    question: 'unrelated',
    model: 'z-ai/glm-5.3-flash',
    answer: answer([failedReadPart('/nope'), readPart('/a'), {type: 'text', text: 'ok'}]),
  });

  assert.equal(properties.failed_reads, 1);
  assert.equal(properties.pages_read, 1);
});

test('reports an answer that produced no text, and why it stopped', () => {
  const properties = askAiAnswerProperties({
    question: 'anything',
    model: 'z-ai/glm-5.3-flash',
    answer: answer([readPart('/a')], {finish_reason: 'tool-calls', provider: 'Nebius', steps: 4}),
  });

  assert.equal(properties.has_answer, false);
  assert.equal(properties.answer_length, 0);
  assert.equal(properties.finish_reason, 'tool-calls');
  assert.equal(properties.provider, 'Nebius');
});

test('falls back when the turn reported no metadata', () => {
  const properties = askAiAnswerProperties({
    question: 'anything',
    model: 'z-ai/glm-5.3-flash',
    answer: answer([{type: 'text', text: 'ok'}]),
  });

  assert.equal(properties.finish_reason, 'unknown');
  assert.equal(properties.provider, 'unknown');
  assert.equal(properties.steps, 0);
});

test('separates a missing key from a provider failure and an abort', () => {
  assert.equal(
    askAiFailureReason(new Error('Ask AI is not configured on this deployment.')),
    'not_configured',
  );
  assert.equal(askAiFailureReason(new Error('502 upstream')), 'provider_error');
  const aborted = new Error('cancelled');
  aborted.name = 'AbortError';
  assert.equal(askAiFailureReason(aborted), 'aborted');
});
