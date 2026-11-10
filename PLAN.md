# Pinezka: app plan for Claude Code

Nov 10, 2026 · @Alexander

## Summary

Pinezka is a personal Android app for ticking off places and keeping favourite photos from them. It starts with one collection, Warsaw's 18 districts, and then adds a second, the countries of the world.

- **Who uses it:** one person, on their own Android phone. No accounts, no sharing, no server.
- **Districts collection:** run once in each of Warsaw's 18 districts, log the date and km, and keep photos from each.
- **Countries collection:** log each trip to a country and add favourite photos from it, each with a city label.
- **Build order:** version 1 ships the districts. Version 2 adds the countries on the same data model and screens, so nothing is rewritten.
- **What it does not do:** record runs. Strava records the run; this app organizes what came out of it.

## Decisions and open questions

The app is an installable web app (PWA) that keeps all data on the phone. That choice removes the two expensive parts of a mobile app: store accounts and a server.

| Decision | Choice | Why |
| --- | --- | --- |
| Platform | Installable web app (PWA), tested in Chrome on Android | No store account or fee, installs from the browser |
| Structure | Collections of places | Districts and countries share one data model and one set of screens |
| Build order | Districts first, countries second | A small app that works beats a big one half built |
| Data | On the device only, in IndexedDB | Nothing to host or pay for, and it works offline |
| Accounts | None | One user |
| Maps | Shapes drawn as SVG from bundled files | No map tiles or API key, so it works offline |
| Photos | No limit per place, favourites marked with a star, stored as resized copies | Originals stay in the phone gallery |
| Trips | Each country holds a list of trips with dates. A country counts as visited once it has one trip | Decided: a list of trips, not a single tick |
| City label | Free text on each photo, with suggestions from labels used before | No location lookup, so no network needed |
| Language | English interface. District and country names in Polish | Decided: Polish names are easier to search |
| Hosting | GitHub Pages | Free static hosting with HTTPS, which installing needs |

No open questions are left. The app is called Pinezka ("map pin"), which is also the name in the web app manifest and under the home screen icon. The icon is a map pin.

## Features

The app is built in two versions. Version 2 does not start until version 1 works on the phone.

**Version 1: Warsaw districts**

1. **District list with progress.** 18 cards showing name, cover photo and done state, under a header with districts done, districts left and total km.
2. **District detail.** Done tick, date, km, notes and an optional link to the Strava activity.
3. **Photos.** Add any number per district from the camera or gallery, star the favourites, add a label and caption, reorder, delete, and view full screen with swipe. Starred photos show first, and the first one is the cover.
4. **District map.** All 18 districts drawn as shapes, done ones filled in. Tapping a district opens it.
5. **Backup.** Export everything as one ZIP file and import it to restore. A reminder appears when there are changes and no backup for 14 days.
6. **Install and offline.** The app installs to the home screen and works with no connection after the first load.

**Version 2: countries**

7. **Country list with progress.** Every country under its Polish name, grouped by continent, with a filter for visited ones and a header showing countries visited. Search ignores case and Polish letters, so "wlochy" finds Włochy.
8. **Trips.** Each country holds a list of trips, each with a start date, an optional end date, a title and notes. A country is visited once it has one trip.
9. **Trip photos with city labels.** Favourite photos are added to a trip, each with a city label, and shown grouped by city.
10. **World map.** Visited countries filled in, with pinch zoom and pan so small countries can be tapped.
11. **Backup covers both.** The same ZIP holds districts, countries, trips and all photos.

Later, in neither version:

- More collections on the same model, such as Poland's 16 voivodeship capitals
- Suggest the current district or country from the phone's location
- Prefill the date and city from the photo's own metadata
- Export a contact sheet of starred photos as a PDF for a photo book
- A shareable progress image

## Screens

The app has a bottom bar with three tabs: Districts, Countries and Settings. The Countries tab arrives in version 2. Both collections use the same screens, so each is built once.

| Screen | Shows | Actions |
| --- | --- | --- |
| Collection list | Progress header. Districts: 18 cards in a two-column grid with name, cover photo, done badge and date. Countries: searchable rows grouped by continent, with a flag emoji and a visited badge | Tap to open. Switch between List and Map at the top. Sort or filter by done state |
| Collection map | The collection's shapes, done or visited ones filled. The world map zooms and pans | Tap a shape to open that place |
| Place detail | Name, done or visited tick, date, notes, and a photo grid of any length. Districts also show km and a Strava link. Countries show a list of trips, and each trip's photos are grouped by city label | Edit any field, saved automatically. Add, star, reorder or delete photos. Add, edit or delete trips |
| Photo viewer | One photo full screen with its label and caption | Swipe between the place's photos. Edit label and caption. Star. Delete |
| Settings | Last backup date, storage used, install help, map data credits | Export ZIP, import ZIP, reset all data after a typed confirmation |

