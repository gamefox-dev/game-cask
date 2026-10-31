// Dedicated Vite process for a single probe. Never advertise readiness before listen().
import { createServer } from 'vite';
import { ROOT } from '../build/toolchain.mjs';

const [port, nonce] = process.argv.slice(2);
let server;
const close = async () => {
  await server?.close();
  process.exit(0);
};
process.once('disconnect', close);
process.once('SIGTERM', close);
process.once('SIGINT', close);
try {
  if (!process.send || !nonce) throw new Error('probe server requires an owning parent');
  server = await createServer({
    root: `${ROOT}/web`,
    configFile: `${ROOT}/vite.config.ts`,
    server: { port: Number(port), strictPort: true, host: '127.0.0.1', open: false },
    plugins: [{
      name: 'probe-owner',
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url !== `/__bgt_probe_owner__/${nonce}`) return next();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ nonce }));
        });
      },
    }],
  });
  await server.listen();
  process.send({ type: 'listening', pid: process.pid, nonce, url: `http://127.0.0.1:${port}/` });
} catch (e) {
  console.error(e);
  await server?.close();
  process.exit(1);
}
