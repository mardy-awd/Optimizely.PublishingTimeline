# Dashboard Extension Investigation

## Objective

The original goal of `Mardy.Optimizely.PublishingTimeline` was to expose a Publishing Timeline
gadget directly on the built-in Optimizely CMS Dashboard — the screen editors see immediately
after logging in. A full-width gadget sitting alongside Workflow Status and Broken Links would
give the content team a single-glance view of all scheduled publications without requiring
navigation to a separate page.

Before committing to an implementation strategy, this investigation examined whether CMS 13
supports loading a custom React component into the Dashboard via the `IDashboardGadget.ScriptUrl`
extension point, without modifying Optimizely's bundled JavaScript.

---

## Environment

| Context | Version |
|---|---|
| Original POC (PaaS application) | Optimizely CMS **13.4.0** |
| Bundle investigation | `EPiServer.Cms.UI` **13.5.0** (NuGet) |
| Target framework | net10.0 |
| Shell package | `EPiServer.Shell` **13.5.0** |
| CMS Shell UI package | `EPiServer.Cms.Shell.UI` **13.5.0** |

All JavaScript findings were derived from source files extracted directly from the
`CMS.zip` and `Shell.zip` module archives shipped inside the NuGet packages. No
running application was required.

---

## Original POC

### Registration

A custom gadget was registered in the PaaS application using the standard
`PostConfigure<DashboardOptions>()` pattern:

```csharp
services.PostConfigure<DashboardOptions>(options =>
{
    options.Gadgets.Add(new DashboardGadget
    {
        DisplayName      = "Publishing Timeline",
        ScriptUrl        = "/publishingtimeline/index.js",
        ColumnStyle      = ColumnStyle.FullWidth,
        SortIndex        = 100
    });
});
```

`DashboardOptions` and `IDashboardGadget` are defined in the
`EPiServer.Shell.Dashboard.Internal` namespace (assembly: `EPiServer.Shell`).

### Observed Behaviour

- The gadget **did appear** in the Dashboard UI below the built-in gadgets. The registration
  pipeline works correctly end-to-end.
- The gadget body displayed the static text **"Loading remote component"**.
- The browser made **no HTTP request** for `/publishingtimeline/index.js`.

This led to the investigation below.

---

## Dashboard Architecture

### Server-side data flow

```
DashboardOptions (EPiServer.Shell.Dashboard.Internal)
  │  Configured via PostConfigure<DashboardOptions>()
  ▼
DashboardController (EPiServer.Cms.Shell.UI.Dashboard.Internal)
  │  Invokes DashboardGadgetViewModelFactory to map each IDashboardGadget
  │  to a DashboardGadgetViewModel (ScriptUrl, Settings, DisplayName, …)
  ▼
Razor view
  │  Serialises the full row/column/gadget tree to JSON
  ▼
<div id="root"
     data-epi-dashboard-rows="[…]"
     data-epi-settings="…"
     data-epi-module-url="…"
     data-epi-antiforgery-header-name="…" />
```

### Client-side bootstrap

`dashboard.bundle.js` (a self-contained script registered under the named resource
`epi-dashboard` in the CMS `module.config`) mounts the React application:

```javascript
const root   = document.getElementById("root");
const rows   = JSON.parse(root.dataset.epiDashboardRows || "");
const settings = JSON.parse(root.dataset.epiSettings   || "");

ReactDOM.createRoot(root).render(<DashboardApp settings={settings} rows={rows} />);
```

The `rows` value — including each gadget's `scriptUrl` string — is read once from the
HTML element and passed directly into the React tree. No subsequent API call is made
to fetch gadget configuration.

---

## Technical Findings

### Finding 1 — `scriptUrl` is a hard-coded discriminator, not a URL loader

> **Verified** — extracted from `dashboard.bundle.js` inside `CMS.zip` (`EPiServer.Cms.UI 13.5.0`)

The gadget renderer component contains the following switch statement:

```javascript
// Component Xj — renders a single gadget
switch (gadget.scriptUrl) {
    case "WorkflowStatusGadget": return <WorkflowStatusComponent  gadget={gadget} />;
    case "StatusQueryGadget":    return <StatusQueryComponent     ... />;
    case "BrokenLinksGadget":    return <BrokenLinksComponent     gadget={gadget} />;
    case "GetStartedGadget":     return <GetStartedComponent      gadget={gadget} />;
    default:
        return <div> ... Loading remote component ...</div>;
}
```

`scriptUrl` is matched against four hard-coded string literals. Any value that does not
match one of these cases — including a real URL — falls into the `default` branch, which
renders a static placeholder string. **No HTTP request is made. No module is loaded.**

The `IDashboardGadget.ScriptUrl` XML documentation reads *"Url from where a gadget js module
can be loaded"*. This appears to describe a design intent from the CMS 11/12 era, when the
Shell UI was built on Dojo/AMD and `scriptUrl` was used to load an AMD module dynamically.
In CMS 13's React rewrite the dynamic loading was not implemented; the `default` branch is a
stub that was never filled in.

