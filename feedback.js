// The "Send feedback" dialog (#feedbackDialog in index.html). The footer's
// link (data-feedback) goes to the repo's issue forms; this opens the dialog
// instead. Once telemetry.js has loaded Sentry, the dialog is a form that
// sends to Sentry's User Feedback with the replay's last minute: photos are
// blocked from replays as always, and the form's fields are masked. Either
// way it links to the Bug and Idea forms, filled in with the device and
// browser and details of the page and settings, which people see and can
// edit before sending. No photo or file name ever goes in them.
(function () {
    'use strict';

    var ISSUES = 'https://github.com/mwarkentin/colourio/issues/new';
    var $ = function (id) { return document.getElementById(id); };
    var dialog = $('feedbackDialog');
    if (!dialog) { return; }
    var form = dialog.querySelector('form');
    var title = $('feedbackTitle');
    var links = dialog.querySelectorAll('a[data-issue]');
    var thanks = 0;

    var sentry = function () { return !!(window.Sentry && Sentry.getClient && Sentry.getClient()); };

    // A short "iPhone · iOS 18.5 · Safari 18.5" from the user agent. The
    // whole user agent goes in the details too, so this only needs to read well.
    var deviceAndBrowser = function () {
        var ua = navigator.userAgent;
        var ios = ua.match(/(iPhone|iPad|iPod).*? OS (\d+)_(\d+)/);
        var android = ua.match(/Android ([\d.]+)/);
        var system = ios ? ios[1] + ' · iOS ' + ios[2] + '.' + ios[3]
            // iPads ask for desktop sites, as a Mac with a touch screen.
            : /Macintosh/.test(ua) && navigator.maxTouchPoints > 1 ? 'iPad'
            : /Android/.test(ua) ? ('Android ' + (android ? android[1] : '')).trim()
            : /Mac OS X/.test(ua) ? 'Mac'
            : /Windows/.test(ua) ? 'Windows'
            : /CrOS/.test(ua) ? 'ChromeOS'
            : /Linux/.test(ua) ? 'Linux' : '';
        // Most specific first: Edge and Samsung Internet say Chrome too, and
        // every browser on iOS says Safari. Links shared on social sites
        // often open in the app's own browser.
        var browsers = [
            [/Instagram/, 'Instagram’s browser'],
            [/FBAN|FBAV/, 'Facebook’s browser'],
            [/Pinterest/, 'Pinterest’s browser'],
            [/LinkedInApp/, 'LinkedIn’s browser'],
            [/EdgA?\/(\d+)|EdgiOS\/(\d+)/, 'Edge'],
            [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
            [/Firefox\/(\d+)|FxiOS\/(\d+)/, 'Firefox'],
            [/Chrome\/(\d+)|CriOS\/(\d+)/, 'Chrome'],
            [/Version\/([\d.]+).*Safari/, 'Safari']
        ];
        var browser = '';
        for (var i = 0; i < browsers.length; i++) {
            var match = ua.match(browsers[i][0]);
            if (!match) { continue; }
            var version = match.slice(1).filter(Boolean)[0];
            browser = browsers[i][1] + (version ? ' ' + version : '');
            break;
        }
        return [system, browser].filter(Boolean).join(' · ') || ua;
    };

    var checked = function (name) {
        var input = document.querySelector('input[name="' + name + '"]:checked');
        return input ? input.value : '';
    };

    // The address without its query string or fragment, which hold share
    // links' colours. The settings are the controls' own values.
    var details = function () {
        var source = $('source');
        var size = $('size');
        var thickness = $('thickness');
        var telemetry = document.querySelector('script[data-release]');
        var release = telemetry ? telemetry.dataset.release : '';
        var replay = window.Sentry && Sentry.getReplay && Sentry.getReplay();
        var replayId = replay && replay.getReplayId && replay.getReplayId();
        var dark = matchMedia('(prefers-color-scheme: dark)').matches;
        var app = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
        return [
            'Page: ' + location.origin + location.pathname,
            source && source.dataset.imageSize && 'Image: ' + source.dataset.imageSize,
            'Settings: ' + [
                checked('direction'),
                thickness && thickness.value + ' px',
                checked('blend'),
                size && size.value
            ].filter(Boolean).join(', '),
            'Window: ' + innerWidth + '×' + innerHeight + ' at ' + devicePixelRatio + '×, ' +
                (dark ? 'dark' : 'light') + ' mode, ' + (app ? 'Home Screen app' : 'browser tab'),
            release && 'Version: ' + release.slice(0, 7),
            replayId && 'Sentry replay: ' + replayId,
            'User agent: ' + navigator.userAgent
        ].filter(Boolean).join('\n');
    };

    // Field names are the ids in .github/ISSUE_TEMPLATE/bug.yml and idea.yml.
    var issueUrl = function (kind, message) {
        message = (message || '').trim().slice(0, 2000);
        var fields = kind === 'bug'
            ? { template: 'bug.yml', what: message, device: deviceAndBrowser(), details: details() }
            : { template: 'idea.yml', idea: message };
        var query = new URLSearchParams();
        Object.keys(fields).forEach(function (key) {
            if (fields[key]) { query.set(key, fields[key]); }
        });
        return ISSUES + '?' + query;
    };

    var open = function () {
        // A "Thanks" still showing from the last one mustn't close this one.
        clearTimeout(thanks);
        dialog.dataset.mode = sentry() ? 'sentry' : 'github';
        title.textContent = 'Send feedback';
        // Ready for a long press or a right click, which skip the click handler.
        links.forEach(function (link) { link.href = issueUrl(link.dataset.issue); });
        if (!dialog.open) { dialog.showModal(); }
        if (dialog.dataset.mode === 'sentry') { form.message.focus(); }
    };

    // A click meant for a new tab still goes to GitHub.
    document.addEventListener('click', function (e) {
        var link = e.target instanceof Element && e.target.closest('[data-feedback]');
        if (!link || e.button || e.metaKey || e.ctrlKey || e.shiftKey) { return; }
        e.preventDefault();
        open();
    });

    $('feedbackCloseBtn').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (e) {
        if (e.target === dialog) { dialog.close(); }
    });
    // A screenshot pasted here mustn't replace the photo being worked on.
    dialog.addEventListener('paste', function (e) { e.stopPropagation(); });

    // Filled in as it's followed, so it carries anything typed in the form,
    // and the replay so far is sent for the issue to point to.
    links.forEach(function (link) {
        link.addEventListener('click', function () {
            link.href = issueUrl(link.dataset.issue, dialog.dataset.mode === 'sentry' ? form.message.value : '');
            var replay = window.Sentry && Sentry.getReplay && Sentry.getReplay();
            if (replay && replay.flush) { replay.flush().catch(function () {}); }
            setTimeout(function () { dialog.close(); });
        });
    });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var message = form.message.value.trim();
        if (!message || !sentry()) { return; }
        Sentry.captureFeedback({ message: message, email: form.email.value.trim() || undefined }, { includeReplay: true });
        form.reset();
        title.textContent = 'Thanks! Sent.';
        thanks = setTimeout(function () { dialog.close(); }, 1500);
    });
})();
