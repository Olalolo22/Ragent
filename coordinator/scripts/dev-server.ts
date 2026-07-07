import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import apiApp from '../src/server.js';

const PORT = Number(process.env.PORT ?? 8787);

const app = new Hono();
app.use('/public/*', serveStatic({ root: './' }));
app.get('/', (c) => c.redirect('/public/index.html'));

// Mount the API
app.route('/', apiApp);

console.log(`\n🚀 Ragent Coordinator (Local Dev)`);
console.log(`   Listening on http://localhost:${PORT}`);

serve({ fetch: app.fetch, port: PORT });
