// Page-view counts through Counterscale, the same self-hosted analytics the
// tools and games sites use. One page view per page load, and nothing else.
//
// Share links carry the whole session in the URL #fragment (a sample id, the
// line, the crop, or colours sampled from someone's own photo), so only the
// page's path is sent: never the query string or the fragment. The referrer
// is sent as an origin only, and moves within the site count as no referrer.
// Counterscale sets no cookies.
(() => {
  const SITE_ID = 'colourio';
  const REPORTER_URL = 'https://counterscale.mwarkentin.workers.dev/collect';
  // Keep this on the version the Counterscale install runs. Update the URL
  // and the hash together (see the README).
  const TRACKER = {
    src: 'https://cdn.jsdelivr.net/npm/@counterscale/tracker@3.4.1/dist/module/index.js',
    integrity: 'sha384-TrbROGVCq2iQjt2unBGc1J1F/aWAilTeZsXPOGEeCswrzsk2oi6fkFfAJAEfLBOr',
  };

  // Only the live site reports; local previews and tests send nothing.
  const live = location.hostname === 'mwarkentin.github.io' && location.pathname.startsWith('/colourio');
  if (!live) return;

  // The path only: no query string, no fragment.
  const url = location.origin + location.pathname;

  // An external referrer as its origin only. Passing our own origin tells
  // the tracker there's no referrer; an empty string would make it fall back
  // to document.referrer (path included) and ?ref= or ?utm_source= in the URL.
  let referrer = location.origin;
  try {
    const from = document.referrer ? new URL(document.referrer).origin : '';
    if (from && from !== 'null' && from !== location.origin) referrer = from;
  } catch (e) {
    // Not a URL we can read; count it as no referrer.
  }

  // Fetching with an integrity hash makes the browser check the file before
  // it runs; a blob: URL then lets it be imported as a module.
  fetch(TRACKER.src, { integrity: TRACKER.integrity, credentials: 'omit' })
    .then((response) => {
      if (!response.ok) throw new Error('Counterscale tracker: HTTP ' + response.status);
      return response.text();
    })
    .then((code) => {
      const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      return import(blobUrl).finally(() => URL.revokeObjectURL(blobUrl));
    })
    .then((Counterscale) => {
      Counterscale.init({ siteId: SITE_ID, reporterUrl: REPORTER_URL, autoTrackPageviews: false });
      Counterscale.trackPageview({ url, referrer });
    })
    .catch(() => {
      // Blocked or failed to load: analytics are optional, so stay quiet.
    });
})();
