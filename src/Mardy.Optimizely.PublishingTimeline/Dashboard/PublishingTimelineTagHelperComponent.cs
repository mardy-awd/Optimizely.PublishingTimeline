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
    //   Layout CSS  — positions the panel at the bottom of the Shell's fixed
    //                 viewport and shrinks #root > div to make room.
    //                 Panel height is 200px; expressed as a custom property so a
    //                 single value controls both the element and the offset.
    //
    //   Mount div   — empty; the JS populates it after fetching the API.
    //
    //   Positioning script — MutationObserver waits for #sideBarNavigationRoot
    //                        (created dynamically by the navigation bundle) then
    //                        tracks its right edge via ResizeObserver to keep
    //                        --publishing-timeline-left current on resize/collapse.
    //
    //   Panel script — loaded with defer; runs after DOM parse completes.
    //
    // Note: $$"""...""" (two dollar signs) is used so CSS/JS braces are treated as
    // literal characters and only {{expr}} is treated as an interpolation.
    private static readonly string BodyHtml =
        $$"""
        <style>
          :root { --pt-panel-height: 200px; }
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
          body:has(#publishing-timeline-root) #root > div {
            height: calc(100vh - var(--navigation-height) - var(--pt-panel-height)) !important;
          }
        </style>
        <div id="publishing-timeline-root"></div>
        <script>
        (function () {
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
        }());
        </script>
        <script src="{{AssetBase}}/publishing-timeline.js" defer></script>
        """;
}
