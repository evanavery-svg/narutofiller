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
  - The main screen has your progress, the **up-next card**, search, the **All / Canon / Filler** control and the episode list grouped by arc.
  - Everything else is in the **⋯** menu at the top right: Mark Several Episodes, the Skip-Filler Guide, Watch Together, Get the App, the two settings, Reset Progress, and where the data comes from.
- **Light and dark mode.** These follow the phone or computer's own setting automatically.
- **Themes** (**⋯ → Theme**). **Naruto** (orange), **Akatsuki** (red, with faint red clouds), **Sharingan** (deep red, with faint tomoe), **Hidden Sand** (desert gold, with faint dunes) and **Hyūga** (lavender). A theme changes the accent color, the background tint, the logo, the Wrapped card and the share images, in both light and dark mode, and fades in when you switch. Each theme's text colors were checked for at least 4.5:1 contrast. The theme is saved on the device and applied before the page first draws, so there's no flash of orange.
- **Animations.** They're all CSS or small bits of JavaScript, with no libraries, and they switch off when the device's **Reduce Motion** setting is on.
  - **Up-next card:** a "WATCHED" or "SKIPPED" stamp lands on the card, the card flies off, the cards behind step forward, and a glint sweeps across the new one. With a mouse, the card tilts toward the pointer and catches the light.
  - **Ticking an episode:** the check draws itself and a ring bursts out. The progress bar springs forward with a sheen, and the number bumps.
  - **Stars and hearts:** stars pop in one after another, five stars sets off a small firework, and hearts beat.
  - **Panels:** they slide up when opened and back down when closed. The All / Canon / Filler selector has a sliding thumb.
  - **Arcs and rows:** arc sections unfold and fold smoothly, and rows and arcs rise in as they appear.
  - **Startup:** a Sharingan intro plays when the app opens (about 2 seconds). The eye opens, the three tomoe spin down to a stop, and you fly through it into the app.
    - Tap it to skip.
    - It plays once per launch, not on reloads or automatic updates.
    - **⋯ → Startup animation** turns it off.
  - **Logo:** the leaf draws itself when the app opens. Tap it for a spin.
  - **Elsewhere:** the Skip-Filler Guide's map fills in as a wave, and Naruto Wrapped and the arc-complete card build in piece by piece.
- **Up-next card.** A big card shows the next episode to watch: its arc, number and title, colored **green for canon** and **red for filler**. Two more cards peek out behind it, like a deck.
  - **Watched** flips the card away to the right and brings up the next one.
  - **Skip** flips it away to the left and marks the episode as *skipped*. It won't come back, and it isn't counted as watched.
  - Both show a message with **Undo**.
  - Tapping the card shows that episode in the list.
  - When everything's done, an "All caught up!" card appears.
- **Episodes grouped by arc.** The list is split into the story arcs (Land of Waves, Chūnin Exams, Konoha Crush, Search for Tsunade, Sasuke Recovery Mission) and the filler missions after them, in order. Each section shows its episode range, whether it's a canon or filler arc (green or red dot), and your progress ("6/48", or "Done").
  - The arc you're up to opens by itself, and finished arcs fold away.
  - Tap a section to open or close it; that choice is remembered.
  - A search opens every section with a match.
- **Your name.** The first time the app opens, it asks for your first name. It's what the people you share a list with see. You can skip it, and change it anytime in **⋯ → Your Name**.
- **5-star ratings and favorites** (your own, even on a shared list):
  - After **Watched** on the up-next card, a "Rate Ep 27 ★★★★★ ♥" bar appears for a few seconds.
  - Every episode row has an **ⓘ** button that opens its details, where you can rate it, favorite it, or change its status (Not Watched, Watched, Skipped).
  - Rated and favorite episodes show their stars and a heart in the list, and each arc shows your average rating.
  - **⋯ → Ratings & Favorites** lists your top-rated episodes (best first) and your favorites. Tap one to open it.
