/* Naruto Filler Guide — vanilla JS, no dependencies.
 * Expects a global `EPISODES` array from data/episodes.js.
 */
(function () {
  "use strict";

  // ---------- Constants ----------
  var TOTAL = EPISODES.length;
  var MINUTES_PER_EPISODE = 23;
  // The site shows just two categories. data/episodes.js keeps Anime Filler List's
  // finer types; "mixed" (and "anime-canon", of which there are none) count as canon,
  // because those episodes adapt the manga's story.
  var TYPES = [
    { id: "canon", label: "Canon", long: "Canon",
      desc: "Tells the manga's story, sometimes with a few anime-only scenes added. Watch these." },
    { id: "filler", label: "Filler", long: "Filler",
      desc: "Anime-only story that isn't in the manga. Safe to skip." }
  ];
  var TYPE_BY_ID = {};
  TYPES.forEach(function (t) { TYPE_BY_ID[t.id] = t; });
  function kindOf(ep) { return ep.type === "filler" ? "filler" : "canon"; }

  var STORAGE = {
    watched: "naruto-filler:watched:v1",
    prefs: "naruto-filler:prefs:v1",
    changed: "naruto-filler:changed:v1", // { episodeNumber: last-change time in ms }
    room: "naruto-filler:room:v1"        // shared list code, if any
  };

  // ---------- Storage (fails soft, e.g. in private mode) ----------
  function load(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  // ---------- State ----------
  var watched = new Set(
    (load(STORAGE.watched, []) || []).filter(function (n) {
      return Number.isInteger(n) && n >= 1 && n <= TOTAL;
    })
  );
  var defaultPrefs = {
    types: TYPES.map(function (t) { return t.id; }),
    hideWatched: false,
    skipFillerNext: true,
    tab: "episodes"
  };
  var prefs = Object.assign({}, defaultPrefs, load(STORAGE.prefs, {}));
  var activeTypes = new Set(prefs.types.filter(function (t) { return TYPE_BY_ID[t]; }));
  // Older versions had four types; if none of the saved ones still exist, show everything.
  if (!activeTypes.size && prefs.types.length) activeTypes = new Set(defaultPrefs.types);
  var query = "";

  function savePrefs() {
    prefs.types = Array.from(activeTypes);
    save(STORAGE.prefs, prefs);
  }
  function saveWatched() {
    save(STORAGE.watched, Array.from(watched).sort(function (a, b) { return a - b; }));
    save(STORAGE.changed, changedAt);
  }

  // When each episode was last ticked/unticked on this device (or by a shared-list
  // partner). Used to merge shared lists: the most recent change to an episode wins.
  var changedAt = (function () {
    var raw = load(STORAGE.changed, {}) || {};
    var out = {};
    Object.keys(raw).forEach(function (k) {
      var n = Number(k);
      if (Number.isInteger(n) && n >= 1 && n <= TOTAL && typeof raw[k] === "number") out[n] = raw[k];
    });
    return out;
  })();
  var lastStamp = 0;
  Object.keys(changedAt).forEach(function (k) { lastStamp = Math.max(lastStamp, changedAt[k]); });
  function stamp() { // strictly increasing on this device
    lastStamp = Math.max(Date.now(), lastStamp + 1);
    return lastStamp;
  }

  /** Records local changes and sends them to the shared list (if any). */
  function recordChanges(numbers) {
    var t = stamp();
    var entries = {};
    numbers.forEach(function (n) {
      changedAt[n] = t;
      entries[n] = { w: watched.has(n), t: t };
    });
    saveWatched();
    if (sync.controller) sync.controller.push(entries);
  }

  // ---------- Helpers ----------
  var $ = function (id) { return document.getElementById(id); };

  function normalize(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  /** Collapse sorted episode numbers into ranges: [[1,25],[27,96],...] */
  function toRanges(numbers) {
    var ranges = [];
    numbers.forEach(function (n) {
      var last = ranges[ranges.length - 1];
      if (last && n === last[1] + 1) last[1] = n;
      else ranges.push([n, n]);
    });
    return ranges;
  }
  function rangeLabel(r) { return r[0] === r[1] ? String(r[0]) : r[0] + "–" + r[1]; }

  function formatDuration(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    if (!h) return m + " min";
    return h + " h" + (m ? " " + m + " min" : "");
  }

  var toastTimer;
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  // Precomputed search text per episode
  var searchIndex = EPISODES.map(function (ep) { return normalize(ep.title); });

  // ---------- Build static UI ----------
  function buildFilters() {
    var wrap = $("filters");
    TYPES.forEach(function (t) {
      var count = EPISODES.filter(function (e) { return kindOf(e) === t.id; }).length;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter";
      btn.dataset.type = t.id;
      btn.setAttribute("aria-pressed", String(activeTypes.has(t.id)));
      btn.title = t.long + ": " + t.desc;
      btn.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="label"></span><span class="count"></span>';
      btn.querySelector(".label").textContent = t.label;
      btn.querySelector(".count").textContent = count;
      btn.addEventListener("click", function () {
        if (activeTypes.has(t.id)) activeTypes.delete(t.id); else activeTypes.add(t.id);
        btn.setAttribute("aria-pressed", String(activeTypes.has(t.id)));
        savePrefs();
        applyFilters();
      });
      wrap.appendChild(btn);
    });
  }

  function buildLegend() {
    var dl = $("legend-list");
    TYPES.forEach(function (t) {
      var item = document.createElement("div");
      item.className = "legend-item";
      var dt = document.createElement("dt");
      var badge = document.createElement("span");
      badge.className = "badge badge--" + t.id;
      badge.textContent = t.label;
      dt.appendChild(badge);
      var dd = document.createElement("dd");
      dd.textContent = t.long + ". " + t.desc;
      item.appendChild(dt);
      item.appendChild(dd);
      dl.appendChild(item);
    });
  }

  var rows = []; // index-aligned with EPISODES
  var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function buildList() {
    var list = $("episode-list");
    var frag = document.createDocumentFragment();
    EPISODES.forEach(function (ep) {
      var kind = kindOf(ep);
      var t = TYPE_BY_ID[kind];
      var li = document.createElement("li");
      li.className = "episode";
      li.id = "ep-" + ep.number;
      li.dataset.type = kind;

      var label = document.createElement("label");
      label.className = "ep-check";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.number = ep.number;
      input.setAttribute("aria-label", "Watched episode " + ep.number + ": " + ep.title);
      var box = document.createElement("span");
      box.className = "box";
      box.innerHTML = CHECK_SVG;
      label.appendChild(input);
      label.appendChild(box);

      var num = document.createElement("span");
      num.className = "ep-number";
      num.textContent = ep.number;

      var main = document.createElement("div");
      main.className = "ep-main";
      var title = document.createElement("p");
      title.className = "ep-title";
      title.textContent = ep.title;
      var badge = document.createElement("span");
      badge.className = "badge badge--" + kind;
      badge.textContent = t.label;
      badge.title = t.long;
      main.appendChild(title);
      main.appendChild(badge);

      li.appendChild(label);
      li.appendChild(num);
      li.appendChild(main);
      frag.appendChild(li);
      rows.push({ li: li, input: input });
    });
    list.appendChild(frag);

    // One delegated listener for all checkboxes
    list.addEventListener("change", function (e) {
      var input = e.target;
      if (!input.matches('input[type="checkbox"]')) return;
      var n = Number(input.dataset.number);
      if (input.checked) watched.add(n); else watched.delete(n);
      recordChanges([n]);
      syncRow(n - 1);
      if (input.checked) pop(input.nextElementSibling);
      updateProgress();
      if (prefs.hideWatched) applyFilters();
    });
  }

  function pop(el) {
    el.classList.remove("pop");
    void el.offsetWidth; // restart the animation
    el.classList.add("pop");
  }

  // ---------- Episode maps (one square per episode) ----------
  var mapCells = { progress: [], guide: [] };
  function buildMap(container, cells) {
    var frag = document.createDocumentFragment();
    EPISODES.forEach(function (ep) {
      var cell = document.createElement("span");
      cell.className = "cell";
      cell.dataset.type = kindOf(ep);
      cell.dataset.n = ep.number;
      cell.title = "Ep " + ep.number + " · " + ep.title + " (" + TYPE_BY_ID[kindOf(ep)].long + ")";
      frag.appendChild(cell);
      cells.push(cell);
    });
    container.appendChild(frag);
    // Tap a square to jump to that episode (the list itself is the accessible route)
    container.addEventListener("click", function (e) {
      var n = Number(e.target.dataset && e.target.dataset.n);
      if (n) jumpTo(EPISODES[n - 1]);
    });
  }
  function updateProgressMap(next) {
    for (var i = 0; i < TOTAL; i++) {
      var c = mapCells.progress[i];
      c.classList.toggle("is-on", watched.has(i + 1));
      c.classList.toggle("is-next", !!next && next.number === i + 1);
    }
  }

  function syncRow(i) {
    var on = watched.has(EPISODES[i].number);
    rows[i].input.checked = on;
    rows[i].li.classList.toggle("is-watched", on);
  }

  // ---------- Filtering + search ----------
  function matchesQuery(i) {
    if (!query) return true;
    var ep = EPISODES[i];
    // "12", "#12", "ep 12", "episode 12" all match episode 12 exactly
    var numMatch = query.match(/^(?:#|ep\.?|episode)?\s*(\d+)$/);
    if (numMatch && Number(numMatch[1]) === ep.number) return true;
    return searchIndex[i].indexOf(query) !== -1;
  }

  function isVisible(i) {
    var ep = EPISODES[i];
    if (!activeTypes.has(kindOf(ep))) return false;
    if (prefs.hideWatched && watched.has(ep.number)) return false;
    return matchesQuery(i);
  }

  function applyFilters() {
    var shown = 0;
    for (var i = 0; i < TOTAL; i++) {
      var vis = isVisible(i);
      rows[i].li.hidden = !vis;
      if (vis) shown++;
    }
    $("result-count").textContent = shown === TOTAL
      ? "Showing all " + TOTAL + " episodes"
      : "Showing " + shown + " of " + TOTAL + " episodes";
    $("empty-state").hidden = shown !== 0;
  }

  // ---------- Progress + next episode ----------
  var canonEpisodes = EPISODES.filter(function (e) { return kindOf(e) === "canon"; });

  function nextEpisode() {
    for (var i = 0; i < TOTAL; i++) {
      var ep = EPISODES[i];
      if (watched.has(ep.number)) continue;
      if (prefs.skipFillerNext && ep.type === "filler") continue;
      return ep;
    }
    return null;
  }

  function setBar(id, value, max) {
    var bar = $(id);
    bar.style.width = (max ? (value / max) * 100 : 0) + "%";
    bar.setAttribute("aria-valuenow", String(value));
    bar.setAttribute("aria-valuemax", String(max));
  }

  function updateProgress() {
    var total = watched.size;
    var canon = canonEpisodes.filter(function (e) { return watched.has(e.number); }).length;
    var pct = Math.round((total / TOTAL) * 100);
    $("progress-all-text").textContent = total + " / " + TOTAL + " (" + pct + "%)";
    $("progress-canon-text").textContent = canon + " / " + canonEpisodes.length;
    setBar("progress-all-bar", total, TOTAL);
    setBar("progress-canon-bar", canon, canonEpisodes.length);
    $("progress-ring").style.setProperty("--p", String((total / TOTAL) * 100));
    $("ring-value").textContent = pct + "%";

    var next = nextEpisode();
    updateProgressMap(next);
    $("next-hint").textContent = next
      ? "Ep " + next.number + " · " + next.title
      : (prefs.skipFillerNext ? "All non-filler episodes watched!" : "You've watched everything!");

    var n = watched.size;
    $("reset-question").textContent = n
      ? "Clear all " + n + " watched episode" + (n === 1 ? "" : "s") +
        (sync.roomId ? " for everyone on the shared list" : "") + "? This can't be undone."
      : "Nothing to reset yet.";
    $("reset-yes").hidden = n === 0;
  }

  function jumpToNext() {
    var ep = nextEpisode();
    if (!ep) {
      toast(prefs.skipFillerNext ? "No unwatched non-filler episodes left." : "You've watched every episode!");
      return;
    }
    jumpTo(ep);
  }

  /** Scrolls the list to an episode, adjusting filters/search if they hide it. */
  function jumpTo(ep) {
    var i = ep.number - 1;
    if (prefs.tab !== "episodes") selectTab("episodes");
    // Make sure the target is visible: clear search / enable its type if needed.
    if (!isVisible(i)) {
      if (prefs.hideWatched && watched.has(ep.number)) {
        prefs.hideWatched = false;
        $("hide-watched").checked = false;
        savePrefs();
      }
      if (!matchesQuery(i)) { $("search").value = ""; query = ""; }
      if (!activeTypes.has(kindOf(ep))) {
        activeTypes.add(kindOf(ep));
        var btn = document.querySelector('.filter[data-type="' + kindOf(ep) + '"]');
        if (btn) btn.setAttribute("aria-pressed", "true");
        savePrefs();
      }
      applyFilters();
      toast("Filters adjusted to show episode " + ep.number);
    }
    var li = rows[i].li;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    li.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    li.classList.remove("is-highlight");
    void li.offsetWidth; // restart animation
    li.classList.add("is-highlight");
    rows[i].input.focus({ preventScroll: true });
  }

  // ---------- Reset (two-step confirm) ----------
  function showResetConfirm(show) {
    $("reset-button").hidden = show;
    $("reset-confirm").hidden = !show;
    if (show) ($("reset-yes").hidden ? $("reset-cancel") : $("reset-yes")).focus();
    else $("reset-button").focus();
  }
  function doReset() {
    var cleared = Array.from(watched);
    watched.clear();
    recordChanges(cleared);
    for (var i = 0; i < TOTAL; i++) syncRow(i);
    updateProgress();
    applyFilters();
    showResetConfirm(false);
    toast("Progress reset");
  }

  // ---------- Skip-filler guide ----------
  function renderGuide() {
    var watch = [], skip = [];
    EPISODES.forEach(function (e) {
      (kindOf(e) === "canon" ? watch : skip).push(e.number);
    });
    var watchRanges = toRanges(watch);
    var skipRanges = toRanges(skip);

    $("guide-watch-count").textContent = watch.length;
    $("guide-skip-count").textContent = skip.length;
    $("guide-time-saved").textContent = "~" + formatDuration(skip.length * MINUTES_PER_EPISODE);
    $("guide-watch-time").textContent =
      "Watching " + watch.length + " of " + TOTAL + " episodes takes about " +
      formatDuration(watch.length * MINUTES_PER_EPISODE) + " instead of " +
      formatDuration(TOTAL * MINUTES_PER_EPISODE) + ".";

    for (var i = 0; i < TOTAL; i++) {
      mapCells.guide[i].classList.toggle("is-on", kindOf(EPISODES[i]) === "canon");
    }
    fillRanges($("guide-watch-ranges"), watchRanges);
    fillRanges($("guide-skip-ranges"), skipRanges);
    $("guide-watch-text").textContent = watchRanges.map(rangeLabel).join(", ");
    $("guide-skip-text").textContent = skipRanges.map(rangeLabel).join(", ");
  }

  function fillRanges(ul, ranges) {
    ul.textContent = "";
    ranges.forEach(function (r) {
      var li = document.createElement("li");
      li.textContent = rangeLabel(r);
      var small = document.createElement("small");
      var n = r[1] - r[0] + 1;
      small.textContent = "(" + n + ")";
      li.appendChild(small);
      ul.appendChild(li);
    });
  }

  // ---------- Tabs ----------
  var tabs = [
    { id: "episodes", tab: $("tab-episodes"), panel: $("panel-episodes") },
    { id: "guide", tab: $("tab-guide"), panel: $("panel-guide") }
  ];
  function selectTab(id, focus) {
    tabs.forEach(function (t) {
      var on = t.id === id;
      t.tab.setAttribute("aria-selected", String(on));
      t.tab.tabIndex = on ? 0 : -1;
      t.panel.hidden = !on;
      if (on && focus) t.tab.focus();
    });
    prefs.tab = id;
    savePrefs();
  }
  tabs.forEach(function (t, idx) {
    t.tab.addEventListener("click", function () {
      if (prefs.tab !== t.id) { selectTab(t.id); window.scrollTo(0, 0); }
    });
    t.tab.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var next = tabs[(idx + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next.id, true);
      e.preventDefault();
    });
  });

  // ---------- Shared list (Firebase) ----------
  // The sync code itself lives in sync.js and is loaded only when a shared list is in use.
  var ROOM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
  var ROOM_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{16}$/;
  var sync = {
    roomId: null,       // current shared list code (no dashes)
    controller: null,   // { push, stop } from sync.js once connected
    module: null,       // sync.js module
    connecting: false,
    leaveArmed: false,
    inviteRoom: null    // room code from an invite link, awaiting confirmation
  };

  function syncAvailable() {
    return typeof FIREBASE_CONFIG !== "undefined" && FIREBASE_CONFIG && location.protocol !== "file:";
  }

  function newRoomCode() {
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    var out = "";
    for (var i = 0; i < 16; i++) out += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
    return out;
  }
  function cleanCode(s) {
    return String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  }
  function prettyCode(c) { return c.replace(/(.{4})(?=.)/g, "$1-"); }
  function inviteLink(code) {
    return location.href.split("#")[0].split("?")[0] + "#join=" + code;
  }

  /** Every episode this device has a value for, as { n: {w, t} }. */
  function allEntries() {
    var out = {};
    for (var n = 1; n <= TOTAL; n++) {
      var t = changedAt[n] || 0;
      if (t || watched.has(n)) out[n] = { w: watched.has(n), t: t };
    }
    return out;
  }

  /**
   * Merges the shared list into this device. For each episode the most recent
   * change wins. Returns the entries where this device is newer, to upload.
   */
  function applyRemote(remote) {
    var changed = [];
    var toPush = {};
    for (var n = 1; n <= TOTAL; n++) {
      var r = remote[n];
      var valid = r && typeof r.w === "boolean" && typeof r.t === "number";
      var lw = watched.has(n);
      var lt = changedAt[n] || 0;
      if (!valid) {
        if (lt || lw) toPush[n] = { w: lw, t: lt };
        continue;
      }
      if (r.t > lt || (r.t === lt && r.w && !lw)) {
        if (r.w !== lw) {
          if (r.w) watched.add(n); else watched.delete(n);
          changed.push(n);
        }
        changedAt[n] = r.t;
        lastStamp = Math.max(lastStamp, r.t);
      } else if (lt > r.t || (lt === r.t && lw && !r.w)) {
        toPush[n] = { w: lw, t: lt };
      }
    }
    saveWatched();
    if (changed.length) {
      changed.forEach(function (n) { syncRow(n - 1); });
      updateProgress();
      applyFilters();
    }
    return toPush;
  }

  var STATUS_TEXT = {
    connecting: "Connecting…",
    synced: "Synced",
    saving: "Saving…",
    offline: "Offline · will sync later",
    error: "Problem"
  };
  function setSyncStatus(state, message) {
    var el = $("sync-status");
    el.dataset.state = state;
    el.textContent = STATUS_TEXT[state] || state;
    showSyncMessage(state === "error" ? message : "");
  }
  function showSyncMessage(msg, isInfo) {
    var el = $("sync-message");
    el.textContent = msg || "";
    el.hidden = !msg;
    el.classList.toggle("is-info", !!isInfo);
  }

  function renderSync() {
    var available = syncAvailable();
    $("sync-unavailable").hidden = available;
    if (!available) {
      $("sync-unavailable-text").textContent = location.protocol === "file:"
        ? "Sharing works on the hosted site (for example GitHub Pages), not when you open the file directly."
        : "Sharing isn't set up on this copy of the site yet. See “Shared progress (Firebase)” in the README.";
    }
    var inRoom = available && !!sync.roomId;
    var inviting = available && !!sync.inviteRoom;
    $("sync-invite-prompt").hidden = !inviting;
    $("sync-setup").hidden = !available || inRoom || inviting;
    $("sync-connected").hidden = !inRoom || inviting;
    $("sync-status").hidden = !inRoom;
    if (inRoom) $("sync-code-display").textContent = prettyCode(sync.roomId);
    if (inviting) {
      $("sync-invite-text").textContent = (sync.roomId ? "Switch to the shared list " : "Join the shared list ") +
        prettyCode(sync.inviteRoom) + "? Your progress on this device will be merged into it.";
    }
    $("sync-leave").textContent = sync.leaveArmed ? "Tap again to leave" : "Leave";
    $("sync-leave").classList.toggle("btn-danger", sync.leaveArmed);
    updateProgress(); // reset wording depends on whether a list is shared
  }

  function loadSyncModule() {
    if (sync.module) return Promise.resolve(sync.module);
    return import("./sync.js").then(function (m) { sync.module = m; return m; });
  }

  function errorText(err) {
    if (sync.module) return sync.module.describeError(err);
    return navigator.onLine
      ? "Couldn't load the sync code. Check your connection and try again."
      : "You're offline. Connect to the internet and try again.";
  }

  /** mode: "create" | "join" | "resume" */
  function startSync(roomId, mode) {
    if (sync.connecting) return Promise.resolve(false);
    sync.connecting = true;
    showSyncMessage("");
    if (mode !== "resume") setBusy(true);
    var lastStatus = ["connecting"];
    var connected = false;
    return loadSyncModule().then(function (m) {
      return m.connect({
        config: FIREBASE_CONFIG,
        roomId: roomId,
        mode: mode,
        api: {
          allEntries: allEntries,
          applyRemote: applyRemote,
          status: function (s, msg) {
            lastStatus = [s, msg];
            if (connected && sync.roomId === roomId) setSyncStatus(s, msg);
          }
        }
      });
    }).then(function (controller) {
      // Only drop the previous list once the new one is connected
      if (sync.controller) sync.controller.stop();
      sync.controller = controller;
      sync.roomId = roomId;
      connected = true;
      save(STORAGE.room, roomId);
      renderSync();
      setSyncStatus(lastStatus[0], lastStatus[1]);
      if (mode === "create") toast("Shared list created. Tap Invite to share it.");
      if (mode === "join") toast("Joined the shared list");
      return true;
    }).catch(function (err) {
      if (mode === "resume") {
        // Couldn't connect at startup (usually offline): keep the list and retry later.
        setSyncStatus(navigator.onLine ? "error" : "offline", errorText(err));
      } else {
        showSyncMessage(errorText(err));
      }
      return false;
    }).then(function (ok) {
      sync.connecting = false;
      setBusy(false);
      return ok;
    });
  }

  function setBusy(busy) {
    ["sync-create", "sync-join-submit", "sync-invite-accept"].forEach(function (id) { $(id).disabled = busy; });
  }

  function leaveRoom() {
    if (sync.controller) sync.controller.stop();
    sync.controller = null;
    sync.roomId = null;
    sync.leaveArmed = false;
    save(STORAGE.room, null);
    renderSync();
    toast("Left the shared list. Your progress stays on this device.");
  }

  function shareInvite() {
    var url = inviteLink(sync.roomId);
    var text = "Join my Naruto watch list. Code: " + prettyCode(sync.roomId);
    if (navigator.share) {
      navigator.share({ title: "Naruto Filler Guide", text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { toast("Invite link copied"); },
        function () { window.prompt("Copy this invite link:", url); }
      );
    } else {
      window.prompt("Copy this invite link:", url);
    }
  }

  /** Handles "#join=CODE" invite links. */
  function readInviteFromUrl() {
    var m = location.hash.match(/join=([0-9A-Za-z-]+)/);
    if (!m) return;
    history.replaceState(null, "", location.href.split("#")[0]);
    var code = cleanCode(m[1]);
    if (!ROOM_RE.test(code)) { toast("That invite link isn't valid"); return; }
    if (code === sync.roomId) { toast("You're already on this shared list"); return; }
    sync.inviteRoom = code;
    selectTab("episodes");
  }

  function initSync() {
    var saved = load(STORAGE.room, null);
    if (typeof saved === "string" && ROOM_RE.test(saved)) sync.roomId = saved;

    $("sync-create").addEventListener("click", function () {
      startSync(newRoomCode(), "create");
    });
    $("sync-join-toggle").addEventListener("click", function () {
      var form = $("sync-join-form");
      form.hidden = !form.hidden;
      if (!form.hidden) $("sync-code").focus();
    });
    $("sync-join-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var code = cleanCode($("sync-code").value);
      if (!ROOM_RE.test(code)) { showSyncMessage("Codes are 16 letters and numbers, like ABCD-EFGH-JKMN-PQRS."); return; }
      startSync(code, "join").then(function (ok) {
        if (ok) { $("sync-code").value = ""; $("sync-join-form").hidden = true; }
      });
    });
    $("sync-invite").addEventListener("click", shareInvite);
    $("sync-leave").addEventListener("click", function () {
      if (sync.leaveArmed) { leaveRoom(); return; }
      sync.leaveArmed = true;
      renderSync();
      setTimeout(function () { if (sync.leaveArmed) { sync.leaveArmed = false; renderSync(); } }, 4000);
    });
    $("sync-invite-accept").addEventListener("click", function () {
      var code = sync.inviteRoom;
      startSync(code, "join").then(function (ok) {
        if (ok) { sync.inviteRoom = null; renderSync(); }
      });
    });
    $("sync-invite-decline").addEventListener("click", function () {
      sync.inviteRoom = null;
      showSyncMessage("");
      renderSync();
    });

    readInviteFromUrl();
    window.addEventListener("hashchange", function () { readInviteFromUrl(); renderSync(); });
    renderSync();

    if (syncAvailable() && sync.roomId) startSync(sync.roomId, "resume");

    // Retry after an offline start once the connection is back
    function retry() {
      if (syncAvailable() && sync.roomId && !sync.controller && !sync.connecting) startSync(sync.roomId, "resume");
    }
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") retry();
    });
  }

  // ---------- Wire up ----------
  function init() {
    buildFilters();
    buildLegend();
    buildList();
    buildMap($("ep-map"), mapCells.progress);
    buildMap($("guide-map"), mapCells.guide);
    for (var i = 0; i < TOTAL; i++) syncRow(i);

    var search = $("search");
    search.addEventListener("input", function () {
      query = normalize(search.value.trim());
      applyFilters();
    });
    search.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && search.value) { search.value = ""; query = ""; applyFilters(); }
    });

    var hide = $("hide-watched");
    hide.checked = !!prefs.hideWatched;
    hide.addEventListener("change", function () {
      prefs.hideWatched = hide.checked; savePrefs(); applyFilters();
    });

    var skipNext = $("skip-filler-next");
    skipNext.checked = !!prefs.skipFillerNext;
    skipNext.addEventListener("change", function () {
      prefs.skipFillerNext = skipNext.checked; savePrefs(); updateProgress();
    });

    $("next-button").addEventListener("click", jumpToNext);
    $("reset-button").addEventListener("click", function () { showResetConfirm(true); });
    $("reset-cancel").addEventListener("click", function () { showResetConfirm(false); });
    $("reset-yes").addEventListener("click", doReset);

    // Keep tabs in sync if progress changes in another tab/window
    window.addEventListener("storage", function (e) {
      if (e.key !== STORAGE.watched) return;
      watched = new Set(load(STORAGE.watched, []));
      var c = load(STORAGE.changed, {}) || {};
      Object.keys(c).forEach(function (k) { changedAt[k] = c[k]; lastStamp = Math.max(lastStamp, c[k]); });
      for (var i = 0; i < TOTAL; i++) syncRow(i);
      updateProgress();
      applyFilters();
    });

    selectTab(prefs.tab === "guide" ? "guide" : "episodes");
    applyFilters();
    updateProgress();
    renderGuide();
    initSync();

    if (location.protocol === "file:") $("file-note").hidden = false;
    document.documentElement.classList.remove("js-loading"); // reveal the built page
    registerServiceWorker();
  }

  // ---------- Service worker + update banner ----------
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

    var refreshing = false;
    var updateRequested = false;
    var waitingWorker = null;

    function showUpdate(worker) {
      waitingWorker = worker;
      $("update-banner").hidden = false;
    }

    $("update-button").addEventListener("click", function () {
      if (!waitingWorker) { location.reload(); return; }
      updateRequested = true;
      $("update-button").textContent = "Updating…";
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    });

    // Reload only when the user asked for the update. On the very first visit the new
    // worker also takes control (clients.claim()), and that must not reload the page.
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!updateRequested || refreshing) return;
      refreshing = true;
      location.reload();
    });

    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).then(function (reg) {
        // An update was already downloaded and is waiting
        if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);

        function track(sw) {
          if (!sw) return;
          sw.addEventListener("statechange", function () {
            // "installed" + an existing controller = new version ready (not first install)
            if (sw.state === "installed" && navigator.serviceWorker.controller) showUpdate(sw);
          });
        }
        track(reg.installing); // an update may already be downloading
        reg.addEventListener("updatefound", function () { track(reg.installing); });

        // Check for updates when the app comes back to the foreground
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") reg.update().catch(function () {});
        });
      }).catch(function (err) {
        console.warn("Service worker registration failed:", err);
      });
    });
  }

  init();
})();
