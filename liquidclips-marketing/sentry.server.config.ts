// Sentry server (Node.js) init. Stripped to bare minimum + debug:true to
// surface SDK init/transport logs in Vercel function output.

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://d8cb20dbccc11e5db66a16b636c3d34e@o4511540773191680.ingest.us.sentry.io/4511540778106880",
  debug: true,
  tracesSampleRate: 0,
});