- **Episode details.** The **ⓘ** panel shows the episode's arc, which manga chapters it adapts (or "anime-only" for filler), when it was marked watched, and, on a shared list, the other people's ratings and favorites ("Sara ★★★★★ ♥"). There are no plot summaries: the only sources are the wiki's spoiler-heavy synopses, which aren't ours to copy.
- **Notes and reactions.** In an episode's **ⓘ** details, react with one of 🔥 😭 😂 😮 😡 💤 (hype, sad, funny, shocked, angry, boring) and leave a short note (up to 280 characters).
  - Reactions show next to the episode in the list, and a small speech bubble means someone left a note.
  - On a shared list, everyone sees everyone else's reactions and notes in the details panel, and the activity line adds the other person's reaction ("Sara watched Ep 45 😭 · 2h ago").
  - With the spoiler shield on, other people's notes on episodes you haven't watched are blurred until you tap **Show title**.
  - **⋯ → Ratings & Favorites** lists every episode with a note or reaction.
- **Watch calendar and streaks** (**⋯ → Watch Calendar**, or tap the 🔥 chip next to your progress).
  - A heatmap of the last 18 weeks: the more episodes you watched that day, the deeper the orange. Tap a day to see what you watched (and, on a shared list, what the others watched).
  - **Day streak** counts the days in a row you watched something. It lasts until you miss a whole day. The 🔥 chip turns gray when you haven't watched anything yet today, so the streak is about to end.
  - Also shows your longest streak and how many days you've watched. On a shared list, everyone's streaks.
  - A day counts only for episodes marked one at a time. **Mark Several** doesn't count, since those are usually episodes you watched before using the app.
- **Ninja rank and badges** (tap your rank next to your progress, or **⋯ → Rank & Badges**).
  - Your rank goes up with the canon episodes you've watched: Academy Student, Genin (10), Chūnin (40), Jōnin (75), ANBU (100), Kage (120) and Hokage (all 130). Reaching a new rank with a single tick shows confetti and a forehead protector whose band color changes with each rank.
  - 17 badges: your first episode; finishing each of the five canon arcs; 3-, 7- and 30-day streaks; 5 episodes in a day; rating 25 episodes; reacting to 10; skipping 10 filler; watching 25 filler; sharing 10 episodes with someone on your list; every canon episode; and all 220. A banner pops up when you earn one.
  - Badges stay earned even if you unmark episodes later. With the spoiler shield on, badges for arcs you haven't started hide their names.
  - On a shared list, **Your Team** shows everyone's rank and badge count.
- **Plan Tonight** (the button under the up-next card, or **⋯ → Plan Tonight**). Pick how much time you have (30 minutes to 3 hours) and it lines up the next episodes that fit, at about 23 minutes each, and shows when you'll be done. It skips filler when **Skip filler when continuing** is on. **Mark All Watched** marks them one at a time, so they count toward your streak, with **Undo**.
- **Opening and ending songs.** Each episode's details show its opening and ending ("OP 2 · Haruka Kanata"), and the up-next card flags an episode with a new one ("🎵 New opening: GO!!!"). **⋯ → Openings & Endings** lists all 9 openings and 15 endings with their artists and episodes, marks the ones playing where you are, jumps to a song's first episode when you tap it, and ▶ searches YouTube for it.
- **Time left and finish estimate.** Under your progress: "42h 33m of canon left · about 3 a day · done with canon around Dec 20".
  - Time left counts the episodes still ahead of you, at about 23 minutes each.
  - The pace uses the episodes you've marked one at a time in the last two weeks; **Mark Several** and other bulk changes don't count.
  - It says "the series" instead of "canon" when **Skip filler when continuing** is off.
- **Spoiler shield.** Turn it on in the **⋯** menu to blur the titles of episodes you haven't watched: in the list, on the up-next card, in **Ratings & Favorites**, and in the map's tooltips. It also blurs the names of arcs you haven't started (no episode watched or skipped yet): in the list's arc headers, on the up-next card and in an episode's details. The finished-arc card says "Next up: the next arc" instead of naming it.
  - The first tap on the up-next card reveals its title.
  - The details (**ⓘ**) panel has a **Show title** button.
  - Watched titles stay readable.
