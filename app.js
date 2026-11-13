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
      entries[n] = entryOf(n, t);
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

    row.appendChild(check);
    row.appendChild(num);
    row.appendChild(main);
    li.appendChild(row);
    rows.push({ li: li, input: input });
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
      a.el = section; a.head = head; a.list = list; a.progress = progress;
    });
    container.appendChild(frag);

    // One delegated listener for all checkboxes
    container.addEventListener("change", function (e) {
      var input = e.target;
      if (!input.matches('input[type="checkbox"]')) return;
      var n = Number(input.dataset.number);
      setState(n, input.checked ? "watched" : "none");
      recordChanges([n]);
      syncRow(n - 1);
      if (input.checked) pop(input.nextElementSibling);
      updateProgress();
      if (prefs.hideWatched) applyFilters();
    });
  }

  // Which arc sections are expanded. The arc you're up to opens by itself; finished ones fold
  // away. Once you open or close a section yourself, that choice is remembered.
  function arcKey(a) { return a.name + "@" + a.start; }
  function isArcOpen(a) {
    var key = arcKey(a);
    if (Object.prototype.hasOwnProperty.call(prefs.arcOpen, key)) return prefs.arcOpen[key];
    var next = nextEpisode();
    return !!next && arcOf[next.number - 1] === a;
  }
  function setArcOpen(a, open) {
    prefs.arcOpen[arcKey(a)] = open;
    savePrefs();
    applyFilters();
  }

  function pop(el) {
    el.classList.remove("pop");
    void el.offsetWidth; // restart the animation
    el.classList.add("pop");
  }

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

  function applyFilters() {
    var shown = 0;
    for (var i = 0; i < TOTAL; i++) {
      var vis = isVisible(i);
      rows[i].li.hidden = !vis;
      if (vis) shown++;
    }
    arcs.forEach(function (a) {
      var visible = a.numbers.some(function (n) { return !rows[n - 1].li.hidden; });
      var open = visible && (isArcOpen(a) || !!query); // a search opens every section with a match
      a.el.hidden = !visible;
      a.list.hidden = !open;
      a.el.classList.toggle("is-open", open);
      a.head.setAttribute("aria-expanded", String(open));
    });
    $("empty-state").hidden = shown !== 0;
  }

  function updateArcProgress() {
    arcs.forEach(function (a) {
      var w = a.numbers.filter(function (n) { return watched.has(n); }).length;
      var done = a.numbers.every(function (n) { return watched.has(n) || skipped.has(n); });
      a.progress.textContent = done ? "Done" : w + "/" + a.numbers.length;
      a.el.classList.toggle("is-done", done);
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
    updateArcProgress();
    renderDeck();
    if (rows.length === TOTAL && arcs[0].el) applyFilters(); // the current arc may have changed

    var n = watched.size + skipped.size;
    $("reset-question").textContent = n
      ? "Clear all " + n + " watched or skipped episode" + (n === 1 ? "" : "s") +
        (sync.roomId ? " for everyone on the shared list" : "") + "? This can't be undone."
      : "Nothing to reset yet.";
    $("reset-yes").hidden = n === 0;
  }

  // ---------- Up-next deck (one card at a time) ----------
  var deckBusy = false;
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function renderDeck() {
    if (deckBusy) return;
    var eps = upcoming(3);
    var ep = eps[0];
    $("deck").dataset.count = String(eps.length);
    $("deck-card").hidden = !ep;
    $("deck-empty").hidden = !!ep;
    $("deck-layer-1").dataset.kind = eps[1] ? kindOf(eps[1]) : "none";
    $("deck-layer-2").dataset.kind = eps[2] ? kindOf(eps[2]) : "none";
    if (!ep) {
      $("deck-empty-text").textContent = prefs.skipFillerNext
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
    $("deck-hint").textContent = kind === "filler" ? "Anime-only. Safe to skip." : "Part of the manga's story.";
    $("deck-find").setAttribute("aria-label", "Show episode " + ep.number + " in the list");
  }

  /** "watched" or "skipped": the card flies off and the next one comes up. */
  function deckAct(state) {
    var ep = nextEpisode();
    if (!ep || deckBusy) return;
    var n = ep.number, before = stateOf(n);
    var card = $("deck-card");
    deckBusy = true;
    card.classList.add(state === "watched" ? "fly-right" : "fly-left");
    setTimeout(function () {
      setState(n, state);
      recordChanges([n]);
      syncRow(n - 1);
      card.classList.remove("fly-right", "fly-left");
      deckBusy = false;
      updateProgress();
      applyFilters();
      if (!reduceMotion()) {
        card.classList.add("enter");
        setTimeout(function () { card.classList.remove("enter"); }, 320);
      }
      toast((state === "watched" ? "Watched" : "Skipped") + " episode " + n, "Undo", function () {
        setState(n, before);
        recordChanges([n]);
        syncRow(n - 1);
        updateProgress();
        applyFilters();
      });
    }, reduceMotion() ? 0 : 260);
  }
  function initDeck() {
    $("deck-watch").addEventListener("click", function () { deckAct("watched"); });
    $("deck-skip").addEventListener("click", function () { deckAct("skipped"); });
    $("deck-find").addEventListener("click", function () { var ep = nextEpisode(); if (ep) jumpTo(ep); });
  }

  /** Scrolls the list to an episode, adjusting filters/search if they hide it. */
  function jumpTo(ep) {
    var i = ep.number - 1;
    closeAllSheets();
    if (!isArcOpen(arcOf[i])) setArcOpen(arcOf[i], true);
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
   * Merges the shared list into this device. For each episode the most recent
   * change wins. Returns the entries where this device is newer, to upload.
   */
  function applyRemote(remote) {
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
    // In an in-app browser (Instagram etc.) keep the link, so "Open in Safari" still carries the invite
    if (!platform.inApp) history.replaceState(null, "", location.href.split("#")[0]);
    var code = cleanCode(m[1]);
    if (!ROOM_RE.test(code)) { toast("That invite link isn't valid"); return; }
    if (code === sync.roomId) { toast("You're already on this shared list"); return; }
    sync.inviteRoom = code;
    if (!syncAvailable()) return;
    if (platform.mobile && !isInstalled()) openInstallSheet(code);
    else openSyncSheet();
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
    buildFilters();
    buildList();
    buildMap($("guide-map"), mapCells.guide);
    initBulk();
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

    initDeck();
    $("reset-button").addEventListener("click", function () { showResetConfirm(true); });
    $("reset-cancel").addEventListener("click", function () { showResetConfirm(false); });
    $("reset-yes").addEventListener("click", doReset);

    // Keep tabs in sync if progress changes in another tab/window
    window.addEventListener("storage", function (e) {
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
    initInstall();
    initSync();

    if (location.protocol === "file:") $("file-note").hidden = false;
    document.documentElement.classList.remove("js-loading"); // reveal the built page
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
