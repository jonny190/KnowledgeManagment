# Installing plugins

Plugins extend KnowledgeManagement with new commands, status bar widgets, and editor features. They are ESM JavaScript bundles that you load from a URL.

## Opening plugin settings

Click your avatar or name in the top navigation bar, then select Settings. In the left sidebar, choose Plugins. This page lists all plugins you have installed and lets you add new ones.

## Adding a plugin

Paste the plugin URL into the input field and click Add. For example, the built-in wordcount plugin ships with the application and is available at:

```
http://localhost:3000/plugins/wordcount.js
```

Replace `localhost:3000` with your actual instance URL when running in production.

After clicking Add, reload the page and open a note. The plugin activates immediately at startup without needing to restart the application.

## Trusting same-origin plugins

Plugins served from the same origin as the application are always trusted. If you are self-hosting and want to ship your own plugins, place the built `.js` files in `apps/web/public/plugins/` and reference them by path.

To allow plugins from other origins, the server administrator needs to set the `NEXT_PUBLIC_PLUGIN_ALLOWLIST` environment variable. See `docs/plugins.md` for details on that configuration.

## Disabling a plugin

Each plugin in the list has a checkbox next to it. Uncheck the box to disable the plugin without removing it. Disabled plugins are not loaded at startup. Re-check the box to enable it again. Changes take effect after the next page load.

## Removing a plugin

Click the Remove button next to a plugin to delete it from your account. It will no longer appear in the list and will not be loaded. This cannot be undone through the UI; add the URL again if you change your mind.

## Troubleshooting

If a plugin does not appear to be working after adding it:

1. Check that the URL is reachable from your browser. Open the URL directly in a new tab to confirm the bundle loads.
2. Verify the origin is allowed. If the URL is on a different domain from the application, it must be listed in `NEXT_PUBLIC_PLUGIN_ALLOWLIST`.
3. Open the browser developer console and look for errors from the plugin loader. A failed allow-list check logs a warning and skips the bundle silently.
4. Reload the page fully after enabling or adding a plugin, because plugins load once at startup.
