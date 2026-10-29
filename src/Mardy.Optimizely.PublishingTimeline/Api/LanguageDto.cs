namespace Mardy.Optimizely.PublishingTimeline.Api;

/// <summary>
/// A configured CMS language branch returned by the languages API.
/// </summary>
public sealed class LanguageDto
{
    /// <summary>BCP-47 language code, e.g. "en", "sv".</summary>
    public string Code { get; init; } = string.Empty;

    /// <summary>Display name of the language, e.g. "English".</summary>
    public string Name { get; init; } = string.Empty;
}
