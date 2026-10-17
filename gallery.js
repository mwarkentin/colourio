(function () {
    'use strict';

    var samples = window.COLOURIO_SAMPLES || [];
    var $ = function (id) { return document.getElementById(id); };

    var els = {
        button: $('samplesBtn'),
        dialog: $('samplesDialog'),
        closeBtn: $('samplesCloseBtn'),
        filters: $('samplesFilters'),
        grid: $('samplesGrid'),
        randomBtn: $('samplesRandomBtn')
    };

    if (!samples.length) {
        els.button.hidden = true;
        return;
    }

    var filter = 'All';
    var cards = [];

    var choose = function (sample) {
        els.dialog.close();
        window.colourio.loadSample(sample);
    };

    var buildCard = function (sample) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'sample-card';
        card.dataset.group = sample.group;
        card.setAttribute('aria-label', sample.title + (sample.credit ? ', ' + sample.credit : ''));

        var thumb = document.createElement('span');
        thumb.className = 'sample-thumb';
        var img = document.createElement('img');
        img.src = sample.thumb;
        img.alt = '';
        img.loading = 'lazy';
        thumb.appendChild(img);

        var palette = document.createElement('span');
        palette.className = 'sample-palette';
        sample.palette.forEach(function (colour) {
            var swatch = document.createElement('span');
            swatch.style.background = colour;
            palette.appendChild(swatch);
        });

        var title = document.createElement('span');
        title.className = 'sample-title';
        title.textContent = sample.title;

        var byline = document.createElement('span');
        byline.className = 'sample-byline';
        byline.textContent = [sample.credit, sample.date].filter(Boolean).join(' · ');

        card.append(thumb, palette, title, byline);
        card.addEventListener('click', function () { choose(sample); });
        return card;
    };

    var buildFilters = function () {
        var groups = ['All'];
        samples.forEach(function (sample) {
            if (groups.indexOf(sample.group) === -1) { groups.push(sample.group); }
        });
        groups.forEach(function (group) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip';
            chip.textContent = group;
            chip.dataset.group = group;
            chip.addEventListener('click', function () {
                filter = group;
                update();
            });
            els.filters.appendChild(chip);
        });
    };

    var update = function () {
        var current = window.colourio.currentSample();
        els.filters.querySelectorAll('.chip').forEach(function (chip) {
            chip.setAttribute('aria-pressed', String(chip.dataset.group === filter));
        });
        cards.forEach(function (card, i) {
            card.hidden = filter !== 'All' && card.dataset.group !== filter;
            card.setAttribute('aria-current', String(samples[i].id === current));
        });
    };

    els.button.addEventListener('click', function () {
        if (!cards.length) {
            buildFilters();
            cards = samples.map(buildCard);
            els.grid.append.apply(els.grid, cards);
        }
        update();
        els.dialog.showModal();
    });

    // A random sample from the current filter, never the one already open.
    els.randomBtn.addEventListener('click', function () {
        var current = window.colourio.currentSample();
        var pool = samples.filter(function (sample) {
            return (filter === 'All' || sample.group === filter) && sample.id !== current;
        });
        if (pool.length) { choose(pool[Math.floor(Math.random() * pool.length)]); }
    });

    els.closeBtn.addEventListener('click', function () { els.dialog.close(); });
    els.dialog.addEventListener('click', function (e) {
        if (e.target === els.dialog) { els.dialog.close(); }
    });
})();