- **Arc complete.** Finishing an arc with a single tick, on the card, a row or in the details, shows confetti and a card ("Land of Waves complete! 19 episodes watched · your average ★ 4.0. Next up: Chūnin Exams."). Marking many at once doesn't celebrate. While skipping filler, an arc counts as finished once its canon episodes are done.
- **Naruto Wrapped** (**⋯** menu). A summary card you can share:
  - episodes, hours and days watched
  - your top-rated episodes and favorite arc (your best-rated, or the one you watched most)
  - your longest streak, biggest binge (most episodes in one day) and go-to reaction
  - on a shared list, how many ratings you agree on with each person, and your biggest debate
- **Share images.** **Share Image** on Wrapped, **Share My Rank** in Rank & Badges, tapping an earned badge, or **Share** on a rank-up celebration makes a 1080 × 1920 picture (the size of an Instagram or iMessage story) in your theme's colors: your stats with your headband, your rank with progress to the next one, or the badge. A preview opens with **Share** (the phone's share sheet, where the device can share images) and **Save Image**. Wrapped can still share as text too.
- **Backup** (**⋯ → Save a Backup / Restore from Backup**). Saves your progress (with the dates, for the calendar), skips, ratings, favorites, notes and name to a `.json` file, and restores it later. Restoring asks first, and on a shared list your restored progress syncs.
- **Partner activity.** While you share a list, a small line under your progress shows what the other person watched last ("Sara watched Ep 45 · 2h ago"). Tap it to open that episode.
- **The race.** On a shared list, bars under your progress compare everyone's canon episodes ("Sara is 3 canon episodes ahead"). Tap it for everyone's rank.
- **Just Me / With Sara.** On a shared list, a switch above the up-next card picks whose next episode it shows. **With Sara** shows the next episode none of you has watched or skipped, says which earlier ones you still need on your own, and marks it for everyone when you tap **Watched** or **Skip** (**Undo** takes it back for everyone). **Plan Tonight** follows the same switch.
- **Who watched it.** On a shared list, everyone keeps their own progress:
  - Ticking marks an episode for you only, and **Continue** (the up-next card) follows your progress.
  - Episodes the others watched show their initial on the row.
  - The up-next card says "Sara already watched it".
  - Each episode's details show everyone's status, with a button to mark it for them.
- **Color-coded episodes.** Every row has a green (canon) or red (filler) stripe and episode number. Filler episodes also get a red **Filler** tag. Skipped episodes show a dash in their circle.
- **All / Canon / Filler.** A segmented control above the list shows everything, only canon, or only filler.
- **Search.** One box that matches the episode number (`135`, `#135`, `ep 135`) or any part of the title. It ignores case and updates as you type. It works together with the filters.
- **Watch tracker.**
  - A round checkbox on each episode, saved in `localStorage`. Tapping anywhere on the row (the number or title too) ticks it.
  - Progress headline and bar for **canon** episodes ("29 of 130 canon watched"), with the all-episodes count ("30 of 220 total") and how many you skipped underneath.
  - The **Skip filler when continuing** switch (in the **⋯** menu, on by default) controls whether filler episodes appear in the up-next card at all.
  - If the All / Canon / Filler control or the search hides an episode you jump to, they change so you can see it.
  - **Mark Several Episodes** (in the **⋯** menu): pick a range (for example 1 to 80) and mark it all as watched or unwatched at once, optionally skipping filler. A message with **Undo** confirms it.
  - A **Hide watched episodes** switch (in the **⋯** menu).
  - **Reset Progress** (in the **⋯** menu), which asks you to confirm first.
- **Watch together.** Two (or more) people can share their watch progress through a free Firebase database: each person's ticks and skips, plus names, ratings and activity, show up on the others' phones within a second or two, and changes made offline sync later.
  - Watched one together? Tap **"Sara watched it too"** in the rating bar after **Watched**.
  - If you always watch together, turn on **We always watch together** (in Watch Together). Then everything you mark counts for everyone, like one shared list. It's off until you add your own Firebase project; see [Shared progress (Firebase)](#shared-progress-firebase). It lives in the **⋯** menu. While you're sharing, a small **Shared** label next to your progress shows the sync status, and tapping it opens Watch Together.
