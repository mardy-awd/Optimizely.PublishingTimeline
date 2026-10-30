using System.Net;
using Mardy.Optimizely.PublishingTimeline.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.AspNetCore.Razor.TagHelpers;
using Microsoft.Extensions.DependencyInjection;

namespace Mardy.Optimizely.PublishingTimeline.Dashboard;

/// <summary>
/// Injects the Publishing Timeline panel into the CMS Dashboard page.
/// Uses ASP.NET Core's ITagHelperComponent pipeline, which fires when the Shell's
/// shared layout renders its &lt;head&gt; and &lt;body&gt; tags.
///
/// Head injection: a stylesheet link pointing to the RCL's static web asset.
/// Body injection: layout positioning rules, the empty mount div, the sidebar
/// alignment script, and a deferred script tag for the panel JavaScript.
///
/// Both injections are gated by IsDashboardRoute so no other CMS page is affected.
/// Static assets are served from /_content/Mardy.Optimizely.PublishingTimeline/
/// by ASP.NET Core's built-in static web assets middleware (UseStaticFiles).
///
/// No Optimizely types are referenced: the Workflow Status configuration is read
/// client-side from the Dashboard's own #root[data-epi-dashboard-rows] attribute,
/// so a CMS upgrade that changes Dashboard internals cannot break startup or
/// page rendering — the panel simply stays hidden.
/// </summary>
internal sealed class PublishingTimelineTagHelperComponent : TagHelperComponent
{
    private const string AssetBase =
        "/_content/Mardy.Optimizely.PublishingTimeline";

    private readonly IHttpContextAccessor _httpContextAccessor;

    public PublishingTimelineTagHelperComponent(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    // Run after the default order (0) so built-in components process first.
    public override int Order => 1;

    public override Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        var request = _httpContextAccessor.HttpContext?.Request;
        if (request is null || !IsDashboardRoute(request.Path))
            return Task.CompletedTask;

        if (string.Equals(output.TagName, "head", StringComparison.OrdinalIgnoreCase))
        {
            var cssUrl = VersionedAssetUrl(request, "publishing-timeline.css");
            output.PostContent.AppendHtml($"""<link rel="stylesheet" href="{cssUrl}">""");
        }
        else if (string.Equals(output.TagName, "body", StringComparison.OrdinalIgnoreCase))
        {
            var jsUrl = VersionedAssetUrl(request, "publishing-timeline.js");
            // API base including the app's PathBase (e.g. /mycms/publishingtimeline/api),
            // read by the script via document.currentScript.
            var apiBase = WebUtility.HtmlEncode(
                request.PathBase.Add(PublishingTimelineEndpoints.BasePath).ToUriComponent());
            output.PostContent.AppendHtml(BodyHtml);
            output.PostContent.AppendHtml($"""<script src="{jsUrl}" data-api-base="{apiBase}" defer></script>""");
        }

        return Task.CompletedTask;
    }

    // Appends ?v=<SHA-256 of the file content> using ASP.NET Core's IFileVersionProvider
    // (the mechanism behind asp-append-version), so browsers fetch a new URL whenever
    // the file changes. It resolves files through the host's WebRootFileProvider,
    // which includes RCL static web assets both from a project reference / NuGet
    // package in development (static web assets manifest) and from wwwroot/_content
    // after publish. Hashes are cached and invalidated by a file watcher.
    // The provider is optional: if it is not registered, or the file cannot be
    // resolved, the URL is returned unversioned rather than failing the page.
    private static string VersionedAssetUrl(HttpRequest request, string fileName)
    {
        // Include the app's PathBase (e.g. /mycms); AddFileVersionToPath strips it again
        // only to locate the file, as the built-in script/link tag helpers do.
        var path = request.PathBase.Add(new PathString($"{AssetBase}/{fileName}")).ToUriComponent();
        var versioned = path;
        try
        {
            var provider = request.HttpContext.RequestServices.GetService<IFileVersionProvider>();
            if (provider is not null)
                versioned = provider.AddFileVersionToPath(request.PathBase, path);
        }
        catch (Exception)
        {
            versioned = path;
        }
        return WebUtility.HtmlEncode(versioned);
    }

