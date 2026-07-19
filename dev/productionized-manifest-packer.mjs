import {spawn} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {basename} from 'node:path';

import {productionizeManifest} from '../tools/utils/src/productionize.js';

export function createProductionManifestPacker() {
  const activePacks = new Set();
  let receivedSignal;
  const signalHandlers = new Map(
    ['SIGINT', 'SIGTERM'].map((signal) => [signal, () => handleSignal(signal)]),
  );

  for (const [signal, handler] of signalHandlers) process.once(signal, handler);

  return {
    async pack(manifestPath, manifest, packArtifact) {
      const sourceManifest = await readFile(manifestPath, 'utf8');
      const controller = new AbortController();
      let resolveCompletion;
      const activePack = {
        completion: new Promise((resolve) => {
          resolveCompletion = resolve;
        }),
        controller,
      };
      activePacks.add(activePack);
      try {
        await writeFile(
          manifestPath,
          `${JSON.stringify(productionizeManifest(manifest), null, 2)}\n`,
        );
        if (controller.signal.aborted)
          throw new Error('Production manifest packing was interrupted');
        return await packArtifact(controller.signal);
      } finally {
        await writeFile(manifestPath, sourceManifest);
        activePacks.delete(activePack);
        resolveCompletion();
      }
    },
    dispose() {
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    },
  };

  function handleSignal(signal) {
    if (receivedSignal) return;
    receivedSignal = signal;
    void stopActivePacks().finally(() => process.kill(process.pid, signal));
  }

  async function stopActivePacks() {
    for (const {controller} of activePacks) controller.abort();
    await Promise.all([...activePacks].map(({completion}) => completion));
  }
}

export function run(command, args, cwd, {signal, stdio = 'inherit'} = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {cwd, stdio});
    const terminate = () => child.kill('SIGTERM');
    const cleanup = () => signal?.removeEventListener('abort', terminate);

    if (signal?.aborted) terminate();
    else signal?.addEventListener('abort', terminate, {once: true});

    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('exit', (code) => {
      cleanup();
      if (code === 0) resolvePromise();
      else reject(new Error(`${basename(command)} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  let failure;

  async function worker() {
    while (nextIndex < values.length && !failure) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(values[index], index);
      } catch (error) {
        failure ??= error;
      }
    }
  }

  await Promise.all(Array.from({length: concurrency}, () => worker()));
  if (failure) throw failure;
  return results;
}
