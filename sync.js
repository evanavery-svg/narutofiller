/* Shared watched list over Firebase Cloud Firestore.
 * Loaded on demand by app.js (dynamic import) only when a shared list is in use.
 *
 * Data: one document per shared list, rooms/{ROOMCODE}:
 *   { members: { "<memberId>": {
 *       name, r: { "12": 4 }, f: { "12": true }, last: { n: 12, at: <ms> },
 *       p: { "12": { w: true, s: false, t: 1731400000000 }, ... } } },
 *     eps: { ... },   // older single shared list, kept only to carry it over
 *     updatedAt: <server time> }
 * p is each person's own progress: w = watched, s = skipped, t = when it last changed (ms).
 * Each episode resolves last-change-wins, so offline devices merge cleanly.
 * r, f and last are that person's star ratings, favorites and latest episode.
 */
const SDK = "https://www.gstatic.com/firebasejs/12.19.0/";

let fs = null; // Firestore SDK module
let db = null; // Firestore instance (one per page)

async function getDb(config) {
  if (db) return db;
  const [appMod, fsMod] = await Promise.all([
    import(SDK + "firebase-app.js"),
    import(SDK + "firebase-firestore.js")
  ]);
  fs = fsMod;
  const app = appMod.getApps()[0] || appMod.initializeApp(config);
  db = fs.getFirestore(app);
  // Local testing against the Firestore emulator (set by tools/e2e-test.js only)
  if (window.NF_FIRESTORE_EMULATOR) {
    const [host, port] = String(window.NF_FIRESTORE_EMULATOR).split(":");
    fs.connectFirestoreEmulator(db, host, Number(port));
  }
  return db;
}

function withTimeout(promise, ms, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(code), { code })), ms); })
  ]).finally(() => clearTimeout(timer));
}

/**
 * Connects to a shared list and keeps it in sync.
 * Each person's progress lives in members.{id}.p ({ n: {w, s, t} }), so everyone keeps their
 * own watched list and sees the others'. "eps" is the older, single shared list: it's only read
 * to carry an existing list over the first time someone connects with this version.
 * @param {object} opts
 * @param {object} opts.config   Firebase web config
 * @param {string} opts.roomId   16-character room code (no dashes)
 * @param {string} opts.memberId this device's person id
 * @param {"create"|"join"|"resume"} opts.mode
 * @param {object} opts.api      callbacks into app.js:
 *   allEntries() -> { n: {w,s,t} } for every episode with a value
 *   applyRemote(mine, legacyEps) -> entries where this device is newer (to upload).
 *                            mine is this person's saved progress, or null the first time.
 *   applyMembers(members)    everyone's names, ratings, favorites, latest episode and progress
 *   memberError(err)         this person's details couldn't be saved (e.g. old security rules)
 *   status(state, message)   state: connecting | synced | saving | offline | error
 * @returns {Promise<{ push(entries), pushFor(id, entries), pushMember(id, data), stop() }>}
 */
export async function connect({ config, roomId, memberId, mode, api }) {
  api.status("connecting");
  const database = await getDb(config);
  const ref = fs.doc(database, "rooms", roomId);
  const validId = (id) => /^[a-z0-9]{6,40}$/.test(id);

  if (mode === "create") {
    if (!navigator.onLine) throw Object.assign(new Error("offline"), { code: "offline" });
    await withTimeout(
      fs.setDoc(ref, { eps: {}, members: { [memberId]: { p: api.allEntries() } }, updatedAt: fs.serverTimestamp() }),
      15000, "timeout"
    );
  } else if (mode === "join") {
    if (!navigator.onLine) throw Object.assign(new Error("offline"), { code: "offline" });
    const snap = await withTimeout(fs.getDocFromServer(ref), 15000, "timeout");
    if (!snap.exists()) throw Object.assign(new Error("not-found"), { code: "not-found" });
  }

  // Batch quick successive changes into one write: { personId: { n: entry } }
  let pending = {};
  let flushTimer = null;
  let stopped = false;

  function flush() {
    flushTimer = null;
    if (stopped) return;
    const batch = pending;
    pending = {};
    const ids = Object.keys(batch);
    if (!ids.length) return;
    const members = {};
    ids.forEach((id) => { members[id] = { p: batch[id] }; });
    // merge: only these episodes of these people change
    fs.setDoc(ref, { members, updatedAt: fs.serverTimestamp() }, { merge: true })
      .catch((err) => {
        if (api.memberError && String(err && err.code).indexOf("permission-denied") !== -1) api.memberError(err);
        else api.status("error", describeError(err));
      });
  }

  /** Saves progress entries for a person (yourself, or someone you watched with). */
  function pushFor(id, entries) {
    if (stopped || !entries || !validId(id)) return;
    const keys = Object.keys(entries);
    if (!keys.length) return;
    pending[id] = pending[id] || {};
    keys.forEach((k) => { pending[id][k] = entries[k]; });
    if (!flushTimer) flushTimer = setTimeout(flush, 250);
  }
  function push(entries) { pushFor(memberId, entries); }

  // This person's own details (name, ratings, favorites, latest episode): each part is replaced
  // as a whole, without touching their progress (p)
  let memberTimer = null;
  function pushMember(id, data) {
    if (stopped || !validId(id)) return;
    clearTimeout(memberTimer);
    memberTimer = setTimeout(() => {
      if (stopped) return;
      const fields = Object.keys(data).filter((k) => k !== "p").map((k) => "members." + id + "." + k);
      fs.setDoc(ref, { members: { [id]: data }, updatedAt: fs.serverTimestamp() }, { mergeFields: fields.concat("updatedAt") })
        .catch((err) => { if (api.memberError) api.memberError(err); });
    }, 400);
  }

  const unsubscribe = fs.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
    const meta = snap.metadata;
    if (!snap.exists()) {
      // An offline start with nothing cached also looks like this; only trust the server.
      if (!meta.fromCache) api.status("error", "This shared list no longer exists. Leave it and create a new one.");
      else api.status("offline");
      return;
    }
    const members = snap.get("members") || {};
    const mine = members[memberId] && members[memberId].p;
    if (api.applyMembers) api.applyMembers(members); // first, so the others are known
    push(api.applyRemote(mine && typeof mine === "object" ? mine : null, snap.get("eps") || {}));
    api.status(meta.hasPendingWrites || flushTimer ? "saving" : meta.fromCache ? "offline" : "synced");
  }, (err) => {
    api.status("error", describeError(err));
  });

  return {
    push,
    pushFor,
    pushMember,
    stop() {
      stopped = true;
      clearTimeout(flushTimer);
      clearTimeout(memberTimer);
      unsubscribe();
    }
  };
}

export function describeError(err) {
  const code = (err && err.code) || "";
  if (code === "offline" || code === "unavailable") return "You're offline. Connect to the internet and try again.";
  if (code === "timeout") return "Couldn't reach the server. Check your connection and try again.";
  if (code === "not-found") return "No shared list with that code. Check the code and try again.";
  if (code.indexOf("permission-denied") !== -1) return "Firebase refused access. Check the Firestore security rules (see README).";
  return "Sync error: " + ((err && err.message) || code || "unknown");
}
