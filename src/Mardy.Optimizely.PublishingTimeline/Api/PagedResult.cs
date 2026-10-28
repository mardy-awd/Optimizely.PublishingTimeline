namespace Mardy.Optimizely.PublishingTimeline.Api;

/// <summary>
/// Paged API envelope using cursor-style forward pagination.
/// Skip/take is applied after content-level permission filtering, so callers
/// advance pages by incrementing <see cref="Skip"/> by <see cref="Take"/> until
/// <see cref="HasMore"/> is false.
/// </summary>
public sealed class PagedResult<T>
{
    public IReadOnlyList<T> Items { get; init; } = [];

    /// <summary>
    /// True when at least one further accessible item exists beyond this page.
    /// Determined by checking for a (Take + 1)th accessible item during batch
    /// iteration — no separate count query is issued.
    /// </summary>
    public bool HasMore { get; init; }

    public int Skip { get; init; }
    public int Take { get; init; }
}
