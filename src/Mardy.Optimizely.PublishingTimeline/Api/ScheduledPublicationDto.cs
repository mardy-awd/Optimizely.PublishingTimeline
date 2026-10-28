namespace Mardy.Optimizely.PublishingTimeline.Api;

/// <summary>
/// A single scheduled publication entry returned by the API.
/// </summary>
public sealed class ScheduledPublicationDto
{
    /// <summary>The content item ID (ContentReference.ID).</summary>
    public int ContentId { get; init; }

    /// <summary>The specific version number (ContentReference.WorkID).</summary>
    public int VersionId { get; init; }

    public string Name { get; init; } = string.Empty;

    /// <summary>BCP-47 language tag, e.g. "en", "sv".</summary>
    public string Language { get; init; } = string.Empty;

    /// <summary>
    /// Date and time at which this version is scheduled to be published,
    /// as stored by the CMS. The timezone of this value depends on the
    /// Optimizely server's database time configuration and cannot be assumed
    /// to be UTC without verifying the host environment. Do not use for
    /// UTC-relative calculations until the timezone has been confirmed.
    /// System.Text.Json serializes this without a timezone suffix when the
    /// underlying DateTimeKind is Unspecified.
    /// </summary>
    public DateTime ScheduledAt { get; init; }

    /// <summary>Username of the person who last saved this version.</summary>
    public string SavedBy { get; init; } = string.Empty;

    /// <summary>Username of the person who set the scheduled-publish status.</summary>
    public string StatusChangedBy { get; init; } = string.Empty;
}
