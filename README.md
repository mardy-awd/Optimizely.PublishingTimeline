# Publishing Timeline for Optimizely CMS

Publishing Timeline is an Optimizely CMS add-on that shows content versions scheduled for
publishing in a panel on the CMS Dashboard, so editors can see what goes live and when.

## Features

- Panel below the Dashboard, shown when the Workflow Status gadget's **Scheduled** tab is active
- **Table** view with paging and **Calendar** (month) view of scheduled publications
- Filters for language and date range, and a timezone selector for displayed times
- Edit links that open each item in the CMS editor
- Collapse/expand and a drag handle to resize the panel
- Lists only content the current editor is allowed to read; the API requires CMS edit access

## Compatibility

- Optimizely CMS 13 (developed and tested against 13.5.0)
- .NET 10

The panel reads the Dashboard configuration rendered by the CMS. If it can't identify the
Workflow Status **Scheduled** tab unambiguously, the panel stays hidden and the native
Dashboard is left unchanged.

## Installation

A NuGet package is not available yet. To try it, reference the project from your CMS site:

```xml
<ProjectReference Include="..\path\to\src\Mardy.Optimizely.PublishingTimeline\Mardy.Optimizely.PublishingTimeline.csproj" />
```

Services are registered automatically through an Optimizely initialization module, so no
changes to `Program.cs` or `Startup.cs` are needed.

## Building

```
dotnet build -c Release
```

## License

[MIT](LICENSE)
