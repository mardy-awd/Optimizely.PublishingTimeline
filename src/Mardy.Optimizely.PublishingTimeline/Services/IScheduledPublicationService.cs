using Mardy.Optimizely.PublishingTimeline.Api;

namespace Mardy.Optimizely.PublishingTimeline.Services;

/// <summary>
/// Returns scheduled publications accessible to the current CMS principal.
/// </summary>
public interface IScheduledPublicationService
{
    PagedResult<ScheduledPublicationDto> GetScheduled(int skip, int take, string? language = null);
}
