import {readFile, writeFile} from 'node:fs/promises';

import {productionizeManifest} from '../tools/utils/src/productionize.js';

export function createProductionManifestPacker() {
  const sourceManifests = new Map();
  let receivedSignal;
  const signalHandlers = new Map(
    ['SIGINT', 'SIGTERM'].map((signal) => [signal, () => handleSignal(signal)]),
  );

  for (const [signal, handler] of signalHandlers) process.once(signal, handler);

  return {
    async pack(manifestPath, manifest, packArtifact) {
      const sourceManifest = await readFile(manifestPath, 'utf8');
      sourceManifests.set(manifestPath, sourceManifest);
      await writeFile(
        manifestPath,
        `${JSON.stringify(productionizeManifest(manifest), null, 2)}\n`,
      );
      try {
        return await packArtifact();
      } finally {
        await writeFile(manifestPath, sourceManifest);
        sourceManifests.delete(manifestPath);
      }
    },
    dispose() {
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    },
  };

  function handleSignal(signal) {
    if (receivedSignal) return;
    receivedSignal = signal;
    void restoreSourceManifests().finally(() => process.kill(process.pid, signal));
  }

  function restoreSourceManifests() {
    return Promise.all(
      [...sourceManifests].map(([manifestPath, sourceManifest]) =>
        writeFile(manifestPath, sourceManifest),
      ),
    );
  }
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
