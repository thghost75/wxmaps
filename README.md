# WxMaps Romania

A Romania weather explorer with ECMWF forecasts, location search, five saved locations, and a shared visit counter backed by Python and Upstash Redis. The frontend uses plain JavaScript with no third-party browser dependencies.

## Deploy with Vercel

1. Import this repository into Vercel. Select the **Other** framework preset and leave the root at the repository root.
2. The included vercel.json sets the build command to **npm run build** and the output directory to **dist**. Vercel also deploys **api/visits.py** as a Python function.
3. In the project's **Storage** tab, create/connect a dedicated Upstash Redis database. Prefer the free plan if available. Connect its environment variables to **Production**.
4. The backend accepts one of these server-only credential pairs: **KV_REST_API_URL / KV_REST_API_TOKEN**, **UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN**, or **COUNTER_REDIS_REST_URL / COUNTER_REDIS_REST_TOKEN**. The Marketplace integration supplies these; never paste credentials into frontend files, GitHub, screenshots or logs.
5. Redeploy after connecting storage. Git pushes to main then deploy through the Vercel GitHub connection.
6. For a different domain, update the production origin in **dist/visit-counter.js** and **wxmaps/visit_counter.py**. For a separate site, also change the Redis key and cookie name.

The current production origin is https://wxmaps-iota.vercel.app/. GitHub Actions runs validation only. GitHub Pages cannot host the Python visit endpoint.

## Local development

Install Node.js 24 or later, then run:

~~~sh
npm run build
npm start
~~~

Open http://127.0.0.1:4173. No npm install is needed. Edit dist files directly; build validates the ready-to-publish frontend. Local and preview origins do not call or increment the production counter.

With Python 3.12 or later, run the backend tests too:

~~~sh
python -m unittest discover -s tests -p "test_*.py"
~~~

The counter uses only the Python standard library. Tests use fake credentials and mocked storage, never the live Redis database.

## What gets deployed

Vercel serves **dist/** and the **api/visits.py** function, with its helper in **wxmaps/**. Upstash holds the durable total across deployments. The local preview server does not serve the Python endpoint.

Saved locations and the counter exclusion preference belong to each browser and origin; they do not move from localhost to the public site. Daily forecast refresh runs in visitors' browsers. No weather history is bundled or stored on the hosting server.

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
`dist/` is a deployable static site. `server.mjs` is a loopback-only preview server. No framework or third-party browser dependency. Vercel serves the frontend and Python visit endpoint; GitHub Actions validates changes.

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

## Site visit counter

The footer displays one persistent total across all visitors. The Python endpoint uses an atomic Redis operation under **wxmaps:public-visits:v1**, separate from other sites. The old per-browser totals are not added to this total; counting starts with the first successful shared visit.

A signed **__Host-wxmaps-visit** cookie counts repeat visits within 30 minutes only once when cookies are enabled. The cookie is Secure, HttpOnly and SameSite=Lax. Common bot, crawler, spider, headless and preview user agents do not increase the total. This counts visits, not unique people; deleting cookies or switching browsers can count again, and user-agent filtering is not comprehensive abuse prevention.

Only requests from the configured production origin with the custom header can increment. GET reads never increment. Local and preview frontends do not call the counter. Failed requests display an unavailable state; neither the client nor backend retries increments because a timeout can happen after Redis has counted the visit.

Use **Exclude this browser** to exclude future page loads on this origin. The existing **wxmaps.page-visits.excluded.v1** preference is preserved. Excluded browsers still see the shared total via a read-only request. **Resume counting this browser** enables future page loads again. Toggling does not retroactively add/remove visits. Clearing site data or changing browser/profile resets the exclusion. If browser storage is blocked, the frontend reads the total without incrementing.

Redis stores only the aggregate total and its start date. The counter does not save IP addresses, user agents or individual visitor records. The host's normal request logs are separate. Credentials stay in server environment variables and are never returned by the endpoint.

Adapted from the user's [Romanian Climate Explorer frontend](https://github.com/thghost75/Romanian-Climate-Explorer/blob/main/frontend/src/VisitCounter.tsx), [Python counter](https://github.com/thghost75/Romanian-Climate-Explorer/blob/main/anm_climate/visit_counter.py), and [API integration](https://github.com/thghost75/Romanian-Climate-Explorer/blob/main/api/index.py). WxMaps retains its existing plain JavaScript frontend rather than adding React for one footer component.
