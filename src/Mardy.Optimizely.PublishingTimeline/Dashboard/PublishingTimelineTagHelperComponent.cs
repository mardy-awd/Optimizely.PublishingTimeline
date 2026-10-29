using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Razor.TagHelpers;

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
            output.PostContent.AppendHtml(HeadHtml);
        }
        else if (string.Equals(output.TagName, "body", StringComparison.OrdinalIgnoreCase))
        {
            output.PostContent.AppendHtml(BodyHtml);
        }

        return Task.CompletedTask;
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

    // Injected into <head>: the panel stylesheet served as an RCL static asset.
    private static readonly string HeadHtml =
        $"""<link rel="stylesheet" href="{AssetBase}/publishing-timeline.css">""";

    // Injected into <body>:
    //
    //   Layout CSS  — positions a drag handle and the panel at the bottom of the
    //                 Shell's fixed viewport; shrinks #root > div to make room.
    //                 --pt-panel-height is set in px by the split script (CSS
    //                 carries a 40vh fallback for the render before JS runs).
    //
    //   Drag handle — #pt-drag-handle sits between the Dashboard content and the
    //                 panel; dragging it updates --pt-panel-height on :root.
    //
    //   Mount div   — empty; the JS populates it after fetching the API.
    //
    //   Positioning script — MutationObserver waits for #sideBarNavigationRoot
    //                        (created dynamically by the navigation bundle) then
    //                        tracks its right edge via ResizeObserver to keep
    //                        --publishing-timeline-left current on resize/collapse.
    //
    //   Split script — initialises a 50/50 split at DOMContentLoaded; handles
    //                  drag and re-clamp on viewport resize.
    //
    //   Panel script — loaded with defer; runs after DOM parse completes.
    //
    // Note: $$"""...""" (two dollar signs) is used so CSS/JS braces are treated as
    // literal characters and only {{expr}} is treated as an interpolation.
    private static readonly string BodyHtml =
        $$"""
        <style>
          :root {
            /* 40vh fallback — replaced with an exact px value by the split script
               once navigation height is known at DOMContentLoaded. */
            --pt-panel-height: 40vh;
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
          /* Shrink the Dashboard content area to accommodate the drag handle (5px)
             and the panel; the three regions sum to 100vh − navigation-height. */
          body:has(#publishing-timeline-root) #root > div {
            height: calc(100vh - var(--navigation-height) - var(--pt-panel-height) - 5px) !important;
          }
        </style>
        <div id="pt-drag-handle"></div>
        <div id="publishing-timeline-root"></div>
        <script>
        (function () {
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

          /* ── Resizable 50/50 split ───────────────────────────────── */
          var MIN_PX    = 200;   // minimum height for each section in px
          var HANDLE_PX = 5;     // must match the CSS height of #pt-drag-handle
          var initialized = false;

          function navPx() {
            var v = getComputedStyle(document.documentElement)
                      .getPropertyValue('--navigation-height').trim();
            return parseFloat(v) || 60;
          }

          function availPx() {
            return window.innerHeight - navPx() - HANDLE_PX;
          }

          function setPanelPx(h) {
            var clamped = Math.max(MIN_PX, Math.min(Math.round(h), availPx() - MIN_PX));
            document.documentElement.style.setProperty('--pt-panel-height', clamped + 'px');
          }

          function initSplit() {
            initialized = true;
            setPanelPx(availPx() / 2);
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initSplit);
          } else {
            initSplit();
          }

          /* Drag */
          var handle    = document.getElementById('pt-drag-handle');
          var dragging  = false;
          var dragStartY, dragStartH;

          handle.addEventListener('mousedown', function (e) {
            dragging   = true;
            dragStartY = e.clientY;
            dragStartH = parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue('--pt-panel-height')
            );
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

          /* Re-clamp on viewport resize without resetting to 50/50. */
          window.addEventListener('resize', function () {
            if (!initialized) { return; }
            var cur = parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue('--pt-panel-height')
            );
            if (!isNaN(cur)) { setPanelPx(cur); }
          });
        }());
        </script>
        <script src="{{AssetBase}}/publishing-timeline.js" defer></script>
        """;
}
