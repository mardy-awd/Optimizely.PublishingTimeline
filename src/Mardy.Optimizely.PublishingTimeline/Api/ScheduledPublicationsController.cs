using Mardy.Optimizely.PublishingTimeline.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Mardy.Optimizely.PublishingTimeline.Api;

/// <summary>
/// Read-only API for scheduled publications.
/// Requires an authenticated CMS editor session (episerver:cmsedit policy).
/// Content items the current user cannot read are excluded from results.
/// </summary>
[ApiController]
[Route("publishingtimeline/api")]
[Authorize(Policy = "episerver:cmsedit")]
public sealed class ScheduledPublicationsController : ControllerBase
{
    private readonly IScheduledPublicationService _service;

    public ScheduledPublicationsController(IScheduledPublicationService service)
    {
        _service = service;
    }

    /// <summary>
    /// Returns a paginated list of scheduled publications sorted by scheduled date
    /// ascending. Only items the current editor is allowed to read are included.
    /// </summary>
    /// <param name="skip">Number of items to skip (default 0).</param>
    /// <param name="take">Page size, clamped to [1, 100] (default 20).</param>
    [HttpGet("scheduled")]
    [Produces("application/json")]
    public ActionResult<PagedResult<ScheduledPublicationDto>> GetScheduled(
        [FromQuery] int skip = 0,
        [FromQuery] int take = 20)
    {
        if (skip < 0) skip = 0;
        take = Math.Clamp(take, 1, 100);

        return Ok(_service.GetScheduled(skip, take));
    }
}
