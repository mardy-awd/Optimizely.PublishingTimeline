/* Publishing Timeline — Dashboard panel script.
   Vanilla JS, IIFE-scoped. No external dependencies.
   Fetches GET /publishingtimeline/api/scheduled and renders a paginated
   table inside #publishing-timeline-root. */
(function () {
  'use strict';

  var MOUNT_ID  = 'publishing-timeline-root';
  var API_PATH  = '/publishingtimeline/api/scheduled';
  var PAGE_SIZE = 10;

  /* ── State ───────────────────────────────────────────────────────── */
  var state = {
    skip:    0,
    take:    PAGE_SIZE,
    items:   [],
    hasMore: false,
    loading: false,
    error:   null,
  };

  /* ── Helpers ─────────────────────────────────────────────────────── */

  // XSS-safe HTML escaping.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Format a date string in the browser's local timezone.
  // The 'short' timeZoneName makes the timezone offset visible to the user,
  // making clear the date is displayed in their own timezone rather than UTC.
  function formatDate(raw) {
    if (!raw) return '—';
    var d = new Date(raw);
    if (isNaN(d.getTime())) return esc(raw);
    try {
      return d.toLocaleString(undefined, {
        year:           'numeric',
        month:          'short',
        day:            'numeric',
        hour:           '2-digit',
        minute:         '2-digit',
        timeZoneName:   'short',
      });
    } catch (_) {
      return d.toString();
    }
  }

  // Read the CMS module URL injected by the server on the #root element.
  // data-epi-module-url may include a trailing slash; strip it so callers
  // can safely append paths without producing double slashes.
  function cmsModuleUrl() {
    var el  = document.getElementById('root');
    var url = (el && el.dataset && el.dataset.epiModuleUrl) || '/Optimizely/CMS';
    return url.replace(/\/+$/, '');
  }

  // Construct a CMS edit link for a scheduled version.
  // Format confirmed from the CMS Scheduled tab:
  //   {cmsModuleUrl}/?language={lang}#context=epi.cms.contentdata:///{contentId}_{versionId}
  // - No /edit path segment (the module root handles routing via the hash context)
  // - contentId_versionId opens the specific scheduled version
  // - language query param sets the correct language context
  function editUrl(item) {
    return cmsModuleUrl() +
      '/?language=' + encodeURIComponent(item.language) +
      '#context=epi.cms.contentdata:///' + item.contentId + '_' + item.versionId;
  }

  /* ── Render ──────────────────────────────────────────────────────── */

  function render(mount) {
    if (state.loading) {
      mount.innerHTML = '<p class="pt-message">Loading…</p>';
      return;
    }

    if (state.error) {
      mount.innerHTML =
        '<p class="pt-message pt-message--error">' +
        'Unable to load scheduled publications. Please refresh the page.' +
        '</p>';
      return;
    }

    if (state.items.length === 0) {
      mount.innerHTML =
        '<p class="pt-message">No scheduled publications found.</p>';
      return;
    }

    var rows = state.items.map(function (item) {
      return (
        '<tr class="pt-tr">' +
          '<td class="pt-td pt-col--name">' + esc(item.name) + '</td>' +
          '<td class="pt-td pt-col--language">' + esc(item.language) + '</td>' +
          '<td class="pt-td pt-col--date">' + formatDate(item.scheduledAt) + '</td>' +
          '<td class="pt-td pt-col--action pt-td--action">' +
            '<a class="pt-link" href="' + esc(editUrl(item)) + '">Edit</a>' +
          '</td>' +
        '</tr>'
      );
    }).join('');

    var page     = Math.floor(state.skip / state.take) + 1;
    var prevOff  = state.skip === 0   ? ' disabled' : '';
    var nextOff  = !state.hasMore     ? ' disabled' : '';

    mount.innerHTML =
      '<div class="pt-scroll">' +
        '<table class="pt-table">' +
          '<colgroup>' +
            '<col class="pt-col--name">' +
            '<col class="pt-col--language">' +
            '<col class="pt-col--date">' +
            '<col class="pt-col--action">' +
          '</colgroup>' +
          '<thead>' +
            '<tr>' +
              '<th class="pt-th">Name</th>' +
              '<th class="pt-th">Language</th>' +
              '<th class="pt-th">Scheduled (local time)</th>' +
              '<th class="pt-th"></th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="pt-pagination">' +
        '<span class="pt-page-info">Page ' + page + '</span>' +
        '<button class="pt-btn" id="pt-prev"' + prevOff + '>← Prev</button>' +
        '<button class="pt-btn" id="pt-next"' + nextOff + '>Next →</button>' +
      '</div>';

    document.getElementById('pt-prev').addEventListener('click', function () {
      state.skip = Math.max(0, state.skip - state.take);
      load(mount);
    });
    document.getElementById('pt-next').addEventListener('click', function () {
      state.skip += state.take;
      load(mount);
    });
  }

  /* ── Data fetching ───────────────────────────────────────────────── */

  function load(mount) {
    state.loading = true;
    state.error   = null;
    render(mount);

    var url = API_PATH + '?skip=' + state.skip + '&take=' + state.take;

    fetch(url, {
      credentials: 'same-origin',                // send CMS session cookie
      headers:     { 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Not authorised — please refresh and log in again.');
        }
        if (!res.ok) {
          throw new Error('Server returned ' + res.status);
        }
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
    if (!mount) return;
    load(mount);
  }

  // The script tag uses defer, so the DOM is ready when this executes.
  // The readyState guard handles any edge-case where defer fires early.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
