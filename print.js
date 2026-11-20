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
        // first to colourio's Cloudflare Worker, which keeps files in R2 (see
        // worker/README.md). Its domain must be declared on Zazzle's domains
        // page. While this is empty, the dialog stays in demo mode.
        printsUrl: 'https://prints.michaelwarkentin.com',
        // Print resolution, capped so large prints stay within the canvas
        // size limits of mobile browsers. Zazzle asks for at least 100 ppi
        // for posters and prints.
        ppi: 150,
        maxPixels: 16000000,
        // One entry per Zazzle product template, grouped in the dialog by
        // `material` (its name as shown, e.g. 'Poster' or 'Metal'), in the
        // order materials first appear here; sizes keep their order too.
        // Adding a product, or a whole new material, is one entry here.
        // `id` is a short, unique identifier, used in file names and
        // telemetry. `productId` is the template's 18-digit product ID
        // (leave it empty to keep that product in demo mode) and
        // `imageParam` the URL parameter name of its image object (Zazzle's
        // default is "image1"). Sizes in inches; match the template's image
        // placeholder. Each shape needs its own template: one set to another
        // size crops to its own shape and then stretches. `wrap` is the
        // margin in inches that a canvas folds round its frame: the file gets
        // that much extra on every side, mirrored from the stripes, so the
        // whole width × height shows on the front.
        products: [
            { id: 'poster-portrait', material: 'Poster', width: 18, height: 24, productId: '256932064593255212', imageParam: 'image1' },
            { id: 'poster-landscape', material: 'Poster', width: 24, height: 18, productId: '256970220779415887', imageParam: 'image1' },
            { id: 'square', material: 'Poster', width: 12, height: 12, productId: '256382642826496595', imageParam: 'image1' },
            // RealView puts the front edge about 1.75 in from the file's
            // edge: the 1.25 in frame depth plus the fold to the back.
            { id: 'canvas', material: 'Canvas', width: 16, height: 20, wrap: 1.75, productId: '256192989000270834', imageParam: 'image1' }
        ]
    };

    // Material cards' thumbnails fit this box; size options' a smaller one.
    var THUMB_WIDTH = 100;
    var THUMB_HEIGHT = 80;
    var SIZE_THUMB = 32;

    var $ = function (id) { return document.getElementById(id); };

    var els = {
        printBtn: $('printBtn'),
        dialog: $('printDialog'),
        closeBtn: $('printCloseBtn'),
        materials: $('printMaterials'),
        sizes: $('printSizes'),
        demo: $('printDemo'),
        status: $('printStatus'),
        link: $('printLink'),
        linkText: $('printLinkText'),
        download: $('printDownload'),
        goBtn: $('printGoBtn'),
        open: $('printOpen'),
        mockup: $('printMockup')
    };

    // Materials in the order they first appear in CONFIG.products, each
    // with its sizes: [{ id, name, products }]. `id` is the name in lower
    // case with dashes, e.g. 'canvas'.
    var materials = [];
    CONFIG.products.forEach(function (product) {
        var name = product.material || 'Poster';
        var id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        var material = materials.filter(function (m) { return m.id === id; })[0];
        if (!material) {
            material = { id: id, name: name, products: [] };
            materials.push(material);
        }
        material.products.push(product);
    });
    var materialOf = function (product) {
        return materials.filter(function (m) { return m.products.indexOf(product) !== -1; })[0];
    };

    var selected = CONFIG.products[0];
    // The size last picked in each material, so switching back keeps it.
    var picked = {};
    materials.forEach(function (m) { picked[m.id] = m.products[0]; });
    var T = window.colourio.telemetry;

    var printsUrl = CONFIG.printsUrl.replace(/\/+$/, '');

    var isLive = function (product) {
        return !!(CONFIG.zazzle.memberId && printsUrl && product.productId);
    };

    // The whole file's size in pixels; `wrap` is the mirrored margin on each
    // side (0 for posters).
    var printSize = function (product) {
        var margin = product.wrap || 0;
        var width = product.width + 2 * margin;
        var height = product.height + 2 * margin;
        var ppi = Math.min(CONFIG.ppi, Math.sqrt(CONFIG.maxPixels / (width * height)));
        var wrap = Math.round(margin * ppi);
        return {
            width: Math.round(product.width * ppi) + 2 * wrap,
            height: Math.round(product.height * ppi) + 2 * wrap,
            wrap: wrap,
            ppi: Math.floor(ppi)
        };
    };

    // Puts `front` in the middle of a canvas `wrap` px bigger on every side,
    // and fills the margins with mirror images of it, so the stripes carry on
    // round a canvas's edges.
    var mirrorWrap = function (front, wrap) {
        var w = front.width;
        var h = front.height;
        var out = document.createElement('canvas');
        out.width = w + 2 * wrap;
        out.height = h + 2 * wrap;
        var ctx = out.getContext('2d');
        [-1, 0, 1].forEach(function (col) {
            [-1, 0, 1].forEach(function (row) {
                ctx.save();
                ctx.translate(wrap + col * w + (col ? w : 0), wrap + row * h + (row ? h : 0));
                ctx.scale(col ? -1 : 1, row ? -1 : 1);
                ctx.drawImage(front, 0, 0);
                ctx.restore();
            });
        });
        return out;
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
    // answers {url} or {error: "..."}.
    var upload = function (blob) {
        return fetch(printsUrl + '/v1/prints', {
            method: 'POST',
            headers: { 'Content-Type': 'image/png' },
            body: blob
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (body) {
                var imageUrl = body.url;
                if (!res.ok || !imageUrl) {
                    var message = typeof body.error === 'string' ? body.error : '';
                    var error = new Error(message || 'HTTP ' + res.status);
                    error.status = res.status;
                    throw error;
                }
                return imageUrl;
            });
        });
    };

    // What an uploaded file's URL looks like, for the demo link.
    var exampleImageUrl = function () {
        return (printsUrl || 'https://prints.example.com') + '/v1/prints/00000000-0000-0000-0000-000000000000.png';
    };

    // ======================================================================
    // Dialog (a state machine: machine.js; README → "State machines")
    // ======================================================================

    // The print file on offer, from the moment it's rendered until the
    // dialog closes or another product is picked:
    // { blob, filename, product, dims, url }: dims is printSize()'s answer and
    // url the download link's object URL.
    var file = null;
    var HAS_FILE = ['demoReady', 'uploading', 'uploadFailed', 'ready'];

    var setStatus = function (message, kind) {
        els.status.textContent = message;
        els.status.dataset.kind = kind || '';
    };

    var keepFile = function (made) {
        file = made;
        file.url = URL.createObjectURL(made.blob);
        els.download.href = file.url;
        els.download.download = file.filename;
    };

    var dropFile = function () {
        if (!file) { return; }
        URL.revokeObjectURL(file.url);
        els.download.removeAttribute('href');
        file = null;
    };

    // Everything the dialog shows follows from its state. `data` is what the
    // event that led here carried.
    var show = function (status, data) {
        var hasFile = HAS_FILE.indexOf(status) !== -1;
        var canCreate = status === 'choosing' || status === 'rendering' || status === 'renderFailed';
        var size = file ? file.dims : printSize(selected);

        els.demo.hidden = isLive(selected);
        els.download.hidden = !hasFile;
        // Downloading is the main action in demo mode; after a failed
        // upload, trying again is.
        els.download.classList.toggle('btn-primary', status === 'demoReady');
        els.goBtn.hidden = !(canCreate || status === 'uploadFailed');
        els.goBtn.disabled = status === 'rendering';
        els.goBtn.textContent = status === 'uploadFailed' ? 'Try upload again' : 'Create print file';
        els.link.hidden = !(status === 'demoReady' || status === 'ready');
        els.open.hidden = status !== 'ready';
        if (status !== 'ready') {
            els.mockup.hidden = true;
            els.mockup.removeAttribute('src');
        }

        if (status === 'rendering') {
            setStatus('Rendering ' + size.width + ' × ' + size.height + ' px print file…', 'busy');
        } else if (status === 'renderFailed') {
            setStatus('Couldn’t create the print file. Try a smaller size.', 'error');
        } else if (status === 'demoReady') {
            setStatus('Print file ready · ' + size.width + ' × ' + size.height + ' px (' + size.ppi +
                ' ppi) · ' + formatBytes(file.blob.size), 'done');
            els.linkText.textContent = zazzleUrl(file.product, exampleImageUrl(), imageCode(file.filename));
        } else if (status === 'uploading') {
            setStatus('Uploading print file…', 'busy');
        } else if (status === 'uploadFailed') {
            setStatus('Upload failed (' + data.message + '). You can still download the print file.', 'error');
        } else if (status === 'ready') {
            var name = materialOf(file.product).name.toLowerCase();
            els.mockup.src = realViewUrl(file.product, data.imageUrl);
            els.mockup.alt = 'Preview of the ' + sizeText(file.product) + ' ' + name + ' on Zazzle';
            els.open.href = data.link;
            els.linkText.textContent = data.link;
            setStatus('Ready. Zazzle will show your stripes on the ' + name + '.', 'done');
        } else {
            setStatus('');
        }
    };

    var renderFile = function () {
        var guard = flow.guard();
        var product = selected;
        var size = printSize(product);
        var mode = isLive(product) ? 'live' : 'demo';
        var timer = T.timer('print.render', { product: product.id });

        // Give the status a frame to paint before the (blocking) render.
        requestAnimationFrame(function () {
            setTimeout(function () {
                // Picked another product or closed the dialog meanwhile.
                if (!guard.active()) { return; }
                var canvas = window.colourio.render(size.width - 2 * size.wrap, size.height - 2 * size.wrap);
                if (canvas && size.wrap) { canvas = mirrorWrap(canvas, size.wrap); }
                canvas.toBlob(function (blob) {
                    timer.end({ ok: !!blob });
                    if (!blob) {
                        // Usually a canvas too large for the device's memory.
                        T.error(new Error('Print file could not be created'), { product: product.id, width: size.width, height: size.height });
                        T.count('print.file_failed', { product: product.id });
                        guard.send('RENDER_FAILED');
                        return;
                    }
                    T.count('print.file_created', { product: product.id, mode: mode });
                    T.distribution('print.file_bytes', blob.size, 'byte', { product: product.id });
                    var info = window.colourio.describe();
                    var filename = [info.name, info.direction, info.position, product.id].join('-') + '.png';
                    guard.send(mode === 'live' ? 'UPLOAD' : 'DEMO', { blob: blob, filename: filename, product: product, dims: size });
                }, 'image/png');
            }, 0);
        });
    };

    var uploadFile = function () {
        var guard = flow.guard();
        var product = file.product;
        var filename = file.filename;
        var timer = T.timer('print.upload', { product: product.id });
        upload(file.blob).then(function (imageUrl) {
            timer.end({ ok: true });
            T.count('print.uploaded', { product: product.id });
            guard.send('UPLOADED', { imageUrl: imageUrl, link: zazzleUrl(product, imageUrl, imageCode(filename)) });
        }, function (error) {
            timer.end({ ok: false });
            // The Worker's message isn't forwarded; the status says enough.
            T.error(new Error('Print file upload failed'), { product: product.id, status: error.status || 'network' });
            T.count('print.upload_failed', { product: product.id });
            guard.send('UPLOAD_FAILED', { message: error.message });
        });
    };

    // Picking another size or material (SELECT) or closing the dialog starts over,
    // and drops any render or upload still under way.
    var flow = colourioMachine({
        name: 'print',
        initial: 'closed',
        states: {
            closed: { OPEN: 'choosing' },
            choosing: { CREATE: 'rendering', SELECT: 'choosing', CLOSE: 'closed' },
            rendering: { DEMO: 'demoReady', UPLOAD: 'uploading', RENDER_FAILED: 'renderFailed', SELECT: 'choosing', CLOSE: 'closed' },
            renderFailed: { CREATE: 'rendering', SELECT: 'choosing', CLOSE: 'closed' },
            demoReady: { SELECT: 'choosing', CLOSE: 'closed' },
            uploading: { UPLOADED: 'ready', UPLOAD_FAILED: 'uploadFailed', SELECT: 'choosing', CLOSE: 'closed' },
            uploadFailed: { RETRY: 'uploading', SELECT: 'choosing', CLOSE: 'closed' },
            ready: { SELECT: 'choosing', CLOSE: 'closed' }
        },
        enter: function (status, data, from, event) {
            if (event === 'DEMO' || event === 'UPLOAD') { keepFile(data); }
            if (HAS_FILE.indexOf(status) === -1) { dropFile(); }
            show(status, data);
            if (status === 'rendering') { renderFile(); }
            if (status === 'uploading') { uploadFile(); }
        }
    });

    // Stripes drawn at a product's shape, fitted to maxWidth × maxHeight
    // CSS px and drawn at 2x for sharpness.
    var thumbnail = function (product, maxWidth, maxHeight) {
        var scale = Math.min(maxWidth / product.width, maxHeight / product.height);
        var width = Math.max(1, Math.round(product.width * scale));
        var height = Math.max(1, Math.round(product.height * scale));
        var thumb = window.colourio.render(width * 2, height * 2);
        thumb.className = 'print-thumb';
        thumb.style.width = width + 'px';
        thumb.style.height = height + 'px';
        return thumb;
    };

    var span = function (className, text) {
        var el = document.createElement('span');
        el.className = className;
        if (text) { el.textContent = text; }
        return el;
    };

    var sizeText = function (product) {
        return product.width + ' × ' + product.height + ' in';
    };

    var shapeName = function (product) {
        if (product.width === product.height) { return 'Square'; }
        return product.width > product.height ? 'Landscape' : 'Portrait';
    };

    // A radio button inside a card-like label; the label is what's clicked.
    var option = function (className, groupName, value, checked, onPick) {
        var label = document.createElement('label');
        label.className = className;
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.value = value;
        input.checked = checked;
        input.addEventListener('change', onPick);
        label.appendChild(input);
        return label;
    };

    var pick = function (product) {
        selected = product;
        picked[materialOf(product).id] = product;
        flow.send('SELECT');
    };

    // The material card's thumbnail shows its current size's shape.
    var buildMaterialThumb = function (material) {
        var frame = els.materials.querySelector('[data-material="' + material.id + '"] .print-frame');
        if (!frame) { return; }
        frame.innerHTML = '';
        var art = span('print-art');
        art.appendChild(thumbnail(picked[material.id], THUMB_WIDTH, THUMB_HEIGHT));
        frame.appendChild(art);
    };

    var buildSizes = function () {
        var material = materialOf(selected);
        els.sizes.innerHTML = '';
        els.sizes.setAttribute('aria-label', material.name + ' size');
        material.products.forEach(function (product) {
            var card = option('print-size-option', 'printSize', product.id, product === selected, function () {
                pick(product);
                buildMaterialThumb(material);
            });
            var frame = span('print-size-frame');
            frame.appendChild(thumbnail(product, SIZE_THUMB, SIZE_THUMB));
            var text = span('print-size-text');
            text.append(span('print-name', sizeText(product)), span('print-size', shapeName(product)));
            card.append(frame, text);
            els.sizes.appendChild(card);
        });
    };

    var buildProducts = function () {
        els.materials.innerHTML = '';
        materials.forEach(function (material) {
            var card = option('print-product print-material', 'printMaterial', material.id, material === materialOf(selected), function () {
                pick(picked[material.id]);
                buildSizes();
            });
            card.dataset.material = material.id;
            var count = material.products.length;
            card.append(span('print-frame'), span('print-name', material.name), span('print-size', count === 1 ? sizeText(material.products[0]) : count + ' sizes'));
            els.materials.appendChild(card);
            buildMaterialThumb(material);
        });
        buildSizes();
    };

    els.printBtn.addEventListener('click', function () {
        if (!window.colourio.render(1, 1) || !flow.is('closed')) { return; }
        buildProducts();
        flow.send('OPEN');
        els.dialog.showModal();
        T.count('print.dialog_opened', { mode: CONFIG.products.some(isLive) ? 'live' : 'demo' });
    });

    els.goBtn.addEventListener('click', function () {
        flow.send(flow.is('uploadFailed') ? 'RETRY' : 'CREATE');
    });

    els.open.addEventListener('click', function () {
        T.count('print.zazzle_opened', { product: selected.id });
    });
    els.download.addEventListener('click', function () {
        T.count('print.file_downloaded', { product: selected.id, mode: isLive(selected) ? 'live' : 'demo' });
    });

    els.closeBtn.addEventListener('click', function () { els.dialog.close(); });

    // Clicking the backdrop closes the dialog.
    els.dialog.addEventListener('click', function (e) {
        if (e.target === els.dialog) { els.dialog.close(); }
    });

    // However it closes: a button, Escape or the backdrop.
    els.dialog.addEventListener('close', function () { flow.send('CLOSE'); });

    // Only show the mockup if Zazzle could render it.
    els.mockup.addEventListener('load', function () {
        if (flow.is('ready')) { els.mockup.hidden = false; }
    });
    els.mockup.addEventListener('error', function () {
        els.mockup.hidden = true;
        if (els.mockup.getAttribute('src')) { T.warn('Print mockup failed', { product: selected.id }); }
    });
})();
