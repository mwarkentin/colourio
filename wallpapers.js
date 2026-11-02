(function () {
    'use strict';

    // One wallpaper per kind of screen, each the shape of that screen and as
    // big as the largest of its kind: devices scale a wallpaper down to fit,
    // but crop it when the shape differs, which would cut off the ends of
    // the gradient.
    var DEVICES = [
        // iPhone 16 Pro Max; other recent iPhones are the same shape.
        { id: 'iphone', name: 'iPhone', width: 1320, height: 2868 },
        // 20:9, the usual Android shape, at Pixel Pro resolution.
        { id: 'android', name: 'Android phone', width: 1440, height: 3200 },
        // iPads use a square wallpaper so it fits either way up.
        { id: 'ipad', name: 'iPad', width: 2732, height: 2732 },
        // MacBook Pro 16″; the 14″ and Air are the same shape.
        { id: 'macbook', name: 'MacBook', width: 3456, height: 2234 },
        // 16:9 at 5K, which covers 1080p, 1440p and 4K monitors too.
        { id: 'desktop', name: 'Desktop', width: 5120, height: 2880 },
        // 21:9 ultrawide monitors.
        { id: 'ultrawide', name: 'Ultrawide', width: 5120, height: 2160 }
    ];

    var THUMB_WIDTH = 100;
    var THUMB_HEIGHT = 80;

    var $ = function (id) { return document.getElementById(id); };
    var els = {
        button: $('wallpapersBtn'),
        dialog: $('wallpapersDialog'),
        closeBtn: $('wallpapersCloseBtn'),
        devices: $('wallpaperDevices'),
        status: $('wallpapersStatus'),
        downloadBtn: $('wallpapersDownloadBtn'),
        shareBtn: $('wallpapersShareBtn')
    };

    var T = window.colourio.telemetry;
    var touch = window.matchMedia('(pointer: coarse)').matches;
    var canShareFiles = !!(navigator.canShare && window.File &&
        navigator.canShare({ files: [new File([''], 'test.png', { type: 'image/png' })] }));
    // Phones save wallpapers to Photos through the share sheet; computers
    // download them.
    var useShareSheet = canShareFiles && touch;

    var screens = [];
    var files = {};         // screen id -> File, for the image currently open
    var ready = null;       // { files, zip } once every ticked screen is rendered
    var generation = 0;     // bumps when the selection changes mid-render

    // The screen colourio is open on, in device pixels. Phones report their
    // portrait size in either orientation on some browsers, so it's kept
    // portrait there.
    var thisScreen = function () {
        var ratio = window.devicePixelRatio || 1;
        var width = Math.round(screen.width * ratio);
        var height = Math.round(screen.height * ratio);
        if (!(width > 0 && height > 0)) { return null; }
        if (touch && width > height) {
            var swap = width;
            width = height;
            height = swap;
        }
        return { id: 'screen', name: 'This screen', width: width, height: height };
    };

    var listScreens = function () {
        var own = thisScreen();
        var match = own && DEVICES.filter(function (d) { return d.width === own.width && d.height === own.height; })[0];
        return (own && !match ? [own] : []).concat(DEVICES).map(function (s) {
            // On a phone, just this phone's wallpaper; on a computer, the set.
            var picked = touch ? (match ? s === match : s.id === 'screen') : true;
            return { id: s.id, name: s.name, width: s.width, height: s.height, picked: picked };
        });
    };

    var selected = function () {
        return screens.filter(function (s) { return s.picked; });
    };

    var baseName = function () {
        var info = window.colourio.describe();
        return [info.name, info.direction, info.position].join('-');
    };

    var formatBytes = function (bytes) {
        return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
    };

    var setStatus = function (message, kind) {
        els.status.textContent = message;
        els.status.dataset.kind = kind || '';
    };

    // ======================================================================
    // ZIP (stored, not compressed: PNGs are already compressed)
    // ======================================================================

    var CRC_TABLE = (function () {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
            table[n] = c >>> 0;
        }
        return table;
    })();

    var crc32 = function (bytes) {
        var c = 0xffffffff;
        for (var i = 0; i < bytes.length; i++) { c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); }
        return (c ^ 0xffffffff) >>> 0;
    };

    // entries: [{ name, bytes: Uint8Array }]
    var zip = function (entries) {
        var now = new Date();
        var time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        var date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        var encoder = new TextEncoder();
        var parts = [];
        var central = [];
        var offset = 0;
        var centralSize = 0;

        entries.forEach(function (entry) {
            var name = encoder.encode(entry.name);
            var crc = crc32(entry.bytes);
            var size = entry.bytes.length;

            var local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);       // version needed
            local.setUint16(6, 0x0800, true);   // names are UTF-8
            local.setUint16(8, 0, true);        // stored
            local.setUint16(10, time, true);
            local.setUint16(12, date, true);
            local.setUint32(14, crc, true);
            local.setUint32(18, size, true);
            local.setUint32(22, size, true);
            local.setUint16(26, name.length, true);
            parts.push(local.buffer, name, entry.bytes);

            var record = new DataView(new ArrayBuffer(46));
            record.setUint32(0, 0x02014b50, true);
            record.setUint16(4, 20, true);      // version made by
            record.setUint16(6, 20, true);
            record.setUint16(8, 0x0800, true);
            record.setUint16(12, time, true);
            record.setUint16(14, date, true);
            record.setUint32(16, crc, true);
            record.setUint32(20, size, true);
            record.setUint32(24, size, true);
            record.setUint16(28, name.length, true);
            record.setUint32(42, offset, true);
            central.push(record.buffer, name);

            offset += 30 + name.length + size;
            centralSize += 46 + name.length;
        });

        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, entries.length, true);
        end.setUint16(10, entries.length, true);
        end.setUint32(12, centralSize, true);
        end.setUint32(16, offset, true);
        return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
    };

    // ======================================================================
    // Rendering
    // ======================================================================

    var renderOne = function (s, done) {
        var canvas = window.colourio.render(s.width, s.height);
        canvas.toBlob(function (blob) {
            // Free the canvas now; phones have little memory to spare.
            canvas.width = canvas.height = 0;
            done(blob && new File([blob], baseName() + '-' + s.id + '-' + s.width + 'x' + s.height + '.png', { type: 'image/png' }));
        }, 'image/png');
    };

    var updateButtons = function () {
        var count = selected().length;
        var noun = count === 1 ? 'wallpaper' : 'wallpapers';
        els.downloadBtn.textContent = count > 1 ? 'Download ZIP' : 'Download PNG';
        els.downloadBtn.disabled = !ready;
        els.shareBtn.disabled = !ready;
        els.shareBtn.textContent = 'Save or share ' + (count > 1 ? count + ' ' + noun : 'wallpaper');
    };

    // Renders every ticked screen ahead of time: Safari only opens the share
    // sheet straight from a tap, so the files have to be ready by then.
    var prepare = function () {
        var run = ++generation;
        var picked = selected();
        ready = null;
        updateButtons();
        if (!picked.length) {
            setStatus('Pick at least one screen.');
            return;
        }
        var timer = T.timer('wallpapers.render', { count: picked.length });
        var queue = picked.filter(function (s) { return !files[s.id]; });
        var failed = [];

        var next = function () {
            if (run !== generation) { return; }
            var s = queue.shift();
            if (s) {
                setStatus('Making the ' + s.name + ' wallpaper…', 'busy');
                // Give the status a frame to paint before the blocking render.
                requestAnimationFrame(function () {
                    setTimeout(function () {
                        if (run !== generation) { return; }
                        renderOne(s, function (file) {
                            if (file) { files[s.id] = file; } else { failed.push(s); }
                            next();
                        });
                    }, 0);
                });
                return;
            }
            finish();
        };

        var finish = function () {
            timer.end({ ok: !failed.length });
            if (failed.length) {
                // Usually a canvas too large for the device's memory.
                T.warn('Wallpaper could not be created', { screen: failed[0].id, width: failed[0].width, height: failed[0].height });
                setStatus('Couldn’t make the ' + failed.map(function (s) { return s.name; }).join(' and ') +
                    ' wallpaper on this device. Untick it to continue.', 'error');
                return;
            }
            var list = picked.map(function (s) { return files[s.id]; });
            var total = list.reduce(function (sum, file) { return sum + file.size; }, 0);
            var done = function (archive) {
                if (run !== generation) { return; }
                ready = { files: list, zip: archive };
                setStatus('Ready · ' + list.length + ' ' + (list.length === 1 ? 'wallpaper' : 'wallpapers') + ', ' + formatBytes(total), 'done');
                updateButtons();
            };
            if (list.length === 1) { return done(null); }
            setStatus('Zipping…', 'busy');
            Promise.all(list.map(function (file) { return file.arrayBuffer(); })).then(function (buffers) {
                done(zip(list.map(function (file, i) { return { name: file.name, bytes: new Uint8Array(buffers[i]) }; })));
            });
        };

        next();
    };

    // ======================================================================
    // Dialog
    // ======================================================================

    var buildCards = function () {
        els.devices.innerHTML = '';
        screens.forEach(function (s) {
            var card = document.createElement('label');
            card.className = 'print-product wallpaper-device';

            var input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = s.picked;
            input.addEventListener('change', function () {
                s.picked = input.checked;
                prepare();
            });

            // Preview at the screen's shape, drawn at 2x for sharpness.
            var scale = Math.min(THUMB_WIDTH / s.width, THUMB_HEIGHT / s.height);
            var width = Math.max(1, Math.round(s.width * scale));
            var height = Math.max(1, Math.round(s.height * scale));
            var thumb = window.colourio.render(width * 2, height * 2);
            thumb.className = 'print-thumb';
            thumb.style.width = width + 'px';
            thumb.style.height = height + 'px';

            var frame = document.createElement('span');
            frame.className = 'print-frame';
            frame.appendChild(thumb);

            var name = document.createElement('span');
            name.className = 'print-name';
            name.textContent = s.name;

            var size = document.createElement('span');
            size.className = 'print-size';
            size.textContent = s.width + ' × ' + s.height;

            card.append(input, frame, name, size);
            els.devices.appendChild(card);
        });
    };

    // Screen ids are fixed names, safe to report.
    var sent = function (method, ids) {
        T.count('wallpapers.saved', { method: method, count: ids.length });
        ids.forEach(function (id) { T.count('wallpaper.screen', { screen: id, method: method }); });
    };

    var selectedIds = function () {
        return selected().map(function (s) { return s.id; });
    };

    els.button.addEventListener('click', function () {
        if (!window.colourio.render(1, 1)) { return; }
        files = {};
        screens = listScreens();
        buildCards();
        els.shareBtn.hidden = !useShareSheet;
        els.downloadBtn.classList.toggle('btn-primary', !useShareSheet);
        els.dialog.showModal();
        T.count('wallpapers.dialog_opened', { share_sheet: useShareSheet });
        prepare();
    });

    els.downloadBtn.addEventListener('click', function () {
        if (!ready) { return; }
        var blob = ready.files.length === 1 ? ready.files[0] : ready.zip;
        var name = ready.files.length === 1 ? ready.files[0].name : baseName() + '-wallpapers.zip';
        if (!blob) { return; }
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        sent(ready.files.length === 1 ? 'png' : 'zip', selectedIds());
        els.dialog.close();
    });

    els.shareBtn.addEventListener('click', function () {
        if (!ready) { return; }
        var list = ready.files;
        var ids = selectedIds();
        els.dialog.close();
        navigator.share({ files: list }).then(function () {
            sent('sheet', ids);
        }, function (error) {
            if (error && error.name === 'AbortError') {
                T.count('wallpapers.share_cancelled');
            } else {
                T.warn('Wallpaper share failed', { error: (error && error.name) || 'unknown' });
                window.colourio.toast('Couldn’t open the share sheet');
            }
        });
    });

    els.closeBtn.addEventListener('click', function () { els.dialog.close(); });
    els.dialog.addEventListener('click', function (e) {
        if (e.target === els.dialog) { els.dialog.close(); }
    });
    els.dialog.addEventListener('close', function () {
        generation++;
        files = {};
        ready = null;
        setStatus('');
    });
})();
