/* Shared watched list over Firebase Cloud Firestore.
 * Loaded on demand by app.js (dynamic import) only when a shared list is in use.
 *
 * Data: one document per shared list, rooms/{ROOMCODE}:
 *   { eps: { "12": { w: true, s: false, t: 1731400000000 }, ... },
 *     members: { "<memberId>": { name, r: { "12": 4 }, f: { "12": true }, last: { n: 12, at: <ms> } } },
 *     updatedAt: <server time> }
 * eps is the shared watched list: w = watched, s = skipped, t = when it last changed (ms).
 * Each episode resolves last-change-wins, so offline devices merge cleanly.
 * members holds each person's own name, star ratings (r), favorites (f) and latest episode.
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
 * @param {object} opts
 * @param {object} opts.config   Firebase web config
 * @param {string} opts.roomId   16-character room code (no dashes)
 * @param {"create"|"join"|"resume"} opts.mode
 * @param {object} opts.api      callbacks into app.js:
 *   allEntries() -> { n: {w,t} } for every episode with a value
 *   applyRemote(eps) -> { n: {w,t} } entries where this device is newer (to upload)
 *   applyMembers(members)    everyone's names, ratings, favorites and latest episode
 *   memberError(err)         this person's details couldn't be saved (e.g. old security rules)
 *   status(state, message)   state: connecting | synced | saving | offline | error
 * @returns {Promise<{ push(entries): void, pushMember(id, data): void, stop(): void }>}
 */
export async function connect({ config, roomId, mode, api }) {
  api.status("connecting");
  const database = await getDb(config);
  const ref = fs.doc(database, "rooms", roomId);

  if (mode === "create") {
    if (!navigator.onLine) throw Object.assign(new Error("offline"), { code: "offline" });
    await withTimeout(
      fs.setDoc(ref, { eps: api.allEntries(), updatedAt: fs.serverTimestamp() }),
      15000, "timeout"
    );
  } else if (mode === "join") {
    if (!navigator.onLine) throw Object.assign(new Error("offline"), { code: "offline" });
    const snap = await withTimeout(fs.getDocFromServer(ref), 15000, "timeout");
    if (!snap.exists()) throw Object.assign(new Error("not-found"), { code: "not-found" });
  }

  // Batch quick successive changes into one write
  let pending = {};
  let flushTimer = null;
  let stopped = false;

  function flush() {
    flushTimer = null;
    if (stopped) return;
    const eps = pending;
    pending = {};
    if (!Object.keys(eps).length) return;
    fs.setDoc(ref, { eps, updatedAt: fs.serverTimestamp() }, { merge: true })
      .catch((err) => api.status("error", describeError(err)));
  }

  // This person's own details: replaced as a whole, separately from the watched list
  let memberTimer = null;
  function pushMember(id, data) {
    if (stopped || !/^[a-z0-9]{6,40}$/.test(id)) return;
    clearTimeout(memberTimer);
    memberTimer = setTimeout(() => {
      if (stopped) return;
      fs.setDoc(ref, { members: { [id]: data }, updatedAt: fs.serverTimestamp() }, { mergeFields: ["members." + id, "updatedAt"] })
        .catch((err) => { if (api.memberError) api.memberError(err); });
    }, 400);
  }

  function push(entries) {
    if (stopped || !entries) return;
    const keys = Object.keys(entries);
    if (!keys.length) return;
    keys.forEach((k) => { pending[k] = entries[k]; });
    if (!flushTimer) flushTimer = setTimeout(flush, 250);
  }

  const unsubscribe = fs.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
    const meta = snap.metadata;
    if (!snap.exists()) {
      // An offline start with nothing cached also looks like this; only trust the server.
      if (!meta.fromCache) api.status("error", "This shared list no longer exists. Leave it and create a new one.");
      else api.status("offline");
      return;
    }
    push(api.applyRemote(snap.get("eps") || {}));
    if (api.applyMembers) api.applyMembers(snap.get("members") || {});
    api.status(meta.hasPendingWrites || flushTimer ? "saving" : meta.fromCache ? "offline" : "synced");
  }, (err) => {
    api.status("error", describeError(err));
  });

  return {
    push,
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