Design rules: built for a phone held in one hand, tap targets at least 44 px, light and dark mode following the phone setting, and an empty state on every screen that says what to do first.

## Data model

Everything is a place in a collection. A country has trips, and a photo belongs to a place and, for countries, to a trip. Four IndexedDB stores hold the user's data: `places`, `trips`, `photos` and `meta`. Totals such as districts done or countries visited are computed on screen and never stored.

**Collection** (defined in code, not stored)

| Field | Notes |
| --- | --- |
| `id` | `warsaw-districts` or `countries` |
| `title`, `doneWord` | "Districts" and "Done", or "Countries" and "Visited" |
| `places` | Bundled list of keys and Polish names. Names are never stored in the database |
| `fields` | Which extra fields the detail screen shows. Districts: `km`, `stravaUrl` |
| `usesTrips` | `false` for districts, `true` for countries |
| `shapesFile` | The bundled GeoJSON for the map |
| `photoLabel` | What the label is called: "Spot" for districts, "City" for countries |

**Place**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Collection and key, for example `warsaw-districts/praga-poludnie` or `countries/ES` |
| `collectionId` | string | Indexed |
| `done` | boolean | Districts only. A country is visited when it has at least one trip |
| `date` | string or null | Districts only. The run date, `YYYY-MM-DD` |
| `km` | number or null | Districts only |
| `stravaUrl` | string | Districts only |
| `notes` | string |  |
| `photoIds` | string\[\] | Districts only. Ordered, no limit |
| `updatedAt` | string | ISO timestamp |

The 18 district records are created on first run. A country record is created the first time that country is edited.

**Trip** (countries only)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | UUID |
| `placeId` | string | The country, for example `countries/ES`. Indexed |
| `title` | string | Optional, for example "Valencia 10K weekend" |
| `startDate` | string | `YYYY-MM-DD`. Trips are listed newest first |
| `endDate` | string or null | `YYYY-MM-DD` |
| `notes` | string |  |
| `photoIds` | string\[\] | Ordered, no limit |
| `updatedAt` | string | ISO timestamp |

A trip that crossed two countries is entered once under each country.

**Photo**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | UUID |
| `placeId` | string | Indexed |
| `tripId` | string or null | Set for country photos. Indexed |
| `image` | Blob | JPEG, long edge at most 2048 px |
| `thumb` | Blob | JPEG, long edge 400 px |
| `label` | string | City for country photos, for example Walencja. Optional |
| `caption` | string |  |
| `favourite` | boolean | The star |
| `takenAt` | string or null | From the file's last-modified time |
| `createdAt` | string | ISO timestamp |

**Meta** (one record): `schemaVersion` (starts at 1), `createdAt`, `lastBackupAt`, `lastChangeAt`.

The schema is versioned from the start, with a migration function per version. Version 1 already uses the collection model, so version 2 adds the `trips` store and bundled country data without changing any stored district record.

## Tech stack

The stack is a static React app with no backend. Claude Code may swap a library for an equivalent, but the constraints under the table are fixed.

| Part | Choice | Note |
| --- | --- | --- |
| Build | Vite, React, TypeScript |  |
| Installable and offline | `vite-plugin-pwa` | Generates the manifest and service worker. Precache the app and the map shapes |
| Storage | IndexedDB through the `idb` library | Photos stored as Blobs |
| Routing | Hash-based routes | Works on static hosting with no server rules |
| Styling | Plain CSS modules, mobile first | Dark mode through `prefers-color-scheme` |
| Backup file | `fflate`, in streaming mode | With no photo limit the ZIP can be large, so it is never built whole in memory |
| Maps | Own SVG renderer | Converts bundled shapes to SVG paths. The world map adds pinch zoom and pan. No map library |
| Tests | Vitest and Playwright | Unit tests for data and backup. One smoke test at an Android phone viewport |
| Hosting | GitHub Pages, deployed by GitHub Actions | Set Vite's `base` to the repository path |

Fixed constraints:

