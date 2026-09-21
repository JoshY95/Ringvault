const GUEST_STORAGE_KEY = "ringvault.collection.v1";
const USER_STORAGE_PREFIX = "ringvault.collection.user";
const PAGE_SIZE = 100;
const API_PAGE_SIZE = 1000;

const state = {
  catalogue: null,
  images: { cards: {}, sets: {} },
  collection: loadCollection(),
  supabase: null,
  user: null,
  syncing: false,
  view: "dashboard",
  query: "",
  setId: "all",
  category: "all",
  status: "all",
  visibleCards: PAGE_SIZE,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function collectionStorageKey(userId = state?.user?.id) {
  return userId ? `${USER_STORAGE_PREFIX}.${userId}.v1` : GUEST_STORAGE_KEY;
}

function loadCollection(storageKey = GUEST_STORAGE_KEY) {
  try {
    const collection = JSON.parse(localStorage.getItem(storageKey)) || {};
    return Object.fromEntries(Object.entries(collection).filter(([, item]) => ["owned", "wanted", "missing"].includes(item?.status)));
  } catch { return {}; }
}

function saveCollection() {
  localStorage.setItem(collectionStorageKey(), JSON.stringify(state.collection));
}

function mergeLocalCollections(primary, incoming) {
  const merged = { ...primary };
  for (const [cardId, entry] of Object.entries(incoming)) {
    if (!merged[cardId] || new Date(entry.updatedAt || 0) > new Date(merged[cardId].updatedAt || 0)) merged[cardId] = entry;
  }
  return merged;
}

function migrateLegacyCollectionIds() {
  const replacements = [
    ["2025-TCWWE-CJ-BASE-", "2025-TCWWE-CJWM-BASE-"],
    ["2025-WMCJ-CCA-", "2025-TCWWE-CJWM-CCA-"],
    ["2025-WMCJ-CJA-", "2025-TCWWE-CJWM-AUTO-"],
  ];
  let changed = false;
  for (const [oldId, entry] of Object.entries({ ...state.collection })) {
    const replacement = replacements.find(([prefix]) => oldId.startsWith(prefix));
    if (!replacement) continue;
    const newId = replacement[1] + oldId.slice(replacement[0].length);
    if (!state.collection[newId] || new Date(entry.updatedAt || 0) > new Date(state.collection[newId].updatedAt || 0)) state.collection[newId] = entry;
    delete state.collection[oldId];
    changed = true;
  }
  if (changed) saveCollection();
}

function entryFor(cardId) { return state.collection[cardId] || null; }
function statusFor(cardId) { return entryFor(cardId)?.status || "missing"; }

async function setStatus(cardId, nextStatus) {
  const current = statusFor(cardId);
  state.collection[cardId] = {
    ...(entryFor(cardId) || {}),
    status: current === nextStatus ? "missing" : nextStatus,
    updatedAt: new Date().toISOString(),
  };
  saveCollection();
  renderAll();
  if (state.user) {
    updateSyncStatus("syncing", "Saving change…");
    try {
      await syncCard(cardId);
      updateSyncStatus("cloud", "Synced to your account");
    } catch (error) {
      updateSyncStatus("pending", "Saved here · sync pending");
      console.error(error);
    }
  }
  showToast(current === nextStatus ? "Card removed from your list" : nextStatus === "owned" ? "Added to your collection" : "Added to your wanted list");
}

function counts() {
  const cards = state.catalogue?.cards || [];
  return {
    owned: cards.filter((card) => statusFor(card.id) === "owned").length,
    wanted: cards.filter((card) => statusFor(card.id) === "wanted").length,
  };
}

function setOwnedCount(setId) {
  return state.catalogue.cards.filter((card) => card.setId === setId && statusFor(card.id) === "owned").length;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function safeUrl(value, allowRelative = true) {
  if (!value) return "";
  try {
    const url = new URL(value, location.href);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (!allowRelative && url.origin === location.origin && !/^https?:/i.test(value)) return "";
    return url.href;
  } catch { return ""; }
}

function approvedImage(entry) { return entry?.rightsStatus === "approved" ? entry : null; }
function cardImage(cardId) { return approvedImage(state.images.cards?.[cardId]); }
function setImage(setId) { return approvedImage(state.images.sets?.[setId]); }
function initials(value) { return String(value || "RV").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }

function imageMarkup(entry, alt, fallback, className = "") {
  const source = safeUrl(entry?.thumbnail || entry?.front || entry?.image);
  return `<div class="image-frame ${className} ${source ? "has-image" : ""}">
    <span class="image-fallback" aria-hidden="true">${escapeHtml(fallback)}</span>
    ${source ? `<img src="${escapeHtml(source)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" onerror="this.parentElement.classList.remove('has-image');this.remove()" />` : ""}
  </div>`;
}

function setCard(set) {
  const owned = setOwnedCount(set.id);
  const progress = set.cardCount ? Math.round((owned / set.cardCount) * 100) : 0;
  return `<article class="set-card" data-set-id="${set.id}" style="--accent:${set.accent}">
    ${imageMarkup(setImage(set.id), `${set.name} sealed product`, "BOX", "set-image")}
    <span class="set-year">${set.year} · ${escapeHtml(set.manufacturer)}</span>
    <h3>${escapeHtml(set.shortName)}</h3>
    <div class="set-meta">${set.cardCount.toLocaleString()} cards · ${set.subsetCount} subsets</div>
    <div class="progress-track"><div class="progress-fill" style="--progress:${progress}%"></div></div>
    <div class="progress-label"><span>${owned.toLocaleString()} collected</span><strong>${progress}%</strong></div>
  </article>`;
}

function renderStats() {
  const { owned, wanted } = counts();
  const completion = state.catalogue.cardCount ? ((owned / state.catalogue.cardCount) * 100).toFixed(1) : "0.0";
  $("#stats").innerHTML = [
    ["Cards owned", owned.toLocaleString(), `${completion}% of catalogued cards`],
    ["Wanted cards", wanted.toLocaleString(), "Your active chase list"],
    ["Completed sets", state.catalogue.sets.filter((set) => setOwnedCount(set.id) === set.cardCount).length, `of ${state.catalogue.setCount} available`],
    ["Cards catalogued", state.catalogue.cardCount.toLocaleString(), "Verified master identities"],
  ].map(([label, value, note]) => `<div class="stat-card"><p>${label}</p><strong>${value}</strong><small>${note}</small></div>`).join("");
}

function renderSets() {
  const cards = state.catalogue.sets.map(setCard).join("");
  $("#dashboardSets").innerHTML = cards;
  $("#allSets").innerHTML = cards;
}

function filteredCards(collectionOnly = false) {
  const query = state.query.trim().toLocaleLowerCase();
  return state.catalogue.cards.filter((card) => {
    if (collectionOnly && statusFor(card.id) !== "owned") return false;
    if (state.setId !== "all" && card.setId !== state.setId) return false;
    if (state.category !== "all" && card.category !== state.category) return false;
    if (state.status !== "all" && statusFor(card.id) !== state.status) return false;
    if (!query) return true;
    return [card.name, card.subject2, card.number, card.subset, card.subsetCode, card.roster].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(query));
  });
}

function cardRow(card) {
  const set = state.catalogue.sets.find((item) => item.id === card.setId);
  const status = statusFor(card.id);
  return `<article class="card-row">
    <button class="card-image-button" data-open-card="${escapeHtml(card.id)}" aria-label="View ${escapeHtml(card.name)}">
      ${imageMarkup(cardImage(card.id), `${card.name} card`, initials(card.name), "card-thumbnail")}
    </button>
    <div class="card-number">#${escapeHtml(card.number)}</div>
    <button class="card-name card-name-button" data-open-card="${escapeHtml(card.id)}">${escapeHtml(card.name)}<small>${escapeHtml(card.subset)}${card.rookie === "Yes" ? " · Rookie" : ""}</small></button>
    <div class="card-set">${escapeHtml(set.shortName)}<small>${escapeHtml(card.roster || "WWE")}</small></div>
    <span class="category-pill">${escapeHtml(card.category)}</span>
    <div class="card-actions">
      <button class="state-button owned ${status === "owned" ? "active" : ""}" data-card-id="${card.id}" data-status="owned">Owned</button>
      <button class="state-button wanted ${status === "wanted" ? "active" : ""}" data-card-id="${card.id}" data-status="wanted">Wanted</button>
    </div>
  </article>`;
}

function openCard(cardId) {
  const card = state.catalogue.cards.find((item) => item.id === cardId);
  if (!card) return;
  const set = state.catalogue.sets.find((item) => item.id === card.setId);
  const entry = cardImage(card.id);
  const front = safeUrl(entry?.front || entry?.image || entry?.thumbnail);
  const back = safeUrl(entry?.back);
  const source = safeUrl(entry?.sourceUrl, false);
  const collectionEntry = entryFor(card.id) || {};
  const selected = (value, current) => value === current ? " selected" : "";
  $("#cardDialogContent").innerHTML = `<div class="dialog-grid">
    <div class="dialog-images">
      ${imageMarkup(front ? { front, rightsStatus: "approved" } : null, `${card.name} front`, initials(card.name), "card-preview")}
      ${back ? imageMarkup({ front: back, rightsStatus: "approved" }, `${card.name} back`, "BACK", "card-preview") : ""}
    </div>
    <div class="dialog-details">
      <p class="eyebrow">${escapeHtml(set.shortName)}</p><h2>${escapeHtml(card.name)}</h2>
      <dl>
        <div><dt>Card number</dt><dd>${escapeHtml(card.number)}</dd></div>
        <div><dt>Subset</dt><dd>${escapeHtml(card.subset)}</dd></div>
        <div><dt>Category</dt><dd>${escapeHtml(card.category)}</dd></div>
        <div><dt>Card UID</dt><dd>${escapeHtml(card.id)}</dd></div>
      </dl>
      <p class="image-status ${entry ? "approved" : "pending"}">${entry ? "Approved reference image" : "Reference image not yet added"}</p>
      ${entry?.photographerCredit ? `<p class="image-credit">Image: ${escapeHtml(entry.photographerCredit)}</p>` : ""}
      ${source ? `<a class="source-link" href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">View image source</a>` : ""}
      <form class="collection-details-form" id="collectionDetailsForm" data-card-id="${escapeHtml(card.id)}">
        <div class="collection-form-heading"><strong>Collection details</strong><small>${state.user ? "Synced to your account" : "Saved on this device"}</small></div>
        <div class="form-grid">
          <label>Status<select name="status">
            <option value="missing"${selected("missing", collectionEntry.status || "missing")}>Missing</option>
            <option value="owned"${selected("owned", collectionEntry.status)}>Owned</option>
            <option value="wanted"${selected("wanted", collectionEntry.status)}>Wanted</option>
          </select></label>
          <label>Quantity<input name="quantity" type="number" min="1" max="999" value="${escapeHtml(collectionEntry.quantity || 1)}" /></label>
          <label>Condition<select name="condition">
            <option value=""${selected("", collectionEntry.condition || "")}>Not specified</option>
            <option value="Raw"${selected("Raw", collectionEntry.condition)}>Raw</option>
            <option value="Near Mint"${selected("Near Mint", collectionEntry.condition)}>Near Mint</option>
            <option value="Excellent"${selected("Excellent", collectionEntry.condition)}>Excellent</option>
            <option value="Good"${selected("Good", collectionEntry.condition)}>Good</option>
            <option value="Graded"${selected("Graded", collectionEntry.condition)}>Graded</option>
          </select></label>
          <label>Purchase price<input name="purchasePrice" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(collectionEntry.purchasePrice ?? "")}" placeholder="0.00" /></label>
          <label>Currency<input name="purchaseCurrency" maxlength="3" pattern="[A-Za-z]{3}" value="${escapeHtml(collectionEntry.purchaseCurrency || "AUD")}" /></label>
          <label>Acquired<input name="acquiredAt" type="date" value="${escapeHtml(collectionEntry.acquiredAt || "")}" /></label>
        </div>
        <label class="notes-field">Notes<textarea name="notes" maxlength="2000" rows="3" placeholder="Grade, serial number, where you found it…">${escapeHtml(collectionEntry.notes || "")}</textarea></label>
        <button class="secondary-button" type="submit">Save details</button>
      </form>
    </div>
  </div>`;
  const dialog = $("#cardDialog");
  if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
}

async function saveCollectionDetails(form) {
  const values = new FormData(form);
  const cardId = form.dataset.cardId;
  const status = values.get("status");
  state.collection[cardId] = {
    status,
    quantity: Math.min(999, Math.max(1, Number(values.get("quantity")) || 1)),
    condition: String(values.get("condition") || "").trim() || null,
    purchasePrice: values.get("purchasePrice") === "" ? null : Math.max(0, Number(values.get("purchasePrice"))),
    purchaseCurrency: String(values.get("purchaseCurrency") || "AUD").trim().toUpperCase(),
    acquiredAt: values.get("acquiredAt") || null,
    notes: String(values.get("notes") || "").trim() || null,
    updatedAt: new Date().toISOString(),
  };
  saveCollection();
  renderAll();
  if (state.user) {
    updateSyncStatus("syncing", "Saving details…");
    try {
      await syncCard(cardId);
      updateSyncStatus("cloud", "Synced to your account");
    } catch (error) {
      updateSyncStatus("pending", "Saved here · sync pending");
      console.error(error);
    }
  }
  showToast(status === "missing" ? "Card removed from your list" : "Collection details saved");
}

function renderCards() {
  const matches = filteredCards();
  const shown = matches.slice(0, state.visibleCards);
  $("#resultCount").textContent = `${matches.length.toLocaleString()} card${matches.length === 1 ? "" : "s"}`;
  const selectedSet = state.catalogue.sets.find((set) => set.id === state.setId);
  $("#activeSetLabel").textContent = selectedSet ? selectedSet.name : "Across all sets";
  $("#cardList").innerHTML = shown.length ? shown.map(cardRow).join("") : emptyState("No cards match these filters", "Try changing the set, category, status or search.");
  $("#loadMore").hidden = shown.length >= matches.length;
}

function renderCollection() {
  const ownedCards = state.catalogue.cards.filter((card) => statusFor(card.id) === "owned");
  const wanted = state.catalogue.cards.filter((card) => statusFor(card.id) === "wanted").length;
  const representedSets = new Set(ownedCards.map((card) => card.setId)).size;
  $("#collectionSummary").innerHTML = [
    ["Total cards", ownedCards.length.toLocaleString()], ["Sets represented", representedSets], ["Wanted cards", wanted.toLocaleString()],
  ].map(([label, value]) => `<div class="summary-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#collectionList").innerHTML = ownedCards.length ? ownedCards.map(cardRow).join("") : emptyState("Your vault is empty", "Mark cards as Owned and they will appear here.");
}

