import { EMIC_PATH, relayEmic } from './emic-worker.mjs';

export default {
  fetch(request) {
    return new URL(request.url).pathname === EMIC_PATH
      ? relayEmic(request) : new Response('Not found', { status: 404 });
  },
};
