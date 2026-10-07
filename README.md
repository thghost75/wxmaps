# WxMaps Romania

A static weather explorer for Romania with ECMWF forecasts, location search, five saved locations, and a browser-local visit counter. No framework, dependencies or API key are required for the current non-commercial forecast endpoint.

## Deploy with GitHub Pages

1. Create a GitHub repository named **WxMaps**, with **main** as its default branch. Use a public repository for GitHub Free.
2. Extract the package and upload the **contents** of its WxMaps folder to the repository root, including the hidden **.github** folder. Do not upload the ZIP itself or nest the whole project in another WxMaps folder. GitHub Desktop or Git preserves dotfiles when committing.
3. In the repository, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. Open **Actions → Validate and deploy WxMaps → Run workflow**, choose **main**, and run it. Future pushes to main deploy automatically after checks pass. Pull requests only run checks.
5. Open the site URL shown by the deployment, normally **https://YOUR-USERNAME.github.io/WxMaps/**. The URL uses your actual repository name.

If the first run fails before Pages is enabled, enable it in step 3 and rerun the workflow. A deployment waiting for environment approval needs approval in GitHub. If using a different branch, change the branch filters and deploy conditions in .github/workflows/pages.yml. No personal access token or repository secret is needed; the workflow uses GitHub's built-in token.

Setup reference: [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and [custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Local development

Install Node.js 24 or later, open a terminal in this folder, then run:

~~~sh
npm run check
npm start
~~~

Open http://127.0.0.1:4173. No npm install step is needed. Edit files in dist directly; they are the site source and the deployment output. npm run build validates the ready-to-publish files without generating a separate bundle.

## What gets deployed

The workflow publishes only **dist/**. The preview server, README and development scripts remain in the repository. All site assets use relative paths to support both project Pages URLs and custom domains. Any other static host can serve the contents of dist as its web root.

Saved locations and the visit count belong to each browser and origin; they do not move from localhost to the public site. The visit count is not a shared visitor total. Daily forecast refresh runs in visitors' browsers, with no scheduled GitHub job needed. No weather history is bundled or stored on the hosting server.

## Features
- Geographic map with twelve selectable Romanian cities
- Seven-day ECMWF IFS 0.25° forecasts through Open-Meteo
- Temperature, daily precipitation, snowfall and maximum 10 m wind views
- ECMWF meteogram links
- Daily refresh, expired-data cleanup and explicit service failure states
- Responsive layout and keyboard-accessible controls

## Data
The browser requests https://api.open-meteo.com/v1/forecast with model ecmwf_ifs025. Daily dates use Europe/Bucharest. Retrieval time is not model initialization time. Markers represent city point forecasts; country shading is geographic, not interpolated weather. Forecasts are deterministic, not probabilities. No fabricated or stored sample forecast is shown. Internet is required for forecasts; the geographic map is bundled.

Open-Meteo's free endpoint is for non-commercial use and subject to rate limits. Review their current terms before commercial deployment. Forecast attribution: Open-Meteo / ECMWF, CC BY 4.0. Geography: Natural Earth via https://github.com/datasets/geo-countries (public domain/ODC-PDDL).

## Structure
`dist/` is a deployable static site. `server.mjs` is a loopback-only preview server. No framework or third-party browser dependency. The supplied GitHub Actions workflow publishes dist to GitHub Pages.

Optional WebMCP forecast selection is feature-detected and does not affect ordinary browsers.

## Snow and geographic projection
Snow uses daily snowfall_sum (centimetres) from Open-Meteo with ECMWF IFS 0.25°. This is an estimate of new snowfall for each local calendar day, not settled snow depth. Missing values display a dash; zero displays 0.0 cm. See https://open-meteo.com/en/docs/ecmwf-api for the derivation.

The map uses a local Mercator view centred at 25° E, 46° N with a uniform scale and an SVG aspect ratio of 900:580. Country boundaries, labels and forecast markers use the same projection.

## Romania location search
Search Romanian populated places using Open-Meteo geocoding (GeoNames), restricted by countryCode=RO. Submit at least two characters. Up to 20 matches are returned per query, with county and municipality to distinguish repeated names. Search supports names without diacritics and county qualifiers. Coverage follows the provider catalogue; there is no fixed application-wide locality limit and no claim that every locality is indexed.

Twelve overview cities plus one replaceable searched location are kept in memory. Forecast requests include at most thirteen places. Search results are not all rendered on the map. Selecting a new place clears its previous forecast immediately, cancels older requests, and loads fresh data. Search results and the active selection are not persisted across reloads. Saved quick-access locations are stored locally as described below. The search query is sent to Open-Meteo; selected coordinates are sent to its forecast API.

Verification: live search and forecast for Sinaia; duplicate Victoria names with county labels; keyboard result selection; empty-result handling; dynamic selected pin; seven-day snow/temperature controls.

## Quick access
Save up to five overview or searched locations. Each saved card opens its forecast; the remove button frees a slot. Duplicate coordinates cannot be saved twice. The five-slot limit is enforced by the state logic, not only by the button. Names, coordinates, county and optional GeoNames ID are stored in this browser under wxmaps.saved-locations.v1. No account or cloud synchronization; clearing site data clears the saved places. Changes synchronize between tabs at the same origin. Storage errors are displayed without silently claiming a successful save.

Validation covers capacity, duplicates, persistence, deletion, malformed records, blocked storage, and browser save/reload/open flows for both overview and searched locations.

## Daily refresh and expiry
Forecasts expire when the calendar day changes in Europe/Bucharest, or after 24 hours, whichever comes first. The visible page checks every minute and fetches a new seven-day forecast. Opening the site always loads fresh data; returning to the tab, restoring a page, focusing the window or reconnecting also checks freshness. Browsers may suspend timers while hidden or asleep; there is no background server scheduler when the browser is closed.

Expired readings and date controls are cleared before the next request. Responses must contain seven consecutive dates starting today in Bucharest. A failed refresh clears readings and retries every five minutes while the page is visible; Refresh data retries immediately. Requests bypass the browser HTTP cache. Retrieval time does not certify the provider's underlying model run is new.

Weather values are only held in memory and replaced on refresh. No weather history or forecast cache is saved to disk or local storage. Saved location preferences are retained.

## Page visit counter
The footer counts page loads (including reloads) in this browser, starting when the counter is added. Weather refreshes and forecast selections do not increment it. The count is stored under wxmaps.page-visits.v1 and synchronizes between tabs. Web Locks serialize simultaneous increments where supported. This is a local page-view count, not unique visitors or a shared total across devices. Clearing site data resets it; blocked storage displays an unavailable state. No analytics service or tracking requests are used.

Use **Exclude this browser** in the footer to pause future page-view increments for this browser and origin. The existing count is preserved; **Resume counting this browser** enables future loads again. The preference persists under wxmaps.page-visits.excluded.v1 and synchronizes between tabs. Clearing site data or using another browser/profile resets the preference. This does not filter a shared analytics total; the counter remains browser-local.
