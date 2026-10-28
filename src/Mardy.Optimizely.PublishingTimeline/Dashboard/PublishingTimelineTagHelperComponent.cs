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

    private const string PlaceholderHtml =
        """
        <div id="publishing-timeline-root"
             style="margin:1.5rem 2rem 0;padding:1rem 1.5rem;background:#f0f4f8;border:1px solid #c8d6e5;border-radius:4px;font-family:sans-serif;">
          <h2 style="font-size:1rem;font-weight:600;margin:0 0 .4rem;color:#2c3e50;">
            Publishing Timeline
          </h2>
          <p style="font-size:.875rem;color:#555;margin:0;">
            Scheduled publications will appear here. (POC placeholder)
          </p>
        </div>
        """;
}
