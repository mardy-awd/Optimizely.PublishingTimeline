using Mardy.Optimizely.PublishingTimeline.Services;
using Xunit;

namespace Mardy.Optimizely.PublishingTimeline.Tests;

// Date-range comparison used by the scheduled-publications API. Optimizely returns
// DelayPublishUntil in server local time (DateTime.Kind Local); the from/to bounds are UTC.
// Local values are built from UTC instants with ToLocalTime(), so the tests hold on a
// server in any timezone.
public class ScheduledPublicationServiceTests
{
    // "1 November 2026" in America/New_York (the day DST ends): [04:00Z, 05:00Z next day).
    private static readonly DateTime FromUtc = new(2026, 11, 1, 4, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime ToUtc   = new(2026, 11, 2, 5, 0, 0, DateTimeKind.Utc);

    private static DateTime Utc(int day, int hour, int minute) =>
        new(2026, 11, day, hour, minute, 0, DateTimeKind.Utc);

    public static TheoryData<DateTime, bool> NewYorkDstEndDay => new()
    {
        { Utc(1, 3, 30), false }, // 31 Oct 23:30 EDT — day before
        { Utc(1, 4, 0),  true  }, // 1 Nov 00:00 EDT — inclusive From
        { Utc(1, 4, 30), true  }, // 1 Nov 00:30 EDT
        { Utc(2, 4, 30), true  }, // 1 Nov 23:30 EST — last half hour of the 25-hour day
        { Utc(2, 5, 0),  false }, // 2 Nov 00:00 EST — exclusive To
        { Utc(2, 5, 30), false }, // 2 Nov 00:30 EST — day after
    };

    [Theory]
    [MemberData(nameof(NewYorkDstEndDay))]
    public void Local_scheduled_time_is_compared_as_utc(DateTime instantUtc, bool expected)
    {
        var serverLocal = instantUtc.ToLocalTime(); // as DelayPublishUntil is returned

        Assert.Equal(DateTimeKind.Local, serverLocal.Kind);
        Assert.Equal(expected, ScheduledPublicationService.IsWithinRange(serverLocal, FromUtc, ToUtc));
    }

    [Theory]
    [MemberData(nameof(NewYorkDstEndDay))]
    public void Utc_scheduled_time_is_compared_unchanged(DateTime instantUtc, bool expected)
    {
        Assert.Equal(expected, ScheduledPublicationService.IsWithinRange(instantUtc, FromUtc, ToUtc));
    }

    [Theory]
    [MemberData(nameof(NewYorkDstEndDay))]
    public void Unspecified_scheduled_time_is_treated_as_server_local(DateTime instantUtc, bool expected)
    {
        var unspecified = DateTime.SpecifyKind(instantUtc.ToLocalTime(), DateTimeKind.Unspecified);

        Assert.Equal(expected, ScheduledPublicationService.IsWithinRange(unspecified, FromUtc, ToUtc));
    }

    [Fact]
    public void Missing_bounds_do_not_filter()
    {
        var local = Utc(1, 3, 30).ToLocalTime();

        Assert.True(ScheduledPublicationService.IsWithinRange(local, null, null));
        Assert.True(ScheduledPublicationService.IsWithinRange(local, null, ToUtc));
        Assert.False(ScheduledPublicationService.IsWithinRange(local, FromUtc, null));
    }
}
