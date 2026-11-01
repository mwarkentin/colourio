// Print file hosting for colourio, a Cloudflare Worker backed by an R2
// bucket. The logic lives in prints.js; this module only exports the Worker,
// because the runtime treats every export of the main module as an entry
// point. See worker/README.md for setup.

import { corsHeaders, handle, json } from './prints.js';

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(error);
      return json({ error: 'server error' }, 500, corsHeaders(request, env));
    }
  },
};
