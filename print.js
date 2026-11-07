(function () {
    'use strict';

    // ======================================================================
    // Configuration: fill these in to go live (see README → "Prints").
    // Until then the dialog runs in demo mode and uploads nothing.
    // ======================================================================

    var CONFIG = {
        zazzle: {
            // Your Zazzle member account ID (required), an 18-digit number.
            memberId: '238549209714777819',
            // Leave blank. Zazzle counts any link carrying your Ambassador ID
            // (rf=) as a Cross-Promotion Link, which earns only 15% on wall
            // art; links to your own Create-a-Product pages without it can
            // earn the Self-Promotion rate (40%). Sent as rf= only if set.
            ambassadorId: '',
            // Off by default: tracking codes feed your referral history, so
            // tc= may also mark links as cross-promotion. Set one (e.g.
            // 'colourio') only once Zazzle confirms it keeps the
            // Self-Promotion rate.
            trackingCode: '',
            domain: 'zazzle.com'
        },
        // Zazzle fetches the print file from a public URL, so it's uploaded
        // first. Declare the host's domain on Zazzle's domains page.
        hosting: {
            // Which host below to use: 'worker' or 'cloudinary'.
            provider: 'worker',
            // colourio's Cloudflare Worker, which keeps files in R2 (see
            // worker/README.md). Its URL, such as
            // 'https://colourio-prints.<your-subdomain>.workers.dev'.
            worker: {
                url: 'https://colourio-prints.mwarkentin.workers.dev'
            },
            // Cloudinary, using an *unsigned* upload preset.
            cloudinary: {
                cloudName: '',
                uploadPreset: ''
            }
        },
        // Print resolution, capped so large prints stay within the canvas
        // size limits of mobile browsers. Zazzle asks for at least 100 ppi
        // for posters and prints.
        ppi: 150,
        maxPixels: 16000000,
        // One entry per Zazzle product template. `productId` is the
        // template's 18-digit product ID and `imageParam` the URL parameter
        // name of its image object (Zazzle's default is "image1"). Sizes in
        // inches; match the template's image placeholder.
        products: [
            { id: 'poster-portrait', name: 'Poster', width: 18, height: 24, productId: '256932064593255212', imageParam: 'image1' },
            { id: 'poster-landscape', name: 'Poster', width: 24, height: 18, productId: '', imageParam: 'image1' },
            { id: 'canvas', name: 'Canvas print', width: 16, height: 20, productId: '', imageParam: 'image1' },
            { id: 'square', name: 'Square print', width: 12, height: 12, productId: '', imageParam: 'image1' }
        ]
    };

    var THUMB_WIDTH = 100;
    var THUMB_HEIGHT = 80;

    var $ = function (id) { return document.getElementById(id); };

    var els = {
        printBtn: $('printBtn'),
        dialog: $('printDialog'),
        closeBtn: $('printCloseBtn'),
        products: $('printProducts'),
        demo: $('printDemo'),
        status: $('printStatus'),
        link: $('printLink'),
        linkText: $('printLinkText'),
        download: $('printDownload'),
        goBtn: $('printGoBtn'),
        open: $('printOpen'),
        mockup: $('printMockup')
    };

    var selected = CONFIG.products[0];
    var T = window.colourio.telemetry;
    var fileUrl = null;

    var HOSTING = CONFIG.hosting;
    var host = HOSTING.provider;
    var workerUrl = HOSTING.worker.url.replace(/\/+$/, '');

    var hostReady = function () {
        if (host === 'worker') { return !!workerUrl; }
        if (host === 'cloudinary') { return !!(HOSTING.cloudinary.cloudName && HOSTING.cloudinary.uploadPreset); }
        return false;
    };

    var isLive = function (product) {
        return !!(CONFIG.zazzle.memberId && hostReady() && product.productId);
    };

    var printSize = function (product) {
        var ppi = Math.min(CONFIG.ppi, Math.sqrt(CONFIG.maxPixels / (product.width * product.height)));
        return {
            width: Math.round(product.width * ppi),
            height: Math.round(product.height * ppi),
            ppi: Math.floor(ppi)
        };
    };

    var formatBytes = function (bytes) {
        return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
    };

    // Zazzle's Create-a-Product "linkover" (API guide v3): opens the product
    // page with our image in the template's image object. The image code
    // shows which design sold in your royalty history.
    var zazzleUrl = function (product, imageUrl, imageCode) {
        var memberId = CONFIG.zazzle.memberId || 'YOUR_MEMBER_ID';
        var params = new URLSearchParams();
        if (CONFIG.zazzle.ambassadorId) { params.set('rf', CONFIG.zazzle.ambassadorId); }
        params.set('ax', 'Linkover');
        params.set('pd', product.productId || 'YOUR_PRODUCT_ID');
        params.set('ed', 'true');
        if (CONFIG.zazzle.trackingCode) { params.set('tc', CONFIG.zazzle.trackingCode); }
        if (imageCode) { params.set('ic', imageCode); }
        params.set('t_' + (product.imageParam || 'image1') + '_iid', imageUrl);
        return 'https://www.' + CONFIG.zazzle.domain + '/api/create/at-' + encodeURIComponent(memberId) + '?' + params;
    };

    // RealView: a square mockup of the product with our image on it. Note
    // the image parameter ends in _url here, unlike the linkover's _iid.
    var realViewUrl = function (product, imageUrl) {
        var params = new URLSearchParams();
        params.set('pid', product.productId);
        params.set('max_dim', '512');
        params.set('at', CONFIG.zazzle.memberId);
        params.set('t_' + (product.imageParam || 'image1') + '_url', imageUrl);
        return 'https://rlv.' + CONFIG.zazzle.domain + '/svc/view?' + params;
    };

    // Image codes allow up to 100 letters, digits and underscores.
    var imageCode = function (filename) {
        return filename.replace(/\.[a-z]+$/i, '').replace(/[^A-Za-z0-9_]+/g, '_').slice(0, 100);
    };

    // Uploads the print file and resolves with its public URL. The Worker
    // answers {url} or {error: "..."}; Cloudinary answers {secure_url} or
    // {error: {message}}.
    var upload = function (blob, filename) {
        var request;
        if (host === 'worker') {
            request = fetch(workerUrl + '/v1/prints', {
                method: 'POST',
                headers: { 'Content-Type': 'image/png' },
                body: blob
            });
        } else {
            var form = new FormData();
            form.append('file', blob, filename);
            form.append('upload_preset', HOSTING.cloudinary.uploadPreset);
            request = fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(HOSTING.cloudinary.cloudName) +
                '/image/upload', { method: 'POST', body: form });
        }
        return request.then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (body) {
                var imageUrl = host === 'worker' ? body.url : body.secure_url;
                if (!res.ok || !imageUrl) {
                    var message = typeof body.error === 'string' ? body.error : body.error && body.error.message;
                    var error = new Error(message || 'HTTP ' + res.status);
                    error.status = res.status;
                    throw error;
                }
                return imageUrl;
            });
        });
    };

    // What an uploaded file's URL looks like, for the demo link.
    var exampleImageUrl = function (filename) {
        if (host === 'cloudinary') {
            return 'https://res.cloudinary.com/' + (HOSTING.cloudinary.cloudName || 'YOUR_CLOUD') + '/image/upload/' + filename;
        }
        return (workerUrl || 'https://colourio-prints.YOUR_SUBDOMAIN.workers.dev') +
            '/v1/prints/00000000-0000-0000-0000-000000000000.png';
    };

    // ======================================================================
    // Dialog
    // ======================================================================

    var setStatus = function (message, kind) {
        els.status.textContent = message;
        els.status.dataset.kind = kind || '';
    };

    var resetResult = function () {
        if (fileUrl) {
            URL.revokeObjectURL(fileUrl);
            fileUrl = null;
        }
        setStatus('');
        els.demo.hidden = isLive(selected);
        els.link.hidden = true;
        els.mockup.hidden = true;
        els.mockup.removeAttribute('src');
        els.download.hidden = true;
        els.download.classList.remove('btn-primary');
        els.open.hidden = true;
        els.goBtn.hidden = false;
        els.goBtn.disabled = false;
    };

    var buildProducts = function () {
        els.products.innerHTML = '';
        CONFIG.products.forEach(function (product) {
            var card = document.createElement('label');
            card.className = 'print-product';

            var input = document.createElement('input');
            input.type = 'radio';
            input.name = 'printProduct';
            input.value = product.id;
            input.checked = product === selected;
            input.addEventListener('change', function () {
                selected = product;
                resetResult();
            });

            // Preview at the product's shape, drawn at 2x for sharpness.
            var scale = Math.min(THUMB_WIDTH / product.width, THUMB_HEIGHT / product.height);
            var width = Math.round(product.width * scale);
            var height = Math.round(product.height * scale);
            var thumb = window.colourio.render(width * 2, height * 2);
            thumb.className = 'print-thumb';
            thumb.style.width = width + 'px';
            thumb.style.height = height + 'px';

            var frame = document.createElement('span');
            frame.className = 'print-frame';
            frame.appendChild(thumb);

            var name = document.createElement('span');
            name.className = 'print-name';
            name.textContent = product.name;

            var size = document.createElement('span');
            size.className = 'print-size';
            size.textContent = product.width + ' × ' + product.height + ' in';

            card.append(input, frame, name, size);
            els.products.appendChild(card);
        });
    };

    var finish = function (blob, filename, product) {
        fileUrl = URL.createObjectURL(blob);
        els.download.href = fileUrl;
        els.download.download = filename;
        els.download.hidden = false;
        els.goBtn.hidden = true;
        els.goBtn.disabled = false;

        if (!isLive(product)) {
            els.download.classList.add('btn-primary');
            els.linkText.textContent = zazzleUrl(product, exampleImageUrl(filename), imageCode(filename));
            els.link.hidden = false;
            return;
        }

        setStatus('Uploading print file…', 'busy');
        var timer = T.timer('print.upload', { product: product.id, upload_host: host });
        upload(blob, filename).then(function (imageUrl) {
            timer.end({ ok: true });
            T.count('print.uploaded', { product: product.id, upload_host: host });
            var link = zazzleUrl(product, imageUrl, imageCode(filename));
            els.mockup.src = realViewUrl(product, imageUrl);
            els.mockup.alt = 'Preview of the ' + product.name.toLowerCase() + ' on Zazzle';
            els.open.href = link;
            els.open.hidden = false;
            els.linkText.textContent = link;
            els.link.hidden = false;
            setStatus('Ready. Zazzle will show your stripes on the ' + product.name.toLowerCase() + '.', 'done');
        }, function (error) {
            timer.end({ ok: false });
            // The host's message isn't forwarded; the status says enough.
            T.error(new Error('Print file upload failed'), { product: product.id, upload_host: host, status: error.status || 'network' });
            T.count('print.upload_failed', { product: product.id, upload_host: host });
            setStatus('Upload failed (' + error.message + '). You can still download the print file.', 'error');
            els.download.classList.add('btn-primary');
        });
    };

    var createPrintFile = function () {
        var product = selected;
        var size = printSize(product);
        els.goBtn.disabled = true;
        setStatus('Rendering ' + size.width + ' × ' + size.height + ' px print file…', 'busy');

        var mode = isLive(product) ? 'live' : 'demo';
        var timer = T.timer('print.render', { product: product.id });

        // Give the status a frame to paint before the (blocking) render.
        requestAnimationFrame(function () {
            setTimeout(function () {
                var canvas = window.colourio.render(size.width, size.height);
                canvas.toBlob(function (blob) {
                    timer.end({ ok: !!blob });
                    if (!blob) {
                        // Usually a canvas too large for the device's memory.
                        T.error(new Error('Print file could not be created'), { product: product.id, width: size.width, height: size.height });
                        T.count('print.file_failed', { product: product.id });
                        setStatus('Couldn’t create the print file. Try a smaller product.', 'error');
                        els.goBtn.disabled = false;
                        return;
                    }
                    T.count('print.file_created', { product: product.id, mode: mode });
                    T.distribution('print.file_bytes', blob.size, 'byte', { product: product.id });
                    var info = window.colourio.describe();
                    var filename = [info.name, info.direction, info.position, product.id].join('-') + '.png';
                    setStatus('Print file ready · ' + size.width + ' × ' + size.height + ' px (' + size.ppi +
                        ' ppi) · ' + formatBytes(blob.size), 'done');
                    finish(blob, filename, product);
                }, 'image/png');
            }, 0);
        });
    };

    els.printBtn.addEventListener('click', function () {
        if (!window.colourio.render(1, 1)) { return; }
        buildProducts();
        resetResult();
        els.dialog.showModal();
        T.count('print.dialog_opened', { mode: CONFIG.products.some(isLive) ? 'live' : 'demo' });
    });

    els.open.addEventListener('click', function () {
        T.count('print.zazzle_opened', { product: selected.id });
    });
    els.download.addEventListener('click', function () {
        T.count('print.file_downloaded', { product: selected.id, mode: isLive(selected) ? 'live' : 'demo' });
    });

    els.goBtn.addEventListener('click', createPrintFile);
    els.closeBtn.addEventListener('click', function () { els.dialog.close(); });

    // Clicking the backdrop closes the dialog.
    els.dialog.addEventListener('click', function (e) {
        if (e.target === els.dialog) { els.dialog.close(); }
    });

    els.dialog.addEventListener('close', resetResult);

    // Only show the mockup if Zazzle could render it.
    els.mockup.addEventListener('load', function () { els.mockup.hidden = false; });
    els.mockup.addEventListener('error', function () {
        els.mockup.hidden = true;
        if (els.mockup.getAttribute('src')) { T.warn('Print mockup failed', { product: selected.id }); }
    });
})();
