/* Publishing Timeline — Dashboard panel script.
   Vanilla JS, IIFE-scoped. No external dependencies. */
(function () {
  'use strict';

  var MOUNT_ID     = 'publishing-timeline-root';
  // API base incl. the app's PathBase, rendered server-side on this <script> tag
  // (data-api-base); currentScript is set while a deferred classic script runs.
  var API_BASE     = (document.currentScript &&
                      document.currentScript.getAttribute('data-api-base')) ||
                     '/publishingtimeline/api';
  var API_PATH     = API_BASE + '/scheduled';
  var LANG_API     = API_BASE + '/languages';
  var PAGE_SIZE    = 10;
  var DD_PAGE_SIZE = 20;   // matches FilteringSelect pageSize in TimeZoneScheduleSelector.js

  /* ── Timezone helpers (ported from TimeZoneScheduleSelector.js) ─── */

  var PREFERRED  = ['Europe/London', 'Africa/Cairo', 'America/New_York', 'Asia/Dubai'];
  var CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

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

  // Converts pre-computed 24-hour parts to "h:mm AM/PM" (no leading zero).
  function formatTimeAMPM(hour, minute) {
    var ampm = hour >= 12 ? 'PM' : 'AM';
    var h    = hour % 12 || 12;
    return h + ':' + pad(minute) + ' ' + ampm;
  }

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

  var _languages = [];   // populated from /api/languages before first render

  // Calendar view state — independent of table pagination state.
  var cal = { items: [], loading: false, error: null };

  var state = {
    skip:     0,
    take:     PAGE_SIZE,
    items:    [],
    hasMore:  false,
    loading:  false,
    error:    null,
    timezone: BROWSER_ZONE,
    language: '',         // '' = all languages
    dateFrom: '',         // YYYY-MM-DD local calendar date, or ''
    dateTo:   '',         // YYYY-MM-DD local calendar date, or ''
    view:     'table',    // 'table' | 'calendar'
    calYear:  0,          // displayed calendar year, initialised in init()
    calMonth: 0,          // displayed calendar month (0-based), initialised in init()
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
        hour: 'numeric', minute: '2-digit', hour12: true,
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

  /* ── Date-range helpers ──────────────────────────────────────────── */

  // Returns the ISO 8601 UTC string for local midnight on dateStr (YYYY-MM-DD) in tz.
  // Uses noon UTC as the reference point so DST transitions around midnight cannot
  // produce an incorrect offset for the day being queried.
  function localDayStartUtcIso(dateStr, tz) {
    var p   = dateStr.split('-');
    var y = +p[0], mo = +p[1] - 1, d = +p[2];
    // noon UTC on that calendar day — safely outside any DST spring-forward gap
    var ref = new Date(Date.UTC(y, mo, d, 12, 0, 0));

    var map = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(ref).forEach(function (pt) { map[pt.type] = pt.value; });

    var h = parseInt(map.hour === '24' ? '0' : map.hour, 10);
    var localRefAsUtc = Date.UTC(
      +map.year, +map.month - 1, +map.day,
      h, +map.minute, +map.second
    );

    // UTC_midnight = local_midnight_as_fake_UTC + (UTC_ref − local_ref_as_UTC)
    var offsetMs     = ref.getTime() - localRefAsUtc;
    var midnightFake = Date.UTC(y, mo, d, 0, 0, 0);
    return new Date(midnightFake + offsetMs).toISOString();
  }

  // Returns the YYYY-MM-DD for the calendar day after dateStr.
  function addOneDayIso(dateStr) {
    var p = dateStr.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1)).toISOString().slice(0, 10);
  }

  // False only when both dates are set and from > to.
  function dateRangeValid() {
    return !state.dateFrom || !state.dateTo || state.dateFrom <= state.dateTo;
  }

  // Returns {year, month (0-based)} for the current moment in the given timezone.
  function localYearMonth(tz) {
    var map = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric',
    }).formatToParts(new Date()).forEach(function (pt) { map[pt.type] = pt.value; });
    return { year: +map.year, month: +map.month - 1 };
  }

  // Converts a UTC ISO string to local date/time parts in the given timezone.
  // Returns null for unparseable input.
  function utcToLocalParts(isoStr, tz) {
    var iso = /Z$|[+-]\d{2}:\d{2}$/.test(isoStr) ? isoStr : isoStr + 'Z';
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return null; }
    var map = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).formatToParts(d).forEach(function (pt) { map[pt.type] = pt.value; });
    return {
      year:   +map.year,
      month:  +map.month - 1,
      day:    +map.day,
      hour:   +(map.hour === '24' ? '0' : map.hour),
      minute: +map.minute,
    };
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
      if (state.view === 'calendar') {
        // UTC month boundaries (and any date-filter bounds) change with timezone.
        loadCalendar(mount);
      } else if (state.dateFrom || state.dateTo) {
        // Date filters are active — UTC boundaries change with timezone.
        state.skip = 0;
        load(mount);
      } else {
        render(mount);   // no date filter — re-render from cached items
      }
    } else {
      var inp = document.getElementById('pt-tz-input');
      if (inp) { inp.value = currentLabel(); }
    }
  }

  /* ── Render ──────────────────────────────────────────────────────── */

  function buildLangOptions() {
    var html = '<option value="">All languages</option>';
    for (var i = 0; i < _languages.length; i++) {
      var lang = _languages[i];
      var sel  = lang.code === state.language ? ' selected' : '';
      html += '<option value="' + esc(lang.code) + '"' + sel + '>' + esc(lang.name) + '</option>';
    }
    return html;
  }

  function buildToolbar() {
    var tblCls  = 'pt-btn pt-view-btn' + (state.view === 'table'    ? ' pt-view-btn--active' : '');
    var calCls  = 'pt-btn pt-view-btn' + (state.view === 'calendar' ? ' pt-view-btn--active' : '');
    var fromVal = state.dateFrom ? ' value="' + esc(state.dateFrom) + '"' : '';
    var toVal   = state.dateTo   ? ' value="' + esc(state.dateTo)   + '"' : '';
    return (
      '<div class="pt-toolbar">' +
        '<div class="pt-toolbar-header">' +
          '<span class="pt-toolbar-title">Publishing Timeline</span>' +
          '<button class="pt-btn pt-collapse-btn" id="pt-collapse" type="button"' +
            ' aria-controls="' + MOUNT_ID + '" aria-expanded="' + !isCollapsed() + '">' +
            (isCollapsed() ? 'Expand' : 'Collapse') +
          '</button>' +
        '</div>' +
        '<div class="pt-toolbar-controls">' +
        '<button class="' + tblCls + '" id="pt-view-table" type="button">Table</button>' +
        '<button class="' + calCls + '" id="pt-view-cal"   type="button">Calendar</button>' +
        '<label class="pt-lang-label" for="pt-lang-select">Language:</label>' +
        '<select class="pt-lang-select" id="pt-lang-select">' + buildLangOptions() + '</select>' +
        '<label class="pt-date-label" for="pt-date-from">From:</label>' +
        '<input class="pt-date-input" id="pt-date-from" type="date"' + fromVal + '>' +
        '<label class="pt-date-label" for="pt-date-to">To:</label>' +
        '<input class="pt-date-input" id="pt-date-to" type="date"' + toVal + '>' +
        '<label class="pt-tz-label" for="pt-tz-input">Timezone:</label>' +
        '<div class="pt-tz-combo" id="pt-tz-combo">' +
          '<input class="pt-tz-input" id="pt-tz-input" type="text"' +
            ' autocomplete="off" spellcheck="false"' +
            ' value="' + esc(currentLabel()) + '">' +
          '<button class="pt-tz-arrow" id="pt-tz-arrow" type="button" tabindex="-1">&#9660;</button>' +
        '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /* ── Calendar rendering ─────────────────────────────────────────── */

  function buildCalendarGrid(year, month, items, tz) {
    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build day-of-month → sorted event list.
    var dayMap = {};
    for (var i = 0; i < items.length; i++) {
      var lp = utcToLocalParts(items[i].scheduledAt, tz);
      if (!lp || lp.year !== year || lp.month !== month) { continue; }
      if (!dayMap[lp.day]) { dayMap[lp.day] = []; }
      dayMap[lp.day].push({ item: items[i], hour: lp.hour, minute: lp.minute });
    }
    Object.keys(dayMap).forEach(function (d) {
      dayMap[d].sort(function (a, b) {
        return (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute);
      });
    });

    // Day-of-week of the 1st is a Gregorian calendar property, independent of timezone.
    var firstDow    = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var todayParts  = utcToLocalParts(new Date().toISOString(), tz);

    var html = '<div class="pt-cal-grid">';

    for (var h = 0; h < 7; h++) {
      html += '<div class="pt-cal-dow">' + DAY_NAMES[h] + '</div>';
    }
    for (var pi = 0; pi < firstDow; pi++) {
      html += '<div class="pt-cal-day pt-cal-day--pad"></div>';
    }
    for (var day = 1; day <= daysInMonth; day++) {
      var isToday = todayParts &&
        todayParts.year === year && todayParts.month === month && todayParts.day === day;
      html += '<div class="pt-cal-day' + (isToday ? ' pt-cal-day--today' : '') + '">';
      html += '<span class="pt-cal-day-num">' + day + '</span>';
      if (dayMap[day]) {
        var evs  = dayMap[day];
        var show = Math.min(evs.length, 3);
        html += '<div class="pt-cal-events">';
        for (var ei = 0; ei < show; ei++) {
          var ev  = evs[ei];
          var lbl = formatTimeAMPM(ev.hour, ev.minute) + ' ' + ev.item.name;
          html += '<a class="pt-cal-event" href="' + esc(editUrl(ev.item)) +
            '" target="_blank" rel="noopener noreferrer"' +
            ' title="' + esc(lbl) + '">' + esc(lbl) + '</a>';
        }
        if (evs.length > 3) {
          html += '<button class="pt-cal-more" data-day="' + day +
            '" type="button">+' + (evs.length - 3) + ' more</button>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    // Complete the final week so every column of the last row has a cell (and
    // therefore its right/bottom border) — mirrors the leading pad cells.
    var trailing = (7 - (firstDow + daysInMonth) % 7) % 7;
    for (var ti = 0; ti < trailing; ti++) {
      html += '<div class="pt-cal-day pt-cal-day--pad"></div>';
    }
    html += '</div>';
    return html;
  }

  /* ── Day-events popup ────────────────────────────────────────────── */

  var _calPopup        = null;   // singleton element, created once
  var _calPopupOpen    = false;
  var _calPopupEscHdlr = null;

  // Re-derives the sorted event list for `day` from cal.items at popup-open
  // time so buildCalendarGrid does not need to encode event data in the DOM.
  function getCalEventsForDay(day) {
    var result = [];
    for (var i = 0; i < cal.items.length; i++) {
      var lp = utcToLocalParts(cal.items[i].scheduledAt, state.timezone);
      if (lp && lp.year === state.calYear && lp.month === state.calMonth && lp.day === day) {
        result.push({ item: cal.items[i], hour: lp.hour, minute: lp.minute });
      }
    }
    result.sort(function (a, b) {
      return (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute);
    });
    return result;
  }

  function createCalPopup() {
    if (_calPopup) { return; }
    _calPopup = document.createElement('div');
    _calPopup.className = 'pt-cal-popup';
    document.body.appendChild(_calPopup);

    // Single document-level outside-click handler, registered once.
    // Uses composedPath() for the same reason as the timezone dropdown.
    document.addEventListener('mousedown', function (e) {
      if (!_calPopupOpen) { return; }
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(_calPopup) >= 0) { return; }
      // Let .pt-cal-more buttons manage open/close themselves.
      if (e.target && e.target.closest && e.target.closest('.pt-cal-more')) { return; }
      closeCalPopup();
    });
  }

  function positionCalPopup(anchor) {
    if (!_calPopup || !anchor) { return; }
    var r  = anchor.getBoundingClientRect();
    var vW = window.innerWidth;
    var vH = window.innerHeight;
    var pw = 220;   // matches .pt-cal-popup width in CSS

    var left = r.left;
    if (left + pw > vW - 8) { left = vW - pw - 8; }
    if (left < 8)            { left = 8; }
    _calPopup.style.left = left + 'px';

    // Prefer below the anchor; fall back to above when space is tight.
    if (vH - r.bottom >= 120) {
      _calPopup.style.top    = (r.bottom + 4) + 'px';
      _calPopup.style.bottom = '';
    } else {
      _calPopup.style.top    = '';
      _calPopup.style.bottom = (vH - r.top + 4) + 'px';
    }
  }

  function openCalPopup(btn, day) {
    createCalPopup();

    var evs = getCalEventsForDay(day);

    var html =
      '<div class="pt-cal-popup-header">' +
        '<span>' + esc(day + ' ' + CAL_MONTHS[state.calMonth] + ' ' + state.calYear) + '</span>' +
        '<button class="pt-cal-popup-close" type="button" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="pt-cal-popup-list">';
    for (var i = 0; i < evs.length; i++) {
      var ev  = evs[i];
      var lbl = formatTimeAMPM(ev.hour, ev.minute) + ' ' + ev.item.name;
      html += '<a class="pt-cal-popup-event" href="' + esc(editUrl(ev.item)) +
        '" target="_blank" rel="noopener noreferrer"' +
        ' title="' + esc(lbl) + '">' + esc(lbl) + '</a>';
    }
    html += '</div>';

    _calPopup.innerHTML    = html;
    _calPopup.style.display = 'block';
    _calPopupOpen           = true;

    _calPopup.querySelector('.pt-cal-popup-close')
      .addEventListener('click', function () { closeCalPopup(); });

    positionCalPopup(btn);

    if (_calPopupEscHdlr) { document.removeEventListener('keydown', _calPopupEscHdlr); }
    _calPopupEscHdlr = function (e) { if (e.key === 'Escape') { closeCalPopup(); } };
    document.addEventListener('keydown', _calPopupEscHdlr);
  }

  function closeCalPopup() {
    _calPopupOpen = false;
    if (_calPopup) { _calPopup.style.display = 'none'; }
    if (_calPopupEscHdlr) {
      document.removeEventListener('keydown', _calPopupEscHdlr);
      _calPopupEscHdlr = null;
    }
  }

  function renderCalendar(mount) {
    var toolbar = buildToolbar();

    if (!dateRangeValid()) {
      mount.innerHTML = toolbar +
        '<p class="pt-message pt-message--warn">From date must be on or before To date.</p>';
      attachListeners(mount);
      return;
    }

    if (cal.loading) {
      mount.innerHTML = toolbar + '<p class="pt-message">Loading…</p>';
      attachListeners(mount);
      return;
    }

    if (cal.error) {
      mount.innerHTML = toolbar +
        '<p class="pt-message pt-message--error">' +
        'Unable to load calendar. Please refresh the page.</p>';
      attachListeners(mount);
      return;
    }

    mount.innerHTML =
      toolbar +
      '<div class="pt-cal-nav">' +
        '<button class="pt-btn" id="pt-cal-prev">&#8592; Prev</button>' +
        '<span class="pt-cal-title">' +
          esc(CAL_MONTHS[state.calMonth] + ' ' + state.calYear) +
        '</span>' +
        '<button class="pt-btn" id="pt-cal-today">Today</button>' +
        '<button class="pt-btn" id="pt-cal-next">Next &#8594;</button>' +
      '</div>' +
      '<div class="pt-cal-scroll">' +
        buildCalendarGrid(state.calYear, state.calMonth, cal.items, state.timezone) +
      '</div>';

    attachListeners(mount);
  }

  // Loads calendar items for the displayed month, intersected with any active
  // From/To date filter.  Uses take=100 (API max) rather than table PAGE_SIZE.
  function loadCalendar(mount) {
    if (!dateRangeValid()) { renderCalendar(mount); return; }

    closeCalPopup();
    cal.loading = true;
    cal.error   = null;
    renderCalendar(mount);

    var y   = state.calYear;
    var mo  = state.calMonth;
    var ny  = mo === 11 ? y + 1 : y;
    var nmo = mo === 11 ? 0 : mo + 1;

    // Month boundaries in the selected timezone → UTC.
    var calFrom = localDayStartUtcIso(y + '-' + pad(mo + 1) + '-01', state.timezone);
    var calTo   = localDayStartUtcIso(ny + '-' + pad(nmo + 1) + '-01', state.timezone);

    // Intersect with the shared date-range filter (ISO string comparison is valid for UTC).
    var effectiveFrom = calFrom;
    if (state.dateFrom) {
      var dfUtc = localDayStartUtcIso(state.dateFrom, state.timezone);
      if (dfUtc > effectiveFrom) { effectiveFrom = dfUtc; }
    }
    var effectiveTo = calTo;
    if (state.dateTo) {
      var dtUtc = localDayStartUtcIso(addOneDayIso(state.dateTo), state.timezone);
      if (dtUtc < effectiveTo) { effectiveTo = dtUtc; }
    }

    var url = API_PATH + '?skip=0&take=100';
    if (state.language) {
      url += '&language=' + encodeURIComponent(state.language);
    }
    url += '&from=' + encodeURIComponent(effectiveFrom);
    url += '&to='   + encodeURIComponent(effectiveTo);

    fetch(url, {
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
        cal.items   = Array.isArray(data.items) ? data.items : [];
        cal.loading = false;
        renderCalendar(mount);
      })
      .catch(function (err) {
        cal.loading = false;
        cal.error   = err.message;
        renderCalendar(mount);
      });
  }

  /* ── Table rendering ─────────────────────────────────────────────── */

  function render(mount) {
    var toolbar = buildToolbar();

    if (!dateRangeValid()) {
      mount.innerHTML = toolbar +
        '<p class="pt-message pt-message--warn">From date must be on or before To date.</p>';
      attachListeners(mount);
      return;
    }

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
            '<a class="pt-link" href="' + esc(editUrl(item)) +
            '" target="_blank" rel="noopener noreferrer">Edit</a>' +
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
    // ── Collapse / Expand ─────────────────────────────────────────────
    var collapseBtn = document.getElementById('pt-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', toggleCollapsed);
    }

    // ── View toggle ───────────────────────────────────────────────────
    var tblBtn = document.getElementById('pt-view-table');
    if (tblBtn) {
      tblBtn.addEventListener('click', function () {
        if (state.view !== 'table') { state.view = 'table'; render(mount); }
      });
    }

    var calBtn = document.getElementById('pt-view-cal');
    if (calBtn) {
      calBtn.addEventListener('click', function () {
        if (state.view !== 'calendar') { state.view = 'calendar'; loadCalendar(mount); }
      });
    }

    // ── Calendar navigation (elements only present in calendar view) ──
    var calPrev = document.getElementById('pt-cal-prev');
    if (calPrev) {
      calPrev.addEventListener('click', function () {
        if (state.calMonth === 0) { state.calYear--; state.calMonth = 11; }
        else { state.calMonth--; }
        loadCalendar(mount);
      });
    }

    var calNext = document.getElementById('pt-cal-next');
    if (calNext) {
      calNext.addEventListener('click', function () {
        if (state.calMonth === 11) { state.calYear++; state.calMonth = 0; }
        else { state.calMonth++; }
        loadCalendar(mount);
      });
    }

    var calToday = document.getElementById('pt-cal-today');
    if (calToday) {
      calToday.addEventListener('click', function () {
        var ym = localYearMonth(state.timezone);
        state.calYear  = ym.year;
        state.calMonth = ym.month;
        loadCalendar(mount);
      });
    }

    // ── Calendar day-overflow popup ───────────────────────────────────
    var moreBtns = mount.querySelectorAll('.pt-cal-more');
    for (var mi = 0; mi < moreBtns.length; mi++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          openCalPopup(btn, parseInt(btn.dataset.day, 10));
        });
      }(moreBtns[mi]));
    }

    // ── Shared filters — dispatch on active view ──────────────────────
    var langSelect = document.getElementById('pt-lang-select');
    if (langSelect) {
      langSelect.addEventListener('change', function () {
        state.language = langSelect.value;
        if (state.view === 'calendar') { loadCalendar(mount); }
        else { state.skip = 0; load(mount); }
      });
    }

    var dateFrom = document.getElementById('pt-date-from');
    if (dateFrom) {
      dateFrom.addEventListener('change', function () {
        state.dateFrom = dateFrom.value;
        state.skip     = 0;
        if (dateRangeValid()) {
          if (state.view === 'calendar') { loadCalendar(mount); } else { load(mount); }
        } else {
          if (state.view === 'calendar') { renderCalendar(mount); } else { render(mount); }
        }
      });
    }

    var dateTo = document.getElementById('pt-date-to');
    if (dateTo) {
      dateTo.addEventListener('change', function () {
        state.dateTo = dateTo.value;
        state.skip   = 0;
        if (dateRangeValid()) {
          if (state.view === 'calendar') { loadCalendar(mount); } else { load(mount); }
        } else {
          if (state.view === 'calendar') { renderCalendar(mount); } else { render(mount); }
        }
      });
    }

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

    var url = API_PATH + '?skip=' + state.skip + '&take=' + state.take;
    if (state.language) {
      url += '&language=' + encodeURIComponent(state.language);
    }
    if (state.dateFrom) {
      url += '&from=' + encodeURIComponent(localDayStartUtcIso(state.dateFrom, state.timezone));
    }
    if (state.dateTo) {
      url += '&to=' + encodeURIComponent(localDayStartUtcIso(addOneDayIso(state.dateTo), state.timezone));
    }

    fetch(url, {
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

  /* ── Collapse state ──────────────────────────────────────────────── */
  /* Held as a class on <body> (read by the layout CSS in the tag helper).
     Session-only: a page load always starts expanded. The toolbar is
     re-rendered via innerHTML, so the button reads its label from here. */

  function isCollapsed() {
    return document.body.classList.contains('pt-collapsed');
  }

  function toggleCollapsed() {
    var collapsed = document.body.classList.toggle('pt-collapsed');
    var btn = document.getElementById('pt-collapse');
    if (btn) {
      btn.textContent = collapsed ? 'Expand' : 'Collapse';
      btn.setAttribute('aria-expanded', String(!collapsed));
    }
    if (collapsed) {
      // Floating elements live on <body> and would outlive the hidden content.
      if (_ddOpen) { closeDd(true); }
      closeCalPopup();
    }
  }

  /* ── Bootstrap ───────────────────────────────────────────────────── */

  function init() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) { return; }

    var ym = localYearMonth(state.timezone);
    state.calYear  = ym.year;
    state.calMonth = ym.month;

    fetch(LANG_API, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (data) { _languages = Array.isArray(data) ? data : []; })
      .catch(function ()    { _languages = []; })
      .then(function ()     { load(mount); });
  }

  // The panel is only shown on the Workflow Status "Scheduled" tab (see the
  // tab-tracking script in the tag helper), so defer the first API call until
  // it is actually shown. The tag helper sets body.pt-visible and fires
  // 'pt:visible' on document each time the panel becomes visible.
  var _started = false;

  function start() {
    if (_started) { return; }
    _started = true;
    init();
  }

  function boot() {
    if (document.body.classList.contains('pt-visible')) {
      start();
    } else {
      document.addEventListener('pt:visible', start, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
