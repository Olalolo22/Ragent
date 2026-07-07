export const runtime = 'edge';
import app from '../src/server.js';

export default function (req: Request) {
  return app.fetch(req);
}