function emptyState(title, message) { return `<div class="empty-state"><strong>${title}</strong><span>${message}</span></div>`; }
function renderAll() { renderStats(); renderSets(); renderCards(); renderCollection(); }

function populateFilters() {
  $("#setFilter").innerHTML = `<option value="all">All sets</option>${state.catalogue.sets.map((set) => `<option value="${set.id}">${escapeHtml(set.shortName)}</option>`).join("")}`;
  const categories = [...new Set(state.catalogue.cards.map((card) => card.category))].sort();
  $("#categoryFilter").innerHTML = `<option value="all">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
}

function changeView(view) {
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `${view}View`));
  $$(".nav-link").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $("#pageTitle").textContent = { dashboard: "Overview", sets: "Sets", cards: "Cards", collection: "My Collection" }[view];
  $(".sidebar").classList.remove("open");
  history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function updateSyncStatus(mode, message) {
  const element = $("#syncStatus");
  if (!element) return;
  element.className = `sync-status ${mode}`;
  element.innerHTML = `<span class="status-dot"></span>${escapeHtml(message)}`;
}

function updateAuthUI() {
  const signedIn = Boolean(state.user);
  $("#authButton").hidden = signedIn;
  $("#signOutButton").hidden = !signedIn;
  $("#accountName").textContent = signedIn ? state.user.email : "Guest mode";
  $("#accountNote").textContent = signedIn ? "Your vault follows you" : "Sign in for cloud sync";
  updateSyncStatus(signedIn ? "cloud" : "local", signedIn ? "Synced to your account" : "Saved on this device");
}

function backupCollection() {
  const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), collection: state.collection }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ringvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function restoreCollection(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (!payload.collection || typeof payload.collection !== "object") throw new Error("Invalid backup");
    state.collection = payload.collection;
    migrateLegacyCollectionIds();
    saveCollection();
    renderAll();
    if (state.user) await syncCollection();
    showToast("Collection restored");
  } catch (error) {
    showToast("That backup file could not be restored");
    console.error(error);
  }
}

async function fetchAllRows(table, columns, orderColumns) {
  const rows = [];
  for (let from = 0; ; from += API_PAGE_SIZE) {
    let query = state.supabase.from(table).select(columns);
    for (const column of [].concat(orderColumns)) query = query.order(column);
    const { data, error } = await query.range(from, from + API_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < API_PAGE_SIZE) return rows;
  }
}

async function loadCatalogue() {
  if (state.supabase) {
    try {
      const [sets, subsets, cards] = await Promise.all([
        fetchAllRows("catalogue_sets", "id,name,short_name,year,manufacturer,release_date,accent,card_count,subset_count", ["release_date", "id"]),
        fetchAllRows("catalogue_subsets", "set_id,subset_code,category,name,card_count", ["set_id", "subset_code"]),
        fetchAllRows("catalogue_cards", "id,set_id,checklist_order,card_number,display_name,subject_2,category,subset_code,roster,rookie,parallel_group", ["set_id", "checklist_order"]),
      ]);
      const subsetMap = new Map(subsets.map((subset) => [`${subset.set_id}\u0000${subset.subset_code}`, subset.name]));
      return {
        schemaVersion: 2,
        setCount: sets.length,
        cardCount: cards.length,
        sets: sets.map((set) => ({
          id: set.id, name: set.name, shortName: set.short_name, year: set.year, manufacturer: set.manufacturer,
          releaseDate: set.release_date, accent: set.accent, cardCount: set.card_count, subsetCount: set.subset_count,
          subsets: subsets.filter((subset) => subset.set_id === set.id).map((subset) => ({ category: subset.category, name: subset.name, code: subset.subset_code, count: subset.card_count })),
        })),
        cards: cards.map((card) => ({
          id: card.id, setId: card.set_id, order: card.checklist_order, number: card.card_number, name: card.display_name,
          subject2: card.subject_2, category: card.category, subset: subsetMap.get(`${card.set_id}\u0000${card.subset_code}`),
          subsetCode: card.subset_code, roster: card.roster, rookie: card.rookie ? "Yes" : "No", parallelGroup: card.parallel_group,
        })),
      };
    } catch (error) {
      console.warn("Supabase catalogue unavailable; using offline catalogue.", error);
    }
  }
  const response = await fetch("data/catalogue.json");
  if (!response.ok) throw new Error("Catalogue failed to load");
  return response.json();
}

function remoteRowToEntry(row) {
  return {
    status: row.status, quantity: row.quantity, condition: row.condition, purchasePrice: row.purchase_price,
    purchaseCurrency: row.purchase_currency, acquiredAt: row.acquired_at, notes: row.notes, updatedAt: row.updated_at,
  };
}

function entryToRemote(cardId, entry) {
  return {
    user_id: state.user.id, card_id: cardId, status: entry.status, quantity: entry.quantity || 1,
    condition: entry.condition || null, purchase_price: entry.purchasePrice ?? null,
    purchase_currency: entry.purchaseCurrency || "AUD", acquired_at: entry.acquiredAt || null,
    notes: entry.notes || null, updated_at: entry.updatedAt || new Date().toISOString(),
  };
}

async function syncCard(cardId) {
  const entry = entryFor(cardId);
  if (!entry || entry.status === "missing") {
    const { error } = await state.supabase.from("collection_items").delete().eq("user_id", state.user.id).eq("card_id", cardId);
    if (error) throw error;
    return;
  }
  const { error } = await state.supabase.from("collection_items").upsert(entryToRemote(cardId, entry), { onConflict: "user_id,card_id" });
  if (error) throw error;
}

async function syncCollection() {
  if (!state.user || state.syncing) return;
  state.syncing = true;
  updateSyncStatus("syncing", "Syncing your vault…");
  try {
    const remoteRows = await fetchAllRows("collection_items", "card_id,status,quantity,condition,purchase_price,purchase_currency,acquired_at,notes,updated_at", "card_id");
    const remote = new Map(remoteRows.map((row) => [row.card_id, remoteRowToEntry(row)]));
    const validCardIds = new Set(state.catalogue.cards.map((card) => card.id));
    const upserts = [];
    const deletions = [];

    for (const cardId of new Set([...Object.keys(state.collection), ...remote.keys()])) {
      if (!validCardIds.has(cardId)) continue;
      const localEntry = state.collection[cardId];
      const remoteEntry = remote.get(cardId);
      if (!localEntry && remoteEntry) {
        state.collection[cardId] = remoteEntry;
        continue;
      }
      if (!localEntry) continue;
      if (!remoteEntry) {
        if (localEntry.status !== "missing") upserts.push(entryToRemote(cardId, localEntry));
        continue;
      }
      if (new Date(remoteEntry.updatedAt || 0) > new Date(localEntry.updatedAt || 0)) {
        state.collection[cardId] = remoteEntry;
      } else if (localEntry.status === "missing") {
        deletions.push(cardId);
      } else {
        upserts.push(entryToRemote(cardId, localEntry));
      }
    }

    if (upserts.length) {
      const { error } = await state.supabase.from("collection_items").upsert(upserts, { onConflict: "user_id,card_id" });
      if (error) throw error;
    }
    if (deletions.length) {
      const { error } = await state.supabase.from("collection_items").delete().eq("user_id", state.user.id).in("card_id", deletions);
      if (error) throw error;
    }
    saveCollection();
    localStorage.setItem(GUEST_STORAGE_KEY, "{}");
    renderAll();
    updateSyncStatus("cloud", "Synced to your account");
  } catch (error) {
    updateSyncStatus("pending", "Saved here · sync pending");
    console.error(error);
  } finally {
    state.syncing = false;
  }
}

async function handleSession(session) {
  const previousUserId = state.user?.id;
  const nextUser = session?.user || null;
  if (nextUser?.id !== previousUserId) {
    state.user = nextUser;
    state.collection = nextUser
      ? mergeLocalCollections(loadCollection(collectionStorageKey(nextUser.id)), loadCollection(GUEST_STORAGE_KEY))
      : loadCollection(GUEST_STORAGE_KEY);
    if (state.catalogue) migrateLegacyCollectionIds();
  } else {
    state.user = nextUser;
  }
  updateAuthUI();
  if (state.catalogue) renderAll();
  if (state.user && state.user.id !== previousUserId && state.catalogue) await syncCollection();
}

async function initSupabase() {
  const config = window.RINGVAULT_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey || !window.supabase?.createClient) return;
  state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const { data, error } = await state.supabase.auth.getSession();
  if (error) console.error(error);
  state.user = data?.session?.user || null;
  if (state.user) state.collection = mergeLocalCollections(loadCollection(collectionStorageKey(state.user.id)), loadCollection(GUEST_STORAGE_KEY));
  state.supabase.auth.onAuthStateChange((_event, session) => setTimeout(() => handleSession(session), 0));
}

async function sendMagicLink(email) {
  if (!state.supabase) throw new Error("Cloud sync is unavailable right now");
  const redirect = new URL(location.href);
  redirect.hash = "";
  redirect.search = "";
  const { error } = await state.supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirect.href, shouldCreateUser: true },
  });
  if (error) throw error;
}

function attachEvents() {
  document.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open-card]");
    if (open) { openCard(open.dataset.openCard); return; }
    const nav = event.target.closest("[data-view]");
    if (nav) { event.preventDefault(); changeView(nav.dataset.view); return; }
    const go = event.target.closest("[data-go]");
    if (go) { changeView(go.dataset.go); return; }
    const set = event.target.closest("[data-set-id]");
    if (set) {
      state.setId = set.dataset.setId; $("#setFilter").value = state.setId; state.visibleCards = PAGE_SIZE;
      changeView("cards"); renderCards(); return;
    }
    const action = event.target.closest("[data-card-id]");
    if (action) setStatus(action.dataset.cardId, action.dataset.status);
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "collectionDetailsForm") return;
    event.preventDefault();
    saveCollectionDetails(event.target);
  });
  $("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
  $("#globalSearch").addEventListener("input", (event) => { state.query = event.target.value; state.visibleCards = PAGE_SIZE; if (state.query && state.view !== "cards") changeView("cards"); renderCards(); });
  $("#setFilter").addEventListener("change", (event) => { state.setId = event.target.value; state.visibleCards = PAGE_SIZE; renderCards(); });
  $("#categoryFilter").addEventListener("change", (event) => { state.category = event.target.value; state.visibleCards = PAGE_SIZE; renderCards(); });
  $("#statusFilter").addEventListener("change", (event) => { state.status = event.target.value; state.visibleCards = PAGE_SIZE; renderCards(); });
  $("#clearFilters").addEventListener("click", () => {
    state.setId = state.category = state.status = "all"; state.query = ""; state.visibleCards = PAGE_SIZE;
    $("#setFilter").value = $("#categoryFilter").value = $("#statusFilter").value = "all"; $("#globalSearch").value = ""; renderCards();
  });
  $("#loadMore").addEventListener("click", () => { state.visibleCards += PAGE_SIZE; renderCards(); });
  $("#backupButton").addEventListener("click", backupCollection);
  $("#restoreInput").addEventListener("change", (event) => { if (event.target.files[0]) restoreCollection(event.target.files[0]); event.target.value = ""; });
  $("#closeCardDialog").addEventListener("click", () => $("#cardDialog").close());
  $("#cardDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  $("#authButton").addEventListener("click", () => $("#authDialog").showModal());
  $("#closeAuthDialog").addEventListener("click", () => $("#authDialog").close());
  $("#authDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  $("#signOutButton").addEventListener("click", async () => {
    const { error } = await state.supabase.auth.signOut();
    if (error) showToast("Sign out failed. Please try again."); else showToast("Signed out · cloud collection stays with your account");
  });
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#authSubmit");
    const message = $("#authMessage");
    button.disabled = true; message.textContent = "Sending your secure sign-in link…";
    try {
      await sendMagicLink($("#authEmail").value.trim());
      message.textContent = "Check your email and open the RingVault sign-in link.";
      button.textContent = "Link sent";
    } catch (error) {
      message.textContent = error.message || "The sign-in link could not be sent.";
      button.disabled = false;
    }
  });
  window.addEventListener("online", () => { if (state.user) syncCollection(); });
}

async function init() {
  try {
    await initSupabase();
    const [catalogue, imageResponse] = await Promise.all([loadCatalogue(), fetch("data/images.json").catch(() => null)]);
    state.catalogue = catalogue;
    if (imageResponse?.ok) state.images = await imageResponse.json();
    migrateLegacyCollectionIds();
    populateFilters();
    attachEvents();
    updateAuthUI();
    renderAll();
    if (state.user) await syncCollection();
    const requested = location.hash.slice(1);
    if (["dashboard", "sets", "cards", "collection"].includes(requested)) changeView(requested);
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js");
  } catch (error) {
    $(".content").innerHTML = emptyState("RingVault could not load", "Refresh the page to try again.");
    console.error(error);
  }
}

init();
