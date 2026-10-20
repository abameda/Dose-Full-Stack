import { ingestEvent } from '@dose/core/webhooks';
import { Hono } from 'hono';
import type { ApiDeps, ApiEnv, WebhookProvider } from './app';

/** The provider registered under `name`, never something inherited (`constructor`, `__proto__`). */
function providerNamed(deps: ApiDeps, name: string): WebhookProvider | undefined {
  return Object.hasOwn(deps.webhookProviders, name) ? deps.webhookProviders[name] : undefined;
}

export function webhookRoutes(deps: ApiDeps): Hono<ApiEnv> {
  const routes = new Hono<ApiEnv>();

  routes.post('/api/webhooks/:provider', async (c) => {
    const name = c.req.param('provider');
    const provider = providerNamed(deps, name);
    if (provider === undefined) return c.json({ error: 'unknown_provider' }, 404);

    // The signature covers the exact bytes the provider sent, so verify gets the body as text
    // and its own copy of the request (the original's body is consumed by reading it).
    const forVerify = c.req.raw.clone();
    const rawBody = await c.req.text();
    const event = await provider.verify(forVerify, rawBody);
    if (event === null) return c.json({ error: 'bad_signature' }, 401);

    // If `apply` throws, nothing is recorded and the error becomes a 500: the provider retries.
    const result = await ingestEvent(c.get('db'), { provider: name, ...event }, (tx, payload) => provider.apply(tx, payload));
    return c.json({ result }, 200);
  });

  return routes;
}
