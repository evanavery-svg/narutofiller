# Naruto Filler Guide

A small static website that shows which episodes of the **original _Naruto_ anime (episodes 1–220)** are canon and which are filler. Shippuden and Boruto aren't included. It has a watch tracker and a skip-filler guide, and it's an installable **Progressive Web App** that works offline.

It's plain HTML, CSS and vanilla JavaScript: no frameworks, no build step, no npm.

| Type | Count | Meaning |
| --- | ---: | --- |
| **Canon** (manga canon) | 74 | Adapts the manga's story. |
| **Mixed** (mixed canon/filler) | 56 | Adapts manga chapters but adds a noticeable amount of anime-original material. |
| **Filler** | 90 | Anime-original story that isn't in the manga. |
| **Anime canon** | 0 | Anime-original but treated as official story. The original series has none; the type is supported anyway. |

## Features

- **Episode list.** All 220 episodes, each with its number, title and a color-coded type badge. A legend explains the types.
- **Type filters.** Toggle buttons for each type that can be combined (for example, canon + mixed only).
- **Search.** One box that matches the episode number (`135`, `#135`, `ep 135`) or any part of the title. It ignores case and updates as you type. It works together with the filters.
- **Watch tracker.**
  - A checkbox on each episode, saved in `localStorage`.
  - Progress bars for all episodes (watched/220) and for canon only (watched/74).
  - A **Next episode to watch** button that scrolls to the first unwatched episode, with a **Skip filler** switch. If a filter or search hides that episode, the button changes them so you can see it.
  - A **Hide watched** switch.
  - **Reset progress**, which asks you to confirm first.
- **Skip-filler guide.** A separate tab that lists the episodes to watch, collapsed into ranges, and the episodes to skip. A switch includes or leaves out mixed episodes. It shows the episode count and the time saved, at about 23 minutes per episode:
  - Including mixed: watch **1–25, 27–96, 98–100, 107–135, 141–142, 220** (130 episodes). This saves about **34 h 30 min**.
  - Canon only: 74 episodes. This saves about **55 h 58 min**.
- **PWA.** You can install it on a phone or desktop. Every file is cached on the first visit, so the whole app then works offline. When a new version is deployed, an "Update available, tap to refresh" banner appears instead of the app quietly serving old files.

## Files

```
index.html            page markup, PWA and iOS meta tags
styles.css            dark/orange theme, mobile-first
app.js                filters, search, tracker, guide, service-worker registration
data/episodes.js      const EPISODES = [{ number, title, type }, ...]
manifest.json         web app manifest
service-worker.js     precache + cache-first + versioned caches + update flow
icons/                original "NF" icons (192, 512, maskable 192/512, Apple 180, favicon, SVG)
.nojekyll             tells GitHub Pages to serve the files as they are
tools/                optional developer scripts (not needed to run the site)
  validate-data.js    checks there are exactly 220 episodes numbered 1–220 and prints counts per type
  make-icons.js       regenerates the PNG icons (needs Playwright)
  e2e-test.js         end-to-end browser test (needs Playwright)
```

The episode data is a `.js` file, not `.json`, so browsers don't block it when the page is opened as `file://`.

## Opening the site

**Easiest:** double-click `index.html`. Everything works, including saving watched episodes, except installing the app and offline caching. Service workers aren't allowed on `file://` pages, so the page skips registering one and shows a short note in the footer.

**Local web server**, which also gives you the PWA features:

```bash
cd narutofiller
```

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Browsers treat `localhost` as a secure origin, so the service worker and installing both work.

## Deploying to GitHub Pages

1. Push these files to a GitHub repository, with `index.html` in the repository root.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Pick your branch (for example `main`) and the **/ (root)** folder, then click **Save**.
4. After a minute or so the site is live at `https://<username>.github.io/<repository>/`.

All paths are relative (`./…`) and the manifest uses `start_url` and `scope` `"./"`, so the site works at a subpath like `username.github.io/naruto-filler/` with no changes. GitHub Pages serves over HTTPS, which installing requires.

### Publishing an update

When you change any file, also bump `CACHE_VERSION` in `service-worker.js` (for example `"v1.0.0"` to `"v1.0.1"`). Returning visitors' browsers then download the new version in the background, and they see the **Update available, tap to refresh** banner. Tapping it switches to the new version and reloads. The old cache is deleted, and their watched list is kept.

## Installing as an app

The site must be served over HTTPS (for example GitHub Pages) or from `localhost`. Visit it once while online.

- **Android (Chrome):** open the site, then tap the **⋮** menu and choose **Install app** or **Add to Home screen**. Chrome may also show an install prompt on its own.
- **iPhone / iPad (Safari):** open the site, tap **Share**, then **Add to Home Screen**, then **Add**. It opens full-screen with the orange "NF" icon.
- **Desktop (Chrome / Edge):** click the install icon at the right end of the address bar, or open the **⋮** menu and choose **Cast, save and share → Install page as app**. In Edge it's **Apps → Install this site as an app**.
- **Desktop (Safari on macOS Sonoma or later):** choose **File → Add to Dock**.

After the first visit the app works with no connection. Watched episodes are saved on the device in `localStorage`, separately for each browser or installed app.

## Data sources

