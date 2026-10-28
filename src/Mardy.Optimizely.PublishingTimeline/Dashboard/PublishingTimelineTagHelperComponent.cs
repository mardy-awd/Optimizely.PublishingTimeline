using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Mardy.Optimizely.PublishingTimeline.Dashboard;

/// <summary>
/// Injects a Publishing Timeline placeholder section into the CMS Dashboard page body.
/// Uses ASP.NET Core's ITagHelperComponent pipeline, which fires when the Shell's shared
/// layout renders its &lt;body&gt; tag. No Optimizely internal APIs are used.
/// </summary>
internal sealed class PublishingTimelineTagHelperComponent : TagHelperComponent
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public PublishingTimelineTagHelperComponent(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    // Run after the default order (0) so built-in components process first.
    public override int Order => 1;

    public override Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
    {
        // ITagHelperComponent fires for both <head> and <body>; we only want <body>.
        if (!string.Equals(output.TagName, "body", StringComparison.OrdinalIgnoreCase))
            return Task.CompletedTask;

        var request = _httpContextAccessor.HttpContext?.Request;
        if (request is null || !IsDashboardRoute(request.Path))
            return Task.CompletedTask;

        output.PostContent.AppendHtml(PlaceholderHtml);
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

    // Layout strategy — three moving parts:
    //
    //   CSS  1. position: absolute removes our panel from the Shell's horizontal flex
    //           row, so #root reclaims its full flex: 1 width.
    //
    //   CSS  2. body:has(...) #root > div shrinks the scrollable dashboard area by the
    //           panel height so built-in gadgets are never hidden behind it.
    //
    //   CSS  3. left: var(--publishing-timeline-left, 0) aligns the panel's left edge
    //           with the content area. The variable is set by the inline script below.
    //           Fallback 0 = full-width, which is safe if the variable is not set.
    //
    //   JS   4. An inline MutationObserver waits for #sideBarNavigationRoot, which is
    //           inserted dynamically by the Shell navigation JS bundle (not server-
    //           rendered), so it does not exist when our script first runs. Once found,
    //           getBoundingClientRect().right gives the sidebar's right edge (= the
    //           content area's left edge). A ResizeObserver keeps the variable current
    //           when the sidebar collapses, expands, or the window resizes.
    //
    //   Both IDs (#sideBarNavigationRoot, #root) are stable: Optimizely's own shipped
    //   CSS and JS reference them by these exact names.
    private const string PlaceholderHtml =
        """
        <style>
          #publishing-timeline-root {
            position: absolute;
            bottom: 0;
            left: var(--publishing-timeline-left, 0);
            right: 0;
            height: 80px;
            overflow: hidden;
            box-sizing: border-box;
            z-index: 1;
          }
          body:has(#publishing-timeline-root) #root > div {
            height: calc(100vh - var(--navigation-height) - 80px) !important;
          }
        </style>
        <div id="publishing-timeline-root"
             style="padding:.75rem 2rem;background:#f0f4f8;border-top:2px solid #c8d6e5;font-family:sans-serif;">
          <h2 style="font-size:1rem;font-weight:600;margin:0 0 .25rem;color:#2c3e50;">
            Publishing Timeline
          </h2>
          <p style="font-size:.875rem;color:#555;margin:0;">
            Scheduled publications will appear here. (POC placeholder)
          </p>
        </div>
        <script>
        (function () {
          var PROP = '--publishing-timeline-left';

          function update(sidebar) {
            var right = sidebar.getBoundingClientRect().right;
            document.documentElement.style.setProperty(PROP, right + 'px');
          }

          function attach(sidebar) {
            update(sidebar);
            new ResizeObserver(function () { update(sidebar); }).observe(sidebar);
          }

          // #sideBarNavigationRoot is created by the Shell navigation bundle after
          // the HTML is parsed. Check first in case the bundle has already run, then
          // fall back to a MutationObserver on document.body's direct children.
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
        }());
        </script>
        """;
}
