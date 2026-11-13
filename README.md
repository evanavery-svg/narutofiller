# Naruto Filler Guide

A small static website that shows which episodes of the **original _Naruto_ anime (episodes 1–220)** are canon and which are filler. Shippuden and Boruto aren't included. It has a watch tracker and a skip-filler guide, and it's an installable **Progressive Web App** that works offline.

It's plain HTML, CSS and vanilla JavaScript: no frameworks, no build step, no npm.

To keep things simple, the site sorts episodes into just two categories:

| Category | Count | Meaning |
| --- | ---: | --- |
| **Canon** | 130 | Tells the manga's story. Watch these. |
| **Filler** | 90 | Anime-only story that isn't in the manga. Safe to skip. |

"Canon" includes the 56 episodes that Anime Filler List calls *mixed canon/filler*: they adapt manga chapters but add some anime-only scenes. The data file still keeps Anime Filler List's finer split (74 manga canon, 56 mixed, 90 filler, 0 anime canon), so the site could show it again later.

## Features

- **Simple, Apple-style design.** It uses the system font (San Francisco on Apple devices), grouped lists like the iPhone Settings app, switches and segmented controls. Naruto orange is the accent color.
  - The main screen has only your progress, a **Continue** button, search, the **All / Canon / Filler** control and the episode list.
  - Everything else is in the **⋯** menu at the top right: Mark Several Episodes, the Skip-Filler Guide, Watch Together, Get the App, the two settings, Reset Progress, and where the data comes from.
- **Light and dark mode.** These follow the phone or computer's own setting automatically.
- **Episode list.** All 220 episodes, each with its number and title. Filler episodes get a small **Filler** tag; anything without a tag is canon. The **⋯** menu explains the difference in one sentence.
- **All / Canon / Filler.** A segmented control above the list shows everything, only canon, or only filler.
- **Search.** One box that matches the episode number (`135`, `#135`, `ep 135`) or any part of the title. It ignores case and updates as you type. It works together with the filters.
- **Watch tracker.**
  - A round checkbox on each episode, saved in `localStorage`.
  - A progress bar showing "40 of 220 watched", with the canon count underneath (out of 130).
  - A **Continue** button that scrolls to the next unwatched episode. The **Skip filler when continuing** switch controls whether it skips filler. If the All / Canon / Filler control or the search hides that episode, the button changes them so you can see it.
  - **Mark Several Episodes** (in the **⋯** menu): pick a range (for example 1 to 80) and mark it all as watched or unwatched at once, optionally skipping filler. A message with **Undo** confirms it.
  - A **Hide watched episodes** switch (in the **⋯** menu).
  - **Reset Progress** (in the **⋯** menu), which asks you to confirm first.
