using EPiServer;
using EPiServer.Core;
using EPiServer.Security;
using Mardy.Optimizely.PublishingTimeline.Api;

namespace Mardy.Optimizely.PublishingTimeline.Services;

/// <summary>
/// Retrieves scheduled publications from the CMS version repository and applies
/// content-level read-permission filtering for the current principal.
/// </summary>
internal sealed class ScheduledPublicationService : IScheduledPublicationService
{
    // Fetch at least this many items per repository round trip.
    // Using max(take * 2, 50) amortises the ACL-filtering overhead for typical
    // deployments where most editors can read most scheduled content.
    private const int MinBatchSize = 50;

    private readonly IContentVersionRepository _versions;
    private readonly IContentLoader _contentLoader;
    private readonly IContentAccessEvaluator _accessEvaluator;
    private readonly IPrincipalAccessor _principalAccessor;

    public ScheduledPublicationService(
        IContentVersionRepository versions,
        IContentLoader contentLoader,
        IContentAccessEvaluator accessEvaluator,
        IPrincipalAccessor principalAccessor)
    {
        _versions = versions;
        _contentLoader = contentLoader;
        _accessEvaluator = accessEvaluator;
        _principalAccessor = principalAccessor;
    }

    /// <summary>
    /// Returns a page of scheduled publications the current user can read, sorted by
    /// scheduled date ascending. Both skip and take are applied after content-level
    /// ACL filtering so callers receive accurate pagination over accessible items only.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The algorithm walks the version repository in bounded batches.
    /// <see cref="PagedResult{T}.HasMore"/> is determined by detecting a (take+1)th
    /// accessible item; no separate count query is issued.
    /// </para>
    /// <para>
    /// Worst-case performance is O(N / batchSize) database calls where N is the total
    /// number of scheduled items — this occurs when the current user can access very
    /// few of them. For typical CMS editors who can read most content, one or two
    /// batches are sufficient per page.
    /// </para>
    /// <para>
    /// Access check: <see cref="IContentLoader.TryGet{T}(ContentReference, out T)"/>
    /// with a versioned ContentReference (WorkID set) loads the specific scheduled
    /// version regardless of language or publish status. ACLs in Optimizely are
    /// per content node, not per version, so the check is valid for draft and
    /// scheduled versions. This assumes no custom <see cref="IContentAccessEvaluator"/>
    /// is registered that applies language-scoped permissions.
    /// </para>
    /// </remarks>
    public PagedResult<ScheduledPublicationDto> GetScheduled(int skip, int take, string? language = null)
    {
        var batchSize = Math.Max(take * 2, MinBatchSize);

        var filter = new VersionFilter
        {
            Statuses          = new[] { VersionStatus.DelayedPublish },
            ExcludeDeleted    = true,
            SortColumn        = VersionSortColumn.DelayPublishUntil,
            SortDirection     = VersionSortDirection.Ascending,
            IncludeTotalCount = false, // replaced by HasMore; avoids extra COUNT query
        };

        var items             = new List<ScheduledPublicationDto>(take);
        var principal         = _principalAccessor.Principal;
        var accessibleSkipped = 0;
        var repoOffset        = 0;
        var hasMore           = false;
        var done              = false;

        while (!done)
        {
            var batchCount = 0;

            foreach (var version in _versions.List(filter, repoOffset, batchSize, out _))
            {
                batchCount++;

                if (version.DelayPublishUntil is null)
                    continue;

                // TryGet with a versioned ContentReference (WorkID > 0) loads the
                // specific version regardless of language or publish status.
                if (!_contentLoader.TryGet<IContent>(version.ContentLink, out var content))
                    continue;

                // ACLs are at content-node level; check is valid for scheduled versions.
                if (!_accessEvaluator.HasAccess(content, principal, AccessLevel.Read))
                    continue;

                if (language is not null &&
                    !string.Equals(version.LanguageBranch, language, StringComparison.OrdinalIgnoreCase))
                    continue;

                // Still consuming the caller's skip window.
                if (accessibleSkipped < skip)
                {
                    accessibleSkipped++;
                    continue;
                }

                // Page is full — one more accessible item confirms a next page exists.
                if (items.Count == take)
                {
                    hasMore = true;
                    done    = true;
                    break;
                }

                items.Add(Map(version));
            }

            // Fewer items than requested means the repository is exhausted.
            if (done || batchCount < batchSize)
                break;

            repoOffset += batchSize;
        }

        return new PagedResult<ScheduledPublicationDto>
        {
            Items   = items,
            HasMore = hasMore,
            Skip    = skip,
            Take    = take,
        };
    }

    private static ScheduledPublicationDto Map(EPiServer.DataAbstraction.ContentVersion v) =>
        new()
        {
            ContentId       = v.ContentLink.ID,
            VersionId       = v.ContentLink.WorkID,
            Name            = v.Name            ?? string.Empty,
            Language        = v.LanguageBranch  ?? string.Empty,
            // Return DelayPublishUntil as-is. The timezone semantics of this value
            // depend on the server's DatabaseDateTimeHandler configuration and have
            // not been confirmed as UTC from source inspection. Callers should not
            // assume a specific timezone until verified on the target deployment.
            ScheduledAt     = v.DelayPublishUntil!.Value,
            SavedBy         = v.SavedBy         ?? string.Empty,
            StatusChangedBy = v.StatusChangedBy ?? string.Empty,
        };
}