    // The CMS Dashboard path always ends with /Dashboard regardless of the configured
    // module base URL (e.g. /EPi/CMS/Dashboard, /Optimizely/CMS/EPi/Dashboard).
    // No other standard CMS shell route ends with this segment.
    private static bool IsDashboardRoute(PathString path)
    {
        var value = path.Value ?? string.Empty;
        return value.EndsWith("/Dashboard", StringComparison.OrdinalIgnoreCase)
            || value.EndsWith("/Dashboard/", StringComparison.OrdinalIgnoreCase)
            || value.EndsWith("/Dashboard/Index", StringComparison.OrdinalIgnoreCase);
    }

    // Injected into <head>: the panel stylesheet (versioned RCL static asset).
    //
    // Injected into <body>: BodyHtml, then the versioned panel <script defer>.
    //
    //   Layout CSS  — positions a drag handle and the panel at the bottom of the
    //                 Shell's fixed viewport; shrinks #root > div to make room.
    //                 --pt-panel-height is derived in CSS from --pt-panel-ratio
    //                 (default 0.5 = 50/50) and the viewport, so it needs no JS
    //                 initialisation and follows viewport resizes.
    //
    //   Drag handle — #pt-drag-handle sits between the Dashboard content and the
    //                 panel; dragging it updates --pt-panel-ratio on :root.
    //
    //   Mount div   — empty; the JS populates it after fetching the API.
    //
    //   Panel state — body classes drive the layout CSS:
    //                   (none)                    hidden; Dashboard keeps full height
    //                   pt-visible                expanded; panel + drag handle shown
    //                   pt-visible pt-collapsed   title bar only; no drag handle
    //                 pt-visible is set by the tab-tracking script; pt-collapsed by
    //                 the panel script's Collapse/Expand button. --pt-panel-ratio is
    //                 never changed by either, so the dragged split is preserved.
    //
    //   Tab-tracking script — reads the Workflow Status tab order from
    //                         #root[data-epi-dashboard-rows], then one
    //                         MutationObserver on #root (the React app) shows the
    //                         panel only while the "Scheduled" tab is active.
    //                         Never touches the native tabs. Fails closed (hidden)
    //                         when the configuration is missing/invalid/ambiguous.
    //
    //   Positioning script — MutationObserver waits for #sideBarNavigationRoot
    //                        (created dynamically by the navigation bundle) then
    //                        tracks its right edge via ResizeObserver to keep
    //                        --publishing-timeline-left current on resize/collapse.
    //
    //   Split script — handles drag only; converts the dragged height into
    //                  --pt-panel-ratio (the 50/50 default lives in CSS).
    //
    //   Panel script — appended after BodyHtml with a versioned URL; loaded with
    //                  defer, so it runs after DOM parse completes.
    //
    // BodyHtml is a plain raw string literal (no interpolation), so CSS/JS braces
    // are literal characters.
    private static readonly string BodyHtml =
        """
        <style>
          :root {
            /* Panel share of the space below the navigation bar (minus the 5px
               drag handle). 0.5 = the default 50/50 split; dragging updates it.
               Kept as a ratio so the split follows viewport resizes. Each
               section keeps at least 200px. */
            --pt-panel-ratio: 0.5;
            --pt-panel-height: clamp(200px,
              calc((100vh - var(--navigation-height) - 5px) * var(--pt-panel-ratio)),
              calc(100vh - var(--navigation-height) - 5px - 200px));
            /* Collapsed panel: 2px top border + the toolbar's title row. */
            --pt-collapsed-height: 40px;
          }
          /* Drag handle — sits directly above the panel in the absolute stack. */
          #pt-drag-handle {
            position: absolute;
            bottom: var(--pt-panel-height);
            left: var(--publishing-timeline-left, 0);
            right: 0;
            height: 5px;
            background: #c8d6e5;
            cursor: ns-resize;
            z-index: 2;
            box-sizing: border-box;
          }
          #pt-drag-handle:hover,
          #pt-drag-handle.pt-dragging {
            background: #357b82;
          }
          #publishing-timeline-root {
            position: absolute;
            bottom: 0;
            left: var(--publishing-timeline-left, 0);
            right: 0;
            height: var(--pt-panel-height);
            box-sizing: border-box;
            border-top: 2px solid #c8d6e5;
            z-index: 1;
          }
          body.pt-collapsed #publishing-timeline-root {
            height: var(--pt-collapsed-height);
          }
          /* Hidden off the Scheduled tab; the handle is also hidden when collapsed. */
          body:not(.pt-visible) #publishing-timeline-root,
          body:not(.pt-visible) #pt-drag-handle,
          body.pt-collapsed #pt-drag-handle {
            display: none;
          }
          /* Shrink the Dashboard content area to accommodate the drag handle (5px)
             and the panel; the three regions sum to 100vh − navigation-height.
             When hidden, no rule applies and the Dashboard keeps its native height. */
          body.pt-visible #root > div {
            height: calc(100vh - var(--navigation-height) - var(--pt-panel-height) - 5px) !important;
          }
          body.pt-visible.pt-collapsed #root > div {
            height: calc(100vh - var(--navigation-height) - var(--pt-collapsed-height)) !important;
          }
        </style>
        <div id="pt-drag-handle"></div>
        <div id="publishing-timeline-root"></div>
        <script>
        (function () {
          /* ── Scheduled-tab tracking ──────────────────────────────── */
          /* Shows the panel (body.pt-visible) only while the Workflow Status
             gadget's "Scheduled" tab is active. The rendered tabs carry no
             identifier (Axiom's TabNav.Tab drops tabId), so the tab is located
             by position in the gadget's settings.versionStatuses — read from
             the same #root[data-epi-dashboard-rows] JSON the Dashboard renders
             from (already filtered by the user's gadget permissions). Its
             selected state is read from aria-selected when present, otherwise
             from Axiom's is-active class (CMS 13.5 renders no ARIA here).
             Fails closed (hidden) on missing/invalid/ambiguous configuration
             or a rendered tab-count mismatch. */
          var SCHEDULED = 6;          // EPiServer.Core.VersionStatus.DelayedPublish
          var config    = null;       // { index, count } once read; null = stay hidden
          var visible   = false;
          var observer  = null;

          function readScheduledTab(appRoot) {
            var rows;
            try { rows = JSON.parse(appRoot.getAttribute('data-epi-dashboard-rows')); }
            catch (_) { return null; }
            if (!Array.isArray(rows)) { return null; }

            /* Mirrors the Dashboard bundle: rows[].columns[].gadgets[]; an entry
               with a gadgets array is a group, otherwise scriptUrl selects the gadget. */
            var found = [];
            function visit(gadgets) {
              if (!Array.isArray(gadgets)) { return; }
              gadgets.forEach(function (g) {
                if (!g) { return; }
                if (Array.isArray(g.gadgets)) { visit(g.gadgets); }
                else if (g.scriptUrl === 'WorkflowStatusGadget') { found.push(g); }
              });
            }
            rows.forEach(function (row) {
              ((row && row.columns) || []).forEach(function (col) { visit(col && col.gadgets); });
            });
            if (found.length !== 1) { return null; }   // none, or ambiguous

            var statuses = found[0].settings && found[0].settings.versionStatuses;
            if (!Array.isArray(statuses)) { return null; }
            var index = -1;
            for (var i = 0; i < statuses.length; i++) {
              if (statuses[i] === SCHEDULED || statuses[i] === 'DelayedPublish') {
                if (index !== -1) { return null; }      // duplicate Scheduled tab
                index = i;
              }
            }
            return index === -1 ? null : { index: index, count: statuses.length };
          }

          function scheduledTabActive() {
            if (!config) { return false; }
            var gadget = document.querySelector('#root .workflow-status-gadget');
            if (!gadget) { return false; }
            var list = gadget.querySelector('[role="tablist"]') ||
                       gadget.querySelector('.oui-tabs-nav');
            if (!list) { return false; }
            var tabs = list.querySelectorAll('[role="tab"]');
            if (!tabs.length) { tabs = list.querySelectorAll('.oui-tabs-nav__item'); }
            if (tabs.length !== config.count) { return false; }
            var tab = tabs[config.index];
            if (!tab) { return false; }
            var selected = tab.getAttribute('aria-selected');
            return selected !== null ? selected === 'true' : tab.classList.contains('is-active');
          }

          /* Applies DOM changes only when the state actually flips, so the
             frequent no-op checks cost one querySelector and nothing else.
             MutationObserver already batches each React commit into a single
             callback; no extra rAF throttle (rAF is paused in background tabs
             and a lost frame would stall tracking). */
          function sync() {
            var next = scheduledTabActive();
            if (next === visible) { return; }
            visible = next;
            document.body.classList.toggle('pt-visible', visible);
            if (visible) { document.dispatchEvent(new CustomEvent('pt:visible')); }
          }

          function observe(appRoot) {
            /* The configuration is server-rendered with #root; read it once.
               Without a usable configuration the panel stays hidden and no
               observer is attached at all. */
            config = readScheduledTab(appRoot);
            if (!config) { return; }
            /* The panel lives outside #root, so its own updates never re-trigger this. */
            observer = new MutationObserver(sync);
            observer.observe(appRoot, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: ['class', 'aria-selected']
            });
            sync();
          }

          var appRoot = document.getElementById('root');
          if (appRoot) {
            observe(appRoot);
          } else {
            var waitRoot = new MutationObserver(function (_, mo) {
              var el = document.getElementById('root');
              if (el) { mo.disconnect(); observe(el); }
            });
            waitRoot.observe(document.body, { childList: true });
            observer = waitRoot;
          }

          window.addEventListener('pagehide', function () {
            if (observer) { observer.disconnect(); observer = null; }
          });
          /* Restored from the back/forward cache: resume tracking. */
          window.addEventListener('pageshow', function (e) {
            var el = document.getElementById('root');
            if (e.persisted && !observer && el) { observe(el); }
          });

          /* ── Sidebar left-edge tracking (unchanged) ──────────────── */
          var PROP = '--publishing-timeline-left';
          function update(sidebar) {
            document.documentElement.style.setProperty(PROP, sidebar.getBoundingClientRect().right + 'px');
          }
          function attach(sidebar) {
            update(sidebar);
            new ResizeObserver(function () { update(sidebar); }).observe(sidebar);
          }
          var existing = document.getElementById('sideBarNavigationRoot');
          if (existing) {
            attach(existing);
          } else {
            var mo = new MutationObserver(function (_, observer) {
              var el = document.getElementById('sideBarNavigationRoot');
              if (el) { observer.disconnect(); attach(el); }
            });
            mo.observe(document.body, { childList: true });
          }

          /* ── Resizable split ─────────────────────────────────────── */
          /* The default 50/50 split and viewport resizes are handled by CSS
             (--pt-panel-ratio); dragging only converts the new height into a
             ratio, so the user's proportion survives resizes, tab switches and
             collapse/expand. */
          var MIN_PX    = 200;   // must match the clamp() minimum in :root
          var HANDLE_PX = 5;     // must match the CSS height of #pt-drag-handle

          function availPx() {
            var nav = parseFloat(getComputedStyle(document.documentElement)
                        .getPropertyValue('--navigation-height')) || 0;
            return window.innerHeight - nav - HANDLE_PX;
          }

          function setPanelPx(h) {
            var avail   = availPx();
            var clamped = Math.max(MIN_PX, Math.min(h, avail - MIN_PX));
            document.documentElement.style.setProperty('--pt-panel-ratio', String(clamped / avail));
          }

          /* Drag */
          var handle    = document.getElementById('pt-drag-handle');
          var panelEl   = document.getElementById('publishing-timeline-root');
          var dragging  = false;
          var dragStartY, dragStartH;

          handle.addEventListener('mousedown', function (e) {
            dragging   = true;
            dragStartY = e.clientY;
            dragStartH = panelEl.getBoundingClientRect().height;
            handle.classList.add('pt-dragging');
            document.body.style.cursor     = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
          });

          document.addEventListener('mousemove', function (e) {
            if (!dragging) { return; }
            /* Moving the mouse up (smaller clientY) grows the panel upward. */
            setPanelPx(dragStartH + (dragStartY - e.clientY));
          });

          document.addEventListener('mouseup', function () {
            if (!dragging) { return; }
            dragging = false;
            handle.classList.remove('pt-dragging');
            document.body.style.cursor     = '';
            document.body.style.userSelect = '';
          });
        }());
        </script>
        """;
}
