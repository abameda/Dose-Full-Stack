import type { Staff } from '@dose/contract';
import type { Db, Tx } from '@dose/core/db';
import { Hono } from 'hono';
import { adminRoutes } from './admin-routes';
import { storefrontRoutes } from './storefront-routes';
import { webhookRoutes } from './webhook-routes';

/**
 * A payment or shipping provider's webhook, as the API sees it. `verify` checks the provider's
 * signature over the exact bytes it sent and returns the event, or null when the request is not
 * genuine. `apply` changes state on the transaction the API opens for the event.
 */
export type WebhookProvider = {
  verify(req: Request, rawBody: string): Promise<{ eventId: string; payload: unknown } | null>;
  apply(tx: Tx, payload: unknown): Promise<void>;
};

export type ApiDeps = {
  /** A fresh `Db` for one request; the app closes it when the request ends. */
  db: () => Db;
  env: 'local' | 'test' | 'preview' | 'staging' | 'production';
  now: () => Date;
  /** Who is asking, for the admin routes: `createAccessVerifier` in every deployed environment. */
  verifyStaff: (req: Request) => Promise<Staff | null>;
  /** Keyed by the `:provider` segment of `/api/webhooks/:provider`. */
  webhookProviders: Record<string, WebhookProvider>;
};

/** Hono's type parameter: what the middleware puts on the request context. */
export type ApiEnv = { Variables: { db: Db } };

export function createApp(deps: ApiDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // One Db per request, closed when it ends whatever the outcome.
  app.use('/api/*', async (c, next) => {
    const db = deps.db();
    c.set('db', db);
    try {
      await next();
    } finally {
      await db.close().catch((error: unknown) => {
        console.error('api: closing the request database failed', error);
      });
    }
  });

  app.route('/', storefrontRoutes(deps));
  app.route('/', webhookRoutes(deps));
  app.route('/', adminRoutes(deps));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((error, c) => {
    console.error('api: unhandled error', error);
    return c.json({ error: 'internal' }, 500);
  });
  return app;
}