- **Main source:** [Anime Filler List: Naruto](https://www.animefillerlist.com/shows/naruto), retrieved 2026-11-12. Every episode's number, title and type comes from its episode table. The table also matches the summary range lists at the top of the same page exactly.
- **Cross-check:** the [Naruto Fandom wiki](https://naruto.fandom.com/wiki/List_of_Animated_Media). Each of the 220 episode pages has an infobox field (`chapters`) listing the manga chapters the episode adapts. An episode with no chapters listed is anime-original.

Type mapping: *Manga Canon* → `canon`, *Mixed Canon/Filler* → `mixed`, *Filler* → `filler`, *Anime Canon* → `anime-canon`.

To check the data file yourself, run `node tools/validate-data.js`:

```
Episodes: 220
  canon        74
  mixed        56
  filler       90
  anime-canon  0

OK: 220 episodes, numbered 1–220, no gaps or duplicates.
```

## Where the sources disagreed

**Filler vs. not filler: no disagreements.** For all 220 episodes, the 90 that Anime Filler List calls *Filler* are exactly the 90 that the Fandom wiki lists with no manga chapters. The other 130 (Canon and Mixed) all have source chapters on the wiki. That includes episode 220, which the wiki lists as adapting chapter 238 and Anime Filler List classifies as *Mixed*.

**Canon vs. mixed: checked against one source only.** The Fandom wiki doesn't separate fully canon episodes from mixed ones, so that split comes from Anime Filler List alone, as the brief asked.

**Titles: 22 episodes have different English titles.** These are translation or spelling variants, not classification differences. The site uses Anime Filler List's titles, with one exception: AFL's typo "Inheritence" in episode 91 is corrected to "Inheritance".

| Ep | Anime Filler List (used) | Fandom wiki |
| ---: | --- | --- |
| 13 | Haku's Secret Jutsu: Crystal Ice Mirrors | Haku's Secret Jutsu: Demonic Mirroring Ice Crystals |
| 37 | Surviving the Cut! The Rookie Nine Together Again! | Surviving the Cut: The Rookie 9 Together Again! |
| 54 | The Summoning Jutsu: Wisdom of the Toad Sage! | The Summoning Technique: Wisdom of the Toad Sage! |
| 60 | Byakugan vs. Shadow Clone | Byakugan vs. Shadow Clone Technique! |
| 61 | Ultimate Defense: Zero Blind Spot! | Ultimate Defence: Zero Blind Spot! |
| 68 | Zero Hour! The Destruction of the Hidden Leaf Village Begins! | Zero Hour! The Konoha Crush Begins! |
| 71 | An Unrivaled Match: Hokage Battle Royale! | An Unrivalled Match: Hokage Battle Royale! |
| 73 | Forbidden Secret Technique: Reaper Death Seal! | Forbidden Secret Technique: Dead Demon Consuming Seal! |
| 91 | Inheritance! The Necklace of Death! *(AFL: "Inheritence")* | Inheritance! The Necklace of Death! |
| 109 | An Invitation from the Sound | Oto's Invitation |
| 110 | Formation! The Sasuke Retrieval Squad | Formation! The Sasuke Recovery Team |
| 146 | Orochimaru's Shadow | Remaining Ambition: Orochimaru's Shadow |
| 148 | Search for the Rare Bikochu Beetle | The Search for the Rare Bikōchū Beetle |
| 159 | Bounty Hunter from the Wilderness | The Bounty Hunter from the Wilderness |
| 173 | The Battle at Sea: The Power Unleashed! | Battle at Sea: The Power Unleashed! |
| 180 | Hidden Jutsu: The Price of The Ninja Art: Kujaku | Hidden Jutsu! The Price of Ninja Art: Kujaku |
| 188 | Mystery of the Targeted Merchants | The Mystery of the Targeted Merchants |
| 197 | Crisis! The Hidden Leaf 11 Gather! | Crisis: The Konoha 11 Gather! |
| 203 | Kurenai's Decision, Squad 8 Left Behind | Kurenai's Decision: Team 8 Left Behind |
| 204 | Yakumo's Sealed Ability | Yakumo's Sealed Power |
| 208 | The Weight of the Prized Artifact! | The Weight of the Prized Artefact! |
| 218 | The Counterattack! | Sealed Sand: The Counterattack! |

## Testing

`node tools/e2e-test.js` copies the site into a `/naruto-filler/` subpath, serves it with `python3 -m http.server`, and drives it with Playwright and Chromium. It checks:

- **Data:** each type's episode list matches Anime Filler List's published range lists.
- **`file://`:** the page renders, has no errors, doesn't try to register a service worker, and keeps watched episodes.
- **Filters:** each type alone, combinations, and none selected, which shows an empty state.
- **Search:** case-insensitive title matches, number matches, and search combined with the filler filter.
- **Tracker:**
  - both progress counts
  - the next episode, with and without skipping filler
  - jumping to an episode that a filter or search is hiding
  - hiding watched episodes
  - watched episodes surviving a reload
  - reset with both confirm and cancel
- **Guide:** ranges, counts and time saved, with and without mixed episodes.
- **PWA:**
  - the service worker registers with the subpath scope and controls the page
  - the first visit doesn't trigger an unexpected reload
  - there is exactly one versioned cache holding all 13 files
  - the manifest parses with no errors
  - Chrome's installability check reports no errors
- **Offline:** the site loads and works with the network off.
- **Update flow:** after a new `CACHE_VERSION` is deployed, the banner appears. Tapping it reloads onto the new cache, deletes the old one, and keeps watched episodes.

The last run passed all 56 checks. Lighthouse 11 (the last version with a PWA category) scored **PWA 100, Accessibility 100, Best Practices 100**, including "Web app manifest and service worker meet the installability requirements". Lighthouse 12 and later no longer have a PWA category. In current Chrome, see **DevTools → Application → Manifest** for installability.

## Legal

This is an unofficial fan project. It isn't affiliated with or endorsed by Masashi Kishimoto, Shueisha, Studio Pierrot, TV Tokyo or VIZ Media. It uses no official logos, artwork or character images: the interface is text and CSS, and the icons are original designs. Episode titles are listed for identification only.
