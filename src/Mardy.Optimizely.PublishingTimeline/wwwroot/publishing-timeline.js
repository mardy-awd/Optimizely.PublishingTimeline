/* Publishing Timeline — Dashboard panel script.
   Vanilla JS, IIFE-scoped. No external dependencies. */
(function () {
  'use strict';

  var MOUNT_ID     = 'publishing-timeline-root';
  var API_PATH     = '/publishingtimeline/api/scheduled';
  var PAGE_SIZE    = 10;
  var DD_PAGE_SIZE = 20;   // matches FilteringSelect pageSize in TimeZoneScheduleSelector.js

  /* ── Timezone helpers (ported from TimeZoneScheduleSelector.js) ─── */

  var PREFERRED = ['Europe/London', 'Africa/Cairo', 'America/New_York', 'Asia/Dubai'];

  function browserZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch (_) { return 'UTC'; }
  }

  function allZones() {
    var supported = typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone') : [];
    return Array.from(new Set(PREFERRED.concat(supported, [browserZone(), 'UTC'])));
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // Produces "UTC+02:00" — ported verbatim from TimeZoneScheduleSelector.js
  function offsetLabel(date, zone) {
    var part = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, timeZoneName: 'longOffset'
    }).formatToParts(date).filter(function (p) { return p.type === 'timeZoneName'; })[0];
    var raw = part ? part.value : 'GMT';
    if (raw === 'GMT') { return 'UTC+00:00'; }
    var m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(raw);
    if (!m) { return raw.replace('GMT', 'UTC'); }
    return 'UTC' + m[1] + pad(m[2]) + ':' + (m[3] || '00');
  }

  // Produces "(UTC+02:00) Africa/Cairo" — ported verbatim from TimeZoneScheduleSelector.js
  function zoneLabel(date, zone) {
    return '(' + offsetLabel(date, zone) + ') ' + zone.replace(/_/g, ' ');
  }

  var BROWSER_ZONE = browserZone();

  // isBrowser flag kept separate so the star can be styled independently
  // in the dropdown (HTML span) vs the input field (plain text with NBSP).
  var TZ_ITEMS = (function () {
    var now   = new Date();
    var items = allZones().map(function (z) {
      return { value: z, label: zoneLabel(now, z), isBrowser: z === BROWSER_ZONE };
    });
    items.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return items;
  }());

  /* ── State ───────────────────────────────────────────────────────── */

  var state = {
    skip:     0,
    take:     PAGE_SIZE,
    items:    [],
    hasMore:  false,
    loading:  false,
    error:    null,
    timezone: BROWSER_ZONE,
  };

  /* ── General helpers ─────────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Treat ScheduledAt as UTC (append Z when no timezone designator present).
  function formatDate(raw, tz) {
    if (!raw) { return '—'; }
    var iso = /Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw + 'Z';
    var d   = new Date(iso);
    if (isNaN(d.getTime())) { return esc(raw); }
    try {
      return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: tz, timeZoneName: 'short',
      });
    } catch (_) { return d.toLocaleString(); }
  }

  function cmsModuleUrl() {
    var el  = document.getElementById('root');
    var url = (el && el.dataset && el.dataset.epiModuleUrl) || '/Optimizely/CMS';
    return url.replace(/\/+$/, '');
  }

  function editUrl(item) {
    return cmsModuleUrl() +
      '/?language=' + encodeURIComponent(item.language) +
      '#context=epi.cms.contentdata:///' + item.contentId + '_' + item.versionId;
  }

  // Label shown in the plain-text input field.
  // Uses NBSP + star so the star doesn't touch the timezone name.
  function currentLabel() {
    for (var i = 0; i < TZ_ITEMS.length; i++) {
      if (TZ_ITEMS[i].value === state.timezone) {
        return TZ_ITEMS[i].label;  // star shown only in dropdown via CSS ::after
      }
    }
    return state.timezone;
  }

  /* ── Custom combobox dropdown ────────────────────────────────────── */
  // Appended to <body> so it escapes the panel's overflow:hidden.
  // Positioned via getBoundingClientRect each time it opens.

  var _dd            = null;  // singleton element, created once
  var _ddOpen        = false;
  var _ddAll         = [];    // all items matching current filter
  var _ddPage        = 0;     // current pagination page within _ddAll
  var _ddAvailH      = 180;   // px available for the options scroll area (set by positionDd)
  var _ddMount       = null;  // mount ref stored for the delegated handler in createDropdown
  var _skipFocusOpen = false; // prevents double-open when arrow clicks focus the input

  function createDropdown() {
    if (_dd) { return; }
    _dd = document.createElement('div');
    _dd.className = 'pt-tz-dropdown';
    document.body.appendChild(_dd);

    // Single delegated mousedown handler on _dd.
    // Registered ONCE here — survives every _dd.innerHTML replacement because
    // _dd itself is never replaced. No per-element re-attachment needed.
    _dd.addEventListener('mousedown', function (e) {
      var t   = e.target;
      var opt = t && t.closest && t.closest('.pt-tz-opt');
      if (opt) {
        e.preventDefault();
        pickZone(opt.dataset.v, _ddMount);
        return;
      }
      if (t && t.closest && t.closest('.pt-tz-prev')) {
        e.preventDefault();
        _ddPage = Math.max(0, _ddPage - 1);
        populateDd(_ddMount);
        return;
      }
      if (t && t.closest && t.closest('.pt-tz-more')) {
        e.preventDefault();
        _ddPage++;
        populateDd(_ddMount);
        return;
      }
    });

    // Close on outside click.
    // Uses e.composedPath() rather than _dd.contains(e.target) because populateDd
    // replaces _dd.innerHTML during the mousedown handler — detaching the original
    // target from _dd. contains() then wrongly returns false (outside click) on the
    // same event. composedPath() captures the path at dispatch time, before any DOM
    // mutations, so _dd still appears in it even after innerHTML replacement.
    document.addEventListener('mousedown', function (e) {
      if (!_ddOpen) { return; }
      var path  = e.composedPath ? e.composedPath() : [];
      var combo = document.getElementById('pt-tz-combo');
      if (path.indexOf(_dd) >= 0) { return; }
      if (combo && path.indexOf(combo) >= 0) { return; }
      closeDd(true);
    });
  }

  function positionDd() {
    var combo = document.getElementById('pt-tz-combo');
    if (!combo || !_dd) { return; }
    var r          = combo.getBoundingClientRect();
    var vH         = window.innerHeight;
    var spaceBelow = vH - r.bottom - 8;
    var spaceAbove = r.top - 8;

    _dd.style.left  = r.left  + 'px';
    _dd.style.width = r.width + 'px';

    if (spaceBelow >= 150 || spaceBelow >= spaceAbove) {
      _dd.style.top          = r.bottom + 'px';
      _dd.style.bottom       = '';
      _dd.style.borderRadius = '0 0 3px 3px';
      _ddAvailH = Math.min(280, Math.max(100, spaceBelow));
    } else {
      _dd.style.top          = '';
      _dd.style.bottom       = (vH - r.top) + 'px';
      _dd.style.borderRadius = '3px 3px 0 0';
      _ddAvailH = Math.min(280, Math.max(100, spaceAbove));
    }
  }

  // Sets _ddAll from the full list filtered by text and resets to page 0.
  function applyFilter(text) {
    var lower = (text || '').toLowerCase().trim();
    _ddAll  = lower
      ? TZ_ITEMS.filter(function (it) { return it.label.toLowerCase().indexOf(lower) >= 0; })
      : TZ_ITEMS.slice();
    _ddPage = 0;
  }

  // Renders the current page of _ddAll into the dropdown with
  // "Previous choices" / "More choices" links matching FilteringSelect pageSize:20.
  function populateDd(mount) {
    _ddMount = mount;   // kept for the delegated handler in createDropdown

    if (_ddAll.length === 0) {
      _dd.innerHTML = '<div class="pt-tz-no-match">No matches</div>';
      return;
    }

    var start     = _ddPage * DD_PAGE_SIZE;
    var end       = start + DD_PAGE_SIZE;
    var pageItems = _ddAll.slice(start, end);
    var hasPrev   = _ddPage > 0;
    var hasMore   = end < _ddAll.length;

    // "Previous choices" and "More choices" are placed OUTSIDE .pt-tz-options
    // so they are always visible as sticky header/footer of the dropdown and
    // are never buried inside the scroll area regardless of list length.
    var html = '';

    if (hasPrev) {
      html += '<div class="pt-tz-choices pt-tz-prev">Previous choices</div>';
    }

    html += '<div class="pt-tz-options">';
    for (var i = 0; i < pageItems.length; i++) {
      var it   = pageItems[i];
      var cls  = it.value === state.timezone ? ' pt-tz-opt--on' : '';
      var cls2 = it.isBrowser ? ' pt-tz-opt--browser' : '';
      html += '<div class="pt-tz-opt' + cls + cls2 + '" data-v="' + esc(it.value) + '">' +
        esc(it.label) + '</div>';
    }
    html += '</div>';

    if (hasMore) {
      html += '<div class="pt-tz-choices pt-tz-more">More choices</div>';
    }
    _dd.innerHTML = html;

    // Explicit options height so 'More choices' stays outside the scroll area.
    var LINK_H = 28;
    var optEl  = _dd.querySelector('.pt-tz-options');
    if (optEl) {
      var usedH = (_dd.querySelector('.pt-tz-prev') ? LINK_H : 0) +
                  (_dd.querySelector('.pt-tz-more') ? LINK_H : 0);
      optEl.style.maxHeight = Math.max(60, _ddAvailH - usedH) + 'px';
    }

    // On first page, scroll the selected item into view.
    if (_ddPage === 0) {
      var on = _dd.querySelector('.pt-tz-opt--on');
      if (on) { on.scrollIntoView({ block: 'nearest' }); }
    }
    // All click handling is done by the single delegated listener on _dd
    // registered in createDropdown() — no per-element listeners needed here.
  }

  function openDd(filter, mount) {
    createDropdown();
    applyFilter(filter);
    _ddOpen = true;
    _dd.style.display = 'block';
    positionDd();
    populateDd(mount);
  }

  function closeDd(restoreLabel) {
    _ddOpen = false;
    if (_dd) { _dd.style.display = 'none'; }
    if (restoreLabel) {
      var inp = document.getElementById('pt-tz-input');
      if (inp) { inp.value = currentLabel(); }
    }
  }

  function pickZone(value, mount) {
    closeDd(false);
    if (value !== state.timezone) {
      state.timezone = value;
      render(mount);     // re-render from cached items — no API refetch
    } else {
      var inp = document.getElementById('pt-tz-input');
      if (inp) { inp.value = currentLabel(); }
    }
  }

  /* ── Render ──────────────────────────────────────────────────────── */

  function buildToolbar() {
    return (
      '<div class="pt-toolbar">' +
        '<span class="pt-toolbar-title">Publishing Timeline</span>' +
        '<label class="pt-tz-label" for="pt-tz-input">Timezone:</label>' +
        '<div class="pt-tz-combo" id="pt-tz-combo">' +
          '<input class="pt-tz-input" id="pt-tz-input" type="text"' +
            ' autocomplete="off" spellcheck="false"' +
            ' value="' + esc(currentLabel()) + '">' +
          '<button class="pt-tz-arrow" id="pt-tz-arrow" type="button" tabindex="-1">&#9660;</button>' +
        '</div>' +
      '</div>'
    );
  }

  function render(mount) {
    var toolbar = buildToolbar();

    if (state.loading) {
      mount.innerHTML = toolbar + '<p class="pt-message">Loading…</p>';
      attachListeners(mount);
      return;
    }

    if (state.error) {
      mount.innerHTML = toolbar +
        '<p class="pt-message pt-message--error">' +
        'Unable to load scheduled publications. Please refresh the page.</p>';
      attachListeners(mount);
      return;
    }

    if (state.items.length === 0) {
      mount.innerHTML = toolbar +
        '<p class="pt-message">No scheduled publications found.</p>';
      attachListeners(mount);
      return;
    }

    var rows = state.items.map(function (item) {
      return (
        '<tr class="pt-tr">' +
          '<td class="pt-td pt-col--name">'     + esc(item.name)                               + '</td>' +
          '<td class="pt-td pt-col--language">' + esc(item.language)                           + '</td>' +
          '<td class="pt-td pt-col--date">'     + formatDate(item.scheduledAt, state.timezone)  + '</td>' +
          '<td class="pt-td pt-col--action pt-td--action">' +
            '<a class="pt-link" href="' + esc(editUrl(item)) + '">Edit</a>' +
          '</td>' +
        '</tr>'
      );
    }).join('');

    var page    = Math.floor(state.skip / state.take) + 1;
    var prevOff = state.skip === 0 ? ' disabled' : '';
    var nextOff = !state.hasMore   ? ' disabled' : '';

    mount.innerHTML =
      toolbar +
      '<div class="pt-scroll">' +
        '<table class="pt-table">' +
          '<colgroup>' +
            '<col class="pt-col--name"><col class="pt-col--language">' +
            '<col class="pt-col--date"><col class="pt-col--action">' +
          '</colgroup>' +
          '<thead><tr>' +
            '<th class="pt-th">Name</th><th class="pt-th">Language</th>' +
            '<th class="pt-th">Scheduled</th><th class="pt-th"></th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="pt-pagination">' +
        '<span class="pt-page-info">Page ' + page + '</span>' +
        '<button class="pt-btn" id="pt-prev"' + prevOff + '>&#8592; Prev</button>' +
        '<button class="pt-btn" id="pt-next"' + nextOff + '>Next &#8594;</button>' +
      '</div>';

    attachListeners(mount);
  }

  function attachListeners(mount) {
    var input = document.getElementById('pt-tz-input');
    var arrow = document.getElementById('pt-tz-arrow');

    if (input) {
      input.addEventListener('focus', function () {
        // _skipFocusOpen is set by the arrow handler when it has already
        // called openDd directly — prevents double-open in that case.
        if (_skipFocusOpen) { _skipFocusOpen = false; input.select(); return; }
        input.select();
        openDd('', mount);
      });

      // Re-filter as the user types; always resets to page 0 via applyFilter.
      input.addEventListener('input', function () {
        openDd(input.value, mount);
      });

      input.addEventListener('blur', function () {
        // Short delay so the delegated mousedown handler on _dd fires before blur
        // closes the dropdown (mousedown precedes blur in the event order).
        setTimeout(function () { if (_ddOpen) { closeDd(true); } }, 150);
      });

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeDd(true); input.blur(); }
        // If exactly one match is left, Enter selects it.
        if (e.key === 'Enter' && _ddAll.length === 1) {
          pickZone(_ddAll[0].value, mount);
        }
      });
    }

    if (arrow) {
      arrow.addEventListener('mousedown', function (e) {
        e.preventDefault();   // keep focus on input

        if (_ddOpen) {
          closeDd(true);
          return;
        }

        // Fix: call openDd() directly — cannot rely on the input's focus event
        // here because the input may already be focused (focus doesn't re-fire).
        if (input) {
          input.value = '';   // clear so user sees the full list on arrow click
          if (document.activeElement !== input) {
            // Input is not focused — focus it, but suppress the focus handler's
            // own openDd call since we're about to call it ourselves below.
            _skipFocusOpen = true;
            input.focus();
          }
        }
        openDd('', mount);
      });
    }

    var prev = document.getElementById('pt-prev');
    if (prev) {
      prev.addEventListener('click', function () {
        state.skip = Math.max(0, state.skip - state.take);
        load(mount);
      });
    }

    var next = document.getElementById('pt-next');
    if (next) {
      next.addEventListener('click', function () {
        state.skip += state.take;
        load(mount);
      });
    }
  }

  /* ── Data fetching ───────────────────────────────────────────────── */

  function load(mount) {
    state.loading = true;
    state.error   = null;
    render(mount);

    fetch(API_PATH + '?skip=' + state.skip + '&take=' + state.take, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Not authorised — please refresh and log in again.');
        }
        if (!res.ok) { throw new Error('Server returned ' + res.status); }
        return res.json();
      })
      .then(function (data) {
        state.items   = Array.isArray(data.items) ? data.items : [];
        state.hasMore = Boolean(data.hasMore);
        state.loading = false;
        render(mount);
      })
      .catch(function (err) {
        state.loading = false;
        state.error   = err.message;
        render(mount);
      });
  }

  /* ── Bootstrap ───────────────────────────────────────────────────── */

  function init() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) { return; }
    load(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
