// Error reporting, performance and session replays through Sentry, loaded at
// the top of <head> so it catches errors from the rest of the page.
//
// People load their own photos, so replays never record them: canvases and
// images are blocked (and canvas recording isn't loaded), leaving grey boxes
// where they would be. Replays still show clicks, dialogs and settings. File
// names can be personal, so anything marked .sentry-mask is masked, as are
// download attributes. Inputs are masked by Sentry's defaults, and no user
// details or IP addresses are sent.
(() => {
  // The colourio project's DSN. While it's empty, nothing loads and nothing is sent.
  const SENTRY_DSN = 'https://b98b8520a5afbc19effd9745fd58ea81@o1142222.ingest.us.sentry.io/4512357893865472';
  const SDK = {
    src: 'https://browser.sentry-cdn.com/11.10.0/bundle.tracing.replay.min.js',
    integrity: 'sha384-lQjzZ9F8GMovuCkjuP9IfDB/640c2hJYHmoc7LXfsG/Lhp9d05tRhrS4sfkOw/Hz',
  };

  // Only the live site reports; local previews and tests send nothing.
  const live = location.hostname === 'mwarkentin.github.io' && location.pathname.startsWith('/colourio');
  if (!SENTRY_DSN || !live) return;

  // The deploy workflow stamps the commit on this script's data-release.
  const release = document.currentScript?.dataset.release || undefined;

  // Errors from before the SDK arrives are kept and sent once it does.
  // Errors from cross-origin scripts arrive as "Script error." with no error
  // attached; Sentry ignores those too.
  const early = [];
  const keep = (event) => {
    if (event.error || 'reason' in event) early.push(event.error ?? event.reason);
  };
  addEventListener('error', keep);
  addEventListener('unhandledrejection', keep);

  const script = document.createElement('script');
  Object.assign(script, { src: SDK.src, integrity: SDK.integrity, crossOrigin: 'anonymous' });
  script.onload = () => {
    removeEventListener('error', keep);
    removeEventListener('unhandledrejection', keep);
    Sentry.init({
      dsn: SENTRY_DSN,
      release,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: false,
          blockAllMedia: true,
          block: ['canvas'],
          mask: ['.sentry-mask'],
          maskAttributes: ['title', 'placeholder', 'download'],
        }),
      ],
      tracesSampleRate: 1,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1,
      dataCollection: { userInfo: false },
    });
    early.forEach((error) => Sentry.captureException(error, { mechanism: { handled: false } }));
  };
  document.head.append(script);
})();
