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

    // The Shell layout sets body { display: flex; flex-flow: row; overflow: hidden } and
    // #root { flex: 1 }, so any body-level sibling of #root ends up in the same horizontal
    // flex row (to the right, causing #root to shrink). Two rules fix this:
    //
    //   1. position: absolute removes our element from the flex algorithm entirely,
    //      so #root reclaims its full flex: 1 width.
    //
    //   2. body:has(...) #root > div shrinks the dashboard scroll area by the panel
    //      height so gadgets are never hidden behind it. --navigation-height is the
    //      only Shell CSS variable we need; the sidebar width does not matter because
    //      left: 0 / right: 0 spans the full viewport (sidebar area at the bottom is
    //      empty in standard Alloy builds).
    //
    //   :has() is used to scope both rules to pages where our element is present.
    private const string PlaceholderHtml =
        """
        <style>
          #publishing-timeline-root {
            position: absolute;
            bottom: 0;
            left: 0;
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
        """;
}