- **Skip-filler guide.** A separate page (in the **⋯** menu) that lists the episodes to watch, collapsed into ranges, and the episodes to skip, with a map showing which to watch. Watch **1–25, 27–96, 98–100, 107–135, 141–142, 220** (130 episodes) and skip the 90 filler episodes, which saves about **34 h 30 min** at about 23 minutes per episode.
- **PWA.** You can install it on a phone or desktop. Every file is saved on the first visit, so the whole app then works offline.
- **Get the app.** **Get the App** in the **⋯** menu shows step-by-step install instructions for the device you're on (iPhone/iPad, Android or desktop). They also pop up by themselves when someone opens a Watch together invite link on a phone.
- **Share This App** (**⋯** menu). On a phone it opens the share sheet with the app's link; on a computer it copies the link. It shares the address the app is opened from, or https://evanavery-svg.github.io/narutofiller/ when it's opened as a local file (set as `APP_URL` in `app.js`).
- **Version number.** The bottom of the page shows the version (currently **0.1**). It's plain text in `index.html`.
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
  validate-data.js    checks there are exactly 220 episodes numbered 1–220, every one has an arc, and the
                      theme songs cover 1–220 with no gaps; prints counts per type
  make-icons.js       draws the leaf logo, regenerates the icons and the logo in the page header (needs Playwright)
  e2e-test.js         end-to-end browser test (needs Playwright)
  monkey-test.js      random-action test: hundreds of random taps, checking the screen matches the saved data
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

### Updating the rules for names, ratings and activity

If you set up Firebase before names and ratings were added, publish the rules once more:

1. In the Firebase console, open **Firestore → Rules**.
2. Select everything (**Ctrl+A** / **Cmd+A**) and delete it.
3. Paste the full contents of [`firestore.rules`](firestore.rules), then click **Publish**.

The new rules also allow a `members` field: each person's name, ratings, favorites and latest episode, for at most 10 people per list. Until you publish them, the watched list keeps syncing, but names, ratings and activity aren't shared. **Watch Together** shows a short note about it.

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

- Everyone keeps their **own progress**. A tick marks the episode for you, and the others see your initial on that row. The up-next card follows your progress.
- **Watched one together?** After **Watched** on the card, tap **"Sara watched it too"**. Or open the episode's **ⓘ** details and tap **Mark watched** next to her name.
- **We always watch together** (a switch in Watch Together, set on each phone): while it's on, every tick, skip, **Mark Several** and **Reset Progress** on that phone counts for everyone on the list.
- Each person's name, star ratings, favorites and latest episode are shared too. Ratings stay per person: you see the other's next to yours in an episode's **ⓘ** details, and "Sara watched Ep 45" shows under your progress.
- Changes show up on the other devices usually within a second or two.
- **Older lists** (from before per-person progress) carry over automatically: the first time each phone connects with the new version, the list's progress becomes that person's own. No new security rules are needed.
- Each phone counts as its own person, so someone who uses two devices shows up twice.
- The status dot shows **Synced**, **Saving…**, or **Offline · will sync later**.
- If you tick episodes with no connection, or even close the app before reconnecting, the changes are saved on the phone and sent the next time it opens online. When both people changed the same episode, the most recent change wins.
- **Leave** (tap twice) stops sharing on that device. Your progress stays, but later ticks are no longer shared. You'll need the code to rejoin.
- The installed app still works fully offline. The Firebase code downloads only once you're on a shared list, and the rest of the app never depends on it.
- Sharing doesn't work when you open `index.html` directly as a file. Use the hosted site.

### Privacy and limits

