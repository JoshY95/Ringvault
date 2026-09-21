const STORAGE_KEY = "ringvault.collection.v1";
const PAGE_SIZE = 100;

const state = {
  catalogue: null,
  collection: loadCollection(),
  view: "dashboard",
  query: "",
  setId: "all",
  category: "all",
  status: "all",
  visibleCards: PAGE_SIZE,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadCollection() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveCollection() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.collection));
}

function entryFor(cardId) { return state.collection[cardId] || null; }
function statusFor(cardId) { return entryFor(cardId)?.status || "missing"; }

function setStatus(cardId, nextStatus) {
  const current = statusFor(cardId);
  if (current === nextStatus) delete state.collection[cardId];
  else state.collection[cardId] = { status: nextStatus, updatedAt: new Date().toISOString() };
  saveCollection();
  renderAll();
  showToast(current === nextStatus ? "Card removed from your list" : nextStatus === "owned" ? "Added to your collection" : "Added to your wanted list");
}

function counts() {
  const values = Object.values(state.collection);
  return {
    owned: values.filter((item) => item.status === "owned").length,
    wanted: values.filter((item) => item.status === "wanted").length,
  };
}

function setOwnedCount(setId) {
  return state.catalogue.cards.filter((card) => card.setId === setId && statusFor(card.id) === "owned").length;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function setCard(set) {
  const owned = setOwnedCount(set.id);
  const progress = set.cardCount ? Math.round((owned / set.cardCount) * 100) : 0;
  return `<article class="set-card" data-set-id="${set.id}" style="--accent:${set.accent}">
    <span class="set-year">${set.year} · TOPPS</span>
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
    <div class="card-number">#${escapeHtml(card.number)}</div>
    <div class="card-name">${escapeHtml(card.name)}<small>${escapeHtml(card.subset)}${card.rookie === "Yes" ? " · Rookie" : ""}</small></div>
    <div class="card-set">${escapeHtml(set.shortName)}<small>${escapeHtml(card.roster || "WWE")}</small></div>
    <span class="category-pill">${escapeHtml(card.category)}</span>
    <div class="card-actions">
      <button class="state-button owned ${status === "owned" ? "active" : ""}" data-card-id="${card.id}" data-status="owned">Owned</button>
      <button class="state-button wanted ${status === "wanted" ? "active" : ""}" data-card-id="${card.id}" data-status="wanted">Wanted</button>
    </div>
  </article>`;
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
  const wanted = Object.values(state.collection).filter((item) => item.status === "wanted").length;
  const representedSets = new Set(ownedCards.map((card) => card.setId)).size;
  $("#collectionSummary").innerHTML = [
    ["Total cards", ownedCards.length.toLocaleString()],
    ["Sets represented", representedSets],
    ["Wanted cards", wanted.toLocaleString()],
  ].map(([label, value]) => `<div class="summary-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#collectionList").innerHTML = ownedCards.length ? ownedCards.map(cardRow).join("") : emptyState("Your vault is empty", "Mark cards as Owned and they will appear here.");
}

function emptyState(title, message) { return `<div class="empty-state"><strong>${title}</strong><span>${message}</span></div>`; }

function renderAll() {
  renderStats();
  renderSets();
  renderCards();
  renderCollection();
}

function populateFilters() {
  $("#setFilter").innerHTML += state.catalogue.sets.map((set) => `<option value="${set.id}">${escapeHtml(set.shortName)}</option>`).join("");
  const categories = [...new Set(state.catalogue.cards.map((card) => card.category))].sort();
  $("#categoryFilter").innerHTML += categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
}

function changeView(view) {
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `${view}View`));
  $$(".nav-link").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  const titles = { dashboard: "Overview", sets: "Sets", cards: "Cards", collection: "My Collection" };
  $("#pageTitle").textContent = titles[view];
  $(".sidebar").classList.remove("open");
  history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function backupCollection() {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), collection: state.collection }, null, 2)], { type: "application/json" });
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
    saveCollection();
    renderAll();
    showToast("Collection restored");
  } catch { showToast("That backup file could not be restored"); }
}

function attachEvents() {
  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-view]");
    if (nav) { event.preventDefault(); changeView(nav.dataset.view); return; }
    const go = event.target.closest("[data-go]");
    if (go) { changeView(go.dataset.go); return; }
    const set = event.target.closest("[data-set-id]");
    if (set) {
      state.setId = set.dataset.setId;
      $("#setFilter").value = state.setId;
      state.visibleCards = PAGE_SIZE;
      changeView("cards");
      renderCards();
      return;
    }
    const action = event.target.closest("[data-card-id]");
    if (action) setStatus(action.dataset.cardId, action.dataset.status);
  });
  $("#menuButton").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
  $("#globalSearch").addEventListener("input", (event) => { state.query = event.target.value; state.visibleCards = PAGE_SIZE; if (state.query && state.view !== "cards") changeView("cards"); renderCards(); });
  $("#setFilter").addEventListener("change", (event) => { state.setId = event.target.value; state.visibleCards = PAGE_SIZE; renderCards(); });
  $("#categoryFilter").addEventListener("change", (event) => { state.category = event.target.value; state.visibleCards = PAGE_SIZE; renderCards(); });
  $("#statusFilter").addEventListener("change", (event) => { state.status = event.target.value; state.visibleCards = PAGE_SIZE; renderCards(); });
  $("#clearFilters").addEventListener("click", () => {
    state.setId = state.category = state.status = "all"; state.query = ""; state.visibleCards = PAGE_SIZE;
    $("#setFilter").value = $("#categoryFilter").value = $("#statusFilter").value = "all";
    $("#globalSearch").value = ""; renderCards();
  });
  $("#loadMore").addEventListener("click", () => { state.visibleCards += PAGE_SIZE; renderCards(); });
  $("#backupButton").addEventListener("click", backupCollection);
  $("#restoreInput").addEventListener("change", (event) => { if (event.target.files[0]) restoreCollection(event.target.files[0]); event.target.value = ""; });
}

async function init() {
  try {
    const response = await fetch("data/catalogue.json");
    if (!response.ok) throw new Error("Catalogue failed to load");
    state.catalogue = await response.json();
    populateFilters();
    attachEvents();
    renderAll();
    const requested = location.hash.slice(1);
    if (["dashboard", "sets", "cards", "collection"].includes(requested)) changeView(requested);
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js");
  } catch (error) {
    $(".content").innerHTML = emptyState("RingVault could not load", "Refresh the page to try again.");
    console.error(error);
  }
}

init();
