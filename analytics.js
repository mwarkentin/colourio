// Page views through Counterscale (https://counterscale.dev), which runs on
// our own Cloudflare account, like the tools and games sites. One page view
// per page load, and nothing else.
//
// Share links carry the whole session in the URL #fragment (a sample id, the
// line, the crop, or colours sampled from someone's own photo), so each page
// view sends the page's path and never its query string or fragment, plus
// the site the visitor came from, as its origin only. Counterscale adds the
// browser and device from the user agent and the country Cloudflare works
// out from the IP address, which it doesn't keep. It sets no cookies.
(() => {
  // Counterscale's address, as the installer printed it. While it's empty,
  // nothing loads and nothing is sent.
  const COUNTERSCALE_URL = 'https://counterscale.mwarkentin.workers.dev';
  const SITE_ID = 'colourio';
  // Counterscale's own tracker, checked against this hash before it runs.
  // Keep it on the version the Counterscale install runs, and update the URL
  // and the hash together (see the README).
  const TRACKER = {
    src: 'https://cdn.jsdelivr.net/npm/@counterscale/tracker@3.4.1/dist/module/index.js',
    integrity: 'sha384-TrbROGVCq2iQjt2unBGc1J1F/aWAilTeZsXPOGEeCswrzsk2oi6fkFfAJAEfLBOr',
  };

  // Only the live site reports; local previews and tests send nothing.
  const live = location.hostname === 'mwarkentin.github.io' && location.pathname.startsWith('/colourio');
  if (!COUNTERSCALE_URL || !live) return;

  // Another site's origin, or this one's, which the tracker records as no
  // referrer. Passing one stops the tracker falling back to the full
  // document.referrer, or to a referrer in this page's own query string
  // (?ref=, ?source= and the like).
  const referrer = (() => {
    try {
      const { origin } = new URL(document.referrer);
      return origin === 'null' ? location.origin : origin;
    } catch {
      return location.origin;
    }
  })();

  // import() can't check an integrity hash, so fetch the module, which the
  // browser checks, and import that.
  fetch(TRACKER.src, { integrity: TRACKER.integrity })
    .then((response) => (response.ok ? response.text() : Promise.reject(new Error(response.statusText))))
    .then((code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      return import(url).finally(() => URL.revokeObjectURL(url));
    })
    .then((Counterscale) => {
      // One page view per load; the tracker won't watch history.pushState,
      // and opening a share link only changes the fragment.
      Counterscale.init({ siteId: SITE_ID, reporterUrl: `${COUNTERSCALE_URL}/collect`, autoTrackPageviews: false });
      Counterscale.trackPageview({ url: location.pathname, referrer });
    })
    // A blocked or failed tracker costs a page view, never the app.
    .catch(() => {});
})();
