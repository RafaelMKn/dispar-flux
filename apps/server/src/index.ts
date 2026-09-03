import { createServer } from './server.js';

export * from './server.js';

async function main() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';
  const dataDir = process.env.DATA_DIR || './data';
  const nodeEnv = process.env.NODE_ENV || 'production';

  const server = createServer({
    port,
    host,
    dataDir,
    nodeEnv,
  });

  const shutdown = async () => {
    // eslint-disable-next-line no-console
    console.log('\nReceived shutdown signal, terminating server gracefully...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    const { address } = await server.start();
    // eslint-disable-next-line no-console
    console.log(`[Dispar Flux Web 1.0] Ready and serving at ${address}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Fatal boot error:', err);
    process.exit(1);
  }
}

const normalizedArgv = process.argv[1]?.replace(/\\/g, '/');
if (
  normalizedArgv &&
  (normalizedArgv.endsWith('server/src/index.ts') ||
    normalizedArgv.endsWith('server/dist/index.js') ||
    normalizedArgv.endsWith('dist/index.js') ||
    normalizedArgv.endsWith('src/index.ts'))
) {
  main();
}

