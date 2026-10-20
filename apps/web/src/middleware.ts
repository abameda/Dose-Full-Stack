import { defineMiddleware } from 'astro:middleware';
import { dirOf, langFromPath } from './lang';

/** Puts the page's language and direction on `Astro.locals`, for the layout's `<html lang dir>`. */
export const onRequest = defineMiddleware((context, next) => {
  const lang = langFromPath(context.url.pathname);
  context.locals.lang = lang;
  context.locals.dir = dirOf(lang);
  return next();
});
