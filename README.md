# Publishing Timeline for Optimizely CMS 13

**Publishing Timeline** is an open-source add-on for Optimizely CMS 13 that gives content editors a clearer overview of what's scheduled to go live and when.

The native CMS Dashboard includes a **Scheduled** tab within the Workflow Status gadget, but it provides limited information about upcoming publications. It doesn't offer a dedicated calendar view or flexible ways to explore publishing schedules.

Publishing Timeline extends this experience with **table and calendar views**, language and date filters, and timezone switching, making it easier to review and plan upcoming content releases.

## Features

- **Table view:** Browse scheduled publications with content names, languages, publishing dates, and pagination.
- **Calendar view:** Visualize upcoming publications in a monthly calendar.
- **Timezone switching:** View scheduled publishing times in different timezones without changing the actual publication schedule.
- **Language filtering:** Focus on content scheduled for a specific language.
- **Date filtering:** Narrow the schedule to a selected date range. From and To dates are whole days in the selected timezone, including days when daylight saving time starts or ends.
- **Quick access:** Open scheduled content directly in the CMS editor.
- **Flexible layout:** Expand, collapse, or resize the timeline within the Dashboard.
- **Permission-aware results:** Scheduled content is subject to the current user's CMS access permissions.

## Publishing across markets

For global content teams, understanding when content will go live in different markets is especially important.

Imagine a product launch coordinated across Cairo, London, and New York.

An editor in Cairo can switch the timeline to **New York time** to review publication times for the US market, then switch to **London time** to check the UK schedule.

The scheduled publication time itself remains unchanged. Only its displayed time is converted to the selected timezone.

This makes it easier to:

- Review publishing schedules across different timezones.
- Understand when content will go live in each market's local time.
- Visually identify publications scheduled outside business hours.
- Notice releases scheduled close together.

The add-on provides visibility into these schedules. It does not currently generate automatic business-hours warnings or detect scheduling conflicts.

> **Note:** Timezone switching changes how publishing times are displayed. It does not automatically filter content by market or website. Language and date filters are available separately.

## How it works

Publishing Timeline appears below the native CMS Dashboard when the **Scheduled** tab of the **Workflow Status** gadget is selected.

Editors can switch between two views:

**Table view** provides a structured list of scheduled publications, including their publishing times and languages.

**Calendar view** provides a monthly overview of upcoming publications, making it easier to see how publishing activity is distributed across different days.

Both views display scheduled publishing times using the selected timezone.

Publishing Timeline uses the CMS's existing scheduled publication information. It does not replace or modify the native scheduling and publishing functionality.

## Compatibility

- **Optimizely CMS:** 13.4.0 or later (below 14.0.0)
- **.NET:** 10

13.4.0 is the minimum dependency version: the package is built against it. Earlier CMS 13 releases depend on SixLabors.ImageSharp 3.1.12, which has known vulnerabilities.

Verification status:

- **CMS 13.5.0:** runtime integration-tested. The NuGet package is tested in a clean CMS site; the Alloy sample site is tested with a project reference.
- **CMS 13.4.0:** compilation verified; runtime testing is still pending.

## Installation

Install the package into your CMS application with Visual Studio's NuGet Package Manager (include prereleases) or the .NET CLI:

```bash
dotnet add package Mardy.Optimizely.PublishingTimeline --version 1.0.0-beta.1
```

No configuration is required. You don't need to change `Program.cs` or `Startup.cs`: services, API endpoints and the Dashboard integration register automatically, and it works with the standard `endpoints.MapContent()` setup. Applications hosted under a sub-path (`PathBase`) are supported.

Build and run your CMS application, then open:

**CMS Dashboard → Workflow Status → Scheduled**

The Publishing Timeline panel appears below the native Dashboard while the **Scheduled** tab is selected, and hides on the other tabs. The native Workflow Status gadget is left unchanged.

The panel and its API are available to users with CMS editing access.

## Development

Clone the repository and build the solution:

```bash
dotnet build -c Release
```

## Roadmap

- Complete runtime testing on CMS 13.4.0 and test later CMS 13 releases.
- Expand functional and edge-case testing.
- Release a stable 1.0.0 version.

## License

This project is licensed under the [MIT License](LICENSE).

Publishing Timeline is an independent community project and is not affiliated with or officially supported by Optimizely.