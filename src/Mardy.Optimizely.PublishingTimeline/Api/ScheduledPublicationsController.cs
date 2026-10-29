using EPiServer.DataAbstraction;
using Mardy.Optimizely.PublishingTimeline.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Mardy.Optimizely.PublishingTimeline.Api;

/// <summary>
/// Read-only API for scheduled publications and configured CMS languages.
/// Requires an authenticated CMS editor session (episerver:cmsedit policy).
/// Content items the current user cannot read are excluded from results.
/// </summary>
[ApiController]
[Route("publishingtimeline/api")]
[Authorize(Policy = "episerver:cmsedit")]
public sealed class ScheduledPublicationsController : ControllerBase
{
    private readonly IScheduledPublicationService _service;
    private readonly ILanguageBranchRepository _languageBranchRepository;

    public ScheduledPublicationsController(
        IScheduledPublicationService service,
        ILanguageBranchRepository languageBranchRepository)
    {
        _service = service;
        _languageBranchRepository = languageBranchRepository;
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
    [HttpGet("scheduled")]
    [Produces("application/json")]
    public ActionResult<PagedResult<ScheduledPublicationDto>> GetScheduled(
        [FromQuery] int             skip     = 0,
        [FromQuery] int             take     = 20,
        [FromQuery] string?         language = null,
        [FromQuery] DateTimeOffset? from     = null,
        [FromQuery] DateTimeOffset? to       = null)
    {
        if (skip < 0) skip = 0;
        take = Math.Clamp(take, 1, 100);
        if (string.IsNullOrWhiteSpace(language)) language = null;

        return Ok(_service.GetScheduled(
            skip, take, language,
            from?.UtcDateTime,
            to?.UtcDateTime));
    }

    /// <summary>
    /// Returns the enabled CMS language branches, sorted by display name.
    /// Used to populate the language filter dropdown in the Publishing Timeline panel.
    /// </summary>
    [HttpGet("languages")]
    [Produces("application/json")]
    public ActionResult<IEnumerable<LanguageDto>> GetLanguages()
    {
        var languages = _languageBranchRepository.ListEnabled()
            .OrderBy(l => l.Name)
            .Select(l => new LanguageDto { Code = l.LanguageID, Name = l.Name });

        return Ok(languages);
    }
}
