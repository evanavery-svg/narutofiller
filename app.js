/* Naruto Filler Guide — vanilla JS, no dependencies.
 * Expects a global `EPISODES` array from data/episodes.js.
 */
(function () {
  "use strict";

  // ---------- Constants ----------
  var TOTAL = EPISODES.length;
  var MINUTES_PER_EPISODE = 23;
  var TYPES = [
    { id: "canon", label: "Canon", long: "Manga canon",
      desc: "Adapts the manga's story. Essential viewing." },
    { id: "mixed", label: "Mixed", long: "Mixed canon/filler",
      desc: "Adapts manga chapters but adds a noticeable amount of anime-original material." },
    { id: "filler", label: "Filler", long: "Filler",
      desc: "Anime-original story not in the manga. Safe to skip." },
    { id: "anime-canon", label: "Anime canon", long: "Anime canon",
      desc: "Anime-original, but treated as part of the official story. (The original Naruto series has none.)" }
  ];
  var TYPE_BY_ID = {};
  TYPES.forEach(function (t) { TYPE_BY_ID[t.id] = t; });

  var STORAGE = {
    watched: "naruto-filler:watched:v1",
    prefs: "naruto-filler:prefs:v1"
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
    includeMixed: true,
    tab: "episodes"
  };
  var prefs = Object.assign({}, defaultPrefs, load(STORAGE.prefs, {}));
  var activeTypes = new Set(prefs.types.filter(function (t) { return TYPE_BY_ID[t]; }));
  var query = "";

  function savePrefs() {
    prefs.types = Array.from(activeTypes);
    save(STORAGE.prefs, prefs);
  }
  function saveWatched() {
    save(STORAGE.watched, Array.from(watched).sort(function (a, b) { return a - b; }));
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
      var count = EPISODES.filter(function (e) { return e.type === t.id; }).length;
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
      var t = TYPE_BY_ID[ep.type];
      var li = document.createElement("li");
      li.className = "episode";
      li.id = "ep-" + ep.number;
      li.dataset.type = ep.type;

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
      badge.className = "badge badge--" + ep.type;
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
      saveWatched();
      syncRow(n - 1);
      updateProgress();
      if (prefs.hideWatched) applyFilters();
    });
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
    if (!activeTypes.has(ep.type)) return false;
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
  var canonEpisodes = EPISODES.filter(function (e) { return e.type === "canon"; });

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

    var next = nextEpisode();
    $("next-hint").textContent = next
      ? "Ep " + next.number + " · " + next.title
      : (prefs.skipFillerNext ? "All non-filler episodes watched!" : "You've watched everything!");

    var n = watched.size;
    $("reset-question").textContent = n
      ? "Clear all " + n + " watched episode" + (n === 1 ? "" : "s") + "? This can't be undone."
      : "Nothing to reset yet.";
    $("reset-yes").hidden = n === 0;
  }

  function jumpToNext() {
    var ep = nextEpisode();
    if (!ep) {
      toast(prefs.skipFillerNext ? "No unwatched non-filler episodes left." : "You've watched every episode!");
      return;
    }
    var i = ep.number - 1;
    if (prefs.tab !== "episodes") selectTab("episodes");
    // Make sure the target is visible: clear search / enable its type if needed.
    if (!isVisible(i)) {
      if (!matchesQuery(i)) { $("search").value = ""; query = ""; }
      if (!activeTypes.has(ep.type)) {
        activeTypes.add(ep.type);
        var btn = document.querySelector('.filter[data-type="' + ep.type + '"]');
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
    watched.clear();
    saveWatched();
    for (var i = 0; i < TOTAL; i++) syncRow(i);
    updateProgress();
    applyFilters();
    showResetConfirm(false);
    toast("Progress reset");
  }

  // ---------- Skip-filler guide ----------
  function renderGuide() {
    var include = prefs.includeMixed;
    var keepTypes = include ? ["canon", "mixed", "anime-canon"] : ["canon", "anime-canon"];
    var watch = [], skip = [];
    EPISODES.forEach(function (e) {
      (keepTypes.indexOf(e.type) !== -1 ? watch : skip).push(e.number);
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

  // ---------- Wire up ----------
  function init() {
    buildFilters();
    buildLegend();
    buildList();
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

    var mixed = $("include-mixed");
    mixed.checked = !!prefs.includeMixed;
    mixed.addEventListener("change", function () {
      prefs.includeMixed = mixed.checked; savePrefs(); renderGuide();
    });

    // Keep tabs in sync if progress changes in another tab/window
    window.addEventListener("storage", function (e) {
      if (e.key !== STORAGE.watched) return;
      watched = new Set(load(STORAGE.watched, []));
      for (var i = 0; i < TOTAL; i++) syncRow(i);
      updateProgress();
      applyFilters();
    });

    selectTab(prefs.tab === "guide" ? "guide" : "episodes");
    applyFilters();
    updateProgress();
    renderGuide();

    if (location.protocol === "file:") $("file-note").hidden = false;
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