- No backend, no accounts, no analytics.
- No network requests while the app runs, apart from loading the app itself.
- Use the current stable version of each library and check its documentation. This plan pins no versions on purpose.

```
src/
  collections/ index.ts  warsaw-districts.ts  countries.ts
  data/        db.ts  migrations.ts  backup.ts
  features/    list/  detail/  photos/  map/  settings/
  components/
  app.tsx
public/
  districts.geojson  countries.geojson  icons/
tests/
```

## Place data

Both collections ship inside the app as a fixed list of places plus one shape file for the map. The app never fetches either while running.

**Warsaw districts (version 1)**

```
Bemowo, Białołęka, Bielany, Mokotów, Ochota, Praga-Południe,
Praga-Północ, Rembertów, Śródmieście, Targówek, Ursus, Ursynów,
Wawer, Wesoła, Wilanów, Włochy, Wola, Żoliborz
```

- **Shapes:** OpenStreetMap's administrative boundaries for the districts, fetched once with an Overpass query and saved as `public/districts.geojson`.
- **Shortcut:** the [andilabs/warszawa-dzielnice-geojson](https://github.com/andilabs/warszawa-dzielnice-geojson) repository has a combined file and one file per district. Its page states no data source or licence, so check the file before relying on it.
- **Credit:** OpenStreetMap data needs "© OpenStreetMap contributors" shown in the app. It goes on the Settings screen.
- **Size:** simplify the shapes so the file stays under about 100 KB.
- **Check:** a test asserts exactly 18 features, each name matching the list above, Polish letters included.

**Countries (version 2)**

- **List:** the ISO 3166-1 country list, with the two-letter code as the key, the Polish name, and the continent for grouping. The Polish names are generated at build time with Intl.DisplayNames for the pl locale, then checked by eye once.
- **Shapes:** Natural Earth's Admin 0 countries layer, which is public domain and needs no credit ([terms of use](http://www.naturalearthdata.com/about/terms-of-use/)). Use the 1:50m scale, since the coarsest scale leaves out many small countries. Save it simplified as `public/countries.geojson`.
- **Small countries:** any country too small to tap on the map is drawn as a dot at its centre, and stays reachable from the list.
- **Check:** a test asserts every country in the list has either a shape or a dot, and that every shape's code exists in the list.

## Photos, storage and backup

Photos live only on the phone, so the backup is the one feature that must not fail. A browser can clear a site's stored data, and the ZIP export is the protection against that.

**Adding a photo**

1. A standard file input with `accept="image/*"` offers the camera or the gallery, with multiple selection.
2. The app decodes the image with its stored orientation applied, then draws it to a canvas.
3. It saves two JPEG copies: one with a long edge of at most 2048 px, and a 400 px thumbnail for lists.
4. A country photo is added inside a trip, and the app asks for the city label once per batch and suggests labels used before in that country.
5. If a file cannot be decoded, the app says so and stores nothing.

The original file is never changed or uploaded anywhere. Each resized photo takes roughly 0.5 to 1 MB (an estimate), so 200 photos need up to about 200 MB.

**Keeping the data**

- With no photo limit, storage grows with use. Settings shows space used and space left, from `navigator.storage.estimate()`, and the app warns when less than 10% is left.
- Before the first photo, the app asks to be installed to the home screen, then calls `navigator.storage.persist()` and shows the answer in Settings.
- The target is Chrome on Android. If the app is ever used on an iPhone, Safari may evict a site's data under storage pressure or after a period without use, and it grants persistence on heuristics such as whether the site runs as a Home Screen web app ([WebKit storage policy](https://webkit.org/?p=14403)).

**Backup and restore**

- Export streams one ZIP: `data.json` with places, trips, photo details and `schemaVersion`, plus `photos/<id>.jpg` and `thumbs/<id>.jpg`. The export screen shows the expected file size first.
- Import checks `schemaVersion`, shows what the file contains, and replaces current data only after a confirmation. There is no merge.
- A banner on the home screen appears when `lastChangeAt` is newer than `lastBackupAt` by 14 days or more.
- An automated test exports, wipes the database, imports, and compares every record and photo byte for byte.

## Build milestones

The build runs in twelve milestones: eight for version 1, then four for version 2. Each ends with a commit and a check done on the real phone before the next one starts.

**Version 1: Warsaw districts**

1. **Scaffold and deploy.** Vite, React and TypeScript project with linting, tests, and a GitHub Actions deploy to GitHub Pages.
   - Check: a placeholder page opens at the public URL on the phone.
2. **Data layer.** The collection model, IndexedDB stores, the 18 seeded districts, read and write functions, migrations.
   - Check: unit tests pass and data survives a reload.
3. **List and detail, without photos.** Progress header, cards, editable fields with autosave.
   - Check: tick a district, enter a date and km, and the header totals change.
4. **Photos.** Add, resize, thumbnails, star, label, caption, reorder, delete, viewer.
   - Check: eight photos added from the phone's gallery show the right way up, and the two starred ones come first.
5. **District map.** SVG shapes, labels, done fill, tap to open.
   - Check: 18 shapes, every name correct, and the fill follows the done tick.
6. **Backup.** Streaming ZIP export, import with confirmation, reminder banner.
   - Check: export, reset the app, import, and everything is back, photos included.
7. **Install and offline.** Manifest, icons, service worker, install help, persistence request, storage display.
   - Check: the app is on the home screen and works in airplane mode.
8. **Finish version 1.** Empty states, dark mode, accessibility labels, README with setup and backup instructions.
   - Check: every version 1 item under "Done when" is ticked.

**Version 2: countries**

9. **Country data and list.** Bundled country list with Polish names, Countries tab, continent groups, visited filter, progress header, and search that ignores case and Polish letters.
   - Check: typing "hiszp" finds Hiszpania, and typing "wlochy" finds Włochy.
10. **Trips and city labels.** Trip list per country with add, edit and delete. Photos added to a trip with a label prompt, label suggestions, and grouping by city.
    - Check: add a trip to Hiszpania with dates, add photos labelled Walencja and Madryt, and see two headings. The header count of visited countries goes up by one.
11. **World map.** Country shapes, dots for small countries, pinch zoom and pan, tap to open.
    - Check: zoom into Europe, tap Polska, and it opens. Visited countries are filled.
12. **Finish version 2.** Backup round trip with both collections and trips, storage warning, README update.
    - Check: a backup made in version 1 imports cleanly, and every version 2 item under "Done when" is ticked.

## Done when

Each version is finished when all of its items hold on the real phone.

**Version 1**

- [ ] All 18 districts appear with correct Polish names
- [ ] Done, date, km, notes and Strava link save without a save button and survive closing the app
- [ ] Any number of photos can be added, starred, labelled, reordered, deleted and viewed full screen
- [ ] The district map shows 18 shapes and fills the done ones
- [ ] Export then import restores every record and photo
- [ ] The app is installed on the home screen and works with no connection
- [ ] Tests pass in CI and the README explains setup, deploy and backup

**Version 2**

- [ ] Every country in the bundled list can be found by its Polish name, typed with or without Polish letters
- [ ] Trips can be added, edited and deleted, and a country shows as visited once it has one
- [ ] Trip photos carry a city label and are grouped by it
- [ ] The world map zooms, pans, fills visited countries and opens a country on tap
- [ ] One backup file restores both collections with their trips, and a version 1 backup still imports

Out of scope for this project: accounts or login, cloud sync, any backend, recording runs or GPS tracks, the Strava API, social features, an app-store release, and analytics or ads.

## Kickoff prompt for Claude Code

Export this doc as Markdown, save it as `PLAN.md` in your existing public GitHub repository, open Claude Code there, and paste this:

```
Build the app described in PLAN.md in this repository.

The repository already exists on GitHub and is public. Do not create a new
one. GitHub Pages will deploy from GitHub Actions, so add the deploy
workflow in milestone 1 and tell me if a Pages setting needs changing.

Before writing code:
- Read the whole plan.
- If anything in the plan is unclear, ask me once before you start.
- Tell me which libraries and versions you will use, after checking their
  current documentation.

While building:
- Build Version 1 only (milestones 1 to 8). Do not start Version 2 until I
  tell you to.
- Use the collection data model from the start, so Version 2 needs no
  change to stored data.
- Work through the milestones in order, one at a time.
- After each milestone: run the tests, commit, tell me exactly how to do the
  milestone's check on my Android phone, then stop and wait for me.
- Put any idea outside the current version in a BACKLOG.md file instead of
  building it.
- Keep the fixed constraints: no backend, no accounts, no analytics, and no
  network requests while the app runs.
- If something in the plan cannot work as written, stop and tell me, with
  the alternative you suggest.

Start with milestone 1.
```