> **Assumption** (not proven from source history): the placeholder originates from the
> AMD-era contract and was retained during the React migration without being implemented.

---

### Finding 2 — No dynamic module loading exists in the bundle

> **Verified** — searched `dashboard.bundle.js` exhaustively

The following patterns were searched and **none were found**:

| Pattern | Purpose |
|---|---|
| `import(` | ES dynamic import |
| `System.import` | SystemJS loader |
| `require.ensure` | Webpack async chunk |
| `__webpack_require__` | Webpack runtime |
| `webpackChunk*` | Webpack chunk array |
| `loadRemoteModule` | Module Federation |
| `federationOptions` / `remoteEntry` | Module Federation config |

The bundle performs no asynchronous module loading of any kind.

---

### Finding 3 — `dashboard.bundle.js` and `base.js` use different, incompatible module runtimes

> **Verified** — inspected both bundles

`base.js` (the shared React component library, loaded as a prerequisite of the dashboard)
uses the webpack chunk array:

```javascript
(self.webpackChunkepiserver_cms_ui_react =
    self.webpackChunkepiserver_cms_ui_react || []).push(["base"], { … });
```

`dashboard.bundle.js` uses a Rollup/esbuild-style ES module interop header and has **zero
references** to `webpackChunkepiserver_cms_ui_react`. The two bundles do not share a module
registry. An external script cannot push a new gadget renderer into `base.js`'s webpack
runtime and expect `dashboard.bundle.js` to discover it, because the dashboard bundle does
not consume that runtime at all.

---

### Finding 4 — No global registration API is exposed

> **Verified** — searched `dashboard.bundle.js`, `configuration.common.bundle.js`,
> `state-initializer.js`, and `cms-global-state.js`

The following global namespaces were searched across all bundles and **none were found**:

`window.epiDashboard`, `window.epi.dashboard`, `registerGadget`, `addGadget`,
`gadgetRegistry`, `GadgetRegistry`, `componentRegistry`, `registerComponent`,
`gadgetRenderers`, `pluginRegistry`

`cms-global-state.js` (Shell module, loaded on all pages) does expose `window.state`, but
this is a typed state registry for auth tokens and editor context — not a gadget renderer
registry. Its API (`window.state.register`, `window.state.get`) accepts `{ name, get,
subscribe, refresh }` state objects only.

---

### Finding 5 — The Shell module.config format provides no gadget-renderer hook

> **Verified** — read `module.config` from both `CMS.zip` and `Shell.zip`

The Optimizely Shell module manifest allows third-party modules to declare:

- Named `clientResources` (CSS and JS files to load on specific routes)
- A Dojo `clientModule` initializer script
- Route prefixes and assembly references

It provides no mechanism to register a new gadget renderer, override a named resource from
another module, or inject behaviour into the React dashboard switch at boot time.

---

## Conclusion

**Custom external React gadgets cannot currently be loaded through `IDashboardGadget.ScriptUrl`
in Optimizely CMS 13.4.0 or 13.5.0.**

The `ScriptUrl` property is serialised into the page's HTML and passed to the React application
as plain data, but the dashboard renderer treats it only as a discriminator key matched against
four hard-coded built-in gadget identifiers. There is no plugin slot, no shared module registry,
and no dynamic import path through which an external bundle could render inside the Dashboard's
React tree.

The "Loading remote component" text seen during the POC is not an error state — it is the
literal fallback string rendered for every unrecognised `scriptUrl` value.

---

## Alternative Approach

Given the confirmed absence of a public Dashboard extension point, the Publishing Timeline
feature will be implemented as a **dedicated CMS UI page**, integrated into the Shell navigation
using the standard Optimizely extension mechanisms:

- A **Shell module** (`modules/_protected/PublishingTimeline/`) delivering the add-on's
  static assets and Razor views through the module ZIP pipeline.
- A **menu provider** (implementing `IMenuProvider` or using `[MenuProvider]`) to register
  a navigation entry in the CMS top bar or left-hand panel, giving editors a direct link to
  the Publishing Timeline page.

This approach is fully supported, survives CMS upgrades without touching bundled assets, and
is consistent with how Optimizely's own add-ons (TinyMce, OpalChat, Settings) integrate with
the Shell.

---

## Future Investigation

If Optimizely introduces an official Dashboard gadget registration API — such as a JavaScript
plugin registry, Module Federation remote entry, or a documented `window.epi.dashboard`
namespace — this investigation should be revisited. At that point, the gadget-based approach
may become viable and could replace the dedicated-page implementation.

Relevant tracking: monitor the `EPiServer.Cms.UI` changelog for entries referencing
`DashboardGadget`, `scriptUrl`, or dynamic component loading.
