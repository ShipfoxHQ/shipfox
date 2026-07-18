import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const server = await createServer({configFile});

try {
  await server.pluginContainer.buildStart({});
} finally {
  await server.close();
}
