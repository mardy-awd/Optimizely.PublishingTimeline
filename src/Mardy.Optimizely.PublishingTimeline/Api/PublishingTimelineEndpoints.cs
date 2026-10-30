using System.Diagnostics;
using System.Globalization;
using EPiServer.DataAbstraction;
using EPiServer.Web.Routing;
using Mardy.Optimizely.PublishingTimeline.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Mardy.Optimizely.PublishingTimeline.Api;

/// <summary>
/// Read-only API for scheduled publications and configured CMS languages.
/// Requires an authenticated CMS editor session (episerver:cmsedit policy).
/// Content items the current user cannot read are excluded from results.
/// </summary>
/// <remarks>
/// Mapped through Optimizely's <see cref="IEndpointRoutingExtension"/>, which
/// <c>endpoints.MapContent()</c> invokes, so the host application needs no
/// <c>MapControllers()</c> or other Startup/Program.cs changes. Minimal API endpoints
/// (rather than an MVC controller) keep these routes out of a host's own
/// <c>MapControllers()</c>, so they are never registered twice.
/// </remarks>
public sealed class PublishingTimelineEndpoints : IEndpointRoutingExtension
{
    public void MapEndpoints(IEndpointRouteBuilder endpointRouteBuilder)
    {
        var api = endpointRouteBuilder
            .MapGroup("/publishingtimeline/api")
            .RequireAuthorization("episerver:cmsedit")
            // Answer 401/403 instead of redirecting to the login page, as the previous
            // [ApiController] did; fetch() would otherwise follow the redirect to HTML.
            .DisableCookieRedirect();

        api.MapGet("/scheduled", GetScheduled);
        api.MapGet("/languages", GetLanguages);
    }

    /// <summary>
    /// Returns a paginated list of scheduled publications sorted by scheduled date
    /// ascending. Only items the current editor is allowed to read are included.
    /// </summary>
    /// <param name="skip">Number of items to skip (default 0).</param>
    /// <param name="take">Page size, clamped to [1, 100] (default 20).</param>
    /// <param name="language">Optional BCP-47 language code to filter by. Omit for all languages.</param>
    /// <param name="from">Optional inclusive lower bound (UTC). Items scheduled before this are excluded.</param>
    /// <param name="to">Optional exclusive upper bound (UTC). Items scheduled at or after this are excluded.</param>
    /// <remarks>
    /// Query values are bound here rather than as typed parameters so that an unparsable
    /// value returns a JSON validation problem (as the previous [ApiController] did),
    /// instead of minimal API's plain-text BadHttpRequestException response.
    /// </remarks>
    private static IResult GetScheduled(
        IScheduledPublicationService service,
        HttpContext httpContext,
        string? skip     = null,
        string? take     = null,
        string? language = null,
        string? from     = null,
        string? to       = null)
    {
        var errors = new Dictionary<string, string[]>();

        var skipValue = Bind<int>(skip, nameof(skip), ParseInt, errors) ?? 0;
        var takeValue = Bind<int>(take, nameof(take), ParseInt, errors) ?? 20;
        var fromValue = Bind<DateTimeOffset>(from, nameof(from), ParseDateTimeOffset, errors);
        var toValue   = Bind<DateTimeOffset>(to, nameof(to), ParseDateTimeOffset, errors);

        if (errors.Count > 0)
        {
            // traceId as MVC's ProblemDetailsFactory adds it.
            return Results.ValidationProblem(errors, extensions: new Dictionary<string, object?>
            {
                ["traceId"] = Activity.Current?.Id ?? httpContext.TraceIdentifier
            });
        }

        if (skipValue < 0) skipValue = 0;
        takeValue = Math.Clamp(takeValue, 1, 100);
        if (string.IsNullOrWhiteSpace(language)) language = null;

        return Results.Ok(service.GetScheduled(
            skipValue, takeValue, language,
            fromValue?.UtcDateTime,
            toValue?.UtcDateTime));
    }

    private delegate bool TryParse<T>(string value, out T result);

    private static readonly TryParse<int> ParseInt = (string value, out int result) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out result);

    private static readonly TryParse<DateTimeOffset> ParseDateTimeOffset = (string value, out DateTimeOffset result) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out result);

    // Missing or blank → null (parameter default applies); unparsable → validation error
    // worded like MVC model binding ("The value 'x' is not valid.").
    private static T? Bind<T>(string? value, string name, TryParse<T> tryParse, Dictionary<string, string[]> errors)
        where T : struct
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (tryParse(value, out var result)) return result;

        errors[name] = [$"The value '{value}' is not valid."];
        return null;
    }

    /// <summary>
    /// Returns the enabled CMS language branches, sorted by display name.
    /// Used to populate the language filter dropdown in the Publishing Timeline panel.
    /// </summary>
    private static IResult GetLanguages(ILanguageBranchRepository languageBranchRepository)
    {
        var languages = languageBranchRepository.ListEnabled()
            .OrderBy(l => l.Name)
            .Select(l => new LanguageDto { Code = l.LanguageID, Name = l.Name });

        return Results.Ok(languages);
    }
}
