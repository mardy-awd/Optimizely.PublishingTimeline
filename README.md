# Publishing Timeline for Optimizely CMS 13

**Publishing Timeline** is an open-source add-on for Optimizely CMS 13 that gives content editors a clearer overview of what's scheduled to go live and when.

The native CMS Dashboard includes a **Scheduled** tab within the Workflow Status gadget, but it provides limited information about upcoming publications. It doesn't offer a dedicated calendar view or flexible ways to explore publishing schedules.

Publishing Timeline extends this experience with **table and calendar views**, language and date filters, and timezone switching, making it easier to review and plan upcoming content releases.

## Features

- **Table view:** Browse scheduled publications with content names, languages, publishing dates, and pagination.
- **Calendar view:** Visualize upcoming publications in a monthly calendar.
- **Timezone switching:** View scheduled publishing times in different timezones without changing the actual publication schedule.
- **Language filtering:** Focus on content scheduled for a specific language.
- **Date filtering:** Narrow the schedule to a selected date range.
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

- **Optimizely CMS:** 13
- **.NET:** 10

Developed and tested against **Optimizely CMS 13.5.0**.

Compatibility with other CMS 13 versions has not yet been fully verified.

## Installation

Publishing Timeline is intended to be distributed as a NuGet package for Optimizely CMS 13.

Once published, install it into your CMS application using Visual Studio's NuGet Package Manager or the .NET CLI:

```bash
dotnet add package Mardy.Optimizely.PublishingTimeline
```

After installation, build and run your CMS application, then navigate to:

**CMS Dashboard → Workflow Status → Scheduled**

The Publishing Timeline panel is designed to appear below the native Dashboard without replacing the existing Workflow Status gadget.

**Current status:** NuGet packaging and installation testing are in progress. The package is not yet publicly available.

## Development

Clone the repository and build the solution:

```bash
dotnet build -c Release
```

## Roadmap

- Validate standalone NuGet installation in a clean CMS 13 application.
- Verify timezone conversions, daylight saving transitions, and date filtering across timezones.
- Expand functional and edge-case testing.
- Test compatibility with additional CMS 13 versions.
- Publish the first NuGet release.

## License

This project is licensed under the [MIT License](LICENSE).

Publishing Timeline is an independent community project and is not affiliated with or officially supported by Optimizely.