- **The code works like a password.** Anyone with your code or invite link can see and change that list. Nobody can browse the database to find codes: the rules block listing, and codes are random 16-character strings with about 79 bits of randomness. To revoke access, both of you **Leave**, create a new list, and optionally delete the old document under `rooms` in the Firebase console.
- **Only watch data and first names are stored.** Each list is one document. For each person it holds the first name they entered, their watched/skipped episodes with when each changed, their star ratings, favorites, reactions and notes, how many badges they have, and their latest episode. There are no emails or accounts.
- **Free plan limits.** At the time of writing, the Spark plan's free quota for a Standard database is 50,000 document reads, 20,000 writes and 20,000 deletes per day, plus 1 GiB of storage ([current limits](https://firebase.google.com/docs/firestore/quotas)). Two people ticking episodes use a tiny fraction of that. Because the project has no billing account, it can't charge you. If a limit were ever reached, sync requests would be refused until the quota resets (daily, around midnight Pacific time), and the app would keep working on each device.
- **Phone clocks matter.** "Most recent change wins" uses each device's clock. If a phone's clock is badly wrong, its changes might win when they shouldn't. Normal automatic phone time is fine.
- **Optional extra lock-down.** In the [Google Cloud console](https://console.cloud.google.com/apis/credentials) for the same project, you can restrict the browser API key to your site with an HTTP referrer restriction such as `https://<username>.github.io/*`.

## Data sources

- **Main source:** [Anime Filler List: Naruto](https://www.animefillerlist.com/shows/naruto), retrieved 2026-11-12. Every episode's number, title and type comes from its episode table. The table also matches the summary range lists at the top of the same page exactly.
- **Cross-check:** the [Naruto Fandom wiki](https://naruto.fandom.com/wiki/List_of_Animated_Media). Each of the 220 episode pages has an infobox field (`chapters`) listing the manga chapters the episode adapts. An episode with no chapters listed is anime-original.

**Theme songs** come from the Fandom wiki too: each episode page's `opening song` and `ending song` fields (retrieved 2026-11-14), with each song's page for its Japanese title and artist. They're stored as ranges in `SONGS` at the end of `data/episodes.js`. Episode 161's page lists no songs; it falls inside the ranges the song pages give (opening 7, ending 11).

**Manga chapters** for each episode also come from the Fandom wiki (each episode page's `chapters` field). The 90 filler episodes have none.

**Arcs** come from the Fandom wiki: each episode page names its arc. Names are shortened ("Chūnin Exams (Arc)" → "Chūnin Exams", "Prologue — Land of Waves" → "Land of Waves"). The 14 episodes with no arc listed are grouped as "Standalone". A section counts as a filler arc when most of its episodes are filler. Three mixed episodes sit at the start of filler arcs: 141 (Land of Rice Fields Investigation Mission), 142 (Mizuki Tracking Mission) and 220 (Sunagakure Support Mission).

Type mapping in `data/episodes.js`: *Manga Canon* → `canon`, *Mixed Canon/Filler* → `mixed`, *Filler* → `filler`, *Anime Canon* → `anime-canon`. The site then shows `filler` as **Filler** and everything else as **Canon**.

To check the data file yourself, run `node tools/validate-data.js`:

```
Episodes: 220
  canon        74
  mixed        56
  filler       90
  anime-canon  0
Arcs: 23 (14 standalone episodes)

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

- **Data:** each type's episode list matches Anime Filler List's published range lists, every episode has an arc, and the openings and endings cover 1–220 (`node tools/validate-data.js`).
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
  - the main screen holds only progress, the up-next card, search with the switcher, and the list
  - the **⋯** menu opens with its rows
  - each item replaces the menu with its own sheet
  - **Escape** closes them
  - no "Shared" label or invitation banner appears when you're not sharing
- **Up-next card:**
  - it shows the right next episode, with and without skipping filler
  - green for canon and red for filler
  - the cards behind it
  - **Skip** marks the episode skipped but not watched
  - **Watched** ticks it
  - **Undo** works for both
  - tapping a skipped episode marks it watched
  - tapping the card reveals the episode in the list, even past a filter or search
- **Arcs:**
  - 32 sections in order, with the right names, ranges and canon/filler kind, and progress per arc
  - finished arcs fold and the current arc opens
  - tapping a header toggles it, and the choice is remembered
  - a search opens matching sections, and **Filler** hides canon-only arcs
- **Categories:** only the 90 filler episodes are tagged, so a *mixed* episode counts as canon.
- **Mark Several Episodes:**
  - marking a range, with and without filler
  - a reversed range (for example 40 to 35)
  - **Mark as Unwatched**
  - **Undo**
  - rejecting numbers outside 1–220
  - changes surviving a reload
- **Light and dark mode:** the page follows the device setting.
- **Startup animation:**
  - it plays on launch, and the welcome screen waits for it
  - it's gone within about 2 seconds, and a tap skips it
  - it doesn't replay on a reload, but does on the next launch
  - the menu switch and Reduce Motion both turn it off
- **Animations:**
  - the selector's thumb follows the choice
  - **Watched** stamps the card before it flies, and the next card comes up
  - with Reduce Motion on, the card changes at once and nothing animates
- **Your name:**
  - the first launch asks for it, and **Not Now** isn't asked again
  - **⋯ → Your Name** changes it
  - on a new phone opening an invite, the name comes first, then the install steps
- **Ratings, favorites and details:**
  - the **ⓘ** button opens details without ticking the row
  - stars show on the row and as the arc average, and tapping the same star clears it
  - favorites show a heart, and the status can be changed from the panel
  - filler shows "anime-only"
  - **Ratings & Favorites** sorts best first, and everything survives a reload
  - the "Rate Ep N" bar appears after **Watched** and goes away after rating
- **Finish estimate:** time left always shows; the pace appears after a few episodes marked one at a time, but not after **Mark Several** alone.
- **Spoiler shield:**
  - unwatched titles blur while watched ones don't
  - the up-next card reveals its title on the first tap
  - the details panel's **Show title** works
  - turning it off shows everything
  - names of arcs you haven't started blur, and started ones don't
  - details blur the arc name too, and **Show title** reveals it
  - watching an episode reveals its arc's name, and unwatching blurs it again
- **Notes and reactions:**
  - six reactions and a note field in the details
  - one reaction at a time, and tapping it again clears it
  - the row shows the reaction and a note icon
  - notes are saved, still there after a reload, and listed in **Ratings & Favorites** and Wrapped
- **Watch calendar and streaks** (a made-up history):
  - the 🔥 chip shows a 3-day streak and opens the calendar
  - current, longest and days-watched counts, and 18 weeks of days
  - today is shaded and selected, and tapping a day lists its episodes, leaving out **Mark Several**
  - an empty day says so, and the calendar fits a phone screen
  - nothing watched today keeps the streak but marks it at risk, and watching brings it back
  - Wrapped shows the longest streak and biggest binge
- **Rank and badges:**
  - 9 canon episodes is Academy Student, and the 10th from the card celebrates "Rank up: Genin!" with the headband
  - the rank sheet shows the rank, what's next, where you are on the ladder, and 17 badges
  - badges already earned when the app opens are saved quietly; a new one pops up above an open sheet, and tapping the banner opens Rank & Badges
  - badges stay earned after unticking, and with the shield on, unstarted arcs' badges hide their names
- **Plan Tonight:** 1 hour is 2 episodes and 2 hours is 5, it says when you'll be done, marking them counts toward today's streak (one at a time), **Undo** works, and it remembers the time you picked.
- **Theme songs:** the card flags a new opening, details show the opening and ending, the list has 9 openings and 15 endings with the current ones marked, ▶ links to a YouTube search, and tapping a song jumps to its first episode.
- **Themes:** Naruto by default; picking Akatsuki recolors the app, adds the pattern, changes the browser bar color and updates the menu; it's kept after a reload; and switching back to Naruto restores everything.
- **Share images:** Wrapped, rank and badge cards are 1080 × 1920 and use the theme's colors; **Share** appears only where the device can share images; **Save Image** downloads a PNG; only earned badges are buttons; and a rank-up celebration offers **Share**.
- **Naruto Wrapped:** the stats, top episode and favorite arc.
- **Backup:**
  - the saved file contains progress, ratings, favorites and notes
  - after clearing, restoring asks first, shows a summary and brings everything back
  - other files are refused
- **Arc complete:** finishing Land of Waves with a single tick celebrates and names the next arc, while **Mark Several** doesn't.
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

`node tools/monkey-test.js [seed] [steps]` does hundreds of random actions against a local server (`python3 -m http.server 8000`) and checks after each one that the screen matches the saved data. It also leaves random reactions and notes, opens the calendar, rank and song lists, plans tonight, switches themes, makes share images, and checks that the rank matches the canon count. Twenty-seven runs of 200–250 steps each found no mismatches and no JavaScript errors.

**Speed.** Measured with the CPU slowed 4× (roughly a mid-range phone), every tap responds in under about 100 ms. Typing in search went from 360 ms to 80 ms, and opening the Skip-Filler Guide from 232 ms to 64 ms. What makes the difference:
- Rows animate only when an arc unfolds, not whenever a filter or search shows them again.
- The guide's map sweeps in as one piece.
- Off-screen arcs aren't drawn until you scroll to them (`content-visibility`); jumping to an episode draws everything briefly so the scroll lands on the right spot.
- Search redraws at most once per screen frame.
- The list is re-filtered only when something it depends on changes.

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
- **Who watched it:**
  - after joining, each phone keeps its own progress and sees the other's initials
  - the up-next card says who already watched it
  - a solo tick stays solo
  - "Ana watched it too" and the details' **Mark watched** button mark it for the other person
- **We always watch together:** with it on for both phones, every check below (live sync, bulk, skips, offline, reset) behaves like one shared list.
- **Older lists:** an old single-list room carries over as the joining person's own progress.
- **People:**
  - each device's name, and what each person watched last, reaches the other device
  - ratings and favorites stay per person, and each sees the other's on the episode details
  - a name change reaches the other device
  - reactions and notes reach the other device (in the list and the details), the spoiler shield blurs a note on an episode you haven't seen, and the calendar shows everyone's streaks
- **Race and the shared card:**
  - the race shows on both devices and says who's ahead
  - **With Ana** skips what Ana has seen, says what you still need on your own, and **Watched** (and **Undo**) reach Ana
  - **Plan Tonight** plans for both and marks for both
  - the rank sheet shows Ana's rank
  - the rules refuse lists with more than 10 people
- **Live sync:** ticks and unticks going both ways, skipping from the up-next card (and **Undo**) reaching the other device, marking several episodes and **Undo** reaching the other device, and reset clearing the other device.
- **Offline:** changes made offline converging with the other device's changes after reconnecting, including a change made offline just before the app was closed.
- **Leave:** stopping sharing, and staying left after a reload.
- **Security rules:** listing rooms, malformed codes, unexpected fields, deletes, and other collections are all refused.

The last runs passed all 291 checks in `e2e-test.js` and all 78 in `sync-test.js`. Lighthouse 11 (the last version with a PWA category) scored **PWA 100, Accessibility 100, Best Practices 100, Performance 95** in light mode (performance was 97–99 before the startup animation, which covers the first two seconds), and a scan of dark mode found no low-contrast text. Lighthouse also confirmed "Web app manifest and service worker meet the installability requirements". Lighthouse 12 and later no longer have a PWA category. In current Chrome, see **DevTools → Application → Manifest** for installability.

## Legal

This is an unofficial fan project. It isn't affiliated with or endorsed by Masashi Kishimoto, Shueisha, Studio Pierrot, TV Tokyo or VIZ Media. The logo and app icons show the Hidden Leaf village symbol from *Naruto*, redrawn for this site (`tools/make-icons.js`), and the startup animation is a Sharingan drawn as inline SVG in `index.html`. The site uses no official artwork or character images. The symbols belong to their owners, and they're used here only to identify the show. Episode titles are listed for identification only.
