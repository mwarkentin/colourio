(function () {
    'use strict';

    // Large images are scaled down on load so sampling stays fast.
    var MAX_SOURCE_SIZE = 3000;
    var PREVIEW_MAX_SIZE = 800;
    var PALETTE_SIZE = 6;
    var GRADIENT_STOPS = 24;
    var SAMPLE_IMAGE = 'sample-image.jpeg';
    var CROP_PREVIEW_MAX_SIZE = 2000;

    var $ = function (id) { return document.getElementById(id); };

    var els = {
        fileInput: $('fileInput'),
        openBtn: $('openBtn'),
        emptyOpenBtn: $('emptyOpenBtn'),
        downloadBtn: $('downloadBtn'),
        printBtn: $('printBtn'),
        snapshotBtn: $('snapshotBtn'),
        cssBtn: $('cssBtn'),
        stage: $('stage'),
        stageInner: $('stageInner'),
        source: $('source'),
        band: $('sampleBand'),
        empty: $('empty'),
        emptySub: $('emptySub'),
        readout: $('readout'),
        pixelDot: $('pixelDot'),
        pixelHex: $('pixelHex'),
        positionLabel: $('positionLabel'),
        lockBtn: $('lockBtn'),
        lockLabel: $('lockLabel'),
        previewFrame: $('previewFrame'),
        preview: $('preview'),
        previewPlaceholder: $('previewPlaceholder'),
        dims: $('dims'),
        palette: $('palette'),
        thickness: $('thickness'),
        thicknessOut: $('thicknessOut'),
        size: $('size'),
        snapshots: $('snapshots'),
        snapshotList: $('snapshotList'),
        clearSnapshotsBtn: $('clearSnapshotsBtn'),
        toast: $('toast'),
        sourceHeading: $('sourceHeading'),
        hint: $('hint'),
        credit: $('credit'),
        creditText: $('creditText'),
        creditLink: $('creditLink'),
        cropBtn: $('cropBtn'),
        cropStage: $('cropStage'),
        cropCanvas: $('cropCanvas'),
        cropBox: $('cropBox'),
        cropHole: $('cropHole'),
        cropToolbar: $('cropToolbar'),
        cropDims: $('cropDims'),
        cropResetBtn: $('cropResetBtn'),
        cropCancelBtn: $('cropCancelBtn'),
        cropApplyBtn: $('cropApplyBtn')
    };

    var sourceContext = els.source.getContext('2d', { willReadFrequently: true });
    var lineCanvas = document.createElement('canvas');
    var lineContext = lineCanvas.getContext('2d');

    var state = {
        img: null,          // the loaded image, kept so snapshots can restore it
        crop: null,         // {x, y, w, h} in image pixels, or null for the whole image
        credit: null,       // catalog entry when the image is a sample, for the credit line
        pixels: null,       // ImageData of the whole source canvas
        width: 0,           // source canvas size (possibly scaled down)
        height: 0,
        naturalWidth: 0,    // original image size, used for "Match source image"
        naturalHeight: 0,
        name: 'colourio',
        x: 0,               // centre of the sampled line, in source pixels
        y: 0,
        hover: null,        // pixel under the pointer, if any
        locked: false,
        direction: 'row',
        thickness: 1,
        blend: 'smooth',
        size: 'match',
        sample: null
    };

    // ======================================================================
    // Helpers
    // ======================================================================

    var clamp = function (value, min, max) {
        return Math.min(max, Math.max(min, value));
    };

    var toHex = function (r, g, b) {
        return '#' + [r, g, b].map(function (v) {
            return Math.round(v).toString(16).padStart(2, '0');
        }).join('');
    };

    var isLight = function (r, g, b) {
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150;
    };

    var slugify = function (text) {
        return text.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'colourio';
    };

    var toastTimer = 0;
    var toast = function (message) {
        els.toast.textContent = message;
        els.toast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            els.toast.classList.remove('is-visible');
        }, 1800);
    };

    var copyText = function (text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            var ok = document.execCommand('copy');
            textarea.remove();
            ok ? resolve() : reject(new Error('copy failed'));
        });
    };

    var downloadUrl = function (url, filename) {
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    // ======================================================================
    // Loading images
    // ======================================================================

    var loadImage = function (src, name, onDone, credit) {
        var img = new Image();
        img.onload = function () {
            setImage(img, name, null, credit);
            if (onDone) { onDone(); }
        };
        img.onerror = function () {
            toast("Couldn't read that image");
            if (onDone) { onDone(); }
        };
        img.src = src;
    };

    var loadFile = function (file) {
        if (!file || !/^image\//.test(file.type)) {
            toast('That doesn’t look like an image');
            return;
        }
        var url = URL.createObjectURL(file);
        loadImage(url, file.name || 'pasted-image', function () {
            URL.revokeObjectURL(url);
        });
    };

    var setImage = function (img, name, crop, credit) {
        if (cropper) { closeCrop(); }
        crop = crop || null;
        var cropX = crop ? crop.x : 0;
        var cropY = crop ? crop.y : 0;
        var cropW = crop ? crop.w : img.naturalWidth;
        var cropH = crop ? crop.h : img.naturalHeight;
        var scale = Math.min(1, MAX_SOURCE_SIZE / Math.max(cropW, cropH));
        var width = Math.max(1, Math.round(cropW * scale));
        var height = Math.max(1, Math.round(cropH * scale));

        els.source.width = width;
        els.source.height = height;
        // Transparent areas sample as white rather than black.
        sourceContext.fillStyle = '#fff';
        sourceContext.fillRect(0, 0, width, height);
        sourceContext.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, width, height);

        var pixels;
        try {
            pixels = sourceContext.getImageData(0, 0, width, height);
        } catch (e) {
            // Browsers block reading pixels from images loaded over file://.
            showEmpty('or paste one from your clipboard. (The bundled sample needs the page to be served over http.)');
            return;
        }

        state.img = img;
        state.crop = crop;
        state.credit = credit || null;
        updateCredit();
        state.pixels = pixels;
        state.width = width;
        state.height = height;
        state.naturalWidth = cropW;
        state.naturalHeight = cropH;
        state.name = slugify(name);
        state.x = Math.floor(width / 2);
        state.y = Math.floor(height / 2);
        state.hover = null;
        setLocked(false);

        els.empty.hidden = true;
        els.stageInner.hidden = false;
        els.readout.hidden = false;
        els.preview.hidden = false;
        els.previewPlaceholder.hidden = true;
        [els.downloadBtn, els.snapshotBtn, els.cssBtn, els.printBtn].forEach(function (btn) { btn.disabled = false; });

        layout();
        render();
    };

    var updateCredit = function () {
        var credit = state.credit;
        els.credit.hidden = !credit;
        if (!credit) { return; }
        var byline = credit.credit + (credit.date ? ', ' + credit.date : '');
        els.creditText.textContent = [credit.title, byline, credit.license].filter(Boolean).join(' · ') +
            (credit.url ? ' ·' : '');
        els.creditLink.hidden = !credit.url;
        if (credit.url) {
            els.creditLink.href = credit.url;
            els.creditLink.textContent = credit.source;
        }
    };

    var showEmpty = function (message) {
        if (message) { els.emptySub.textContent = message; }
        els.empty.hidden = false;
        els.stageInner.hidden = true;
        els.readout.hidden = true;
    };

    // ======================================================================
    // Sampling & rendering
    // ======================================================================

    // Averages `thickness` rows (or columns) around the current position
    // into a single line of colours.
    var sampleLine = function () {
        var isRow = state.direction === 'row';
        var width = state.width;
        var length = isRow ? state.width : state.height;
        var across = isRow ? state.height : state.width;
        var thickness = Math.min(state.thickness, across);
        var centre = isRow ? state.y : state.x;
        var start = clamp(centre - Math.floor(thickness / 2), 0, across - thickness);
        var data = state.pixels.data;
        var line = new Uint8ClampedArray(length * 4);

        for (var i = 0; i < length; i++) {
            var r = 0, g = 0, b = 0;
            for (var j = start; j < start + thickness; j++) {
                var offset = (isRow ? j * width + i : i * width + j) * 4;
                r += data[offset];
                g += data[offset + 1];
                b += data[offset + 2];
            }
            var o = i * 4;
            line[o] = r / thickness;
            line[o + 1] = g / thickness;
            line[o + 2] = b / thickness;
            line[o + 3] = 255;
        }

        return { line: line, length: length, start: start, thickness: thickness, across: across };
    };

    // Stretches or squashes a line of colours to `size` entries.
    var resample = function (line, length, size, crisp) {
        var out = new Uint8ClampedArray(size * 4);
        var ratio = length / size;

        for (var i = 0; i < size; i++) {
            var o = i * 4, r = 0, g = 0, b = 0, c;

            if (crisp) {
                var s = Math.min(length - 1, Math.floor((i + 0.5) * ratio)) * 4;
                r = line[s]; g = line[s + 1]; b = line[s + 2];
            } else if (ratio > 1) {
                // Box filter when shrinking
                var from = i * ratio, to = from + ratio, total = 0;
                for (c = Math.floor(from); c < Math.ceil(to) && c < length; c++) {
                    var weight = Math.min(to, c + 1) - Math.max(from, c);
                    r += line[c * 4] * weight;
                    g += line[c * 4 + 1] * weight;
                    b += line[c * 4 + 2] * weight;
                    total += weight;
                }
                r /= total; g /= total; b /= total;
            } else {
                // Linear interpolation when stretching
                var pos = (i + 0.5) * ratio - 0.5;
                var a = clamp(Math.floor(pos), 0, length - 1);
                var z = Math.min(length - 1, a + 1);
                var t = clamp(pos - a, 0, 1);
                r = line[a * 4] + (line[z * 4] - line[a * 4]) * t;
                g = line[a * 4 + 1] + (line[z * 4 + 1] - line[a * 4 + 1]) * t;
                b = line[a * 4 + 2] + (line[z * 4 + 2] - line[a * 4 + 2]) * t;
            }

            out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
        }

        return out;
    };

    var outputSize = function () {
        if (state.size === 'match') {
            return { width: state.naturalWidth, height: state.naturalHeight };
        }
        var parts = state.size.split('x');
        return { width: +parts[0], height: +parts[1] };
    };

    var paint = function (canvas, width, height, sample) {
        var isRow = state.direction === 'row';
        var length = isRow ? width : height;
        var pixels = resample(sample.line, sample.length, length, state.blend === 'crisp');

        lineCanvas.width = isRow ? length : 1;
        lineCanvas.height = isRow ? 1 : length;
        lineContext.putImageData(new ImageData(pixels, lineCanvas.width, lineCanvas.height), 0, 0);

        if (canvas.width !== width) { canvas.width = width; }
        if (canvas.height !== height) { canvas.height = height; }
        var context = canvas.getContext('2d');
        context.imageSmoothingEnabled = false;
        context.drawImage(lineCanvas, 0, 0, width, height);
        return canvas;
    };

    // Median-cut quantisation of the line, ordered by where each colour
    // appears so the swatches read in the same order as the stripes.
    var extractPalette = function (sample, count) {
        var line = sample.line;
        var indices = [];
        for (var i = 0; i < sample.length; i++) { indices.push(i); }
        var boxes = [indices];

        while (boxes.length < count) {
            var best = -1, bestRange = 0, bestChannel = 0;
            boxes.forEach(function (box, index) {
                if (box.length < 2) { return; }
                for (var c = 0; c < 3; c++) {
                    var min = 255, max = 0;
                    for (var k = 0; k < box.length; k++) {
                        var v = line[box[k] * 4 + c];
                        if (v < min) { min = v; }
                        if (v > max) { max = v; }
                    }
                    if (max - min > bestRange) {
                        best = index; bestRange = max - min; bestChannel = c;
                    }
                }
            });
            if (best < 0 || bestRange < 6) { break; }

            var box = boxes[best].slice().sort(function (p, q) {
                return line[p * 4 + bestChannel] - line[q * 4 + bestChannel];
            });
            var mid = box.length >> 1;
            boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
        }

        return boxes.map(function (box) {
            var r = 0, g = 0, b = 0, pos = 0;
            box.forEach(function (index) {
                r += line[index * 4]; g += line[index * 4 + 1]; b += line[index * 4 + 2]; pos += index;
            });
            var n = box.length;
            return { r: r / n, g: g / n, b: b / n, pos: pos / n };
        }).sort(function (p, q) { return p.pos - q.pos; });
    };

    var gradientCss = function (sample, stops, angle) {
        var colours = resample(sample.line, sample.length, stops, false);
        var parts = [];
        for (var i = 0; i < stops; i++) {
            var hex = toHex(colours[i * 4], colours[i * 4 + 1], colours[i * 4 + 2]);
            parts.push(hex + ' ' + +(i / (stops - 1) * 100).toFixed(2) + '%');
        }
        return 'linear-gradient(' + angle + 'deg, ' + parts.join(', ') + ')';
    };

    var frame = 0;
    var scheduleRender = function () {
        if (!frame) { frame = requestAnimationFrame(render); }
    };

    var render = function () {
        frame = 0;
        if (!state.pixels) { return; }

        var sample = state.sample = sampleLine();
        var size = outputSize();
        var scale = Math.min(1, PREVIEW_MAX_SIZE / Math.max(size.width, size.height));
        paint(els.preview,
            Math.max(1, Math.round(size.width * scale)),
            Math.max(1, Math.round(size.height * scale)),
            sample);

        els.dims.textContent = size.width + ' × ' + size.height;
        updateBand(sample);
        updateReadout();
        updatePalette(sample);
        document.documentElement.style.setProperty('--live', gradientCss(sample, 12, state.direction === 'row' ? 90 : 180));
    };

    // ======================================================================
    // UI updates
    // ======================================================================

    var updateBand = function (sample) {
        var style = els.band.style;
        var start = (sample.start / sample.across * 100) + '%';
        var extent = (sample.thickness / sample.across * 100) + '%';
        els.band.dataset.direction = state.direction;
        els.band.classList.toggle('is-locked', state.locked);
        if (state.direction === 'row') {
            style.top = start; style.height = extent; style.left = ''; style.width = '';
        } else {
            style.left = start; style.width = extent; style.top = ''; style.height = '';
        }
    };

    var updateReadout = function () {
        var point = state.hover || { x: state.x, y: state.y };
        var offset = (point.y * state.width + point.x) * 4;
        var data = state.pixels.data;
        var hex = toHex(data[offset], data[offset + 1], data[offset + 2]);
        els.pixelDot.style.background = hex;
        els.pixelHex.textContent = hex;

        var sample = state.sample;
        var noun = state.direction === 'row' ? 'Row' : 'Column';
        els.positionLabel.textContent = sample.thickness > 1
            ? noun + 's ' + (sample.start + 1) + '–' + (sample.start + sample.thickness) + ' of ' + sample.across
            : noun + ' ' + (sample.start + 1) + ' of ' + sample.across;
    };

    var swatches = [];
    var updatePalette = function (sample) {
        var colours = extractPalette(sample, PALETTE_SIZE);
        while (swatches.length < PALETTE_SIZE) {
            var swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'swatch';
            swatch.addEventListener('click', function () {
                var hex = this.dataset.hex;
                copyText(hex).then(function () { toast('Copied ' + hex); }, function () { toast(hex); });
            });
            els.palette.appendChild(swatch);
            swatches.push(swatch);
        }
        swatches.forEach(function (swatch, i) {
            var colour = colours[i];
            swatch.hidden = !colour;
            if (!colour) { return; }
            var hex = toHex(colour.r, colour.g, colour.b);
            var light = isLight(colour.r, colour.g, colour.b);
            swatch.dataset.hex = hex;
            swatch.style.background = hex;
            swatch.textContent = hex.slice(1);
            swatch.title = 'Copy ' + hex;
            swatch.setAttribute('aria-label', 'Copy ' + hex);
            swatch.classList.toggle('is-light', light);
            swatch.classList.toggle('is-dark', !light);
        });
    };

    var setLocked = function (locked) {
        state.locked = locked;
        els.lockBtn.setAttribute('aria-pressed', String(locked));
        els.lockLabel.textContent = locked ? 'Locked' : 'Following';
        els.band.classList.toggle('is-locked', locked);
    };

    // Fits a canvas inside the given box, preserving its aspect ratio.
    var fit = function (canvas, width, height, maxWidth, maxHeight) {
        var scale = Math.min(maxWidth / width, maxHeight / height);
        canvas.style.width = Math.max(1, Math.floor(width * scale)) + 'px';
        canvas.style.height = Math.max(1, Math.floor(height * scale)) + 'px';
    };

    var innerWidth = function (el) {
        var style = getComputedStyle(el);
        return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    };

    var layout = function () {
        if (!state.pixels) { return; }
        var viewport = window.innerHeight;
        if (cropper) {
            fit(els.cropCanvas, cropper.width, cropper.height,
                innerWidth(els.stage), clamp(viewport - 240, 240, 900));
        } else {
            fit(els.source, state.width, state.height,
                innerWidth(els.stage), clamp(viewport - 240, 240, 900));
        }
        var size = outputSize();
        fit(els.preview, size.width, size.height,
            innerWidth(els.previewFrame), clamp(viewport * 0.45, 160, 520));
    };

    // ======================================================================
    // Exporting
    // ======================================================================

    var renderFull = function (callback) {
        // Sample afresh: a render may still be pending for the latest move.
        var size = outputSize();
        var sample = state.sample = sampleLine();
        var canvas = paint(document.createElement('canvas'), size.width, size.height, sample);
        var position = sample.start + 1;
        var filename = [state.name, state.direction, position, size.width + 'x' + size.height].join('-') + '.png';
        canvas.toBlob(function (blob) {
            callback(blob, filename, size, position);
        }, 'image/png');
    };

    var download = function () {
        if (!state.pixels) { return; }
        renderFull(function (blob, filename) {
            var url = URL.createObjectURL(blob);
            downloadUrl(url, filename);
            setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        });
    };

    var snapshot = function () {
        if (!state.pixels) { return; }
        var noun = state.direction === 'row' ? 'Row' : 'Column';
        var settings = {
            img: state.img,
            crop: state.crop,
            credit: state.credit,
            name: state.name,
            x: state.x,
            y: state.y,
            direction: state.direction,
            thickness: state.thickness,
            blend: state.blend,
            size: state.size
        };
        renderFull(function (blob, filename, size, position) {
            var url = URL.createObjectURL(blob);
            var item = document.createElement('li');
            item.className = 'snapshot';
            item.innerHTML =
                '<a class="snapshot-thumb" title="Download"><img alt=""></a>' +
                '<div class="snapshot-meta">' +
                    '<button type="button" class="snapshot-restore"></button>' +
                    '<span class="icons">' +
                        '<a class="icon-btn" title="Download" aria-label="Download"><svg viewBox="0 0 24 24"><path d="M12 4v12m0 0-5-5m5 5 5-5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg></a>' +
                        '<button type="button" class="icon-btn snapshot-remove" title="Remove" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
                    '</span>' +
                '</div>';
            var label = noun + ' ' + position + ' · ' + size.width + ' × ' + size.height;
            item.querySelectorAll('a').forEach(function (link) {
                link.href = url;
                link.download = filename;
            });
            item.querySelector('img').src = url;
            item.querySelector('img').alt = 'Snapshot: ' + label;
            var restoreBtn = item.querySelector('.snapshot-restore');
            restoreBtn.textContent = label;
            restoreBtn.title = 'Restore ' + label;
            restoreBtn.addEventListener('click', function () {
                restoreSnapshot(settings);
                toast('Restored ' + noun.toLowerCase() + ' ' + position);
            });
            item.querySelector('.snapshot-remove').addEventListener('click', function () {
                URL.revokeObjectURL(url);
                item.remove();
                els.snapshots.hidden = !els.snapshotList.children.length;
            });
            els.snapshotList.prepend(item);
            els.snapshots.hidden = false;
            toast('Snapshot saved');
        });
    };

    // Puts the picker and controls back the way they were for a snapshot,
    // reloading its source image if another one has been opened since.
    var restoreSnapshot = function (settings) {
        if (settings.img !== state.img || !sameCrop(settings.crop, state.crop)) {
            setImage(settings.img, settings.name, settings.crop, settings.credit);
        } else if (cropper) {
            closeCrop();
        }

        state.x = settings.x;
        state.y = settings.y;
        state.direction = settings.direction;
        state.thickness = settings.thickness;
        state.blend = settings.blend;
        state.size = settings.size;
        state.hover = null;
        setLocked(true);

        document.querySelector('input[name="direction"][value="' + settings.direction + '"]').checked = true;
        document.querySelector('input[name="blend"][value="' + settings.blend + '"]').checked = true;
        els.thickness.value = settings.thickness;
        els.thicknessOut.textContent = settings.thickness + ' px';
        els.size.value = settings.size;

        layout();
        render();
        els.stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    var clearSnapshots = function () {
        els.snapshotList.querySelectorAll('img').forEach(function (img) { URL.revokeObjectURL(img.src); });
        els.snapshotList.innerHTML = '';
        els.snapshots.hidden = true;
    };

    // ======================================================================
    // Pointer & keyboard interaction
    // ======================================================================

    var pointerToPixel = function (e) {
        var rect = els.source.getBoundingClientRect();
        return {
            x: clamp(Math.floor((e.clientX - rect.left) / rect.width * state.width), 0, state.width - 1),
            y: clamp(Math.floor((e.clientY - rect.top) / rect.height * state.height), 0, state.height - 1)
        };
    };

    var moveTo = function (point) {
        state.x = point.x;
        state.y = point.y;
        scheduleRender();
    };

    var drag = null;

    els.source.addEventListener('pointerdown', function (e) {
        if (!state.pixels || (e.pointerType === 'mouse' && e.button !== 0)) { return; }
        els.source.setPointerCapture(e.pointerId);
        drag = { x: e.clientX, y: e.clientY, wasLocked: state.locked, moved: false };
        moveTo(pointerToPixel(e));
    });

    els.source.addEventListener('pointermove', function (e) {
        if (!state.pixels) { return; }
        var point = pointerToPixel(e);
        state.hover = point;
        if (drag) {
            drag.moved = drag.moved || Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4;
            moveTo(point);
        } else if (!state.locked && e.pointerType === 'mouse') {
            moveTo(point);
        } else {
            updateReadout();
        }
    });

    var endDrag = function (e) {
        if (!drag) { return; }
        // A plain mouse click toggles the lock; dragging or touching always locks.
        var isClick = e.pointerType === 'mouse' && !drag.moved;
        setLocked(isClick ? !drag.wasLocked : true);
        drag = null;
        scheduleRender();
    };

    els.source.addEventListener('pointerup', endDrag);
    els.source.addEventListener('pointercancel', endDrag);

    els.source.addEventListener('pointerleave', function () {
        if (drag) { return; }
        state.hover = null;
        if (state.pixels) { updateReadout(); }
    });

    els.source.addEventListener('keydown', function (e) {
        if (!state.pixels) { return; }
        var step = e.shiftKey ? 10 : 1;
        var delta = { ArrowUp: -step, ArrowLeft: -step, ArrowDown: step, ArrowRight: step }[e.key];

        if (delta) {
            e.preventDefault();
            if (state.direction === 'row') {
                state.y = clamp(state.y + delta, 0, state.height - 1);
            } else {
                state.x = clamp(state.x + delta, 0, state.width - 1);
            }
            state.hover = null;
            setLocked(true);
            scheduleRender();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setLocked(!state.locked);
        }
    });

    els.lockBtn.addEventListener('click', function () {
        setLocked(!state.locked);
    });

    document.addEventListener('keydown', function (e) {
        var tag = e.target.tagName;
        if (cropper) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeCrop();
            } else if (e.key === 'Enter' && tag !== 'BUTTON') {
                e.preventDefault();
                applyCrop();
            }
            return;
        }
        if (document.querySelector('dialog[open]')) { return; }
        if (e.metaKey || e.ctrlKey || e.altKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { return; }
        if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            snapshot();
        }
    });

    // ======================================================================
    // Controls
    // ======================================================================

    document.querySelectorAll('input[name="direction"]').forEach(function (input) {
        input.addEventListener('change', function () {
            state.direction = input.value;
            state.hover = null;
            scheduleRender();
        });
    });

    document.querySelectorAll('input[name="blend"]').forEach(function (input) {
        input.addEventListener('change', function () {
            state.blend = input.value;
            scheduleRender();
        });
    });

    els.thickness.addEventListener('input', function () {
        state.thickness = +els.thickness.value;
        els.thicknessOut.textContent = state.thickness + ' px';
        scheduleRender();
    });

    els.size.addEventListener('change', function () {
        state.size = els.size.value;
        layout();
        scheduleRender();
    });

    els.openBtn.addEventListener('click', function () { els.fileInput.click(); });
    els.emptyOpenBtn.addEventListener('click', function () { els.fileInput.click(); });
    els.fileInput.addEventListener('change', function () {
        loadFile(els.fileInput.files[0]);
        els.fileInput.value = '';
    });

    els.downloadBtn.addEventListener('click', download);
    els.snapshotBtn.addEventListener('click', snapshot);
    els.clearSnapshotsBtn.addEventListener('click', clearSnapshots);

    els.cssBtn.addEventListener('click', function () {
        if (!state.sample) { return; }
        var css = 'background: ' + gradientCss(state.sample, GRADIENT_STOPS, state.direction === 'row' ? 90 : 180) + ';';
        copyText(css).then(function () { toast('CSS gradient copied'); }, function () { toast("Couldn't copy to clipboard"); });
    });

    // ======================================================================
    // Cropping
    // ======================================================================

    // While crop mode is open: the original image size, the crop box (in
    // original image pixels), the locked aspect ratio and any active drag.
    var cropper = null;
    var cropContext = els.cropCanvas.getContext('2d');

    var sameCrop = function (a, b) {
        return a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
    };

    var toggleCropUi = function (open) {
        els.cropStage.hidden = !open;
        els.cropToolbar.hidden = !open;
        els.stageInner.hidden = open;
        els.readout.hidden = open;
        els.hint.hidden = open;
        els.sourceHeading.textContent = open ? 'Crop' : 'Source';
    };

    // Shows the whole original image so a crop can be widened again later.
    var openCrop = function () {
        if (!state.img || cropper) { return; }
        var img = state.img;
        var scale = Math.min(1, CROP_PREVIEW_MAX_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
        els.cropCanvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        els.cropCanvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        cropContext.drawImage(img, 0, 0, els.cropCanvas.width, els.cropCanvas.height);

        var crop = state.crop;
        cropper = {
            width: img.naturalWidth,
            height: img.naturalHeight,
            rect: crop
                ? { x: crop.x, y: crop.y, w: crop.w, h: crop.h }
                : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight },
            ratio: null,
            drag: null
        };
        setRatioButton('free');
        toggleCropUi(true);
        layout();
        updateCropBox();
        els.cropStage.focus({ preventScroll: true });
    };

    var closeCrop = function () {
        if (!cropper) { return; }
        cropper = null;
        toggleCropUi(false);
        layout();
    };

    var applyCrop = function () {
        if (!cropper) { return; }
        var width = cropper.width, height = cropper.height, r = cropper.rect;
        var x = clamp(Math.round(r.x), 0, width - 1);
        var y = clamp(Math.round(r.y), 0, height - 1);
        var crop = {
            x: x,
            y: y,
            w: clamp(Math.round(r.w), 1, width - x),
            h: clamp(Math.round(r.h), 1, height - y)
        };
        if (crop.x === 0 && crop.y === 0 && crop.w === width && crop.h === height) { crop = null; }

        var changed = !sameCrop(crop, state.crop);
        closeCrop();
        if (changed) {
            setImage(state.img, state.name, crop, state.credit);
            toast(crop ? 'Cropped to ' + crop.w + ' × ' + crop.h : 'Crop removed');
        }
    };

    var updateCropBox = function () {
        var r = cropper.rect;
        [els.cropBox, els.cropHole].forEach(function (el) {
            el.style.left = (r.x / cropper.width * 100) + '%';
            el.style.top = (r.y / cropper.height * 100) + '%';
            el.style.width = (r.w / cropper.width * 100) + '%';
            el.style.height = (r.h / cropper.height * 100) + '%';
        });
        els.cropDims.textContent = Math.round(r.w) + ' × ' + Math.round(r.h);
    };

    var setRatioButton = function (key) {
        els.cropToolbar.querySelectorAll('[data-ratio]').forEach(function (btn) {
            btn.setAttribute('aria-pressed', String(btn.dataset.ratio === key));
        });
    };

    // Locks an aspect ratio and switches to the largest box of that shape
    // that fits the image, centred on the current box.
    var setRatio = function (key) {
        setRatioButton(key);
        var ratio = null;
        if (key === 'original') {
            ratio = cropper.width / cropper.height;
        } else if (key !== 'free') {
            var parts = key.split(':');
            ratio = parts[0] / parts[1];
        }
        cropper.ratio = ratio;
        if (!ratio) { return; }

        var width = cropper.width, height = cropper.height, r = cropper.rect;
        var w = width, h = width / ratio;
        if (h > height) { h = height; w = height * ratio; }
        cropper.rect = {
            x: clamp(r.x + r.w / 2 - w / 2, 0, width - w),
            y: clamp(r.y + r.h / 2 - h / 2, 0, height - h),
            w: w,
            h: h
        };
        updateCropBox();
    };

    // Resizes the box from a handle (hx and hy are each -1, 0 or 1), keeping
    // the anchor (ax, ay) fixed: the opposite corner, or the middle of the
    // opposite edge. Honours the locked ratio and stays inside the image.
    var resizeCrop = function (start, hx, hy, ax, ay, point) {
        var width = cropper.width, height = cropper.height, ratio = cropper.ratio;
        var min = Math.max(8, Math.min(width, height) * 0.02);
        var w = hx ? Math.max(min, hx * (point.x - ax)) : start.w;
        var h = hy ? Math.max(min, hy * (point.y - ay)) : start.h;

        if (ratio) {
            if (hx && hy) {
                if (w / h > ratio) { h = w / ratio; } else { w = h * ratio; }
            } else if (hx) {
                h = w / ratio;
            } else {
                w = h * ratio;
            }
        }

        var maxW = hx > 0 ? width - ax : hx < 0 ? ax : 2 * Math.min(ax, width - ax);
        var maxH = hy > 0 ? height - ay : hy < 0 ? ay : 2 * Math.min(ay, height - ay);
        if (w > maxW) { w = maxW; if (ratio) { h = w / ratio; } }
        if (h > maxH) { h = maxH; if (ratio) { w = h * ratio; } }

        return {
            x: hx > 0 ? ax : hx < 0 ? ax - w : ax - w / 2,
            y: hy > 0 ? ay : hy < 0 ? ay - h : ay - h / 2,
            w: w,
            h: h
        };
    };

    var cropPoint = function (e) {
        var rect = els.cropCanvas.getBoundingClientRect();
        return {
            x: clamp((e.clientX - rect.left) / rect.width * cropper.width, 0, cropper.width),
            y: clamp((e.clientY - rect.top) / rect.height * cropper.height, 0, cropper.height)
        };
    };

    // Drag a handle to resize, inside the box to move it, or anywhere else
    // to draw a new box.
    els.cropStage.addEventListener('pointerdown', function (e) {
        if (!cropper || (e.pointerType === 'mouse' && e.button !== 0)) { return; }
        e.preventDefault();
        var handle = e.target.dataset.handle;
        var r = cropper.rect;
        var drag = {
            start: cropPoint(e),
            rect: { x: r.x, y: r.y, w: r.w, h: r.h },
            clientX: e.clientX,
            clientY: e.clientY,
            moved: false
        };

        if (handle) {
            drag.mode = 'resize';
            drag.hx = handle.indexOf('e') !== -1 ? 1 : handle.indexOf('w') !== -1 ? -1 : 0;
            drag.hy = handle.indexOf('s') !== -1 ? 1 : handle.indexOf('n') !== -1 ? -1 : 0;
            drag.ax = drag.hx > 0 ? r.x : drag.hx < 0 ? r.x + r.w : r.x + r.w / 2;
            drag.ay = drag.hy > 0 ? r.y : drag.hy < 0 ? r.y + r.h : r.y + r.h / 2;
        } else if (els.cropBox.contains(e.target)) {
            drag.mode = 'move';
        } else {
            drag.mode = 'draw';
        }

        cropper.drag = drag;
        els.cropStage.setPointerCapture(e.pointerId);
        els.cropStage.classList.add('is-dragging');
        els.cropStage.focus({ preventScroll: true });
    });

    els.cropStage.addEventListener('pointermove', function (e) {
        var drag = cropper && cropper.drag;
        if (!drag) { return; }
        var point = cropPoint(e);
        var r = drag.rect;
        drag.moved = drag.moved || Math.abs(e.clientX - drag.clientX) + Math.abs(e.clientY - drag.clientY) > 3;

        if (drag.mode === 'move') {
            cropper.rect = {
                x: clamp(r.x + point.x - drag.start.x, 0, cropper.width - r.w),
                y: clamp(r.y + point.y - drag.start.y, 0, cropper.height - r.h),
                w: r.w,
                h: r.h
            };
        } else if (drag.mode === 'resize') {
            cropper.rect = resizeCrop(r, drag.hx, drag.hy, drag.ax, drag.ay, point);
        } else if (drag.moved) {
            cropper.rect = resizeCrop(r,
                point.x < drag.start.x ? -1 : 1,
                point.y < drag.start.y ? -1 : 1,
                drag.start.x, drag.start.y, point);
        }
        updateCropBox();
    });

    var endCropDrag = function () {
        if (!cropper) { return; }
        cropper.drag = null;
        els.cropStage.classList.remove('is-dragging');
    };

    els.cropStage.addEventListener('pointerup', endCropDrag);
    els.cropStage.addEventListener('pointercancel', endCropDrag);

    // Arrow keys move the box by a screen pixel (Shift for 10).
    els.cropStage.addEventListener('keydown', function (e) {
        var dx = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0;
        var dy = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0;
        if (!cropper || (!dx && !dy)) { return; }
        e.preventDefault();
        var step = (e.shiftKey ? 10 : 1) * cropper.width / els.cropCanvas.getBoundingClientRect().width;
        var r = cropper.rect;
        cropper.rect = {
            x: clamp(r.x + dx * step, 0, cropper.width - r.w),
            y: clamp(r.y + dy * step, 0, cropper.height - r.h),
            w: r.w,
            h: r.h
        };
        updateCropBox();
    });

    els.cropToolbar.querySelectorAll('[data-ratio]').forEach(function (btn) {
        btn.addEventListener('click', function () { setRatio(btn.dataset.ratio); });
    });

    els.cropBtn.addEventListener('click', openCrop);
    els.cropApplyBtn.addEventListener('click', applyCrop);
    els.cropCancelBtn.addEventListener('click', closeCrop);
    els.cropResetBtn.addEventListener('click', function () {
        cropper.rect = { x: 0, y: 0, w: cropper.width, h: cropper.height };
        cropper.ratio = null;
        setRatioButton('free');
        updateCropBox();
    });

    // ======================================================================
    // Drag & drop, paste
    // ======================================================================

    var dragDepth = 0;
    var hasFiles = function (e) {
        return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
    };

    window.addEventListener('dragenter', function (e) {
        if (!hasFiles(e)) { return; }
        e.preventDefault();
        dragDepth++;
        document.body.classList.add('is-dragging');
    });

    window.addEventListener('dragover', function (e) {
        if (!hasFiles(e)) { return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('dragleave', function (e) {
        if (!hasFiles(e)) { return; }
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) { document.body.classList.remove('is-dragging'); }
    });

    window.addEventListener('drop', function (e) {
        if (!hasFiles(e)) { return; }
        e.preventDefault();
        dragDepth = 0;
        document.body.classList.remove('is-dragging');
        loadFile(e.dataTransfer.files[0]);
    });

    window.addEventListener('paste', function (e) {
        var items = (e.clipboardData && e.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
                e.preventDefault();
                loadFile(items[i].getAsFile());
                return;
            }
        }
    });

    // ======================================================================
    // Start
    // ======================================================================

    var lastStageWidth = 0;
    new ResizeObserver(function () {
        var width = els.stage.clientWidth;
        if (width !== lastStageWidth) {
            lastStageWidth = width;
            layout();
        }
    }).observe(els.stage);
    window.addEventListener('resize', layout);

    // Lets print.js render the current stripes at print sizes.
    window.colourio = {
        render: function (width, height) {
            return state.pixels ? paint(document.createElement('canvas'), width, height, sampleLine()) : null;
        },
        describe: function () {
            var sample = sampleLine();
            return { name: state.name, direction: state.direction, position: sample.start + 1 };
        },
        toast: toast,
        // Lets gallery.js load catalog images with their credit.
        loadSample: function (sample) {
            loadImage(sample.file, sample.id, null, sample);
        },
        currentSample: function () {
            return state.credit && state.credit.id;
        }
    };

    var samples = window.COLOURIO_SAMPLES || [];
    if (samples.length) {
        window.colourio.loadSample(samples[0]);
    } else {
        loadImage(SAMPLE_IMAGE, 'sample');
    }
})();
