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
    skipped: "naruto-filler:skipped:v1", // episodes skipped from the up-next deck
    ratings: "naruto-filler:ratings:v1", // { episodeNumber: 1–5 stars } (yours)
    favorites: "naruto-filler:favorites:v1", // [episodeNumber] (yours)
    profile: "naruto-filler:profile:v1", // { id, name, asked, last: { n, at } }
    notes: "naruto-filler:notes:v1",     // { episodeNumber: { e: reaction emoji, x: note text } } (yours)
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
  function loadNumbers(key) {
    return new Set((load(key, []) || []).filter(function (n) {
      return Number.isInteger(n) && n >= 1 && n <= TOTAL;
    }));
  }
  var watched = loadNumbers(STORAGE.watched);
  var skipped = loadNumbers(STORAGE.skipped); // "not watching this one" (a skipped episode is never also watched)
  var defaultPrefs = {
    show: "all",          // "all" | "canon" | "filler"
    hideWatched: false,
    skipFillerNext: true,
    together: false,      // "We watch together": your marks count for everyone on the shared list
    shield: false,        // spoiler shield: blur titles of episodes you haven't watched
    splash: true,         // startup animation
    arcOpen: {}           // arc sections you opened/closed yourself ("name@firstEpisode": true/false)
  };
  var storedPrefs = load(STORAGE.prefs, {}) || {};
  var prefs = Object.assign({}, defaultPrefs, storedPrefs);
  if (!storedPrefs.show && Array.isArray(storedPrefs.types)) { // older versions: toggle buttons per type
    var hasCanon = storedPrefs.types.indexOf("canon") !== -1, hasFiller = storedPrefs.types.indexOf("filler") !== -1;
    prefs.show = hasCanon && !hasFiller ? "canon" : hasFiller && !hasCanon ? "filler" : "all";
  }
  delete prefs.types;
  delete prefs.tab; // older versions had tabs
  if (["all", "canon", "filler"].indexOf(prefs.show) === -1) prefs.show = "all";
  function showsKind(kind) { return prefs.show === "all" || prefs.show === kind; }
  var query = "";

  function savePrefs() {
    save(STORAGE.prefs, prefs);
  }
  function sorted(set) { return Array.from(set).sort(function (a, b) { return a - b; }); }
  function saveWatched() {
    save(STORAGE.watched, sorted(watched));
    save(STORAGE.skipped, sorted(skipped));
    save(STORAGE.changed, changedAt);
  }
  /** Sets one episode's state: "watched", "skipped" or "none". */
  function setState(n, state) {
    if (state === "watched") watched.add(n); else watched.delete(n);
    if (state === "skipped") skipped.add(n); else skipped.delete(n);
  }
  function stateOf(n) { return watched.has(n) ? "watched" : skipped.has(n) ? "skipped" : "none"; }
  function entryOf(n, t) { return { w: watched.has(n), s: skipped.has(n), t: t }; }

  // ---------- You: name, star ratings, favorites ----------
  function randomId(len) {
    var abc = "abcdefghijklmnopqrstuvwxyz0123456789", bytes = new Uint8Array(len), out = "";
    window.crypto.getRandomValues(bytes);
    for (var i = 0; i < len; i++) out += abc[bytes[i] % abc.length];
    return out;
  }
  var profile = load(STORAGE.profile, null) || {};
  if (!/^[a-z0-9]{12}$/.test(profile.id || "")) profile.id = randomId(12);
  if (typeof profile.name !== "string") profile.name = "";
  if (!profile.badges || typeof profile.badges !== "object" || Array.isArray(profile.badges)) profile.badges = {}; // { badgeId: time earned }
  save(STORAGE.profile, profile);
  function saveProfile() { save(STORAGE.profile, profile); pushMember(); }

  var ratings = (function () {
    var raw = load(STORAGE.ratings, {}) || {}, out = {};
    Object.keys(raw).forEach(function (k) {
      var n = Number(k), r = raw[k];
      if (n >= 1 && n <= TOTAL && Number.isInteger(r) && r >= 1 && r <= 5) out[n] = r;
    });
    return out;
  })();
  var favorites = loadNumbers(STORAGE.favorites);
  function savePersonal() {
    save(STORAGE.ratings, ratings);
    save(STORAGE.favorites, sorted(favorites));
    pushMember();
  }
  function setRating(n, stars) {
    if (stars) ratings[n] = stars; else delete ratings[n];
    savePersonal();
    refreshPersonal(n);
  }
  function toggleFavorite(n) {
    if (favorites.has(n)) favorites.delete(n); else favorites.add(n);
    savePersonal();
    refreshPersonal(n);
  }
  // ---------- Notes & reactions (yours; partners' arrive with the shared list) ----------
  var REACTIONS = [["🔥", "Hype"], ["😭", "Sad"], ["😂", "Funny"], ["😮", "Shocked"], ["😡", "Angry"], ["💤", "Boring"]];
  var REACTION_SET = REACTIONS.map(function (r) { return r[0]; });
  var NOTE_MAX = 280;
  /** Keeps only valid entries: a known reaction and/or some text. */
  function cleanNotes(raw) {
    var out = {};
    if (!raw || typeof raw !== "object") return out;
    Object.keys(raw).forEach(function (k) {
      var n = Number(k), v = raw[k];
      if (!(Number.isInteger(n) && n >= 1 && n <= TOTAL) || !v || typeof v !== "object") return;
      var e = REACTION_SET.indexOf(v.e) !== -1 ? v.e : "";
      var x = typeof v.x === "string" ? v.x.slice(0, NOTE_MAX) : "";
      if (!x.trim()) x = "";
      if (e || x) { out[n] = {}; if (e) out[n].e = e; if (x) out[n].x = x; }
    });
    return out;
  }
  var notes = cleanNotes(load(STORAGE.notes, {}));
  function setNote(n, patch) {
    var cur = cleanNotes((function () { var o = {}; o[n] = Object.assign({}, notes[n] || {}, patch); return o; })())[n];
    if (cur) notes[n] = cur; else delete notes[n];
    save(STORAGE.notes, notes);
    pushMember();
    if (rows.length === TOTAL) syncRow(n - 1);
    if ($("top-sheet").open) renderTop();
    if (badgesReady) checkBadges();
  }

  /** Remembers the last episode you yourself marked watched (shown to your partner). */
  function noteWatched(n) {
    profile.last = { n: n, at: Date.now() };
    saveProfile();
  }

  /** Your pace: episodes marked one at a time in the last two weeks (bulk marks share
   *  one timestamp, so groups of 3+ identical times are left out). */
  function paceInfo() {
    var DAY = 864e5, now = Date.now(), byTime = {};
    watched.forEach(function (n) {
      var t = changedAt[n];
      if (t && now - t < 14 * DAY) (byTime[t] = byTime[t] || []).push(n);
    });
    var times = [];
    Object.keys(byTime).forEach(function (t) { if (byTime[t].length < 3) byTime[t].forEach(function () { times.push(Number(t)); }); });
    if (times.length < 2) return null;
    var days = Math.min(14, Math.max(3, (now - Math.min.apply(null, times)) / DAY));
    var perDay = times.length / days;
    var remaining = upcoming(TOTAL).length;
    if (!remaining) return null;
    return { perDay: perDay, remaining: remaining, finish: new Date(now + Math.ceil(remaining / perDay) * DAY) };
  }
  function formatHM(minutes) {
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return h ? h + "h" + (m ? " " + m + "m" : "") : m + "m";
  }
  function formatDate(d) {
    var opts = { month: "short", day: "numeric" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return d.toLocaleDateString(undefined, opts);
  }
  function timeAgo(at) {
    var m = Math.round((Date.now() - at) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
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
  function recordChanges(numbers, timeOf) {
    var t = stamp();
    var entries = {};
    numbers.forEach(function (n) {
      var when = (timeOf && timeOf(n)) || t;
      changedAt[n] = when;
      entries[n] = entryOf(n, when);
    });
    saveWatched();
    if (sync.controller) {
      sync.controller.push(entries);
      if (prefs.together) markForOthers(entries);
    }
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
  /** Shows a short message; optionally with an action button such as "Undo". */
  function toast(msg, actionLabel, action) {
    var el = $("toast");
    el.textContent = "";
    var text = document.createElement("span");
    text.textContent = msg;
    el.appendChild(text);
    if (actionLabel) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = actionLabel;
      btn.addEventListener("click", function () { el.hidden = true; action(); });
      el.appendChild(btn);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, actionLabel ? 6000 : 2600);
  }

  // Precomputed search text per episode
  var searchIndex = EPISODES.map(function (ep) { return normalize(ep.title); });

  // ---------- Build static UI ----------
  // "All / Canon / Filler" segmented control
  var SHOW_OPTIONS = [["all", "All"], ["canon", "Canon"], ["filler", "Filler"]];
  function buildFilters() {
    var wrap = $("filters");
    SHOW_OPTIONS.forEach(function (o, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.dataset.show = o[0];
      btn.textContent = o[1];
      btn.addEventListener("click", function () { setShow(o[0]); });
      btn.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        var next = SHOW_OPTIONS[(idx + (e.key === "ArrowRight" ? 1 : SHOW_OPTIONS.length - 1)) % SHOW_OPTIONS.length][0];
        setShow(next);
        wrap.querySelector('[data-show="' + next + '"]').focus();
        e.preventDefault();
      });
      wrap.appendChild(btn);
    });
    syncShowButtons();
  }
  function syncShowButtons() {
    Array.prototype.forEach.call($("filters").children, function (b) {
      var on = b.dataset.show === prefs.show;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    syncSegment($("filters"));
  }
  /** Moves a segmented control's sliding thumb to the selected option. */
  function syncSegment(el) {
    var kids = Array.prototype.slice.call(el.children);
    var i = kids.findIndex(function (b) { return b.getAttribute("aria-checked") === "true"; });
    el.classList.add("slide");
    el.style.setProperty("--n", kids.length);
    el.style.setProperty("--i", Math.max(0, i));
  }
  function setShow(value) {
    prefs.show = value;
    savePrefs();
    syncShowButtons();
    applyFilters();
  }

  var rows = []; // index-aligned with EPISODES
  var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  // Consecutive episodes with the same arc form one section of the list
  var arcs = []; // { id, name, kind, start, end, numbers, el, list, head, progress }
  EPISODES.forEach(function (ep) {
    var last = arcs[arcs.length - 1];
    if (last && last.name === ep.arc) { last.end = ep.number; last.numbers.push(ep.number); return; }
    arcs.push({ id: "arc-" + arcs.length, name: ep.arc, start: ep.number, end: ep.number, numbers: [ep.number] });
  });
  arcs.forEach(function (a) {
    var filler = a.numbers.filter(function (n) { return kindOf(EPISODES[n - 1]) === "filler"; }).length;
    a.kind = filler * 2 > a.numbers.length ? "filler" : "canon";
  });
  var arcOf = []; // episode index -> arc
  arcs.forEach(function (a) { a.numbers.forEach(function (n) { arcOf[n - 1] = a; }); });

  var INFO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.4"/></svg>';
  var STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.3l2.6 5.5 6 .7-4.4 4.1 1.1 6L12 16.7l-5.3 2.9 1.1-6L3.4 9.5l6-.7z"/></svg>';
  var NOTE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.6 3.8c-.5.4-1.4.1-1.4-.6z"/></svg>';
  var HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3s-7.6-4.6-9-9.3C2 7.6 4.3 4.7 7.4 4.7c1.9 0 3.5 1.1 4.6 2.6 1.1-1.5 2.7-2.6 4.6-2.6 3.1 0 5.4 2.9 4.4 6.3-1.4 4.7-9 9.3-9 9.3z"/></svg>';
  var CHEVRON_SVG = '<svg class="arc-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

  function buildRow(ep) {
    var kind = kindOf(ep);
    var li = document.createElement("li");
    li.className = "episode";
    li.id = "ep-" + ep.number;
    li.dataset.type = kind;

    // The whole row is one <label>, so tapping the number or title ticks it too
    var row = document.createElement("label");
    row.className = "ep-row";
    var check = document.createElement("span");
    check.className = "ep-check";
    var input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.number = ep.number;
    input.setAttribute("aria-label", "Watched episode " + ep.number + ": " + ep.title);
    var box = document.createElement("span");
    box.className = "box";
    box.innerHTML = CHECK_SVG;
    check.appendChild(input);
    check.appendChild(box);

    var num = document.createElement("span");
    num.className = "ep-number";
    num.textContent = ep.number;

    var main = document.createElement("span");
    main.className = "ep-main";
    var title = document.createElement("span");
    title.className = "ep-title";
    title.textContent = ep.title;
    main.appendChild(title);
    if (kind === "filler") {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Filler";
      main.appendChild(badge);
    }

    var meta = document.createElement("span");
    meta.className = "ep-meta";
    var who = document.createElement("span");
    who.className = "ep-who";
    who.hidden = true;

    row.appendChild(check);
    row.appendChild(num);
    row.appendChild(main);
    row.appendChild(who);
    row.appendChild(meta);
    li.appendChild(row);

    var info = document.createElement("button");
    info.type = "button";
    info.className = "ep-info";
    info.dataset.n = ep.number;
    info.setAttribute("aria-label", "Details for episode " + ep.number);
    info.innerHTML = INFO_SVG;
    li.appendChild(info);

    rows.push({ li: li, input: input, meta: meta, who: who });
    return li;
  }

  function buildList() {
    var container = $("episode-list");
    var frag = document.createDocumentFragment();
    arcs.forEach(function (a) {
      var section = document.createElement("section");
      section.className = "arc card";
      section.id = a.id;
      section.dataset.kind = a.kind;

      var head = document.createElement("button");
      head.type = "button";
      head.className = "arc-head";
      head.setAttribute("aria-controls", a.id + "-list");
      var dot = document.createElement("span");
      dot.className = "arc-dot";
      dot.setAttribute("aria-hidden", "true");
      var text = document.createElement("span");
      text.className = "arc-text";
      var name = document.createElement("span");
      name.className = "arc-name";
      name.textContent = a.name;
      var meta = document.createElement("span");
      meta.className = "arc-meta";
      meta.textContent = (a.start === a.end ? "Episode " + a.start : "Episodes " + a.start + "–" + a.end) +
        " · " + (a.kind === "filler" ? "Filler" : "Canon");
      text.appendChild(name);
      text.appendChild(meta);
      var progress = document.createElement("span");
      progress.className = "arc-progress";
      head.appendChild(dot);
      head.appendChild(text);
      head.appendChild(progress);
      head.insertAdjacentHTML("beforeend", CHEVRON_SVG);
      head.addEventListener("click", function () { setArcOpen(a, !isArcOpen(a)); });

      var list = document.createElement("ol");
      list.className = "arc-episodes";
      list.id = a.id + "-list";
      a.numbers.forEach(function (n) { list.appendChild(buildRow(EPISODES[n - 1])); });

      section.appendChild(head);
      section.appendChild(list);
      frag.appendChild(section);
      a.el = section; a.head = head; a.list = list; a.progress = progress; a.meta = meta; a.metaBase = meta.textContent;
    });
    container.appendChild(frag);

    container.addEventListener("click", function (e) {
      var info = e.target.closest && e.target.closest(".ep-info");
      if (info) openEpSheet(Number(info.dataset.n));
    });

    // One delegated listener for all checkboxes
    container.addEventListener("change", function (e) {
      var input = e.target;
      if (!input.matches('input[type="checkbox"]')) return;
      var n = Number(input.dataset.number);
      withCelebration(function () {
        setState(n, input.checked ? "watched" : "none");
        recordChanges([n]);
        if (input.checked) noteWatched(n);
        updateArcProgress();
      });
      syncRow(n - 1);
      if (input.checked) pop(input.nextElementSibling);
      updateProgress();
      if (prefs.hideWatched) setTimeout(applyFilters, 450); // let the tick animation play first
    });
  }

  // Which arc sections are expanded. The arc you're up to opens by itself; finished ones fold
  // away. Once you open or close a section yourself, that choice is remembered.
  function arcKey(a) { return a.name + "@" + a.start; }
  /** The arc you're up to (the one with your next episode). */
  function currentArc() {
    var next = nextEpisode();
    return next ? arcOf[next.number - 1] : null;
  }
  function isArcOpen(a, cur) {
    var key = arcKey(a);
    if (Object.prototype.hasOwnProperty.call(prefs.arcOpen, key)) return prefs.arcOpen[key];
    return a === (cur === undefined ? currentArc() : cur);
  }
  function setArcOpen(a, open, instant) {
    prefs.arcOpen[arcKey(a)] = open;
    savePrefs();
    var animate = !instant && !reduceMotion() && !!a.list.animate;
    if (!open && animate && !a.list.hidden) { // fold: shrink, then hide
      a.el.classList.remove("is-open");
      a.head.setAttribute("aria-expanded", "false");
      a.list.style.overflow = "hidden";
      a.list.animate([{ height: a.list.offsetHeight + "px", opacity: 1 }, { height: "0px", opacity: 0 }],
        { duration: 240, easing: "cubic-bezier(.4, 0, .6, 1)" }).onfinish = function () {
        a.list.style.overflow = "";
        applyFilters();
      };
      return;
    }
    var wasHidden = a.list.hidden;
    applyFilters();
    if (open && animate && wasHidden && !a.list.hidden) { // unfold: grow to full height, rows slide in
      a.list.style.overflow = "hidden";
      a.list.classList.add("unfolding");
      a.list.animate([{ height: "0px", opacity: 0 }, { height: a.list.scrollHeight + "px", opacity: 1 }],
        { duration: 320, easing: "cubic-bezier(.2, .9, .3, 1)" }).onfinish = function () { a.list.style.overflow = ""; };
      setTimeout(function () { a.list.classList.remove("unfolding"); }, 600);
    }
  }

  /** (Re)starts a CSS animation that is tied to a class. */
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  function pop(el) { replay(el, "pop"); }

  // ---------- Episode maps (one square per episode) ----------
  var mapCells = { guide: [] };
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
  function syncRow(i) {
    var n = EPISODES[i].number;
    rows[i].input.checked = watched.has(n);
    rows[i].li.classList.toggle("is-watched", watched.has(n));
    rows[i].li.classList.toggle("is-skipped", skipped.has(n));
    var meta = "", label = [];
    var reacts = reactionsFor(n), noted = hasNoteText(n);
    // reaction emoji come from the fixed REACTIONS list (cleanNotes drops anything else)
    if (reacts.length) { meta += '<span class="meta-react">' + reacts.slice(0, 3).join("") + "</span>"; label.push("reactions " + reacts.join(" ")); }
    if (noted) { meta += '<span class="meta-note" title="Has notes">' + NOTE_SVG + "</span>"; label.push("has notes"); }
    if (ratings[n]) { meta += '<span class="meta-stars">' + STAR_SVG + ratings[n] + "</span>"; label.push(ratings[n] + " stars"); }
    if (favorites.has(n)) { meta += '<span class="meta-fav" title="Favorite">' + HEART_SVG + "</span>"; label.push("favorite"); }
    if (rows[i].metaHTML !== meta) { // fixed markup, numbers and the fixed emoji only
      rows[i].metaHTML = meta;
      rows[i].meta.innerHTML = meta;
      rows[i].meta.setAttribute("aria-label", label.join(", "));
    }
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
    if (!showsKind(kindOf(ep))) return false;
    if (prefs.hideWatched && watched.has(ep.number)) return false;
    return matchesQuery(i);
  }

  var lastCurrentArc;
  function setHidden(el, hidden) { if (el.hidden !== hidden) el.hidden = hidden; }
  function applyFilters() {
    var shown = 0;
    var cur = currentArc();
    for (var i = 0; i < TOTAL; i++) {
      var vis = isVisible(i);
      setHidden(rows[i].li, !vis);
      if (vis) shown++;
    }
    arcs.forEach(function (a) {
      var first = null;
      a.numbers.forEach(function (n) {
        var li = rows[n - 1].li;
        if (!li.hidden && !first) first = li;
        if (li.classList.contains("first-vis") !== (li === first)) li.classList.toggle("first-vis", li === first);
      });
      var visible = !!first;
      var open = visible && (isArcOpen(a, cur) || !!query); // a search opens every section with a match
      setHidden(a.el, !visible);
      setHidden(a.list, !open);
      if (a.el.classList.contains("is-open") !== open) a.el.classList.toggle("is-open", open);
      if (a.head.getAttribute("aria-expanded") !== String(open)) a.head.setAttribute("aria-expanded", String(open));
    });
    setHidden($("empty-state"), shown !== 0);
  }
  /** Typing in the search box: redraw at most once per frame. */
  var filterFrame = 0;
  function scheduleFilters() {
    if (filterFrame) return;
    filterFrame = requestAnimationFrame(function () { filterFrame = 0; applyFilters(); });
  }

  /** Finished: everything watched or skipped (filler doesn't count while skipping filler). */
  function arcDone(a) {
    return a.numbers.every(function (n) {
      return watched.has(n) || skipped.has(n) || (prefs.skipFillerNext && kindOf(EPISODES[n - 1]) === "filler");
    });
  }
  function doneArcs() { return arcs.filter(arcDone); }
  /** Runs a single-episode change; celebrates any arc it finishes. */
  function withCelebration(fn) {
    var before = doneArcs(), rankBefore = myRank();
    fn();
    var fresh = doneArcs().filter(function (a) { return before.indexOf(a) === -1 && a.numbers.some(function (n) { return watched.has(n); }); });
    var rank = myRank(), up = rank > rankBefore ? rank : -1;
    if (fresh.length) celebrate(fresh[fresh.length - 1], up);
    else if (up !== -1) celebrateRank(up);
  }

  function updateArcProgress() {
    arcs.forEach(function (a) {
      var w = a.numbers.filter(function (n) { return watched.has(n); }).length;
      var done = arcDone(a);
      // A filler arc you're skipping (nothing watched, nothing to watch) says "Skip", not "Done"
      var skipIt = done && !w && !a.numbers.every(function (n) { return skipped.has(n); });
      a.progress.textContent = skipIt ? "Skip" : done ? "Done" : w + "/" + a.numbers.length;
      a.el.classList.toggle("is-done", done && !skipIt);
      a.el.classList.toggle("unstarted", !arcStarted(a)); // spoiler shield blurs its name
      var rated = a.numbers.filter(function (n) { return ratings[n]; });
      var avg = rated.length ? rated.reduce(function (sum, n) { return sum + ratings[n]; }, 0) / rated.length : 0;
      a.meta.textContent = a.metaBase + (avg ? " · ★ " + avg.toFixed(1) : "");
    });
  }

  // ---------- Progress + next episode ----------
  var canonEpisodes = EPISODES.filter(function (e) { return kindOf(e) === "canon"; });

  /** The next episodes still to do (not watched or skipped), in order. */
  function upcoming(count) {
    var out = [];
    for (var i = 0; i < TOTAL && out.length < count; i++) {
      var ep = EPISODES[i];
      if (watched.has(ep.number) || skipped.has(ep.number)) continue;
      if (prefs.skipFillerNext && kindOf(ep) === "filler") continue;
      out.push(ep);
    }
    return out;
  }
  function nextEpisode() { return upcoming(1)[0] || null; }

  function setBar(id, value, max) {
    var bar = $(id);
    if (bar.getAttribute("aria-valuenow") !== String(value) && rows.length === TOTAL && document.documentElement.classList.contains("ready")) {
      replay(bar, "bump");
      replay($("progress-canon-text"), "bump-text");
    }
    bar.style.width = (max ? (value / max) * 100 : 0) + "%";
    bar.setAttribute("aria-valuenow", String(value));
    bar.setAttribute("aria-valuemax", String(max));
  }

  function updateProgress() {
    var total = watched.size;
    var canon = canonEpisodes.filter(function (e) { return watched.has(e.number); }).length;
    var pct = Math.round((total / TOTAL) * 100);
    // Canon is the headline (and the bar); all episodes and skips are the smaller line
    $("progress-canon-text").textContent = canon + " of " + canonEpisodes.length;
    $("progress-all-text").textContent = total + " of " + TOTAL + " total" +
      (skipped.size ? " · " + skipped.size + " skipped" : "");
    setBar("progress-canon-bar", canon, canonEpisodes.length);
    // Time left, and (with a few episodes marked one at a time) your pace and finish date
    var left = upcoming(TOTAL).length;
    var pace = paceInfo();
    var what = prefs.skipFillerNext ? "canon" : "the series";
    var parts = left ? [formatHM(left * MINUTES_PER_EPISODE) + " of " + (prefs.skipFillerNext ? "canon" : "episodes") + " left"] : [];
    if (pace) {
      var per = pace.perDay >= 1 ? String(Math.round(pace.perDay)) : pace.perDay.toFixed(1);
      parts.push("about " + per + " a day · done with " + what + " around " + formatDate(pace.finish));
    }
    $("pace-text").hidden = !parts.length;
    $("pace-text").textContent = parts.join(" · ");
    updateStreak();
    updateRank();
    renderRace();
    updateArcProgress();
    renderDeckMode();
    renderDeck();
    checkBadges();
    if (rows.length === TOTAL && arcs[0].el) { // the arc you're up to may have changed
      var cur = currentArc();
      if (cur !== lastCurrentArc) { lastCurrentArc = cur; applyFilters(); }
    }

    var n = watched.size + skipped.size;
    $("reset-question").textContent = n
      ? "Clear all " + n + " watched or skipped episode" + (n === 1 ? "" : "s") +
        (sync.roomId && prefs.together ? " for everyone on the shared list" : "") + "? This can't be undone."
      : "Nothing to reset yet.";
    $("reset-yes").hidden = n === 0;
  }

  // ---------- Up-next deck (one card at a time) ----------
  var deckBusy = false;
  var deck = { revealed: {} }; // titles revealed this session (spoiler shield)
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function renderDeck() {
    if (deckBusy) return;
    var eps = deckUpcoming(3), us = deckMode() === "us";
    var ep = eps[0];
    $("deck").dataset.count = String(eps.length);
    $("deck-card").hidden = !ep;
    $("deck-empty").hidden = !!ep;
    $("deck-layer-1").dataset.kind = eps[1] ? kindOf(eps[1]) : "none";
    $("deck-layer-2").dataset.kind = eps[2] ? kindOf(eps[2]) : "none";
    if (!ep) {
      $("deck-empty-text").textContent = us && nextEpisode()
        ? "Nothing left that none of you has watched. Switch to Just Me to see your next episode."
        : prefs.skipFillerNext
        ? "You've finished every canon episode." + (skipped.size ? " Skipped episodes are marked in the list." : "")
        : "You've been through every episode.";
      return;
    }
    var kind = kindOf(ep);
    $("deck-card").dataset.kind = kind;
    $("deck-arc").textContent = ep.arc;
    $("deck-kind").textContent = kind === "filler" ? "Filler" : "Canon";
    $("deck-num").textContent = "Episode " + ep.number;
    $("deck-title").textContent = ep.title;
    var hide = prefs.shield && !deck.revealed[ep.number];
    $("deck-card").classList.toggle("is-hidden-title", hide);
    $("deck-card").classList.toggle("is-hidden-arc", hide && !arcStarted(arcOf[ep.number - 1]));
    $("deck-label").textContent = (us ? "Up next for all of you" : "Up next") + (hide ? " · tap to reveal the title" : "");
    var already = sync.roomId && !us ? othersWho(ep.number) : [];
    // together: episodes before this one that you still need (the others have seen them)
    var catchUp = us ? upcoming(TOTAL).filter(function (e) { return e.number < ep.number; }).map(function (e) { return e.number; }) : [];
    $("deck-hint").textContent = (kind === "filler" ? "Anime-only. Safe to skip." : "Part of the manga's story.") +
      (already.length ? " " + nameList(already) + " already watched it." : "") +
      (catchUp.length ? " You still need Ep " + toRanges(catchUp).map(rangeLabel).join(", ") + " on your own." : "");
    var fresh = newSongs(ep.number);
    $("deck-song").hidden = !fresh.length;
    if (fresh.length) {
      $("deck-song").textContent = "🎵 " + (fresh.length === 2 ? "New opening and ending!" : fresh[0] === "op"
        ? "New opening: " + SONG_LIST.op[songIndex("op", ep.number)][2] : "New ending: " + SONG_LIST.ed[songIndex("ed", ep.number)][2]);
    }
    $("deck-find").setAttribute("aria-label", "Show episode " + ep.number + " in the list");
  }

  /** "watched" or "skipped": the card flies off and the next one comes up. */
  function deckAct(state) {
    var ep = deckUpcoming(1)[0];
    if (!ep || deckBusy) return;
    var n = ep.number, before = stateOf(n);
    var lastBefore = profile.last ? { n: profile.last.n, at: profile.last.at } : null;
    var card = $("deck-card");
    deckBusy = true;
    resetTilt();
    card.classList.add(state === "watched" ? "fly-right" : "fly-left"); // the stamp lands, then it flies
    setTimeout(function () {
      withCelebration(function () {
        setState(n, state);
        recordChanges([n]);
        shareIfTogether([n]);
        if (state === "watched") noteWatched(n);
        updateArcProgress();
      });
      syncRow(n - 1);
      card.classList.remove("fly-right", "fly-left");
      showRatePrompt(state === "watched" ? n : 0);
      deckBusy = false;
      updateProgress();
      applyFilters();
      if (!reduceMotion()) {
        replay(card, "enter");
        replay($("deck"), "advance");
        setTimeout(function () { card.classList.remove("enter"); $("deck").classList.remove("advance"); }, 850);
      }
      toast((state === "watched" ? "Watched" : "Skipped") + " episode " + n, "Undo", function () {
        setState(n, before);
        recordChanges([n]);
        shareIfTogether([n]);
        syncRow(n - 1);
        if (state === "watched") { // you didn't watch it after all: put "last watched" back
          if (lastBefore) profile.last = lastBefore; else delete profile.last;
          saveProfile();
        }
        if (ratePrompt.n === n) showRatePrompt(0);
        updateProgress();
        applyFilters();
      });
    }, reduceMotion() ? 0 : 460);
  }

  // With a mouse, the card tilts toward the pointer
  function resetTilt() {
    var card = $("deck-card");
    card.classList.remove("tilting");
    ["--rx", "--ry", "--gx", "--gy"].forEach(function (v) { card.style.removeProperty(v); });
  }
  function initTilt() {
    var card = $("deck-card");
    if (!window.matchMedia || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    card.addEventListener("pointermove", function (e) {
      if (deckBusy || reduceMotion()) return;
      var r = card.getBoundingClientRect();
      var x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      var y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      card.classList.add("tilting");
      card.style.setProperty("--ry", ((x - 0.5) * 7).toFixed(2) + "deg");
      card.style.setProperty("--rx", ((0.5 - y) * 6).toFixed(2) + "deg");
      card.style.setProperty("--gx", (x * 100).toFixed(1) + "%");
      card.style.setProperty("--gy", (y * 100).toFixed(1) + "%");
    });
    card.addEventListener("pointerleave", resetTilt);
  }

  // ---------- Startup animation ----------
  var SPLASH_MS = 1500; // when the fly-through starts (matches styles.css)
  var splash = { done: false, queue: [] };
  /** Runs fn now, or as the startup animation gives way to the app. */
  function whenSplashDone(fn) { if (splash.done) fn(); else splash.queue.push(fn); }
  function finishSplash() {
    if (splash.done) return;
    splash.done = true;
    var q = splash.queue; splash.queue = [];
    q.forEach(function (fn) { fn(); });
  }
  function initSplash() {
    var el = $("splash");
    if (!el || getComputedStyle(el).display === "none") { if (el) el.remove(); finishSplash(); return; }
    var elapsed = Date.now() - (window.NF_SPLASH_START || Date.now());
    var t1 = setTimeout(finishSplash, Math.max(0, SPLASH_MS - elapsed));
    var t2 = setTimeout(function () { el.remove(); }, Math.max(0, SPLASH_MS + 550 - elapsed));
    el.addEventListener("click", function () { // tap to skip
      clearTimeout(t1); clearTimeout(t2);
      el.classList.add("skip");
      finishSplash();
      setTimeout(function () { el.remove(); }, 220);
    });
  }

  // The leaf logo draws itself; tap it for a spin
  function drawLeaf(mark, duration) {
    var path = mark && mark.querySelector("path");
    if (!path || !path.animate || !path.getTotalLength || reduceMotion()) return;
    var len = path.getTotalLength();
    path.style.strokeDasharray = len;
    path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
      { duration: duration || 1300, easing: "cubic-bezier(.5, 0, .2, 1)" }).onfinish = function () { path.style.strokeDasharray = ""; };
  }
  function initLogo() {
    var mark = document.querySelector(".top .app-mark");
    drawLeaf(mark);
    mark.addEventListener("click", function () { replay(mark, "spin"); });
  }
  function initDeck() {
    initTilt();
    $("deck-watch").addEventListener("click", function () { deckAct("watched"); });
    $("deck-skip").addEventListener("click", function () { deckAct("skipped"); });
    $("deck-find").addEventListener("click", function () {
      var ep = nextEpisode();
      if (!ep) return;
      if (prefs.shield && !deck.revealed[ep.number]) { deck.revealed[ep.number] = true; renderDeck(); return; } // first tap reveals
      jumpTo(ep);
    });
  }

  /** Scrolls the list to an episode, adjusting filters/search if they hide it. */
  function jumpTo(ep) {
    var i = ep.number - 1;
    closeAllSheets();
    if (!isArcOpen(arcOf[i])) setArcOpen(arcOf[i], true, true);
    // Make sure the target is visible: clear search / enable its type if needed.
    if (!isVisible(i)) {
      if (prefs.hideWatched && watched.has(ep.number)) {
        prefs.hideWatched = false;
        $("hide-watched").checked = false;
        savePrefs();
      }
      if (!matchesQuery(i)) { $("search").value = ""; query = ""; }
      if (!showsKind(kindOf(ep))) { prefs.show = "all"; savePrefs(); syncShowButtons(); }
      applyFilters();
      toast("Showing all episodes so you can see episode " + ep.number);
    }
    var li = rows[i].li;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Off-screen arcs normally aren't drawn (faster), so their heights are estimates. Draw them all
    // for the jump, so the scroll lands on the real position.
    var html = document.documentElement;
    html.classList.add("jumping");
    void li.offsetTop; // lay everything out now
    clearTimeout(jumpTo.timer);
    jumpTo.timer = setTimeout(function () { html.classList.remove("jumping"); }, 1200);
    li.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    li.classList.remove("is-highlight");
    void li.offsetWidth; // restart animation
    li.classList.add("is-highlight");
    rows[i].input.focus({ preventScroll: true });
  }

  // ---------- Reset (two-step confirm) ----------
  function showResetConfirm(show, quiet) {
    $("reset-button").hidden = show;
    $("reset-confirm").hidden = !show;
    if (quiet) return;
    if (show) ($("reset-yes").hidden ? $("reset-cancel") : $("reset-yes")).focus();
    else $("reset-button").focus();
  }
  function doReset() {
    var cleared = sorted(watched).concat(sorted(skipped));
    watched.clear();
    skipped.clear();
    recordChanges(cleared);
    for (var i = 0; i < TOTAL; i++) syncRow(i);
    updateProgress();
    applyFilters();
    showResetConfirm(false, true);
    closeDialog($("menu-sheet"));
    toast("Progress reset");
  }

  // ---------- Spoiler shield ----------
  /** You've watched or skipped at least one episode of this arc (its name is no spoiler). */
  function arcStarted(a) {
    return a.numbers.some(function (n) { return watched.has(n) || skipped.has(n); });
  }
  function applyShield() {
    document.body.classList.toggle("shield", !!prefs.shield);
    mapCells.guide.forEach(function (cell, i) { // map tooltips
      var ep = EPISODES[i];
      cell.title = "Ep " + ep.number + (prefs.shield && !watched.has(ep.number) ? "" : " · " + ep.title);
    });
    renderDeck();
  }

  // ---------- Arc complete! ----------
  /** The confetti card. rank: show the headband for a new rank (-1 for none). */
  function showCelebration(title, text, rank) {
    $("celebrate-title").textContent = title;
    $("celebrate-text").textContent = text;
    var hasRank = rank >= 0;
    $("celebrate-emoji").hidden = hasRank;
    $("celebrate-rank").hidden = !hasRank;
    if (hasRank) fillEmblem($("celebrate-rank"), rank);
    $("celebrate-share").hidden = !hasRank;
    openDialog($("celebrate-sheet"), $("celebrate-ok"));
    confetti($("confetti"));
  }
  function celebrate(a, rankUp) {
    if (window.NF_NO_CELEBRATION) return; // automated tests that tick through whole arcs
    var rated = a.numbers.filter(function (n) { return ratings[n]; });
    var avg = rated.length ? rated.reduce(function (sum, n) { return sum + ratings[n]; }, 0) / rated.length : 0;
    var idx = arcs.indexOf(a), next = arcs[idx + 1];
    var w = a.numbers.filter(function (n) { return watched.has(n); }).length;
    var up = rankUp >= 0 ? rankUp : -1;
    showCelebration(a.name + " complete!", w + " episode" + (w === 1 ? "" : "s") + " watched" +
      (avg ? " · your average ★ " + avg.toFixed(1) : "") + (next ? ". Next up: " + (prefs.shield && !arcStarted(next) ? "the next arc" : next.name) + "." : ". That's the whole series!") +
      (up !== -1 ? " And you're now " + (/^[AEIOU]/.test(RANKS[up].name) ? "an " : "a ") + RANKS[up].name + "!" : ""), up);
  }
  function confetti(canvas) {
    if (reduceMotion() || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
    var h = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    var colors = ["#f68b22", "#ffb800", "#34c759", "#ff3b30", "#007aff", "#ffffff"];
    var bits = [];
    for (var i = 0; i < 140; i++) {
      bits.push({ x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.35, vx: (Math.random() - 0.5) * w * 0.02,
        vy: -Math.random() * h * 0.02 - h * 0.005, s: (4 + Math.random() * 6) * (window.devicePixelRatio || 1),
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length] });
    }
    var start = performance.now();
    (function frame(now) {
      var t = now - start;
      ctx.clearRect(0, 0, w, h);
      bits.forEach(function (b) {
        b.vy += h * 0.0006; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.globalAlpha = Math.max(0, 1 - t / 3200);
        ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        ctx.restore();
      });
      if (t < 3200 && $("celebrate-sheet").open) requestAnimationFrame(frame); else ctx.clearRect(0, 0, w, h);
    })(start);
  }

  // ---------- Naruto Wrapped ----------
  function wrappedData() {
    var list = sorted(watched);
    var times = list.map(function (n) { return changedAt[n]; }).filter(Boolean);
    var first = times.length ? Math.min.apply(null, times) : 0;
    var days = first ? Math.max(1, Math.ceil((Date.now() - first) / 864e5)) : 0;
    var top = Object.keys(ratings).map(Number).sort(function (a, b) { return ratings[b] - ratings[a] || a - b; }).slice(0, 3);
    // favorite arc: best average (2+ ratings), else the one you watched most of
    var bestArc = null, bestScore = -1;
    arcs.forEach(function (a) {
      var r = a.numbers.filter(function (n) { return ratings[n]; });
      var score = r.length >= 2 ? 10 + r.reduce(function (sum, n) { return sum + ratings[n]; }, 0) / r.length
        : a.numbers.filter(function (n) { return watched.has(n); }).length / 1000;
      if (score > bestScore && a.numbers.some(function (n) { return watched.has(n); })) { bestScore = score; bestArc = a; }
    });
    var people = partners().map(function (m) {
      var both = Object.keys(ratings).map(Number).filter(function (n) { return m.r[n]; });
      var agree = both.filter(function (n) { return m.r[n] === ratings[n]; }).length;
      var diff = both.slice().sort(function (a, b) { return Math.abs(m.r[b] - ratings[b]) - Math.abs(m.r[a] - ratings[a]); })[0];
      return { m: m, both: both.length, agree: agree, diff: diff && Math.abs(m.r[diff] - ratings[diff]) >= 2 ? diff : 0 };
    });
    var log = myLog(), st = streaks(log), counts = {}, react = "";
    Object.keys(notes).forEach(function (k) { var e = notes[k].e; if (e) counts[e] = (counts[e] || 0) + 1; });
    Object.keys(counts).forEach(function (e) { if (!react || counts[e] > counts[react]) react = e; });
    return { count: list.length, hours: Math.round(list.length * MINUTES_PER_EPISODE / 60), days: days,
      top: top, arc: bestArc, favs: favorites.size, skipped: skipped.size, people: people,
      longest: st.longest, best: st.best ? { day: st.best, count: log[st.best].length } : null,
      react: react ? { e: react, count: counts[react] } : null };
  }
  function renderWrapped() {
    var d = wrappedData();
    $("wrapped-who").textContent = profile.name ? profile.name + "'s Naruto" : "Your Naruto";
    $("wrapped-count").textContent = d.count;
    $("wrapped-count").nextElementSibling.textContent = d.count === 1 ? "episode" : "episodes";
    $("wrapped-hours").nextElementSibling.textContent = d.hours === 1 ? "hour" : "hours";
    $("wrapped-hours").textContent = d.hours;
    $("wrapped-days").textContent = d.days;
    $("wrapped-days-label").textContent = d.days === 1 ? "day" : "days";
    var box = $("wrapped-details");
    box.textContent = "";
    function line(label, value) {
      var p = document.createElement("p");
      p.className = "wrapped-line";
      var l = document.createElement("span"); l.className = "wrapped-label"; l.textContent = label;
      var v = document.createElement("span"); v.className = "wrapped-value"; v.textContent = value;
      p.appendChild(l); p.appendChild(v); box.appendChild(p);
    }
    if (d.top.length) d.top.forEach(function (n, i) {
      line(i === 0 ? "Your top episodes" : "", "★" + ratings[n] + "  Ep " + n + " · " + EPISODES[n - 1].title);
    });
    if (d.arc) line("Favorite arc", d.arc.name);
    if (d.longest >= 2) line("Longest streak", "🔥 " + d.longest + " days in a row");
    if (d.best && d.best.count >= 2) line("Biggest binge", d.best.count + " episodes · " + formatDate(parseDay(d.best.day)));
    if (d.react) line("Go-to reaction", d.react.e + " × " + d.react.count);
    if (d.favs) line("Favorites", String(d.favs));
    if (d.skipped) line("Episodes skipped", String(d.skipped));
    d.people.forEach(function (p) {
      if (!p.both) return;
      line("You & " + p.m.name, "agree on " + p.agree + " of " + p.both + " shared ratings");
      if (p.diff) line("Biggest debate", "Ep " + p.diff + ": you ★" + ratings[p.diff] + ", " + p.m.name + " ★" + p.m.r[p.diff]);
    });
    if (!d.count) line("", "Watch a few episodes and come back!");
  }
  function shareWrapped() {
    var d = wrappedData();
    var text = (profile.name ? profile.name + "'s" : "My") + " Naruto so far: " + d.count + " episodes, about " + d.hours + " hours" +
      (d.days ? " in " + d.days + " day" + (d.days === 1 ? "" : "s") : "") +
      (d.top.length ? ". Top episode: Ep " + d.top[0] + " (★" + ratings[d.top[0]] + ")" : "") +
      (d.arc ? ". Favorite arc: " + d.arc.name : "") + ".";
    if (navigator.share) navigator.share({ title: "My Naruto Wrapped", text: text }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("Copied to the clipboard"); });
  }

  // ---------- Watch calendar & streaks ----------
  var CAL_WEEKS = 18;
  var cal = { selected: "" };
  function pad2(x) { return (x < 10 ? "0" : "") + x; }
  function dayKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function parseDay(k) { var p = k.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, k) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k); }
  function startOfToday() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  /** Episodes watched per day, { "2026-11-13": [45, 46] }, from [episode, time] pairs. Marks that
   *  share one time with 2+ others came from Mark Several (or a restore), so they don't count. */
  function dayLog(pairs) {
    var byTime = {}, days = {};
    pairs.forEach(function (p) { (byTime[p[1]] = byTime[p[1]] || []).push(p[0]); });
    Object.keys(byTime).forEach(function (t) {
      if (byTime[t].length >= 3) return;
      var k = dayKey(new Date(Number(t)));
      days[k] = (days[k] || []).concat(byTime[t]);
    });
    Object.keys(days).forEach(function (k) { days[k].sort(function (a, b) { return a - b; }); });
    return days;
  }
  function myLog() {
    var pairs = [];
    watched.forEach(function (n) { if (changedAt[n]) pairs.push([n, changedAt[n]]); });
    return dayLog(pairs);
  }
  function memberLog(m) {
    var pairs = [];
    Object.keys(m.p).forEach(function (k) { if (m.p[k].state === "watched") pairs.push([Number(k), m.p[k].t]); });
    return dayLog(pairs);
  }
  /** current: days in a row up to today (or yesterday, so it lasts until a whole day is missed). */
  function streaks(days) {
    var keys = Object.keys(days).sort(), longest = 0, run = 0, prev = "", best = "";
    keys.forEach(function (k) {
      run = prev && dayKey(addDays(parseDay(prev), 1)) === k ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = k;
      if (!best || days[k].length > days[best].length) best = k;
    });
    var today = startOfToday(), d = days[dayKey(today)] ? today : addDays(today, -1), current = 0;
    while (days[dayKey(d)]) { current++; d = addDays(d, -1); }
    return { current: current, longest: longest, count: keys.length, best: best, today: !!days[dayKey(today)] };
  }
  function dayName(k) {
    var today = startOfToday();
    if (k === dayKey(today)) return "Today";
    if (k === dayKey(addDays(today, -1))) return "Yesterday";
    var d = parseDay(k), opts = { weekday: "long", month: "short", day: "numeric" };
    if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
    return d.toLocaleDateString(undefined, opts);
  }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  /** The 🔥 chip next to your progress and the count in the menu. */
  var lastStreak = null;
  function updateStreak() {
    var st = streaks(myLog()), chip = $("streak-chip");
    chip.hidden = !st.current;
    $("streak-count").textContent = st.current;
    chip.classList.toggle("at-risk", !!st.current && !st.today);
    chip.setAttribute("aria-label", plural(st.current, "day") + " in a row" +
      (st.current && !st.today ? ". Watch an episode today to keep it going" : "") + ". Open the watch calendar");
    $("menu-streak").textContent = st.current ? "🔥 " + st.current : "";
    if (lastStreak !== null && st.current > lastStreak) pop(chip);
    lastStreak = st.current;
  }

  function calLevel(count) { return count >= 5 ? 4 : count >= 3 ? 3 : count; }
  function renderCalendar() {
    var log = myLog(), st = streaks(log);
    $("cal-current").textContent = st.current;
    $("cal-longest").textContent = st.longest;
    $("cal-days").textContent = st.count;
    $("cal-days-label").textContent = st.count === 1 ? "day watched" : "days watched";

    var today = startOfToday(), todayKey = dayKey(today);
    var start = addDays(today, -today.getDay() - (CAL_WEEKS - 1) * 7); // a Sunday
    var grid = $("cal-grid"), months = $("cal-months");
    grid.textContent = "";
    months.textContent = "";
    grid.style.setProperty("--weeks", CAL_WEEKS);
    months.style.setProperty("--weeks", CAL_WEEKS);
    if (!cal.selected) cal.selected = todayKey;
    for (var w = 0; w < CAL_WEEKS; w++) {
      var first = addDays(start, w * 7);
      // a month's name goes above the first week that starts in it (and above the first
      // column, if that month lasts long enough for the name to fit)
      var label = w === 0 ? addDays(first, 14).getMonth() === first.getMonth() : addDays(first, -7).getMonth() !== first.getMonth();
      if (label) {
        var m = document.createElement("span");
        m.textContent = first.toLocaleDateString(undefined, { month: "short" });
        m.style.gridColumn = (w + 1) + " / span 3";
        months.appendChild(m);
      }
      for (var i = 0; i < 7; i++) {
        var d = addDays(first, i), k = dayKey(d);
        var cell;
        if (d > today) {
          cell = document.createElement("span");
          cell.className = "cal-cell future";
        } else {
          var eps = log[k] || [];
          cell = document.createElement("button");
          cell.type = "button";
          cell.className = "cal-cell";
          cell.dataset.day = k;
          cell.dataset.level = calLevel(eps.length);
          cell.setAttribute("aria-label", dayName(k) + ": " +
            (eps.length ? plural(eps.length, "episode") : "nothing watched"));
          if (k === todayKey) cell.classList.add("today");
          if (k === cal.selected) { cell.classList.add("selected"); cell.setAttribute("aria-pressed", "true"); }
          else cell.setAttribute("aria-pressed", "false");
        }
        grid.appendChild(cell);
      }
    }
    renderCalDay(log);

    // Everyone's streaks, while sharing
    var people = sync.roomId ? partners() : [];
    $("cal-people").hidden = !people.length;
    var list = $("cal-people-list");
    list.textContent = "";
    if (people.length) [{ name: "You", st: st }].concat(people.map(function (m) { return { name: m.name, st: streaks(memberLog(m)) }; }))
      .forEach(function (p) {
        var row = document.createElement("div");
        row.className = "row";
        var l = document.createElement("span"); l.className = "row-label"; l.textContent = p.name;
        var v = document.createElement("span"); v.className = "row-value";
        v.textContent = (p.st.current ? "🔥 " + p.st.current : "No streak") + " · best " + p.st.longest;
        row.appendChild(l); row.appendChild(v); list.appendChild(row);
      });
  }
  function renderCalDay(log) {
    var k = cal.selected, eps = log[k] || [];
    $("cal-day-title").textContent = dayName(k);
    var box = $("cal-day-list");
    box.textContent = "";
    eps.forEach(function (n) { box.appendChild(topItem(n, ratings[n] ? "★ " + ratings[n] : "")); });
    if (sync.roomId) partners().forEach(function (m) {
      var theirs = memberLog(m)[k];
      if (!theirs) return;
      var row = document.createElement("div");
      row.className = "row";
      var l = document.createElement("span"); l.className = "row-label"; l.textContent = m.name;
      var v = document.createElement("span"); v.className = "row-value";
      v.textContent = "Ep " + toRanges(theirs).map(rangeLabel).join(", ");
      row.appendChild(l); row.appendChild(v); box.appendChild(row);
    });
    box.hidden = !box.children.length;
    $("cal-day-empty").hidden = !!box.children.length;
    $("cal-day-empty").textContent = k === dayKey(startOfToday()) ? "Nothing watched yet today." : "Nothing watched this day.";
  }
  function initCalendar() {
    $("cal-grid").addEventListener("click", function (e) {
      var cell = e.target.closest(".cal-cell[data-day]");
      if (!cell) return;
      cal.selected = cell.dataset.day;
      Array.prototype.forEach.call(this.querySelectorAll(".cal-cell.selected"), function (c) {
        c.classList.remove("selected");
        c.setAttribute("aria-pressed", "false");
      });
      cell.classList.add("selected");
      cell.setAttribute("aria-pressed", "true");
      renderCalDay(myLog());
    });
    function openCalendar() { cal.selected = ""; renderCalendar(); openDialog($("calendar-sheet")); }
    $("menu-calendar").addEventListener("click", openCalendar);
    $("streak-chip").addEventListener("click", openCalendar);
  }

  // ---------- Ninja rank & badges ----------
  // Ranks go by canon episodes watched (the headline number).
  var RANKS = [
    { name: "Academy Student", at: 0 },
    { name: "Genin", at: 10 },
    { name: "Chūnin", at: 40 },
    { name: "Jōnin", at: 75 },
    { name: "ANBU", at: 100 },
    { name: "Kage", at: 120 },
    { name: "Hokage", at: 130 }
  ];
  function canonWatchedBy(has) { return canonEpisodes.filter(function (e) { return has(e.number); }).length; }
  function myCanon() { return canonWatchedBy(function (n) { return watched.has(n); }); }
  function memberCanon(m) { return canonWatchedBy(function (n) { return m.p[n] && m.p[n].state === "watched"; }); }
  function rankFor(count) {
    var r = 0;
    RANKS.forEach(function (k, i) { if (count >= k.at) r = i; });
    return r;
  }
  function myRank() { return rankFor(myCanon()); }
  /** The headband: a cloth band behind a metal plate with the leaf. */
  function fillEmblem(el, rank) {
    if (!el.firstChild) {
      var band = document.createElement("span");
      band.className = "emblem-band";
      var plate = document.createElement("span");
      plate.className = "emblem-plate";
      var leaf = document.querySelector(".app-mark .app-leaf");
      if (leaf) plate.appendChild(leaf.cloneNode(true));
      el.appendChild(band);
      el.appendChild(plate);
    }
    el.dataset.rank = rank;
  }

  var MAIN_ARCS = [["Land of Waves", "🌉"], ["Chūnin Exams", "📜"], ["Konoha Crush", "🏯"], ["Search for Tsunade", "🐸"], ["Sasuke Recovery Mission", "🌀"]];
  function arcNamed(name) { return arcs.filter(function (a) { return a.name === name; })[0]; }
  var BADGES = [{ id: "first", icon: "🍃", name: "First Mission", desc: "Watch your first episode", test: function (s) { return s.watched >= 1; } }]
    .concat(MAIN_ARCS.map(function (x, i) {
      return { id: "arc" + (i + 1), icon: x[1], name: x[0], arc: x[0], desc: "Finish the arc", test: function () {
        var a = arcNamed(x[0]);
        return !!a && arcDone(a) && a.numbers.some(function (n) { return watched.has(n); });
      } };
    }))
    .concat([
      { id: "streak3", icon: "🔥", name: "Warming Up", desc: "Watch 3 days in a row", test: function (s) { return s.longest >= 3; } },
      { id: "streak7", icon: "☄️", name: "Will of Fire", desc: "Watch 7 days in a row", test: function (s) { return s.longest >= 7; } },
      { id: "streak30", icon: "🌋", name: "Unstoppable", desc: "Watch 30 days in a row", test: function (s) { return s.longest >= 30; } },
      { id: "binge", icon: "🍜", name: "Ramen Binge", desc: "Watch 5 episodes in one day", test: function (s) { return s.bestDay >= 5; } },
      { id: "critic", icon: "⭐", name: "Critic", desc: "Rate 25 episodes", test: function (s) { return s.rated >= 25; } },
      { id: "notes", icon: "💬", name: "Storyteller", desc: "React to or note 10 episodes", test: function (s) { return s.notes >= 10; } },
      { id: "dodger", icon: "💨", name: "Filler Dodger", desc: "Skip 10 filler episodes", test: function (s) { return s.fillerSkipped >= 10; } },
      { id: "fillerfan", icon: "🍡", name: "Filler Fan", desc: "Watch 25 filler episodes", test: function (s) { return s.fillerWatched >= 25; } },
      { id: "team", icon: "🤝", name: "Team 7", desc: "Share 10 watched episodes with someone on your list", test: function (s) { return s.shared >= 10; } },
      { id: "hokage", icon: "👑", name: "Hokage", desc: "Watch every canon episode", test: function (s) { return s.canon >= canonEpisodes.length; } },
      { id: "believe", icon: "🍥", name: "Believe It!", desc: "Get through all 220 episodes (watched or skipped)", test: function (s) { return s.through >= TOTAL; } }
    ]);
  function badgeStats() {
    var log = myLog(), st = streaks(log), bestDay = 0;
    Object.keys(log).forEach(function (k) { bestDay = Math.max(bestDay, log[k].length); });
    var fillerSkipped = 0, fillerWatched = 0, shared = 0;
    skipped.forEach(function (n) { if (kindOf(EPISODES[n - 1]) === "filler") fillerSkipped++; });
    watched.forEach(function (n) {
      if (kindOf(EPISODES[n - 1]) === "filler") fillerWatched++;
      if (sync.roomId && othersWho(n).length) shared++;
    });
    return { watched: watched.size, canon: myCanon(), longest: st.longest, bestDay: bestDay, rated: Object.keys(ratings).length,
      notes: Object.keys(notes).length, fillerSkipped: fillerSkipped, fillerWatched: fillerWatched, shared: shared,
      through: watched.size + skipped.size };
  }
  var badgesReady = false;
  /** Saves newly earned badges (they stay earned) and announces them, except on startup. */
  function checkBadges() {
    if (!profile.badges || typeof profile.badges !== "object") profile.badges = {};
    var s = badgeStats(), fresh = [];
    BADGES.forEach(function (b) {
      if (!profile.badges[b.id] && b.test(s)) { profile.badges[b.id] = Date.now(); fresh.push(b); }
    });
    if (fresh.length) {
      saveProfile();
      if (badgesReady) badgePop(fresh);
      if ($("rank-sheet").open) renderRankSheet();
    }
    badgesReady = true;
  }
  function badgeCount() { return Object.keys(profile.badges || {}).length; }
  function badgeName(b) { // a future arc's name is a spoiler while the shield is on
    return b.arc && prefs.shield && !profile.badges[b.id] && !arcStarted(arcNamed(b.arc)) ? "" : b.name;
  }
  var badgePopTimer = null;
  function badgePop(list) {
    var el = $("badge-pop");
    $("badge-pop-icon").textContent = list[0].icon;
    $("badge-pop-text").textContent = list.length === 1 ? "Badge earned: " + (badgeName(list[0]) || "a new arc") : list.length + " badges earned";
    el.hidden = false;
    // a popover sits in the top layer, above any open sheet
    if (el.showPopover) { try { if (!el.matches(":popover-open")) el.showPopover(); } catch (e) { /* not supported */ } }
    replay(el, "show");
    clearTimeout(badgePopTimer);
    badgePopTimer = setTimeout(hideBadgePop, 4000);
  }
  function hideBadgePop() {
    var el = $("badge-pop");
    if (el.hidePopover) { try { el.hidePopover(); } catch (e) { /* already hidden */ } }
    el.hidden = true;
  }
  function updateRank() {
    var r = myRank();
    $("rank-name").textContent = RANKS[r].name;
    $("rank-chip").dataset.rank = r;
    $("rank-chip").setAttribute("aria-label", "Rank: " + RANKS[r].name + ", " + badgeCount() + " badges. Open Rank and Badges");
    $("menu-rank-value").textContent = RANKS[r].name;
  }
  function renderRankSheet() {
    var c = myCanon(), r = rankFor(c), next = RANKS[r + 1];
    fillEmblem($("rank-emblem"), r);
    $("rank-title").textContent = RANKS[r].name;
    $("rank-next").textContent = next
      ? plural(next.at - c, "more canon episode") + " to " + next.name
      : "The highest rank. Every canon episode watched!";
    var pct = next ? Math.round(((c - RANKS[r].at) / (next.at - RANKS[r].at)) * 100) : 100;
    $("rank-bar").style.width = pct + "%";
    $("rank-bar").setAttribute("aria-valuenow", String(pct));
    var ladder = $("rank-ladder");
    ladder.textContent = "";
    RANKS.forEach(function (k, i) {
      var row = document.createElement("div");
      row.className = "row rank-step" + (i < r ? " done" : i === r ? " current" : "");
      var dot = document.createElement("span"); dot.className = "rank-step-dot"; dot.setAttribute("aria-hidden", "true");
      var l = document.createElement("span"); l.className = "row-label"; l.textContent = k.name;
      var v = document.createElement("span"); v.className = "row-value";
      v.textContent = i === r ? "You're here" : k.at ? k.at + " canon" : "Start";
      row.appendChild(dot); row.appendChild(l); row.appendChild(v);
      ladder.appendChild(row);
    });
    var people = sync.roomId ? partners() : [];
    $("rank-people").hidden = !people.length;
    var list = $("rank-people-list");
    list.textContent = "";
    if (people.length) [{ name: "You", c: c, b: badgeCount() }].concat(people.map(function (m) { return { name: m.name, c: memberCanon(m), b: m.b }; }))
      .forEach(function (p) {
        var row = document.createElement("div");
        row.className = "row";
        var l = document.createElement("span"); l.className = "row-label"; l.textContent = p.name;
        var v = document.createElement("span"); v.className = "row-value";
        v.textContent = RANKS[rankFor(p.c)].name + (typeof p.b === "number" ? " · " + plural(p.b, "badge") : "");
        row.appendChild(l); row.appendChild(v); list.appendChild(row);
      });
    $("badge-count").textContent = badgeCount() + " of " + BADGES.length;
    var grid = $("award-grid");
    grid.textContent = "";
    BADGES.forEach(function (b) {
      var got = profile.badges[b.id];
      var card = document.createElement(got ? "button" : "div"); // earned ones can be shared
      if (got) card.type = "button";
      card.dataset.id = b.id;
      card.className = "award" + (got ? " earned" : "");
      var icon = document.createElement("span"); icon.className = "award-icon"; icon.textContent = b.icon; icon.setAttribute("aria-hidden", "true");
      var name = document.createElement("span"); name.className = "award-name";
      var shown = badgeName(b);
      name.textContent = shown || "Hidden arc";
      if (!shown) name.classList.add("is-hidden-title");
      var desc = document.createElement("span"); desc.className = "award-desc";
      desc.textContent = got ? "Earned " + formatDate(new Date(got)) : b.desc;
      card.setAttribute("aria-label", (shown || "Hidden arc") + ". " + (got ? "Earned " + formatDate(new Date(got)) + ". Share it" : "Not earned yet: " + b.desc));
      if (!got) card.setAttribute("role", "img");
      card.appendChild(icon); card.appendChild(name); card.appendChild(desc);
      grid.appendChild(card);
    });
  }
  function celebrateRank(r) {
    if (window.NF_NO_CELEBRATION) return;
    var next = RANKS[r + 1];
    showCelebration("Rank up: " + RANKS[r].name + "!",
      plural(myCanon(), "canon episode") + " watched. " + (next ? "Next rank: " + next.name + " at " + next.at + "." : "That's every canon episode. Believe it!"), r);
  }

  // ---------- Watching together: the shared up-next card and the race ----------
  /** "us": the card shows the next episode nobody on the list has watched (or skipped), and marks it for everyone. */
  function deckMode() { return prefs.deckMode === "us" && sync.roomId && partners().length ? "us" : "me"; }
  function seenByOthers(n) { return partners().some(function (m) { return m.p[n] && m.p[n].state !== "none"; }); }
  function deckUpcoming(count) {
    if (deckMode() !== "us") return upcoming(count);
    return upcoming(TOTAL).filter(function (ep) { return !seenByOthers(ep.number); }).slice(0, count);
  }
  function renderDeckMode() {
    var people = sync.roomId ? partners() : [];
    $("deck-mode").hidden = !people.length;
    if (!people.length) return;
    $("deck-mode-us").textContent = people.length === 1 ? "With " + people[0].name : "Together";
    var mode = deckMode();
    Array.prototype.forEach.call($("deck-mode").children, function (b) { b.setAttribute("aria-checked", String(b.dataset.mode === mode)); });
    syncSegment($("deck-mode"));
  }
  /** Marks entries for everyone else too when the card or plan is in "together" mode. */
  function shareIfTogether(numbers) {
    if (deckMode() !== "us" || prefs.together) return; // "We always watch together" already does it
    var entries = {};
    numbers.forEach(function (n) { entries[n] = entryOf(n, changedAt[n] || stamp()); });
    markForOthers(entries);
  }
  function renderRace() {
    var people = sync.roomId ? partners() : [];
    $("race").hidden = !people.length;
    if (!people.length) return;
    var mine = myCanon(), total = canonEpisodes.length;
    var rows = [{ name: "You", c: mine, me: true }].concat(people.map(function (m) { return { name: m.name, c: memberCanon(m) }; }));
    var box = $("race-rows");
    box.textContent = "";
    rows.forEach(function (p) {
      var row = document.createElement("span"); row.className = "race-row" + (p.me ? " me" : "");
      var name = document.createElement("span"); name.className = "race-name"; name.textContent = p.name;
      var track = document.createElement("span"); track.className = "race-track";
      var fill = document.createElement("span"); fill.className = "race-fill"; fill.style.width = (p.c / total * 100) + "%";
      track.appendChild(fill);
      var count = document.createElement("span"); count.className = "race-count"; count.textContent = p.c;
      row.appendChild(name); row.appendChild(track); row.appendChild(count);
      box.appendChild(row);
    });
    var lead = rows.slice(1).sort(function (a, b) { return b.c - a.c; })[0];
    var diff = mine - lead.c, text;
    if (people.length === 1) {
      text = diff > 0 ? "You're " + plural(diff, "canon episode") + " ahead of " + lead.name
        : diff < 0 ? lead.name + " is " + plural(-diff, "canon episode") + " ahead"
        : "Neck and neck with " + lead.name;
    } else {
      text = diff > 0 ? "You're in the lead by " + plural(diff, "canon episode") : diff < 0 ? lead.name + " is in the lead" : "You're tied for the lead";
    }
    $("race-text").textContent = text;
    $("race").setAttribute("aria-label", rows.map(function (p) { return p.name + " " + p.c; }).join(", ") + " canon episodes. " + text + ". Open Rank and Badges");
  }

  // ---------- Opening & ending songs ----------
  var SONG_LIST = typeof SONGS !== "undefined" ? SONGS : { op: [], ed: [] }; // data/episodes.js
  function songIndex(kind, n) {
    for (var i = 0; i < SONG_LIST[kind].length; i++) if (n >= SONG_LIST[kind][i][0] && n <= SONG_LIST[kind][i][1]) return i;
    return -1;
  }
  function songText(kind, n) {
    var i = songIndex(kind, n);
    return i === -1 ? "" : (kind === "op" ? "OP " : "ED ") + (i + 1) + " · " + SONG_LIST[kind][i][2];
  }
  /** "New opening" when an episode is the first with a new song (episode 1 doesn't count). */
  function newSongs(n) {
    var out = [];
    ["op", "ed"].forEach(function (kind) {
      var i = songIndex(kind, n);
      if (i > 0 && SONG_LIST[kind][i][0] === n) out.push(kind);
    });
    return out;
  }
  function renderSongs() {
    var cur = nextEpisode(), now = cur ? cur.number : 0;
    ["op", "ed"].forEach(function (kind) {
      var box = $(kind + "-list");
      box.textContent = "";
      SONG_LIST[kind].forEach(function (s, i) {
        var row = document.createElement("div");
        row.className = "row song-row" + (now >= s[0] && now <= s[1] ? " now" : "");
        var main = document.createElement("button");
        main.type = "button";
        main.className = "song-main";
        var num = document.createElement("span"); num.className = "song-num"; num.textContent = i + 1;
        var text = document.createElement("span"); text.className = "song-text";
        var title = document.createElement("span"); title.className = "song-title"; title.textContent = s[2];
        var sub = document.createElement("span"); sub.className = "song-sub";
        sub.textContent = (s[3] ? "“" + s[3] + "” · " : "") + s[4] + " · Ep " + s[0] + "–" + s[1];
        text.appendChild(title); text.appendChild(sub);
        main.appendChild(num); main.appendChild(text);
        if (now >= s[0] && now <= s[1]) {
          var pill = document.createElement("span"); pill.className = "song-now"; pill.textContent = "Now";
          main.appendChild(pill);
        }
        main.setAttribute("aria-label", (kind === "op" ? "Opening " : "Ending ") + (i + 1) + ": " + s[2] + " by " + s[4] + ", episodes " + s[0] + " to " + s[1] + ". Jump to episode " + s[0]);
        main.addEventListener("click", function () { closeDialog($("songs-sheet")); jumpTo(EPISODES[s[0] - 1]); });
        var play = document.createElement("a");
        play.className = "song-play";
        play.href = "https://www.youtube.com/results?search_query=" + encodeURIComponent("Naruto " + (kind === "op" ? "opening " : "ending ") + (i + 1) + " " + s[2] + " " + s[4]);
        play.target = "_blank";
        play.rel = "noopener noreferrer";
        play.setAttribute("aria-label", "Find " + s[2] + " on YouTube");
        play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
        row.appendChild(main);
        row.appendChild(play);
        box.appendChild(row);
      });
    });
  }

  // ---------- Plan tonight ----------
  var PLAN_TIMES = [[30, "30 min"], [45, "45 min"], [60, "1 hr"], [90, "1½ hr"], [120, "2 hr"], [180, "3 hr"]];
  function planMinutes() {
    return PLAN_TIMES.some(function (t) { return t[0] === prefs.planMinutes; }) ? prefs.planMinutes : 60;
  }
  function planEpisodes() {
    var minutes = planMinutes();
    var count = Math.max(1, Math.floor((minutes + 5) / MINUTES_PER_EPISODE)); // a few minutes over is fine
    return deckUpcoming(count);
  }
  function renderPlan() {
    var minutes = planMinutes();
    Array.prototype.forEach.call($("plan-times").children, function (b) {
      b.setAttribute("aria-checked", String(Number(b.dataset.min) === minutes));
    });
    var eps = planEpisodes();
    $("plan-count").textContent = eps.length;
    $("plan-count-label").textContent = eps.length === 1 ? "episode" : "episodes";
    var end = new Date(Date.now() + eps.length * MINUTES_PER_EPISODE * 60000);
    $("plan-end").textContent = eps.length ? "Done around " + end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
    var people = deckMode() === "us" ? partners() : [];
    var lines = [];
    if (people.length) lines.push("For you and " + nameList(people) + ": episodes none of you has watched.");
    lines.push(prefs.skipFillerNext ? "Skipping filler." : "Including filler.");
    $("plan-note").textContent = lines.join(" ");
    var list = $("plan-list");
    list.textContent = "";
    eps.forEach(function (ep) {
      var s = newSongs(ep.number);
      list.appendChild(topItem(ep.number, s.length ? "🎵" : kindOf(ep) === "filler" ? "Filler" : ""));
    });
    list.hidden = !eps.length;
    $("plan-empty").hidden = !!eps.length;
    $("plan-done").hidden = !eps.length;
    $("plan-done").textContent = eps.length ? "Mark " + (eps.length === 1 ? "It" : "All " + eps.length) + " Watched" + (people.length ? " Together" : "") : "";
  }
  /** Marks tonight's episodes watched, one at a time so they count for the calendar. */
  function finishPlan() {
    var eps = planEpisodes().map(function (e) { return e.number; });
    if (!eps.length) return;
    var before = {}, lastBefore = profile.last ? { n: profile.last.n, at: profile.last.at } : null;
    eps.forEach(function (n) { before[n] = stateOf(n); });
    withCelebration(function () {
      eps.forEach(function (n) { setState(n, "watched"); recordChanges([n]); });
      shareIfTogether(eps);
      noteWatched(eps[eps.length - 1]);
      updateArcProgress();
    });
    eps.forEach(function (n) { syncRow(n - 1); });
    updateProgress();
    applyFilters();
    closeDialog($("plan-sheet"));
    toast("Marked " + plural(eps.length, "episode") + " watched", "Undo", function () {
      eps.forEach(function (n) { setState(n, before[n]); recordChanges([n]); syncRow(n - 1); });
      shareIfTogether(eps);
      if (lastBefore) profile.last = lastBefore; else delete profile.last;
      saveProfile();
      updateProgress();
      applyFilters();
    });
  }
  function initExtras() {
    PLAN_TIMES.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "plan-time";
      b.setAttribute("role", "radio");
      b.dataset.min = t[0];
      b.textContent = t[1];
      b.addEventListener("click", function () { prefs.planMinutes = t[0]; savePrefs(); renderPlan(); pop(b); });
      $("plan-times").appendChild(b);
    });
    function openPlan() { renderPlan(); openDialog($("plan-sheet")); }
    $("plan-open").addEventListener("click", openPlan);
    $("menu-plan").addEventListener("click", openPlan);
    $("plan-done").addEventListener("click", finishPlan);
    function openRank() { renderRankSheet(); openDialog($("rank-sheet")); }
    $("rank-chip").addEventListener("click", openRank);
    $("menu-rank").addEventListener("click", openRank);
    $("race").addEventListener("click", openRank);
    $("badge-pop").addEventListener("click", function () { hideBadgePop(); openRank(); });
    $("menu-songs").addEventListener("click", function () { renderSongs(); openDialog($("songs-sheet")); });
    Array.prototype.forEach.call($("deck-mode").children, function (b) {
      b.addEventListener("click", function () {
        if (prefs.deckMode === b.dataset.mode || (!prefs.deckMode && b.dataset.mode === "me")) return;
        prefs.deckMode = b.dataset.mode;
        savePrefs();
        deck.revealed = {};
        renderDeckMode();
        renderDeck();
      });
    });
    checkBadges();
  }

  // ---------- Themes ----------
  var THEMES = [
    { id: "naruto", name: "Naruto", sub: "Jumpsuit orange" },
    { id: "akatsuki", name: "Akatsuki", sub: "Black and red clouds" },
    { id: "sharingan", name: "Sharingan", sub: "Uchiha red" },
    { id: "sand", name: "Hidden Sand", sub: "Desert gold" },
    { id: "hyuga", name: "Hyūga", sub: "Byakugan lavender" }
  ];
  function themeOf(id) { return THEMES.filter(function (t) { return t.id === id; })[0] || THEMES[0]; }
  /** Sets the theme on the page (the inline script in index.html does it before the first paint too). */
  function applyTheme(fade) {
    var t = themeOf(prefs.theme), root = document.documentElement;
    if (fade && !reduceMotion()) {
      root.classList.add("theme-fade");
      clearTimeout(applyTheme.timer);
      applyTheme.timer = setTimeout(function () { root.classList.remove("theme-fade"); }, 500);
    }
    if (t.id === "naruto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t.id);
    // the browser's bar colour follows the theme's background
    var cs = getComputedStyle(root);
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      var dark = (m.getAttribute("media") || "").indexOf("dark") !== -1;
      var v = cs.getPropertyValue(dark ? "--bg-dark" : "--bg-light").trim();
      if (v) m.setAttribute("content", v);
    });
    $("menu-theme-value").textContent = t.name;
    Array.prototype.forEach.call($("theme-list").children, function (b) {
      b.setAttribute("aria-checked", String(b.dataset.themePreview === t.id));
    });
  }
  function initThemes() {
    var leaf = document.querySelector(".app-mark .app-leaf");
    THEMES.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "theme-option";
      b.setAttribute("role", "radio");
      b.dataset.themePreview = t.id;
      var sw = document.createElement("span");
      sw.className = "theme-swatch";
      sw.setAttribute("aria-hidden", "true");
      if (leaf) sw.appendChild(leaf.cloneNode(true));
      var name = document.createElement("span"); name.className = "theme-name"; name.textContent = t.name;
      var sub = document.createElement("span"); sub.className = "theme-sub"; sub.textContent = t.sub;
      b.appendChild(sw); b.appendChild(name); b.appendChild(sub);
      b.addEventListener("click", function () {
        if (themeOf(prefs.theme).id === t.id) return;
        prefs.theme = t.id;
        savePrefs();
        applyTheme(true);
        pop(sw);
      });
      $("theme-list").appendChild(b);
    });
    $("menu-theme").addEventListener("click", function () { openDialog($("theme-sheet")); });
    applyTheme(false);
  }

  // ---------- Share images (1080 × 1920, story size) ----------
  var CARD_W = 1080, CARD_H = 1920;
  var RANK_BANDS = ["#8e8e93", "#2f5fb3", "#3f7d3a", "#2d5a3c", "#2b2b30", "#c8221d", "#e8590c"]; // as in styles.css
  var CARD_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  var leafPath = null;
  function leafShape() {
    if (leafPath === null) {
      var p = document.querySelector(".app-mark .app-leaf path");
      try { leafPath = p && window.Path2D ? new Path2D(p.getAttribute("d")) : false; } catch (e) { leafPath = false; }
    }
    return leafPath;
  }
  function cardColors() {
    var cs = getComputedStyle(document.documentElement), g = function (n) { return cs.getPropertyValue(n).trim(); };
    return { accent: g("--accent"), hi: g("--accent-hi"), deep: g("--accent-deep"), on: g("--on-accent"), glass: g("--card-glass") || "rgba(255,255,255,0.35)" };
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function font(weight, size, family) { return weight + " " + size + "px " + (family || CARD_FONT); }
  /** Draws text centred (or from x when align is "left"), wrapped to maxW; returns the y after it. */
  function textBlock(ctx, text, x, y, maxW, lineH, maxLines, align) {
    ctx.textAlign = align || "center";
    var words = String(text).split(" "), lines = [], line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (ctx.measureText(last + "…").width > maxW && last.length) last = last.slice(0, -1);
      lines[maxLines - 1] = last + "…";
    }
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lineH); });
    return y + lines.length * lineH;
  }
  function spaced(ctx, px) { if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px"; }
  function paintLeaf(ctx, x, y, size, color, width) {
    var path = leafShape();
    if (!path) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 100, size / 100);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * 100 / size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.restore();
  }
  function drawHeadband(ctx, cx, cy, w, rank) {
    var bandH = w * 0.32, pw = w * 0.58, ph = w * 0.42;
    var band = ctx.createLinearGradient(0, cy - bandH / 2, 0, cy + bandH / 2);
    var c = RANK_BANDS[rank] || RANK_BANDS[1];
    band.addColorStop(0, c); band.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = w * 0.06; ctx.shadowOffsetY = w * 0.02;
    rr(ctx, cx - w / 2, cy - bandH / 2, w, bandH, bandH * 0.18); ctx.fillStyle = c; ctx.fill();
    ctx.shadowColor = "transparent";
    rr(ctx, cx - w / 2, cy - bandH / 2, w, bandH, bandH * 0.18); ctx.fillStyle = band; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
    ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = w * 0.05; ctx.shadowOffsetY = w * 0.02;
    var plate = ctx.createLinearGradient(cx - pw / 2, cy - ph / 2, cx + pw / 2, cy + ph / 2);
    plate.addColorStop(0, "#fbfcfd"); plate.addColorStop(0.45, "#d5dbe2"); plate.addColorStop(1, "#9aa4b0");
    rr(ctx, cx - pw / 2, cy - ph / 2, pw, ph, ph * 0.2); ctx.fillStyle = plate; ctx.fill();
    ctx.restore();
    paintLeaf(ctx, cx - ph * 0.36, cy - ph * 0.36, ph * 0.72, "#3b424b", ph * 0.05);
  }
  /** Background, logo and link shared by every card. */
  function drawFrame(ctx, col) {
    var g = ctx.createRadialGradient(CARD_W, 0, 0, CARD_W, 0, CARD_H * 1.1);
    g.addColorStop(0, col.hi); g.addColorStop(0.45, col.accent); g.addColorStop(1, col.deep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.save(); // a big faint leaf in the corner
    ctx.globalAlpha = 0.09;
    paintLeaf(ctx, -260, CARD_H - 900, 1100, col.on, 34);
    ctx.restore();
    // header: the app's mark and name
    rr(ctx, 90, 110, 96, 96, 24); ctx.fillStyle = col.glass; ctx.fill();
    paintLeaf(ctx, 100, 120, 76, col.on, 7);
    ctx.fillStyle = col.on;
    ctx.font = font(700, 46);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Naruto Filler Guide", 212, 160);
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 0.8;
    ctx.font = font(600, 36);
    ctx.textAlign = "center";
    ctx.fillText(appLink().replace(/^https?:\/\//, "").replace(/\/$/, ""), CARD_W / 2, CARD_H - 110);
    ctx.globalAlpha = 1;
  }
  function whose() { return profile.name ? profile.name + "'s" : "My"; }
  function drawWrappedCard(ctx, col) {
    var d = wrappedData(), c = myCanon(), r = rankFor(c);
    ctx.fillStyle = col.on;
    ctx.font = font(800, 104);
    textBlock(ctx, whose() + " Naruto", CARD_W / 2, 380, 940, 112, 2);
    ctx.font = font(500, 40);
    ctx.globalAlpha = 0.85;
    ctx.fillText("So far · " + new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }), CARD_W / 2, 460);
    ctx.globalAlpha = 1;
    [[d.count, d.count === 1 ? "episode" : "episodes"], [d.hours, d.hours === 1 ? "hour" : "hours"], [d.days, d.days === 1 ? "day" : "days"]].forEach(function (s, i) {
      var x = 90 + i * 310;
      rr(ctx, x, 530, 280, 230, 36); ctx.fillStyle = col.glass; ctx.fill();
      ctx.fillStyle = col.on;
      ctx.font = font(800, 110);
      ctx.fillText(String(s[0]), x + 140, 670);
      ctx.font = font(600, 40);
      ctx.fillText(s[1], x + 140, 728);
    });
    drawHeadband(ctx, CARD_W / 2, 900, 380, r);
    ctx.fillStyle = col.on;
    ctx.font = font(800, 76);
    ctx.fillText(RANKS[r].name, CARD_W / 2, 1105);
    ctx.font = font(500, 38);
    ctx.globalAlpha = 0.85;
    ctx.fillText(c + " canon episodes · " + plural(badgeCount(), "badge"), CARD_W / 2, 1163);
    ctx.globalAlpha = 1;
    var lines = [];
    if (d.top.length) lines.push(["Top episode", "★" + ratings[d.top[0]] + "  Ep " + d.top[0] + " · " + EPISODES[d.top[0] - 1].title]);
    if (d.arc) lines.push(["Favorite arc", d.arc.name]);
    if (d.longest >= 2) lines.push(["Longest streak", "🔥 " + d.longest + " days in a row"]);
    else if (d.react) lines.push(["Go-to reaction", d.react.e + " × " + d.react.count]);
    if (!lines.length) lines.push(["Just getting started", "Believe it!"]);
    var y = 1230;
    lines.slice(0, 3).forEach(function (l) {
      rr(ctx, 90, y, 900, 150, 32); ctx.fillStyle = col.glass; ctx.fill();
      ctx.fillStyle = col.on;
      ctx.font = font(700, 30);
      ctx.textAlign = "left";
      spaced(ctx, 3);
      ctx.fillText(l[0].toUpperCase(), 140, y + 54);
      spaced(ctx, 0);
      ctx.textAlign = "left";
      ctx.font = font(600, 44) + ", " + EMOJI_FONT;
      textBlock(ctx, l[1], 140, y + 112, 800, 50, 1, "left");
      ctx.textAlign = "center";
      y += 170;
    });
  }
  function drawRankCard(ctx, col) {
    var c = myCanon(), r = rankFor(c), next = RANKS[r + 1];
    drawHeadband(ctx, CARD_W / 2, 760, 700, r);
    ctx.fillStyle = col.on;
    ctx.font = font(700, 44);
    spaced(ctx, 8);
    ctx.globalAlpha = 0.85;
    ctx.fillText((whose() + " rank").toUpperCase(), CARD_W / 2, 1130);
    ctx.globalAlpha = 1;
    spaced(ctx, 0);
    ctx.font = font(800, 160);
    textBlock(ctx, RANKS[r].name, CARD_W / 2, 1290, 960, 160, 1);
    ctx.font = font(600, 48);
    ctx.fillText(c + " of " + canonEpisodes.length + " canon episodes watched", CARD_W / 2, 1390);
    var pct = next ? (c - RANKS[r].at) / (next.at - RANKS[r].at) : 1;
    rr(ctx, 160, 1450, 760, 30, 15); ctx.fillStyle = col.glass; ctx.fill();
    rr(ctx, 160, 1450, Math.max(30, 760 * pct), 30, 15); ctx.fillStyle = col.on; ctx.fill();
    ctx.font = font(500, 40);
    ctx.globalAlpha = 0.85;
    ctx.fillText(next ? "Next: " + next.name + " at " + next.at : "The highest rank. Believe it!", CARD_W / 2, 1550);
    ctx.globalAlpha = 1;
  }
  function drawBadgeCard(ctx, col, b) {
    ctx.beginPath(); ctx.arc(CARD_W / 2, 780, 300, 0, Math.PI * 2); ctx.fillStyle = col.glass; ctx.fill();
    ctx.font = font(400, 330, EMOJI_FONT);
    ctx.fillStyle = "#000"; // emoji keep their own colours but take the fill's transparency
    ctx.textBaseline = "middle";
    ctx.fillText(b.icon, CARD_W / 2, 800);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = col.on;
    ctx.font = font(700, 44);
    spaced(ctx, 8);
    ctx.globalAlpha = 0.85;
    ctx.fillText("BADGE EARNED", CARD_W / 2, 1210);
    ctx.globalAlpha = 1;
    spaced(ctx, 0);
    ctx.font = font(800, 120);
    var y = textBlock(ctx, b.name, CARD_W / 2, 1350, 940, 124, 2);
    ctx.font = font(500, 48);
    y = textBlock(ctx, b.desc, CARD_W / 2, y + 10, 900, 60, 2);
    ctx.font = font(600, 40);
    ctx.globalAlpha = 0.85;
    var got = profile.badges[b.id];
    ctx.fillText((profile.name ? profile.name + " · " : "") + RANKS[myRank()].name + (got ? " · " + formatDate(new Date(got)) : ""), CARD_W / 2, y + 40);
    ctx.globalAlpha = 1;
  }
  var share = { blob: null, url: "", file: "" };
  /** Draws a card ("wrapped", "rank" or a badge) and shows it with Share and Save buttons. */
  function shareImage(kind, badge) {
    var canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    var ctx = canvas.getContext("2d"), col = cardColors();
    drawFrame(ctx, col);
    ctx.textAlign = "center";
    if (kind === "wrapped") drawWrappedCard(ctx, col);
    else if (kind === "rank") drawRankCard(ctx, col);
    else drawBadgeCard(ctx, col, badge);
    var title = kind === "wrapped" ? "Share Your Wrapped" : kind === "rank" ? "Share Your Rank" : "Share Badge";
    share.file = "naruto-" + (kind === "badge" ? "badge-" + badge.id : kind) + ".png";
    share.text = kind === "wrapped" ? whose() + " Naruto so far" : kind === "rank" ? "I'm " + (/^[AEIOU]/.test(RANKS[myRank()].name) ? "an " : "a ") + RANKS[myRank()].name + " in Naruto!" : "Badge earned: " + badge.name;
    canvas.toBlob(function (blob) {
      if (!blob) { toast("Couldn't make the image"); return; }
      if (share.url) URL.revokeObjectURL(share.url);
      share.blob = blob;
      share.url = URL.createObjectURL(blob);
      $("share-img").src = share.url;
      $("share-img").alt = share.text;
      $("share-title").textContent = title;
      var canShare = false;
      try { canShare = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File([blob], share.file, { type: "image/png" })] })); } catch (e) { canShare = false; }
      $("share-send").hidden = !canShare;
      $("share-save").className = canShare ? "button-plain" : "button-filled";
      openDialog($("share-sheet"), canShare ? $("share-send") : $("share-save"));
    }, "image/png");
  }
  function initShare() {
    $("share-send").addEventListener("click", function () {
      if (!share.blob) return;
      var f = new File([share.blob], share.file, { type: "image/png" });
      navigator.share({ files: [f], title: "Naruto Filler Guide", text: share.text }).catch(function (err) {
        if (err && err.name !== "AbortError") toast("Couldn't share. Try Save Image instead.");
      });
    });
    $("share-save").addEventListener("click", function () {
      if (!share.url) return;
      var a = document.createElement("a");
      a.href = share.url;
      a.download = share.file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("Image saved");
    });
    $("wrapped-image").addEventListener("click", function () { shareImage("wrapped"); });
    $("rank-share").addEventListener("click", function () { shareImage("rank"); });
    $("celebrate-share").addEventListener("click", function () { shareImage("rank"); });
    $("award-grid").addEventListener("click", function (e) {
      var card = e.target.closest(".award.earned");
      if (card) shareImage("badge", BADGES.filter(function (b) { return b.id === card.dataset.id; })[0]);
    });
  }

  // ---------- Backup ----------
  function exportBackup() {
    var data = {
      app: "naruto-filler-guide", backup: 1, exported: new Date().toISOString(), name: profile.name || "",
      watched: sorted(watched), skipped: sorted(skipped), changedAt: changedAt, ratings: ratings, favorites: sorted(favorites),
      notes: notes, badges: profile.badges || {}
    };
    var file = "naruto-filler-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    // Phones: the share sheet ("Save to Files") is more reliable than a download, especially
    // in an installed iPhone app
    if (platform.mobile && window.File && navigator.canShare) {
      var shared = new File([blob], file, { type: "application/json" });
      if (navigator.canShare({ files: [shared] })) {
        navigator.share({ files: [shared], title: "Naruto Filler Guide backup" })
          .then(function () { toast("Backup saved"); })
          .catch(function (err) { if (!err || err.name !== "AbortError") download(); });
        return;
      }
    }
    download();
    function download() {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast("Backup saved: " + file);
    }
  }
  var pendingRestore = null;
  function readBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var d;
      try { d = JSON.parse(reader.result); } catch (e) { d = null; }
      var nums = function (a) { return Array.isArray(a) ? a.filter(function (n) { return Number.isInteger(n) && n >= 1 && n <= TOTAL; }) : null; };
      if (!d || d.app !== "naruto-filler-guide" || !nums(d.watched)) { toast("That file isn't a Naruto Filler Guide backup"); return; }
      pendingRestore = {
        watched: nums(d.watched), skipped: nums(d.skipped) || [], favorites: nums(d.favorites) || [],
        ratings: d.ratings && typeof d.ratings === "object" ? d.ratings : {},
        name: typeof d.name === "string" ? d.name.slice(0, 30) : "", exported: d.exported,
        notes: d.notes && typeof d.notes === "object" ? cleanNotes(d.notes) : null, // older backups have none
        changedAt: d.changedAt && typeof d.changedAt === "object" ? d.changedAt : {},
        badges: d.badges && typeof d.badges === "object" ? d.badges : {}
      };
      var when = Date.parse(d.exported);
      $("restore-text").textContent = "From " + (when ? formatDate(new Date(when)) : "an unknown date") + ": " +
        pendingRestore.watched.length + " watched, " + pendingRestore.skipped.length + " skipped, " +
        Object.keys(pendingRestore.ratings).length + " ratings, " + pendingRestore.favorites.length + " favorites" +
        (pendingRestore.notes ? ", " + Object.keys(pendingRestore.notes).length + " notes" : "") + ". " +
        "This replaces what's on this device" + (sync.roomId ? " (and your progress on the shared list)" : "") + ".";
      openDialog($("restore-sheet"), $("restore-yes"));
    };
    reader.readAsText(file);
  }
  function applyRestore() {
    var r = pendingRestore;
    if (!r) return;
    var changed = [];
    for (var n = 1; n <= TOTAL; n++) {
      var st = r.watched.indexOf(n) !== -1 ? "watched" : r.skipped.indexOf(n) !== -1 ? "skipped" : "none";
      if (stateOf(n) !== st) { setState(n, st); changed.push(n); }
    }
    // keep the backup's dates (the watch calendar uses them) unless this device changed the episode since
    if (changed.length) recordChanges(changed, function (n) {
      var t = r.changedAt[n];
      return typeof t === "number" && t > (changedAt[n] || 0) && t <= Date.now() ? t : 0;
    });
    ratings = {};
    Object.keys(r.ratings).forEach(function (k) {
      var n = Number(k), v = r.ratings[k];
      if (n >= 1 && n <= TOTAL && Number.isInteger(v) && v >= 1 && v <= 5) ratings[n] = v;
    });
    favorites = new Set(r.favorites);
    if (r.notes) { notes = r.notes; save(STORAGE.notes, notes); }
    // badges stay earned: keep the earliest date of each
    Object.keys(r.badges).forEach(function (id) {
      var t = r.badges[id];
      if (typeof t === "number" && BADGES.some(function (b) { return b.id === id; }) && !(profile.badges[id] <= t)) profile.badges[id] = t;
    });
    if (!profile.name && r.name) { profile.name = r.name; saveProfile(); renderName(); }
    savePersonal();
    for (var i = 0; i < TOTAL; i++) syncRow(i);
    updateProgress();
    applyFilters();
    pendingRestore = null;
    closeDialog($("restore-sheet"));
    toast("Backup restored");
  }

  // ---------- Stars ----------
  function buildStars(el, label, onPick) {
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", label);
    for (var i = 1; i <= 5; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "star";
      b.dataset.v = i;
      b.setAttribute("aria-label", i + " star" + (i > 1 ? "s" : ""));
      b.innerHTML = STAR_SVG;
      el.appendChild(b);
    }
    el.addEventListener("click", function (e) {
      var b = e.target.closest(".star");
      if (!b) return;
      onPick(Number(b.dataset.v));
      if (b.dataset.v === "5" && b.classList.contains("on")) replay(el, "burst"); else el.classList.remove("burst");
    });
  }
  function renderStars(el, value) {
    Array.prototype.forEach.call(el.children, function (b) {
      var v = Number(b.dataset.v);
      b.classList.toggle("on", v <= value);
      b.setAttribute("aria-pressed", String(v === value));
    });
  }
  function starText(v) { return "★★★★★".slice(0, v) + "☆☆☆☆☆".slice(0, 5 - v); }
  /** Tapping the current rating again clears it. */
  function pickRating(n, v) { setRating(n, ratings[n] === v ? 0 : v); }

  /** Updates everything that shows one episode's rating/favorite. */
  function refreshPersonal(n) {
    if (rows.length === TOTAL) syncRow(n - 1);
    updateArcProgress();
    if ($("top-sheet").open) renderTop();
    if (epSheet.n === n) renderEpSheet();
    if (ratePrompt.n === n) renderRatePrompt();
    checkBadges();
  }

  // ---------- "How was it?" after Watched ----------
  var ratePrompt = { n: 0, timer: null };
  function showRatePrompt(n) {
    clearTimeout(ratePrompt.timer);
    ratePrompt.n = n;
    $("rate-prompt").hidden = !n;
    if (!n) return;
    renderRatePrompt();
    ratePrompt.timer = setTimeout(function () { showRatePrompt(0); }, 20000);
  }
  function renderRatePrompt() {
    var n = ratePrompt.n;
    if (!n) return;
    $("rate-text").textContent = "Rate Ep " + n;
    renderStars($("rate-stars"), ratings[n] || 0);
    $("rate-fav").setAttribute("aria-pressed", String(favorites.has(n)));
    // Watched together? One tap marks it for the others too
    var others = sync.roomId && !prefs.together ? partners() : [];
    var missing = others.filter(function (m) { return !(m.p[n] && m.p[n].state === "watched"); });
    var too = $("rate-too");
    too.hidden = !others.length;
    if (others.length) {
      too.disabled = !missing.length;
      too.textContent = missing.length ? "✓ " + (others.length > 1 ? "Everyone" : others[0].name) + " watched it too"
        : (others.length > 1 ? "Everyone" : others[0].name) + " has it too";
    }
  }
  function initRatePrompt() {
    buildStars($("rate-stars"), "Rate this episode", function (v) {
      var n = ratePrompt.n;
      if (!n) return;
      pickRating(n, v);
      clearTimeout(ratePrompt.timer);
      ratePrompt.timer = setTimeout(function () { showRatePrompt(0); }, 1500);
    });
    $("rate-fav").addEventListener("click", function () { if (ratePrompt.n) toggleFavorite(ratePrompt.n); });
    $("rate-close").addEventListener("click", function () { showRatePrompt(0); });
    $("rate-too").addEventListener("click", function () {
      var n = ratePrompt.n;
      if (!n) return;
      var entries = {};
      entries[n] = { w: true, s: false, t: stamp() };
      markForOthers(entries);
      renderRatePrompt();
      clearTimeout(ratePrompt.timer);
      ratePrompt.timer = setTimeout(function () { showRatePrompt(0); }, 8000);
    });
  }

  // ---------- Episode details ----------
  var epSheet = { n: 0 };
  function openEpSheet(n) {
    epSheet.n = n;
    epSheet.revealed = false;
    renderEpSheet();
    openDialog($("ep-sheet"));
  }
  function renderEpSheet() {
    var n = epSheet.n;
    if (!n) return;
    var ep = EPISODES[n - 1], kind = kindOf(ep);
    $("ep-sheet-title").textContent = "Episode " + n;
    $("ep-sheet-kind").textContent = kind === "filler" ? "Filler" : "Canon";
    $("ep-sheet-kind").dataset.kind = kind;
    $("ep-sheet-name").textContent = ep.title;
    var hideTitle = prefs.shield && !watched.has(n) && !epSheet.revealed;
    $("ep-sheet-name").classList.toggle("is-hidden-title", hideTitle);
    $("ep-sheet-reveal").hidden = !hideTitle;
    $("ep-sheet-arc").textContent = ep.arc;
    $("ep-sheet-arc").classList.toggle("is-hidden-title", hideTitle && !arcStarted(arcOf[n - 1]));
    $("ep-sheet-op").textContent = songText("op", n);
    $("ep-sheet-ed").textContent = songText("ed", n);
    $("ep-sheet-chapters").textContent = ep.chapters ? (ep.chapters.indexOf(",") === -1 ? "Chapter " : "Chapters ") + ep.chapters : "None (anime-only)";
    var when = watched.has(n) && changedAt[n];
    $("ep-sheet-date-row").hidden = !when;
    if (when) $("ep-sheet-date").textContent = formatDate(new Date(changedAt[n]));
    var state = stateOf(n);
    Array.prototype.forEach.call($("ep-sheet-state").children, function (b) {
      b.setAttribute("aria-checked", String(b.dataset.state === state));
    });
    syncSegment($("ep-sheet-state"));
    renderStars($("ep-sheet-stars"), ratings[n] || 0);
    var mine = notes[n] || {};
    Array.prototype.forEach.call($("ep-sheet-reactions").children, function (b) {
      b.setAttribute("aria-pressed", String(mine.e === b.dataset.e));
    });
    if (document.activeElement !== $("ep-sheet-note") || epSheet.noteFor !== n) $("ep-sheet-note").value = mine.x || "";
    epSheet.noteFor = n;
    $("ep-sheet-fav").setAttribute("aria-pressed", String(favorites.has(n)));
    $("ep-sheet-fav-label").textContent = favorites.has(n) ? "Favorite" : "Add to Favorites";

    var box = $("ep-sheet-partners");
    box.textContent = "";
    if (sync.roomId) partners().forEach(function (m) {
      var st = m.p[n] ? m.p[n].state : "none";
      var row = document.createElement("div");
      row.className = "row person-row";
      var text = document.createElement("span");
      text.className = "person-text";
      var name = document.createElement("span");
      name.className = "person-name";
      name.textContent = m.name;
      var sub = document.createElement("span");
      sub.className = "person-state";
      sub.textContent = st === "watched" ? "Watched " + formatDate(new Date(m.p[n].t)) : st === "skipped" ? "Skipped" : "Not watched yet";
      text.appendChild(name);
      text.appendChild(sub);
      var their = m.n[n];
      if (their) {
        var note = document.createElement("span");
        note.className = "person-note";
        if (their.e) {
          var em = document.createElement("span");
          em.className = "person-react";
          em.textContent = their.e;
          note.appendChild(em);
        }
        if (their.x) {
          var said = document.createElement("span");
          said.className = "person-said";
          said.textContent = their.x;
          // their note may give the episode away
          if (hideTitle) { said.classList.add("is-hidden-title"); said.setAttribute("aria-label", "Note hidden by the spoiler shield"); }
          note.appendChild(said);
        }
        text.appendChild(note);
      }
      row.appendChild(text);
      if (m.r[n] || m.f[n]) {
        var val = document.createElement("span");
        val.className = "partner-rating";
        val.textContent = (m.r[n] ? starText(m.r[n]) : "") + (m.f[n] ? "  ♥" : "");
        val.setAttribute("aria-label", (m.r[n] ? m.r[n] + " stars" : "No rating") + (m.f[n] ? ", favorite" : ""));
        row.appendChild(val);
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "link-button person-toggle";
      btn.textContent = st === "watched" ? "Unmark" : "Mark watched";
      btn.setAttribute("aria-label", (st === "watched" ? "Unmark episode " + n + " for " : "Mark episode " + n + " watched for ") + m.name);
      btn.addEventListener("click", function () {
        var entries = {};
        entries[n] = { w: st !== "watched", s: false, t: stamp() };
        markForOthers(entries, m.id);
      });
      row.appendChild(btn);
      box.appendChild(row);
    });
    box.hidden = !box.children.length;
  }
  function initEpSheet() {
    buildStars($("ep-sheet-stars"), "Your rating", function (v) { pickRating(epSheet.n, v); });
    $("ep-sheet-fav").addEventListener("click", function () { toggleFavorite(epSheet.n); });
    $("ep-sheet-reveal").addEventListener("click", function () { epSheet.revealed = true; renderEpSheet(); });
    REACTIONS.forEach(function (r) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "reaction";
      b.dataset.e = r[0];
      b.textContent = r[0];
      b.title = r[1];
      b.setAttribute("aria-label", r[1]);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        var n = epSheet.n, on = !(notes[n] && notes[n].e === r[0]);
        setNote(n, { e: on ? r[0] : "" });
        renderEpSheet();
        if (on) pop(b);
      });
      $("ep-sheet-reactions").appendChild(b);
    });
    $("ep-sheet-note").addEventListener("input", function () { setNote(epSheet.n, { x: this.value }); });
    Array.prototype.forEach.call($("ep-sheet-state").children, function (b) {
      b.addEventListener("click", function () {
        var n = epSheet.n;
        if (stateOf(n) === b.dataset.state) return;
        withCelebration(function () {
          setState(n, b.dataset.state);
          recordChanges([n]);
          if (b.dataset.state === "watched") noteWatched(n);
          updateArcProgress();
        });
        syncRow(n - 1);
        updateProgress();
        applyFilters();
        renderEpSheet();
      });
    });
    $("partner-line").addEventListener("click", function () { openEpSheet(Number($("partner-line").dataset.n)); });
    setInterval(function () { renderPartner(); updateStreak(); }, 60000); // keep "2h ago" and the streak current
  }

  // ---------- Ratings & Favorites ----------
  function topItem(n, extra) {
    var ep = EPISODES[n - 1];
    var b = document.createElement("button");
    b.type = "button";
    b.className = "row row-button top-item";
    b.dataset.type = kindOf(ep);
    b.classList.toggle("unwatched", !watched.has(n));
    var num = document.createElement("span");
    num.className = "ep-number";
    num.textContent = n;
    var title = document.createElement("span");
    title.className = "row-label";
    title.textContent = ep.title;
    var val = document.createElement("span");
    val.className = "row-value top-value";
    val.textContent = extra;
    b.appendChild(num);
    b.appendChild(title);
    b.appendChild(val);
    b.addEventListener("click", function () { openEpSheet(n); });
    return b;
  }
  function renderTop() {
    var rated = Object.keys(ratings).map(Number).sort(function (a, b) { return ratings[b] - ratings[a] || a - b; });
    $("top-rated").textContent = "";
    rated.forEach(function (n) { $("top-rated").appendChild(topItem(n, "★ " + ratings[n])); });
    $("top-rated").hidden = !rated.length;
    $("top-rated-empty").hidden = !!rated.length;
    var favs = sorted(favorites);
    $("fav-list").textContent = "";
    favs.forEach(function (n) { $("fav-list").appendChild(topItem(n, "♥")); });
    $("fav-list").hidden = !favs.length;
    $("fav-empty").hidden = !!favs.length;
    var noted = [];
    for (var n = 1; n <= TOTAL; n++) if (reactionsFor(n).length || hasNoteText(n)) noted.push(n);
    $("note-list").textContent = "";
    noted.forEach(function (n) {
      $("note-list").appendChild(topItem(n, reactionsFor(n).slice(0, 3).join("") + (hasNoteText(n) ? " 💬" : "")));
    });
    $("note-list").hidden = !noted.length;
    $("note-empty").hidden = !!noted.length;
  }

  // ---------- Your name (asked on first launch) ----------
  var welcome = { queued: [] };
  function openWelcome(editing) {
    $("welcome-title").textContent = editing ? "Your Name" : "Welcome!";
    $("welcome-text").textContent = editing
      ? "This is the name the people you share your list with see."
      : "What's your first name? It's shown to the people you share your watch list with.";
    $("welcome-skip").textContent = editing ? "Cancel" : "Not Now";
    $("welcome-name").value = profile.name || "";
    openDialog($("welcome-sheet"), $("welcome-name"));
    drawLeaf($("welcome-sheet").querySelector(".welcome-mark"), 1600);
  }
  /** Runs fn once the startup animation is over and the welcome screen (if due) is answered. */
  function afterWelcome(fn) {
    if (welcome.pending || $("welcome-sheet").open) welcome.queued.push(fn); else whenSplashDone(fn);
  }
  function renderName() { $("menu-name-value").textContent = profile.name || "Add"; }
  function initWelcome() {
    $("welcome-form").addEventListener("submit", function (e) {
      e.preventDefault();
      profile.name = $("welcome-name").value.trim().slice(0, 30);
      profile.asked = true;
      saveProfile();
      renderName();
      renderSync();
      if (profile.name) toast("Hi, " + profile.name + "!");
      closeDialog($("welcome-sheet"));
    });
    $("welcome-skip").addEventListener("click", function () {
      if (!profile.asked) { profile.asked = true; saveProfile(); } // right away, not when the close animation ends
      closeDialog($("welcome-sheet"));
    });
    $("welcome-sheet").addEventListener("close", function () {
      if (!profile.asked) { profile.asked = true; saveProfile(); }
      var q = welcome.queued; welcome.queued = [];
      q.forEach(function (fn) { fn(); });
    });
    $("welcome-sheet").querySelector(".welcome-mark").innerHTML = document.querySelector(".app-mark").innerHTML;
    $("menu-name").addEventListener("click", function () { openWelcome(true); });
    $("sync-name").addEventListener("click", function () { openWelcome(true); });
    renderName();
    if (!profile.asked) {
      welcome.pending = true; // opens once the startup animation is over
      whenSplashDone(function () { welcome.pending = false; openWelcome(false); });
    }
  }

  // ---------- Mark several episodes at once ----------
  /** Opens a sheet (closing any other open sheet first, like iOS). */
  function openDialog(dlg, focusEl) {
    document.querySelectorAll("dialog.sheet").forEach(function (d) { if (d !== dlg) closeDialog(d); });
    if (!dlg.open) { if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", ""); }
    (focusEl || dlg.querySelector(".sheet-title")).focus();
  }
  function closeAllSheets() {
    document.querySelectorAll("dialog.sheet").forEach(closeDialog);
  }
  function closeDialog(dlg) {
    if (typeof dlg.close === "function" && dlg.open) dlg.close(); else dlg.removeAttribute("open");
  }

  function bulkRange() {
    var a = parseInt($("bulk-from").value, 10), b = parseInt($("bulk-to").value, 10);
    if (!(a >= 1 && a <= TOTAL && b >= 1 && b <= TOTAL)) return null;
    if (a > b) { var t = a; a = b; b = t; }
    var skipFiller = $("bulk-skip-filler").checked;
    var nums = [];
    for (var n = a; n <= b; n++) {
      if (skipFiller && kindOf(EPISODES[n - 1]) === "filler") continue;
      nums.push(n);
    }
    return { from: a, to: b, nums: nums };
  }
  function renderBulkSummary() {
    var r = bulkRange();
    $("bulk-watch").disabled = $("bulk-unwatch").disabled = !r || !r.nums.length;
    if (!r) { $("bulk-summary").textContent = "Enter episode numbers from 1 to " + TOTAL + "."; return; }
    var skipped = r.to - r.from + 1 - r.nums.length;
    $("bulk-summary").textContent = (r.from === r.to ? "Episode " + r.from : "Episodes " + r.from + "–" + r.to) + ": " +
      r.nums.length + " episode" + (r.nums.length === 1 ? "" : "s") +
      (skipped ? " (" + skipped + " filler skipped)" : "") + ".";
  }
  function refreshAfterBulk(nums) {
    nums.forEach(function (n) { syncRow(n - 1); });
    updateProgress();
    applyFilters();
  }
  function applyStates(nums, stateFor) {
    nums.forEach(function (n) { setState(n, stateFor(n)); });
    recordChanges(nums);
    refreshAfterBulk(nums);
  }
  function applyBulk(markWatched) {
    var r = bulkRange();
    if (!r) return;
    var target = markWatched ? "watched" : "none";
    var changed = r.nums.filter(function (n) { return stateOf(n) !== target; });
    closeDialog($("bulk-sheet"));
    if (!changed.length) {
      toast(markWatched ? "Those episodes were already watched" : "Those episodes weren't marked as watched");
      return;
    }
    var before = {};
    changed.forEach(function (n) { before[n] = stateOf(n); });
    applyStates(changed, function () { return target; });
    toast((markWatched ? "Marked " : "Unmarked ") + changed.length + " episode" + (changed.length === 1 ? "" : "s"),
      "Undo", function () { applyStates(changed, function (n) { return before[n]; }); });
  }
  function openBulk() {
    $("bulk-from").value = "1";
    $("bulk-to").value = "";
    $("bulk-skip-filler").checked = false;
    renderBulkSummary();
    openDialog($("bulk-sheet"), $("bulk-to"));
  }
  function initBulk() {

    ["bulk-from", "bulk-to"].forEach(function (id) { $(id).addEventListener("input", renderBulkSummary); });
    $("bulk-skip-filler").addEventListener("change", renderBulkSummary);
    $("bulk-form").addEventListener("submit", function (e) { e.preventDefault(); applyBulk(true); });
    $("bulk-unwatch").addEventListener("click", function () { applyBulk(false); });
    $("bulk-close").addEventListener("click", function () { closeDialog($("bulk-sheet")); });
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
    var saved = skip.length * MINUTES_PER_EPISODE; // compact so it fits its box: "~34h 30m"
    $("guide-time-saved").textContent = "~" + Math.floor(saved / 60) + "h" + (saved % 60 ? " " + (saved % 60) + "m" : "");
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

  // ---------- Menu and sheets ----------
  function initSheets() {
    document.querySelectorAll("dialog.sheet").forEach(function (dlg) {
      dlg.addEventListener("click", function (e) { if (e.target === dlg) closeDialog(dlg); }); // backdrop
      dlg.querySelectorAll("[data-close]").forEach(function (b) {
        b.addEventListener("click", function () { closeDialog(dlg); });
      });
    });
    $("menu-open").addEventListener("click", function () {
      showResetConfirm(false, true);
      openDialog($("menu-sheet"));
    });
    $("menu-bulk").addEventListener("click", openBulk);
    $("menu-guide").addEventListener("click", function () { openDialog($("guide-sheet")); });
    $("menu-top").addEventListener("click", function () { renderTop(); openDialog($("top-sheet")); });
    $("menu-wrapped").addEventListener("click", function () { renderWrapped(); openDialog($("wrapped-sheet")); });
    $("wrapped-share").addEventListener("click", shareWrapped);
    $("menu-export").addEventListener("click", function () { closeDialog($("menu-sheet")); exportBackup(); });
    $("menu-import").addEventListener("click", function () { $("restore-file").click(); });
    $("restore-file").addEventListener("change", function () {
      var f = $("restore-file").files[0];
      if (f) readBackup(f);
      $("restore-file").value = "";
    });
    $("restore-yes").addEventListener("click", applyRestore);
    $("celebrate-ok").addEventListener("click", function () { closeDialog($("celebrate-sheet")); });
    $("startup-animation").checked = prefs.splash !== false;
    $("startup-animation").addEventListener("change", function () {
      prefs.splash = $("startup-animation").checked;
      savePrefs();
    });
    $("spoiler-shield").checked = !!prefs.shield;
    $("spoiler-shield").addEventListener("change", function () {
      prefs.shield = $("spoiler-shield").checked;
      savePrefs();
      applyShield();
    });
    $("menu-sync").addEventListener("click", openSyncSheet);
    $("sync-chip").addEventListener("click", openSyncSheet);
    $("invite-banner").addEventListener("click", openSyncSheet);
  }
  function openSyncSheet() { openDialog($("sync-sheet")); }

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
    s = String(s || "");
    var link = s.match(/join=([0-9A-Za-z-]+)/); // a whole invite link was pasted
    if (link) s = link[1];
    return s.toUpperCase().replace(/[^0-9A-Z]/g, "");
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
      if (t || watched.has(n) || skipped.has(n)) out[n] = entryOf(n, t);
    }
    return out;
  }

  /**
   * Merges your saved progress from the shared list into this device. mine is null the first
   * time you're on this list with this version: then the older single shared list (legacy)
   * is carried over, and all your progress is uploaded.
   */
  function applyRemote(mine, legacy) {
    if (mine === null) {
      if (legacy && Object.keys(legacy).length) mergeEntries(legacy);
      return allEntries();
    }
    var toPush = mergeEntries(mine);
    // Changes made while offline (even if the app was closed) also go to the others when
    // you watch together
    if (prefs.together && Object.keys(toPush).length) markForOthers(toPush);
    return toPush;
  }

  /** For each episode the most recent change wins. Returns entries where this device is newer. */
  function mergeEntries(remote) {
    var changed = [];
    var toPush = {};
    for (var n = 1; n <= TOTAL; n++) {
      var r = remote[n];
      var valid = r && typeof r.w === "boolean" && typeof r.t === "number";
      var lw = watched.has(n), ls = skipped.has(n);
      var lt = changedAt[n] || 0;
      if (!valid) {
        if (lt || lw || ls) toPush[n] = entryOf(n, lt);
        continue;
      }
      var rs = r.s === true && !r.w; // older versions had no "s"
      if (r.t > lt || (r.t === lt && r.w && !lw)) {
        if (r.w !== lw || rs !== ls) {
          setState(n, r.w ? "watched" : rs ? "skipped" : "none");
          changed.push(n);
        }
        changedAt[n] = r.t;
        lastStamp = Math.max(lastStamp, r.t);
      } else if (lt > r.t || (lt === r.t && lw && !r.w)) {
        toPush[n] = entryOf(n, lt);
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

  // ---------- People on the shared list ----------
  var members = {};          // everyone else: id -> { name, r: {n: stars}, f: {n: true}, last: {n, at} }
  var membersBlocked = false; // the database refused our details (security rules need updating)

  function memberPayload() {
    var r = {}, f = {};
    Object.keys(ratings).forEach(function (n) { r[n] = ratings[n]; });
    favorites.forEach(function (n) { f[n] = true; });
    var out = { name: (profile.name || "").trim().slice(0, 30) || "Someone", r: r, f: f, n: JSON.parse(JSON.stringify(notes)), b: badgeCount() };
    if (profile.last && profile.last.n) out.last = { n: profile.last.n, at: profile.last.at };
    return out;
  }
  function pushMember() {
    if (sync.controller && sync.controller.pushMember) sync.controller.pushMember(profile.id, memberPayload());
  }
  function applyMembers(all) {
    var next = {};
    Object.keys(all || {}).forEach(function (id) {
      var m = all[id];
      if (id === profile.id || !m || typeof m !== "object") return;
      var clean = { name: typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 30) : "Someone", r: {}, f: {}, last: null };
      if (m.r && typeof m.r === "object") Object.keys(m.r).forEach(function (k) {
        var n = Number(k), v = m.r[k];
        if (n >= 1 && n <= TOTAL && Number.isInteger(v) && v >= 1 && v <= 5) clean.r[n] = v;
      });
      if (m.f && typeof m.f === "object") Object.keys(m.f).forEach(function (k) {
        var n = Number(k);
        if (n >= 1 && n <= TOTAL && m.f[k] === true) clean.f[n] = true;
      });
      if (m.last && Number.isInteger(m.last.n) && m.last.n >= 1 && m.last.n <= TOTAL && typeof m.last.at === "number") {
        clean.last = { n: m.last.n, at: m.last.at };
      }
      clean.n = cleanNotes(m.n);
      clean.b = Number.isInteger(m.b) && m.b >= 0 && m.b <= 100 ? m.b : null;
      clean.p = {};
      if (m.p && typeof m.p === "object") Object.keys(m.p).forEach(function (k) {
        var n = Number(k), e = m.p[k];
        if (!(n >= 1 && n <= TOTAL) || !e || typeof e.w !== "boolean" || typeof e.t !== "number") return;
        clean.p[n] = { state: e.w ? "watched" : e.s === true ? "skipped" : "none", t: e.t };
      });
      clean.id = id;
      next[id] = clean;
    });
    members = next;
    membersBlocked = false;
    renderPartner();
    renderAllWho();
    if (rows.length === TOTAL) for (var i = 0; i < TOTAL; i++) syncRow(i); // their reactions
    updateStreak();
    renderRace();
    renderDeckMode();
    checkBadges();
    if ($("top-sheet").open) renderTop();
    if ($("calendar-sheet").open) renderCalendar();
    if ($("rank-sheet").open) renderRankSheet();
    renderDeck();
    if (epSheet.n) renderEpSheet();
    if (ratePrompt.n) renderRatePrompt();
  }

  /** Reactions on an episode: yours first, then the others' (no repeats). */
  function reactionsFor(n) {
    var out = [];
    if (notes[n] && notes[n].e) out.push(notes[n].e);
    if (sync.roomId) partners().forEach(function (m) {
      var e = m.n[n] && m.n[n].e;
      if (e && out.indexOf(e) === -1) out.push(e);
    });
    return out;
  }
  function hasNoteText(n) {
    return !!(notes[n] && notes[n].x) || (!!sync.roomId && partners().some(function (m) { return m.n[n] && m.n[n].x; }));
  }

  /** Who else watched an episode (names). */
  function othersWho(n, state) {
    return partners().filter(function (m) { return m.p[n] && m.p[n].state === (state || "watched"); });
  }
  /** Marks episodes for everyone else on the list too (you watched together). */
  var othersQueue = {}; // marks waiting for the connection to finish
  function markForOthers(entries, onlyId) {
    if (!sync.controller) {
      if (!onlyId) Object.keys(entries).forEach(function (k) { othersQueue[k] = entries[k]; });
      return;
    }
    partners().forEach(function (m) {
      if (onlyId && m.id !== onlyId) return;
      sync.controller.pushFor(m.id, entries);
      Object.keys(entries).forEach(function (k) { // show it right away
        var e = entries[k];
        m.p[k] = { state: e.w ? "watched" : e.s ? "skipped" : "none", t: e.t };
      });
    });
    renderAllWho();
    if (epSheet.n) renderEpSheet();
  }
  function renderAllWho() {
    if (rows.length === TOTAL) for (var i = 0; i < TOTAL; i++) renderWho(i);
  }
  /** Small initials on a row for the others who watched it. */
  function renderWho(i) {
    var n = i + 1, el = rows[i].who, who = sync.roomId ? othersWho(n) : [];
    el.textContent = "";
    who.slice(0, 3).forEach(function (m) {
      var b = document.createElement("span");
      b.className = "who-dot";
      b.textContent = (m.name || "?").charAt(0).toUpperCase();
      el.appendChild(b);
    });
    el.title = who.length ? "Watched by " + who.map(function (m) { return m.name; }).join(", ") : "";
    el.setAttribute("aria-label", el.title);
    el.hidden = !who.length;
  }
  function memberError() { membersBlocked = true; renderSync(); }
  function partners() { return Object.keys(members).map(function (id) { return members[id]; }); }
  /** "Sara", "Sara and Ben", "Sara, Ben and Al" */
  function nameList(list) {
    var names = list.map(function (m) { return m.name; });
    return names.length < 3 ? names.join(" and ") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }

  /** "Sara watched Ep 45 · 2h ago" under your progress, while sharing. */
  function renderPartner() {
    var line = $("partner-line");
    var latest = sync.roomId && partners().filter(function (m) { return m.last; })
      .sort(function (a, b) { return b.last.at - a.last.at; })[0];
    line.hidden = !latest;
    if (!latest) return;
    line.dataset.n = latest.last.n;
    var said = latest.n[latest.last.n];
    $("partner-text").textContent = latest.name + " watched Ep " + latest.last.n +
      (said ? " " + (said.e || "") + (said.x ? (said.e ? " " : "") + "💬" : "") : "") + " · " + timeAgo(latest.last.at);
  }

  var STATUS_TEXT = {
    connecting: "Connecting…",
    synced: "Synced",
    saving: "Saving…",
    offline: "Offline · will sync later",
    error: "Problem"
  };
  var CHIP_TEXT = { connecting: "Connecting…", synced: "Shared", saving: "Saving…", offline: "Offline", error: "Sync problem" };
  function setSyncStatus(state, message) {
    var el = $("sync-status");
    el.dataset.state = state;
    el.textContent = STATUS_TEXT[state] || state;
    $("sync-chip").dataset.state = state;
    $("sync-chip").textContent = CHIP_TEXT[state] || state;
    $("menu-sync-status").textContent = STATUS_TEXT[state] === "Offline · will sync later" ? "Offline" : (STATUS_TEXT[state] || "On");
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
    $("sync-chip").hidden = !inRoom;
    $("invite-banner").hidden = !inviting;
    if (!inRoom) $("menu-sync-status").textContent = !available ? "Not set up" : inviting ? "Invited" : "Off";
    if (inRoom) $("sync-code-display").textContent = prettyCode(sync.roomId);
    $("sync-you").textContent = profile.name ? "You appear as " + profile.name + "." : "Add your name so the others know it's you.";
    var others = partners();
    $("sync-together-label").textContent = others.length === 1 ? "I always watch with " + others[0].name : "We always watch together";
    $("sync-members-note").hidden = !(inRoom && membersBlocked);
    if (inviting) {
      $("sync-invite-text").textContent = (sync.roomId ? "Switch to the shared list " : "Join the shared list ") +
        prettyCode(sync.inviteRoom) + "? Your progress on this device will be merged into it.";
    }
    $("sync-leave").textContent = sync.leaveArmed ? "Tap again to leave" : "Leave";
    $("sync-leave").classList.toggle("armed", sync.leaveArmed);
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
        memberId: profile.id,
        mode: mode,
        api: {
          allEntries: allEntries,
          applyRemote: applyRemote,
          applyMembers: function (all) { if (sync.roomId === roomId || !connected) applyMembers(all); },
          memberError: memberError,
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
      pushMember();
      if (Object.keys(othersQueue).length) { var q = othersQueue; othersQueue = {}; markForOthers(q); }
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
    members = {};
    membersBlocked = false;
    othersQueue = {};
    renderPartner();
    renderAllWho();
    for (var i = 0; i < TOTAL; i++) syncRow(i); // their reactions go
    save(STORAGE.room, null);
    renderSync();
    toast("Left the shared list. Your progress stays on this device.");
  }

  // ---------- Share this app ----------
  var APP_URL = "https://evanavery-svg.github.io/narutofiller/";
  /** The app's address: wherever it's being served from, or the public site when opened as a file. */
  function appLink() {
    if (!/^https?:$/.test(location.protocol)) return APP_URL;
    return location.origin + location.pathname.replace(/index\.html$/, "");
  }
  function shareApp() {
    var url = appLink();
    var text = "Which Naruto episodes are filler? This app tracks canon vs filler and what you've watched.";
    if (navigator.share) {
      navigator.share({ title: "Naruto Filler Guide", text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { toast("Link copied: " + url); },
        function () { window.prompt("Copy this link:", url); }
      );
    } else {
      window.prompt("Copy this link:", url);
    }
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
    // In an in-app browser (Instagram etc.) keep the link, so "Open in Safari" still carries the invite
    if (!platform.inApp) history.replaceState(null, "", location.href.split("#")[0]);
    var code = cleanCode(m[1]);
    if (!ROOM_RE.test(code)) { toast("That invite link isn't valid"); return; }
    if (code === sync.roomId) { toast("You're already on this shared list"); return; }
    sync.inviteRoom = code;
    if (!syncAvailable()) return;
    afterWelcome(function () {
      if (platform.mobile && !isInstalled()) openInstallSheet(code);
      else openSyncSheet();
    });
  }

  function acceptInvite(code) {
    return startSync(code, "join").then(function (ok) {
      if (ok && sync.inviteRoom === code) { sync.inviteRoom = null; renderSync(); }
      return ok;
    });
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
    $("sync-together").checked = !!prefs.together;
    $("sync-together").addEventListener("change", function () {
      prefs.together = $("sync-together").checked;
      savePrefs();
      updateProgress();
      toast(prefs.together ? "What you mark now counts for everyone on the list" : "What you mark now counts just for you");
    });
    $("sync-leave").addEventListener("click", function () {
      if (sync.leaveArmed) { leaveRoom(); return; }
      sync.leaveArmed = true;
      renderSync();
      setTimeout(function () { if (sync.leaveArmed) { sync.leaveArmed = false; renderSync(); } }, 4000);
    });
    $("sync-invite-accept").addEventListener("click", function () { acceptInvite(sync.inviteRoom); });
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
    initSplash();
    buildFilters();
    buildList();
    buildMap($("guide-map"), mapCells.guide);
    initBulk();
    for (var i = 0; i < TOTAL; i++) syncRow(i);

    var search = $("search");
    search.addEventListener("input", function () {
      query = normalize(search.value.trim());
      scheduleFilters();
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

    initDeck();
    $("reset-button").addEventListener("click", function () { showResetConfirm(true); });
    $("reset-cancel").addEventListener("click", function () { showResetConfirm(false); });
    $("reset-yes").addEventListener("click", doReset);

    // Keep tabs in sync if progress changes in another tab/window
    window.addEventListener("storage", function (e) {
      if (e.key === STORAGE.notes) {
        notes = cleanNotes(load(STORAGE.notes, {}));
        for (var k = 0; k < TOTAL; k++) syncRow(k);
        if (epSheet.n) renderEpSheet();
        return;
      }
      if (e.key === STORAGE.ratings || e.key === STORAGE.favorites) { // rated in another tab
        var r = load(STORAGE.ratings, {}) || {};
        ratings = {};
        Object.keys(r).forEach(function (k) { var n = Number(k); if (n >= 1 && n <= TOTAL && r[k] >= 1 && r[k] <= 5) ratings[n] = r[k]; });
        favorites = loadNumbers(STORAGE.favorites);
        for (var j = 0; j < TOTAL; j++) syncRow(j);
        updateArcProgress();
        return;
      }
      if (e.key !== STORAGE.watched && e.key !== STORAGE.skipped) return;
      watched = loadNumbers(STORAGE.watched);
      skipped = loadNumbers(STORAGE.skipped);
      var c = load(STORAGE.changed, {}) || {};
      Object.keys(c).forEach(function (k) { changedAt[k] = c[k]; lastStamp = Math.max(lastStamp, c[k]); });
      for (var i = 0; i < TOTAL; i++) syncRow(i);
      updateProgress();
      applyFilters();
    });

    initSheets();
    if (!prefs.arcOpen || typeof prefs.arcOpen !== "object") prefs.arcOpen = {};
    applyFilters();
    updateProgress();
    renderGuide();
    initRatePrompt();
    initEpSheet();
    initCalendar();
    initExtras();
    initThemes();
    initShare();
    applyShield();
    initInstall();
    initWelcome();
    initSync();

    if (location.protocol === "file:") $("file-note").hidden = false;
    document.documentElement.classList.remove("js-loading"); // reveal the built page
    whenSplashDone(function () {
      document.documentElement.classList.add("ready", "entering"); // entrance animations
      setTimeout(function () { document.documentElement.classList.remove("entering"); }, 1200);
      initLogo();
    });
    registerServiceWorker();
  }

  // ---------- Get the app (install instructions) ----------
  var ua = navigator.userAgent || "";
  var platform = {
    ios: /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    android: /Android/i.test(ua),
    inApp: /FBAN|FBAV|Instagram|Snapchat|Line\/|TikTok|musical_ly|GSA\//.test(ua), // can't install from these
    iosOtherBrowser: /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua),
    chromium: /Chrome\/|Chromium|Edg\//.test(ua),
    macSafari: /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)
  };
  platform.mobile = platform.ios || platform.android;
  var installPrompt = null; // Chrome/Edge/Android's own install dialog, when offered

  function isInstalled() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  function canOfferInstall() {
    if (location.protocol === "file:" || isInstalled()) return false;
    return platform.mobile || !!installPrompt || platform.macSafari || platform.chromium;
  }
  function updateGetApp() { $("menu-get-app").hidden = !canOfferInstall(); }

  var ICON = {
    share: '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/></svg>',
    add: '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    install: '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 7v6m0 0-2.5-2.5M12 13l2.5-2.5M8 20h8"/></svg>'
  };

  var sheet = { code: null, joined: false };

  function addStep(html, extra) {
    var li = document.createElement("li");
    li.innerHTML = html; // fixed strings only (no user data)
    if (extra) li.appendChild(extra);
    $("install-steps").appendChild(li);
    return li;
  }

  function renderInstallSheet() {
    var code = sheet.code;
    var invited = !!code && syncAvailable();
    $("install-steps").textContent = "";
    $("install-invite").hidden = !invited;
    if (invited) $("install-code").textContent = prettyCode(code);
    $("install-native").hidden = true;
    var note = "";

    $("install-sub").textContent = invited
      ? "Add it to your home screen so your shared list is one tap away."
      : "Add it to your home screen. It opens full-screen and works offline.";

    if (platform.ios && platform.inApp) {
      addStep("This app's built-in browser can't install apps. Tap the <strong>•••</strong> or share menu and choose <strong>Open in Safari</strong> (or <strong>Open in browser</strong>).");
      addStep("Safari opens the same page and shows these steps again.");
    } else if (platform.ios) {
      addStep(platform.iosOtherBrowser
        ? "Tap the <strong>Share</strong> button " + ICON.share + " next to the address bar."
        : "Tap the <strong>Share</strong> button " + ICON.share + " at the bottom of Safari (at the top on iPad).");
      addStep("Scroll down and tap <strong>Add to Home Screen</strong> " + ICON.add + ".");
      addStep("Tap <strong>Add</strong>.");
      if (invited) {
        addStep("Open <strong>Naruto Filler</strong> from your home screen, tap <strong>Join with a Code</strong> and paste your code.");
        note = "Your iPhone keeps home-screen apps separate from Safari, so you join the list inside the app. Copy the code first.";
      } else {
        addStep("Open <strong>Naruto Filler</strong> from your home screen.");
      }
    } else if (platform.android) {
      if (invited) {
        var join = document.createElement("button");
        join.type = "button";
        join.className = "button-tinted small step-btn";
        join.textContent = sheet.joined ? "Joined ✓" : "Join the list";
        join.disabled = sheet.joined;
        join.addEventListener("click", function () {
          join.disabled = true;
          join.textContent = "Joining…";
          acceptInvite(code).then(function (ok) {
            sheet.joined = ok;
            join.disabled = ok;
            join.textContent = ok ? "Joined ✓" : "Try again";
          });
        });
        addStep("Join the shared list: ", join);
      }
      if (installPrompt) {
        addStep("Tap <strong>Install app</strong> below, then <strong>Install</strong>.");
        $("install-native").hidden = false;
      } else {
        addStep("Open the browser menu (<strong>⋮</strong> at the top right) and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>. In Samsung Internet: <strong>≡ → Add page to → Home screen</strong>.");
      }
      addStep("Open <strong>Naruto Filler</strong> from your home screen.");
    } else if (installPrompt) {
      addStep("Click <strong>Install app</strong> below.");
      $("install-native").hidden = false;
    } else if (platform.macSafari) {
      addStep("In the menu bar, choose <strong>File → Add to Dock</strong>.");
    } else {
      addStep("Click the install icon " + ICON.install + " at the right end of the address bar, or open the <strong>⋮</strong> menu and choose <strong>Cast, save and share → Install page as app</strong>.");
    }
    $("install-note").textContent = note;
    $("install-note").hidden = !note;
  }

  function openInstallSheet(code) {
    sheet.code = code || null;
    sheet.joined = false;
    renderInstallSheet();
    openDialog($("install-sheet"), $("install-title"));
  }
  function closeInstallSheet() { closeDialog($("install-sheet")); }

  function initInstall() {
    $("install-sheet").querySelector(".sheet-mark").innerHTML = document.querySelector(".app-mark").innerHTML;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault(); // we offer our own button instead of the browser's banner
      installPrompt = e;
      updateGetApp();
      if ($("install-sheet").open) renderInstallSheet();
    });
    window.addEventListener("appinstalled", function () {
      installPrompt = null;
      closeInstallSheet();
      updateGetApp();
      toast("Installed! Open Naruto Filler from your home screen.");
    });
    $("menu-share-app").addEventListener("click", shareApp);
    $("menu-get-app").addEventListener("click", function () {
      if (installPrompt && !platform.mobile) { $("install-native").click(); return; }
      openInstallSheet(sync.inviteRoom);
    });
    $("install-native").addEventListener("click", function () {
      if (!installPrompt) return;
      var p = installPrompt;
      p.prompt();
      p.userChoice.then(function () {
        installPrompt = null;
        updateGetApp();
        if ($("install-sheet").open) renderInstallSheet();
      });
    });
    $("install-copy").addEventListener("click", function () {
      var text = prettyCode(sheet.code || "");
      var btn = $("install-copy");
      function done() { btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = "Copy Code"; }, 2000); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { toast("Press and hold the code to copy it"); });
      } else {
        toast("Press and hold the code to copy it");
      }
    });
    $("install-close").addEventListener("click", closeInstallSheet);
    $("install-later").addEventListener("click", closeInstallSheet);
    $("install-sheet").addEventListener("click", function (e) {
      if (e.target === $("install-sheet")) closeInstallSheet(); // tap on the backdrop
    });
    updateGetApp();
  }

  // ---------- Service worker: always up to date ----------
  // The service worker loads the newest files on every open (when online). When the app
  // comes back from the background, it also checks for changes and reloads if there are any.
  var UPDATED_FLAG = "naruto-filler:just-updated";

  function registerServiceWorker() {
    try {
      if (sessionStorage.getItem(UPDATED_FLAG)) {
        sessionStorage.removeItem(UPDATED_FLAG);
        toast("Updated to the latest version");
      }
    } catch (e) { /* ignore */ }

    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

    var lastCheck = Date.now();
    function checkForUpdates(reg) {
      reg.update().catch(function () {});
      var ctrl = navigator.serviceWorker.controller;
      if (!ctrl || !navigator.onLine || Date.now() - lastCheck < 30000) return;
      lastCheck = Date.now();
      var channel = new MessageChannel();
      channel.port1.onmessage = function (e) {
        if (!e.data || !e.data.changed) return;
        try { sessionStorage.setItem(UPDATED_FLAG, "1"); } catch (err) { /* ignore */ }
        location.reload();
      };
      ctrl.postMessage({ type: "CHECK_UPDATES" }, [channel.port2]);
    }

    window.addEventListener("load", function () {
      // updateViaCache "none": always fetch service-worker.js itself fresh
      navigator.serviceWorker.register("./service-worker.js", { scope: "./", updateViaCache: "none" }).then(function (reg) {
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") checkForUpdates(reg);
        });
      }).catch(function (err) {
        console.warn("Service worker registration failed:", err);
      });
    });
  }

  init();
})();
