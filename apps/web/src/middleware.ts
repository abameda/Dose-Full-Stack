import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { verifyStaffFor } from './env';
import { dirOf, langFromPath } from './lang';
import { guardStudio, isStudioPath, withStudioHeaders } from './studio-guard';

/**
 * Puts the page's language and direction on `Astro.locals`, for the layout's `<html lang dir>`,
 * and keeps the studio behind staff sign-in: no staff is a 401, and every studio response, a
 * refusal or an error included, is private and not indexed.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const lang = langFromPath(context.url.pathname);
  context.locals.lang = lang;
  context.locals.dir = dirOf(lang);

  if (!isStudioPath(context.url.pathname)) return next();
  try {
    const refusal = await guardStudio(context.request, verifyStaffFor(env));
    if (refusal !== null) return refusal;
    return withStudioHeaders(await next());
  } catch (error) {
    // Fail closed: a fault while checking who is asking (or rendering) shows nothing.
    console.error('studio: request failed', error);
    return withStudioHeaders(new Response('The studio could not answer.', { status: 500 }));
  }
});
