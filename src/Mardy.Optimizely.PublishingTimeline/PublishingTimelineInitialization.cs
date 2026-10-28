using EPiServer.Framework;
using EPiServer.Framework.Initialization;
using EPiServer.ServiceLocation;
using Mardy.Optimizely.PublishingTimeline.Dashboard;
using Microsoft.AspNetCore.Razor.TagHelpers;
using Microsoft.Extensions.DependencyInjection;

namespace Mardy.Optimizely.PublishingTimeline;

/// <summary>
/// Registers Publishing Timeline services with the Optimizely CMS 13 dependency injection
/// container. Discovered automatically by the Optimizely module scanner — no manual
/// registration is required in the host application's Startup/Program.cs.
/// </summary>
[InitializableModule]
[ModuleDependency(typeof(EPiServer.Web.InitializationModule))]
public sealed class PublishingTimelineInitialization : IConfigurableModule
{
    public void ConfigureContainer(ServiceConfigurationContext context)
    {
        // IHttpContextAccessor is required by PublishingTimelineTagHelperComponent.
        // AddHttpContextAccessor() is idempotent — safe to call even if already registered
        // by the host application.
        context.Services.AddHttpContextAccessor();

        // Register as ITagHelperComponent so ASP.NET Core's BodyTagHelper automatically
        // invokes it when the Shell shared layout renders its <body> tag.
        context.Services.AddTransient<ITagHelperComponent, PublishingTimelineTagHelperComponent>();
    }

    public void Initialize(InitializationEngine context) { }

    public void Uninitialize(InitializationEngine context) { }
}
