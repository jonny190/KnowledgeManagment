import { startServer } from "./server.js";

const port = Number(process.env.REALTIME_PORT ?? 3001);
startServer(port).then(() => {
  // eslint-disable-next-line no-console
  console.log(`[realtime] listening on :${port}`);
});
