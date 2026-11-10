// Error reporting, performance, session replays, logs and metrics through
// Sentry, loaded at the top of <head> so it catches errors from the rest of
// the page.
//
// People load their own photos, so replays never record them: canvases and
// images are blocked (and canvas recording isn't loaded), leaving grey boxes
// where they would be. Replays still show clicks, dialogs and settings. File
// names can be personal, so anything marked .sentry-mask is masked, as are
// download attributes. Inputs are masked by Sentry's defaults, and no user
// details or IP addresses are sent.
//
// The app reports through window.colourioTelemetry (below), which exists even
// when Sentry doesn't load, so app code can call it anywhere. Log and metric
// attributes may only be numbers, booleans or short strings from a fixed set
// (such as source: "upload"): never file names, URLs, colours or other text.
(() => {
  // The colourio project's DSN. While it's empty, nothing loads and nothing is sent.
  const SENTRY_DSN = 'https://b98b8520a5afbc19effd9745fd58ea81@o1142222.ingest.us.sentry.io/4512357893865472';
  const SDK = {
    src: 'https://browser.sentry-cdn.com/11.10.0/bundle.tracing.replay.logs.metrics.min.js',
    integrity: 'sha384-B+WMd8/+CmQVo0y6MSf00jCF4kTC2TdqWOmzZO+mIC42N/Eo0/3fopMkrDr+bDqp',
  };

  // Only the live site reports; local previews and tests send nothing.
  // That's the address in index.html's canonical link, which comes before
  // this script.
  const canonical = document.querySelector('link[rel="canonical"]');
  const live = Boolean(canonical) && location.origin === new URL(canonical.href).origin;
  const enabled = Boolean(SENTRY_DSN) && live;

  // Attribute values must look like identifiers ("upload", "1920x1080",
  // "16:9", "NotAllowedError"); anything else is dropped, so a file name or a
  // URL can't slip through by mistake.
  const SAFE_VALUE = /^[A-Za-z0-9_.:+-]{1,40}$/;
  const clean = (attributes) => {
    const out = {};
    Object.keys(attributes || {}).forEach((key) => {
      const value = attributes[key];
      if (typeof value === 'number' && isFinite(value)) out[key] = value;
      else if (typeof value === 'boolean') out[key] = value;
      else if (typeof value === 'string' && SAFE_VALUE.test(value)) out[key] = value;
    });
    return out;
  };
  // A backstop for attributes that reach Sentry by any other route; the
  // SDK's own sentry.* attributes are kept.
  const scrubAttributes = (item) => {
    if (item && item.attributes) {
      const own = {};
      const internal = {};
      Object.keys(item.attributes).forEach((key) => {
        (key.startsWith('sentry.') ? internal : own)[key] = item.attributes[key];
      });
      item.attributes = { ...clean(own), ...internal };
    }
    return item;
  };

  // The SDK is 'off' (not the live site), 'loading', 'ready' or 'failed'
  // (an ad blocker, say). Calls made while it's loading wait here, then run
  // in order once it's ready; if it fails, they're dropped.
  let sdk = enabled ? 'loading' : 'off';
  const pending = [];
  const run = (fn) => {
    if (sdk === 'ready') fn();
    else if (sdk === 'loading' && pending.length < 200) pending.push(fn);
  };

  window.colourioTelemetry = {
    // Where the SDK is up to, for debugging: off, loading, ready or failed.
    get status() {
      return sdk;
    },
    // A metric counter, e.g. count('print.uploaded', { product: 'canvas' }).
    count(name, attributes) {
      run(() => Sentry.metrics.count(name, 1, { attributes: clean(attributes) }));
    },
    // A metric distribution, e.g. distribution('print.file_bytes', 2e5, 'byte').
    distribution(name, value, unit, attributes) {
      if (typeof value !== 'number' || !isFinite(value)) return;
      run(() => Sentry.metrics.distribution(name, value, { unit, attributes: clean(attributes) }));
    },
    // A log line. Messages are fixed strings; details go in attributes.
    info(message, attributes) {
      run(() => Sentry.logger.info(message, clean(attributes)));
    },
    warn(message, attributes) {
      run(() => Sentry.logger.warn(message, clean(attributes)));
    },
    // A handled failure worth fixing, sent as an error with its attributes as tags.
    error(error, attributes) {
      run(() => Sentry.captureException(error, { tags: clean(attributes) }));
    },
    // Times a step that may finish in a callback: const t = timer('print.render');
    // ...; t.end({ product }). The span is created when it ends, with the
    // recorded start time, so it works before the SDK has loaded too.
    timer(name, attributes) {
      const startTime = Date.now() / 1000;
      return {
        end(extra) {
          const endTime = Date.now() / 1000;
          const all = clean({ ...attributes, ...extra });
          run(() => Sentry.startInactiveSpan({ name, op: name, startTime, attributes: all }).end(endTime));
        },
      };
    },
  };

  if (!enabled) return;

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
      beforeSendLog: scrubAttributes,
      beforeSendMetric: scrubAttributes,
    });
    early.forEach((error) => Sentry.captureException(error, { mechanism: { handled: false } }));
    sdk = 'ready';
    pending.splice(0).forEach((fn) => fn());
  };
  script.onerror = () => {
    sdk = 'failed';
    pending.length = 0;
  };
  document.head.append(script);
})();
