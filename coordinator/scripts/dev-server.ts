import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import app from '../src/server.js';

const PORT = Number(process.env.PORT ?? 8787);

app.use('/public/*', serveStatic({ root: './' }));
app.get('/', (c) => c.redirect('/public/index.html'));

console.log(`\n🚀 Ragent Coordinator (Local Dev)`);
console.log(`   Listening on http://localhost:${PORT}`);

serve({ fetch: app.fetch, port: PORT });