- **Watch together.** Two (or more) people can share one watched list through a free Firebase database. Episodes either of you ticks show up on the other's phone within a second or two, and changes made offline sync later. It's off until you add your own Firebase project; see [Shared progress (Firebase)](#shared-progress-firebase). It lives in the **⋯** menu. While you're sharing, a small **Shared** label next to your progress shows the sync status, and tapping it opens Watch Together.
- **Skip-filler guide.** A separate page (in the **⋯** menu) that lists the episodes to watch, collapsed into ranges, and the episodes to skip, with a map showing which to watch. Watch **1–25, 27–96, 98–100, 107–135, 141–142, 220** (130 episodes) and skip the 90 filler episodes, which saves about **34 h 30 min** at about 23 minutes per episode.
- **PWA.** You can install it on a phone or desktop. Every file is saved on the first visit, so the whole app then works offline.
- **Get the app.** **Get the App** in the **⋯** menu shows step-by-step install instructions for the device you're on (iPhone/iPad, Android or desktop). They also pop up by themselves when someone opens a Watch together invite link on a phone.
- **Always up to date.** Whenever there's a connection, every open of the site or app loads the newest version, and the app checks again each time you switch back to it. There's no "update available" step. Offline, it uses the last saved copy.

## Files

```
index.html            page markup, PWA and iOS meta tags
styles.css            dark/orange theme, mobile-first
app.js                filters, search, tracker, guide, shared-list UI, service-worker registration
sync.js               shared-list sync over Firestore (loaded only when a shared list is in use)
firebase-config.js    your Firebase web config (null = sharing off)
firestore.rules       Firestore security rules to paste into the Firebase console
firebase.json         points the Firebase CLI / emulator at firestore.rules
data/episodes.js      const EPISODES = [{ number, title, type }, ...]
manifest.json         web app manifest
service-worker.js     offline copy + network-first (always the newest version when online)
icons/                Hidden Leaf symbol icons (192, 512, maskable 192/512, Apple 180, favicon, SVG)
.nojekyll             tells GitHub Pages to serve the files as they are
tools/                optional developer scripts (not needed to run the site)
  validate-data.js    checks there are exactly 220 episodes numbered 1–220 and prints counts per type
  make-icons.js       draws the leaf logo, regenerates the icons and the logo in the page header (needs Playwright)
  e2e-test.js         end-to-end browser test (needs Playwright)
  sync-test.js        two-device shared-list test against the Firestore emulator
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

Just commit and push. GitHub Pages takes a minute or two to publish (its servers can hold on to old files for up to about 10 minutes). After that:

- **Opening the site or app** loads the new version right away.
- **An app that was already open in the background** checks for changes when you switch back to it, and reloads by itself if anything changed. A short "Updated to the latest version" message confirms it.
- **Watched episodes and the shared list** are kept.

You only need to bump `CACHE_VERSION` in `service-worker.js` when you add or remove files in its `PRECACHE` list, so the offline copy includes them.

## Installing as an app

The site must be served over HTTPS (for example GitHub Pages) or from `localhost`. Visit it once while online. **Get the App** in the site's **⋯** menu shows these steps for the device you're on.

- **Android (Chrome):** open the site, then tap the **⋮** menu and choose **Install app** or **Add to Home screen**. Chrome may also show an install prompt on its own.
- **iPhone / iPad (Safari):** open the site, tap **Share**, then **Add to Home Screen**, then **Add**. It opens full-screen with the orange Hidden Leaf icon. Other iPhone browsers (Chrome, Edge, Firefox) also offer **Add to Home Screen** in their Share menu. In-app browsers, like the ones inside Instagram or Facebook, can't install apps; open the page in Safari first.
- **Desktop (Chrome / Edge):** click the install icon at the right end of the address bar, or open the **⋮** menu and choose **Cast, save and share → Install page as app**. In Edge it's **Apps → Install this site as an app**.
- **Desktop (Safari on macOS Sonoma or later):** choose **File → Add to Dock**.

After the first visit the app works with no connection. Watched episodes are saved on the device in `localStorage`, separately for each browser or installed app.

## Shared progress (Firebase)

**Watch Together** (in the **⋯** menu) lets two people share one watched list. It uses Google's Firebase Cloud Firestore on the free **Spark** plan, so no credit card is needed. Until you set it up, it just says sharing isn't set up.

### One-time setup (about 10 minutes)

1. **Create a Firebase project.**
   - Go to <https://console.firebase.google.com> and sign in with a Google account.
   - Click **Create a project** (or **Add project**) and give it a name, for example `naruto-filler`.
   - You can turn Google Analytics off; the app doesn't use it.
2. **Create the database.**
   - In the left menu, open **Build → Firestore Database** (or **Databases & Storage → Firestore**) and click **Create database**.
   - If it asks for an edition, choose **Standard** (the free quota below is for Standard).
   - Pick a location near you. You can't change it later.
   - Choose **Start in production mode**.
3. **Add the security rules.**
   - Still in Firestore, open the **Rules** tab.
   - Replace everything there with the contents of [`firestore.rules`](firestore.rules), then click **Publish**.
4. **Register the web app.**
   - Click the gear icon next to **Project Overview**, then **Project settings**.
   - Under **Your apps**, click the web icon (`</>`).
   - Enter a nickname. Leave **Firebase Hosting** unticked, since the site is on GitHub Pages. Click **Register app**.
   - Copy the `firebaseConfig = { ... }` object it shows.
5. **Paste the config into the site.**
   - Open [`firebase-config.js`](firebase-config.js) and replace `const FIREBASE_CONFIG = null;` with your values, keeping the `const FIREBASE_CONFIG =` part. For example:

     ```js
     const FIREBASE_CONFIG = {
       apiKey: "AIza...",
       authDomain: "naruto-filler.firebaseapp.com",
       projectId: "naruto-filler",
       storageBucket: "naruto-filler.firebasestorage.app",
       messagingSenderId: "1234567890",
       appId: "1:1234567890:web:abc123"
     };
     ```

   - Commit and push. GitHub Pages updates within a minute or two.

The config values aren't secret. Every Firebase web app sends them to the browser, so it's fine to commit them to a public repository. What protects your data is the security rules from step 3.

### Using it

1. On your phone, open the site and tap **⋯ → Watch Together → Create List**. Anything you've already ticked goes into the new list.
2. Tap **Invite** and send the link to the other person. On a phone this opens the share sheet; on desktop it copies the link.
3. They open the link. On a phone, install instructions pop up, showing the list's code.
   - **iPhone:** an app added to the Home Screen keeps its data separate from Safari. So they copy the code, add the app to the Home Screen, open it, tap **Join with a Code** and paste.
   - **Android:** they tap **Join the list** in the pop-up, then install. The installed app keeps the joined list.
   - **Desktop, or to skip installing:** Watch Together opens with a **Join** button. If it was closed, an invitation banner at the top of the page reopens it.

   Anything they had already ticked is merged in.

**Join with a Code** accepts the 16-character code shown on the card (for example `KFMQ-K7JP-AQ9N-CBG8`) or the whole invite link. Upper or lower case and dashes don't matter.

From then on:

- Ticks, unticks and **Reset progress** show up on both devices, usually within a second or two. Reset clears the list for everyone, and its confirm message says so.
- The status dot shows **Synced**, **Saving…**, or **Offline · will sync later**.
- If you tick episodes with no connection, or even close the app before reconnecting, the changes are saved on the phone and sent the next time it opens online. When both people changed the same episode, the most recent change wins.
- **Leave** (tap twice) stops sharing on that device. Your progress stays, but later ticks are no longer shared. You'll need the code to rejoin.
- The installed app still works fully offline. The Firebase code downloads only once you're on a shared list, and the rest of the app never depends on it.
- Sharing doesn't work when you open `index.html` directly as a file. Use the hosted site.

### Privacy and limits

- **The code works like a password.** Anyone with your code or invite link can see and change that list. Nobody can browse the database to find codes: the rules block listing, and codes are random 16-character strings with about 79 bits of randomness. To revoke access, both of you **Leave**, create a new list, and optionally delete the old document under `rooms` in the Firebase console.
- **Only watch data is stored.** Each list is one document holding episode numbers, watched yes/no, and when each was changed. There are no names, emails or accounts.
- **Free plan limits.** At the time of writing, the Spark plan's free quota for a Standard database is 50,000 document reads, 20,000 writes and 20,000 deletes per day, plus 1 GiB of storage ([current limits](https://firebase.google.com/docs/firestore/quotas)). Two people ticking episodes use a tiny fraction of that. Because the project has no billing account, it can't charge you. If a limit were ever reached, sync requests would be refused until the quota resets (daily, around midnight Pacific time), and the app would keep working on each device.
- **Phone clocks matter.** "Most recent change wins" uses each device's clock. If a phone's clock is badly wrong, its changes might win when they shouldn't. Normal automatic phone time is fine.
- **Optional extra lock-down.** In the [Google Cloud console](https://console.cloud.google.com/apis/credentials) for the same project, you can restrict the browser API key to your site with an HTTP referrer restriction such as `https://<username>.github.io/*`.

## Data sources

- **Main source:** [Anime Filler List: Naruto](https://www.animefillerlist.com/shows/naruto), retrieved 2026-11-12. Every episode's number, title and type comes from its episode table. The table also matches the summary range lists at the top of the same page exactly.
- **Cross-check:** the [Naruto Fandom wiki](https://naruto.fandom.com/wiki/List_of_Animated_Media). Each of the 220 episode pages has an infobox field (`chapters`) listing the manga chapters the episode adapts. An episode with no chapters listed is anime-original.

Type mapping in `data/episodes.js`: *Manga Canon* → `canon`, *Mixed Canon/Filler* → `mixed`, *Filler* → `filler`, *Anime Canon* → `anime-canon`. The site then shows `filler` as **Filler** and everything else as **Canon**.

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

**Canon vs. mixed: checked against one source only.** The Fandom wiki doesn't separate fully canon episodes from mixed ones, so that split comes from Anime Filler List alone, as the brief asked. The site now shows both as Canon, so this split only matters in the data file.

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
- **All / Canon / Filler:** each option shows the right episodes, and a search with no matches shows an empty state.
- **Search:** case-insensitive title matches, number matches, and search combined with the filler filter.
- **Tracker:**
  - both progress counts
  - the next episode, with and without skipping filler
  - jumping to an episode that a filter or search is hiding
  - hiding watched episodes
  - watched episodes surviving a reload
  - reset with both confirm and cancel
- **Main screen and menu:**
  - the main screen holds only progress, search, the switcher and the list
  - the **⋯** menu opens with its rows
  - each item replaces the menu with its own sheet
  - **Escape** closes them
  - no "Shared" label or invitation banner appears when you're not sharing
- **Categories:** only the 90 filler episodes are tagged, so a *mixed* episode counts as canon.
- **Mark Several Episodes:**
  - marking a range, with and without filler
  - a reversed range (for example 40 to 35)
  - **Mark as Unwatched**
  - **Undo**
  - rejecting numbers outside 1–220
  - changes surviving a reload
- **Light and dark mode:** the page follows the device setting.
- **Guide:** ranges, counts, time saved and the map, and tapping a square jumps to that episode.
- **PWA:**
  - the service worker registers with the subpath scope and controls the page
  - the first visit doesn't trigger an unexpected reload
  - there is exactly one versioned cache holding every file the site needs
  - the manifest parses with no errors
  - Chrome's installability check reports no errors
- **Offline:** the site loads and works with the network off.
- **Always up to date:**
  - a change deployed to the server shows on the next open, with no version bump
  - the newest copy is used offline
  - the "has anything changed?" check (used when switching back to the app) answers correctly before and after a change
  - a new service worker takes over by itself and deletes the old cache
- **Install instructions** (simulated iPhone, Android and desktop):
  - an invite link opens the instructions on phones but not on desktop
  - the right steps show for each device, along with the code
  - **Maybe later**, **Escape** and **⋯ → Get the App** work
  - the invitation banner stays on the main screen and reopens the invite
  - on desktop, an invite opens Watch Together directly

- **Sharing switched off:** the card explains that sharing isn't set up (or, on `file://`, that it needs the hosted site).

`node tools/sync-test.js` tests sharing with two simulated devices against the local Firestore emulator. To run it:

```bash
npx firebase-tools emulators:start --only firestore --project demo-naruto-filler
```

Then, in a second terminal:

```bash
node tools/sync-test.js
```

It checks:

- **Create and join:** creating a list; joining through an invite link, and by pasting a code or the whole link into **Join with a Code**; the two devices' existing progress being merged; error messages for unknown and badly formed codes.
- **Shared label and banner:** the **Shared** label appears on the main screen and opens Watch Together, and the invitation banner shows until you join.
- **Live sync:** ticks and unticks going both ways, marking several episodes and **Undo** reaching the other device, and reset clearing the other device.
- **Offline:** changes made offline converging with the other device's changes after reconnecting, including a change made offline just before the app was closed.
- **Leave:** stopping sharing, and staying left after a reload.
- **Security rules:** listing rooms, malformed codes, unexpected fields, deletes, and other collections are all refused.

The last runs passed all 119 checks in `e2e-test.js` and all 38 in `sync-test.js`. Lighthouse 11 (the last version with a PWA category) scored **PWA 100, Accessibility 100, Best Practices 100, Performance 99** in light mode, and a scan of dark mode found no low-contrast text. Lighthouse also confirmed "Web app manifest and service worker meet the installability requirements". Lighthouse 12 and later no longer have a PWA category. In current Chrome, see **DevTools → Application → Manifest** for installability.

## Legal

This is an unofficial fan project. It isn't affiliated with or endorsed by Masashi Kishimoto, Shueisha, Studio Pierrot, TV Tokyo or VIZ Media. The logo and app icons show the Hidden Leaf village symbol from *Naruto*, redrawn for this site (`tools/make-icons.js`). The site uses no official artwork or character images. The symbol belongs to its owners, and it's used here only to identify the show. Episode titles are listed for identification only.
