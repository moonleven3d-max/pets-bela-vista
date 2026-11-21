import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, serverTimestamp, doc, setDoc, updateDoc, addDoc, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { firebaseConfig, ADMIN_UID } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const $ = id => document.getElementById(id);

const state = {
  user: null,          // usuário conectado (morador ativo ou administração)
  member: null,        // dados de members/{uid}
  pets: [],
  found: [],
  lost: [],            // alertas ativos
  contacts: new Map(), // petId -> pet_alert_contacts
  mySightings: [],
  signingUp: false,
  deferredPrompt: null,
  routeHandled: false
};
const SITE = location.origin;

// ---------- utilitários ----------
function esc(v = "") { return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function toast(m, ms = 4000) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms); }
function modal(id, show) { $(id).hidden = !show; document.body.style.overflow = document.querySelector(".modal-backdrop:not([hidden])") ? "hidden" : ""; }
function bySeconds(a, b) { return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0); }
function digits(v = "") { return String(v).replace(/\D/g, ""); }
function waNumber(phone) { let d = digits(phone); if (d.length === 10 || d.length === 11) d = "55" + d; return d; }
function waLink(phone, text) { return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`; }
function waShare(text) { return `https://wa.me/?text=${encodeURIComponent(text)}`; }
function petUrl(id) { return `${SITE}/pet/${encodeURIComponent(id)}`; }
function fmtDateTime(v) { if (!v) return ""; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); }
function fmtDate(v) { if (!v) return ""; const d = new Date(v + (String(v).length === 10 ? "T12:00" : "")); return isNaN(d) ? String(v) : d.toLocaleDateString("pt-BR"); }
function isMemberActive() { return !!state.user && (state.member?.active === true || state.user.uid === ADMIN_UID); }
function isAdminUser() { return state.user?.uid === ADMIN_UID; }
function myPets() { return state.user ? state.pets.filter(p => p.ownerUid === state.user.uid) : []; }
function alertFor(petId) { return state.lost.find(a => (a.petId || a.id) === petId); }
function lostMessage(a) {
  return `🚨 *PET DESAPARECIDO*\n\n*${a.name} está desaparecido(a)!*\n` +
    `Foi visto(a) pela última vez ${a.location ? `próximo a: ${a.location}` : "no bairro"}${a.seenAt ? ` (${fmtDateTime(a.seenAt)})` : ""}.\n\n` +
    `Se alguém encontrar ou tiver informações, por favor, ajude a família! 🐾\n\n${petUrl(a.petId || a.id)}`;
}

// ---------- telefone -> login interno ----------
function canonicalPhone(phone) {
  let d = digits(phone);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10 || d.length > 11) throw new Error("Informe um WhatsApp válido com DDD, por exemplo (47) 99999-9999.");
  return d;
}
const loginEmail = d => `${d}@login.petsbelavista.invalid`;

// ---------- carregamento ----------
async function load() {
  try {
    const [petsSnap, foundSnap, lostSnap] = await Promise.all([
      getDocs(collection(db, "pets_public")),
      getDocs(query(collection(db, "found_public"), where("status", "==", "active"))),
      getDocs(collection(db, "lost_public"))
    ]);
    state.pets = petsSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort(bySeconds);
    state.found = foundSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort(bySeconds);
    state.lost = lostSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => a.status === "active").sort(bySeconds);
  } catch (e) {
    console.error(e);
    toast("Não foi possível carregar os cadastros. Confira as regras do Firestore.");
  }
  state.contacts = new Map();
  state.mySightings = [];
  if (state.user && isMemberActive()) {
    try {
      const qs = isAdminUser()
        ? [getDocs(collection(db, "pet_alert_contacts"))]
        : [getDocs(query(collection(db, "pet_alert_contacts"), where("allowAlerts", "==", true))),
           getDocs(query(collection(db, "pet_alert_contacts"), where("ownerUid", "==", state.user.uid)))];
      for (const snap of await Promise.all(qs)) snap.docs.forEach(d => state.contacts.set(d.data().petId || d.id, { id: d.id, ...d.data() }));
    } catch (e) { console.error("contatos", e); }
    if (!isAdminUser()) {
      try {
        const s = await getDocs(query(collection(db, "sightings"), where("petOwnerUid", "==", state.user.uid)));
        state.mySightings = s.docs.map(d => ({ id: d.id, ...d.data() })).sort(bySeconds);
      } catch (e) { console.error("avistamentos", e); }
    }
  }
  renderAll();
  handleRoute();
}

// ---------- renderização ----------
function petCard(p, owner = false) {
  const a = alertFor(p.id);
  return `<article class="pet-card">${p.photo ? `<img class="pet-photo" src="${esc(p.photo)}" alt="Foto de ${esc(p.name)}" loading="lazy">` : `<div class="pet-photo-placeholder">🐾</div>`}
  <div class="pet-info"><div class="pet-title"><h3>${esc(p.name)}</h3><span class="species${a ? " species-lost" : ""}">${a ? "Desaparecido" : esc(p.type)}</span></div>
  <p>${esc([p.breed, p.traits].filter(Boolean).join(" · "))}</p>
  <button class="details-link" data-pet-details="${esc(p.id)}">Ver mais detalhes <span>→</span></button>
  ${owner ? `<div class="owner-actions"><button class="small-btn approve" data-pet-edit="${esc(p.id)}">Editar cadastro</button>${a ? `<button class="small-btn approve" data-resolve-lost="${esc(p.id)}">Meu pet foi encontrado</button>` : `<button class="small-btn reject" data-lost-for="${esc(p.id)}">Meu pet fugiu</button>`}</div>` : ""}
  </div></article>`;
}
function renderPets() {
  const q = $("searchInput").value.trim().toLocaleLowerCase("pt-BR"), t = $("typeFilter").value;
  const v = state.pets.filter(p => (t === "todos" || p.type === t) && [p.name, p.breed, p.traits, p.description, p.type].join(" ").toLocaleLowerCase("pt-BR").includes(q));
  $("approvedCount").textContent = state.pets.length;
  $("petGrid").innerHTML = v.map(p => petCard(p)).join("");
  $("emptyState").classList.toggle("show", !v.length);
  $("emptyState").querySelector("h3").textContent = state.pets.length ? "Nenhum pet encontrado nessa busca" : "Ainda não temos pets por aqui";
  $("petGrid").style.display = v.length ? "grid" : "none";
}
function renderMyPets() {
  const section = $("meus-pets");
  section.hidden = !state.user || isAdminUser();
  $("myPetsNav").hidden = section.hidden;
  if (section.hidden) return;
  const mine = myPets();
  $("myPetsGrid").innerHTML = mine.map(p => petCard(p, true)).join("");
  $("myPetsEmpty").hidden = mine.length > 0;
  $("mySightings").innerHTML = state.mySightings.length
    ? `<h3 class="sub-heading">Avistamentos dos seus pets</h3>` + state.mySightings.slice(0, 10).map(s => `<div class="mini-sighting"><div class="pet-photo-placeholder mini-ph">👀</div><div><b>${esc(s.petName)}</b><small>📍 ${esc(s.location)} · ${esc(fmtDateTime(s.seenAt))}<br>Avisado por ${esc(s.reporterName || "morador")}${s.notes ? ` · ${esc(s.notes)}` : ""}</small></div></div>`).join("")
    : "";
}
function renderFound() {
  $("foundGrid").innerHTML = state.found.map(p => `<article class="pet-card">${p.photo ? `<img class="pet-photo" src="${esc(p.photo)}" alt="Animal encontrado" loading="lazy">` : `<div class="pet-photo-placeholder">🐾</div>`}<div class="pet-info"><div class="pet-title"><h3>${esc(p.type)}</h3><span class="species">Encontrado</span></div><p>${esc([p.appearance, p.traits].filter(Boolean).join(" · "))}</p><p class="pet-location">📍 ${esc(p.location)} · ${esc(fmtDate(p.seenDate))}</p><button class="button button-primary claim-btn" data-id="${esc(p.id)}">Esse pet é meu</button></div></article>`).join("");
  $("foundEmpty").classList.toggle("show", !state.found.length);
  $("foundGrid").style.display = state.found.length ? "grid" : "none";
}
function renderDashboard() {
  $("foundCount").textContent = state.found.length;
  $("activeAlertCount").textContent = state.lost.length;
  $("lostAlerts").innerHTML = state.lost.length ? state.lost.map(a => `<div class="mini-alert">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : `<div class="pet-photo-placeholder mini-ph">🐾</div>`}<div class="mini-alert-info"><b>${esc(a.name)}</b><small>DESAPARECIDO · ${esc(a.location || "Local não informado")}<br>${esc(fmtDateTime(a.seenAt))}</small></div><div class="mini-alert-actions"><button class="share-mini" data-pet-details="${esc(a.petId || a.id)}">Ver</button><a class="share-mini share-wa" href="${waShare(lostMessage(a))}" target="_blank" rel="noopener">WhatsApp</a></div></div>`).join("") : '<p class="panel-empty">Nenhum alerta de desaparecimento ativo.</p>';
  $("recentSightings").innerHTML = state.found.slice(0, 3).map(p => `<div class="mini-sighting">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : `<div class="pet-photo-placeholder mini-ph">🐾</div>`}<div><b>${esc(p.type)}</b><small>📍 ${esc(p.location)}<br>Visto em ${esc(fmtDate(p.seenDate))}</small></div></div>`).join("") || '<p class="panel-empty">Nenhum avistamento recente.</p>';
}
function renderAuth() {
  const on = !!state.user;
  $("memberBtn").textContent = on ? (isAdminUser() ? "Administração conectada" : `Olá, ${(state.member?.name || "morador").split(" ")[0]}`) : "Entrar / Cadastrar morador";
  $("memberForm").hidden = on;
  $("memberConnectedActions").hidden = !on;
  $("goMyPets").hidden = isAdminUser();
  $("goAdmin").hidden = !isAdminUser();
  $("memberTitle").textContent = on ? "Você está conectado" : "Acesso dos moradores";
  $("memberIntro").textContent = on ? `Conectado como ${state.member?.name || (isAdminUser() ? "administração" : "morador")}${state.member?.phone ? ` · ${state.member.phone}` : ""}.` : "Entre ou crie seu acesso para ajudar a cuidar dos pets do bairro.";
}
function renderAll() { renderAuth(); renderPets(); renderMyPets(); renderFound(); renderDashboard(); }

// ---------- detalhes / página individual ----------
async function openPetDetails(id, { pushUrl = true } = {}) {
  let p = state.pets.find(x => x.id === id);
  const a = alertFor(id);
  if (!p && a) p = { id, name: a.name, photo: a.photo, type: "" };
  if (!p) { toast("Pet não encontrado. O cadastro pode ter sido removido."); return; }
  const owner = !!state.user && p.ownerUid === state.user.uid;
  const c = state.contacts.get(id);
  let extra;
  if (!state.user) {
    extra = `<div class="details-extra"><b>Informações adicionais</b><p>Visualize as informações adicionais ao se cadastrar na comunidade.</p><button class="button button-outline-light" data-open-member>Entrar / Cadastrar morador</button></div>`;
  } else {
    let priv = null;
    if (owner || isAdminUser()) { try { const s = await getDoc(doc(db, "pet_private", id)); priv = s.exists() ? s.data() : null; } catch (e) { console.error(e); } }
    const guardians = c?.guardians?.filter(g => g.name || g.phone) || [];
    const canContact = owner || isAdminUser() || c?.allowAlerts === true;
    extra = `<div class="details-extra"><b>Informações adicionais</b>${canContact && guardians.length
      ? `<p>${guardians.map(g => `${esc(g.name || "Responsável")}${g.phone ? ` · <a href="${waLink(g.phone, `Olá! Estou entrando em contato pelo Pets Bela Vista sobre o(a) ${p.name}.`)}" target="_blank" rel="noopener">${esc(g.phone)}</a>` : ""}`).join("<br>")}</p>`
      : `<p>${canContact ? "Nenhum contato cadastrado." : "O responsável optou por não compartilhar os contatos. Você ainda pode registrar um avistamento."}</p>`}
      ${priv ? `<p class="private-box">🔒 <b>Endereço (visível só para você${isAdminUser() ? " e a administração" : ""}):</b><br>${esc([priv.street, priv.number].filter(Boolean).join(", "))}${priv.referenceUnit ? ` · ${esc(priv.referenceUnit)}` : ""}${priv.houseColor ? ` · casa ${esc(priv.houseColor)}` : ""}${priv.nearbyReference ? `<br>${esc(priv.nearbyReference)}` : ""}</p>` : ""}
      ${owner ? `<small>Este pet está vinculado à sua conta.</small><div class="owner-actions"><button class="small-btn approve" data-pet-edit="${esc(id)}">Editar cadastro</button>${a ? `<button class="small-btn approve" data-resolve-lost="${esc(id)}">Meu pet foi encontrado</button>` : `<button class="small-btn reject" data-lost-for="${esc(id)}">Meu pet fugiu</button>`}</div>`
        : `<div class="owner-actions"><button class="small-btn approve" data-sighting-for="${esc(id)}">👀 Vi este pet na rua</button></div>`}
    </div>`;
  }
  const alertBox = a ? `<div class="alert-box"><b>🚨 Pet desaparecido</b><p><b>Último local:</b> ${esc(a.location || "não informado")}<br><b>Data e horário:</b> ${esc(fmtDateTime(a.seenAt) || "não informado")}${a.notes ? `<br><b>Informações:</b> ${esc(a.notes)}` : ""}</p>
    <p class="alert-help">Se você viu este pet: não corra atrás dele, observe para onde foi e avise a família${state.user ? " pelo botão abaixo" : " (entre na comunidade para ver os contatos autorizados)"}. Se conseguir, ofereça água e mantenha-o em local seguro.</p>
    <div class="owner-actions"><a class="small-btn share-wa" href="${waShare(lostMessage(a))}" target="_blank" rel="noopener">Compartilhar no grupo do WhatsApp</a><button class="small-btn approve" data-copy-link="${esc(id)}">Copiar link</button></div></div>` : "";
  $("petDetailsTitle").textContent = p.name;
  $("petDetailsContent").innerHTML = `${alertBox}${p.photo ? `<img class="details-photo" src="${esc(p.photo)}" alt="Foto de ${esc(p.name)}">` : ""}<div class="details-facts">${p.type ? `<span class="species">${esc(p.type)}</span>` : ""}${p.breed ? `<p><b>Raça:</b> ${esc(p.breed)}</p>` : ""}${p.size ? `<p><b>Porte:</b> ${esc(p.size)}</p>` : ""}${p.traits ? `<p><b>Cor e características:</b> ${esc(p.traits)}</p>` : ""}${p.description ? `<p><b>Descrição:</b> ${esc(p.description)}</p>` : ""}</div>${extra}`;
  modal("petDetailsModal", true);
  if (pushUrl && location.pathname !== `/pet/${id}`) history.replaceState(null, "", `/pet/${encodeURIComponent(id)}`);
  document.title = `${p.name}${a ? " está desaparecido(a)" : ""} · Pets Bela Vista`;
}
function closePetDetails() {
  modal("petDetailsModal", false);
  if (location.pathname.startsWith("/pet/") || location.hash.startsWith("#pet-") || location.hash.startsWith("#alerta-")) history.replaceState(null, "", "/");
  document.title = "Pets Bela Vista";
}
function handleRoute() {
  if (state.routeHandled) return;
  state.routeHandled = true; // só na primeira carga da página
  let id = null;
  const m = location.pathname.match(/^\/pet\/([^/]+)\/?$/);
  if (m) id = decodeURIComponent(m[1]);
  const h = location.hash.match(/^#(?:pet|alerta)-(.+)$/);
  if (!id && h) {
    id = decodeURIComponent(h[1]);
    const legacy = state.lost.find(a => a.id === id); // links antigos usavam o id do alerta
    if (legacy?.petId) id = legacy.petId;
  }
  if (id) openPetDetails(id);
}

// ---------- cadastro / edição de pet ----------
function compress(file) {
  return new Promise((res, rej) => {
    if (!file.type.startsWith("image/")) return rej(Error("Escolha uma imagem."));
    if (file.size > 15 * 1024 * 1024) return rej(Error("A imagem é muito grande. Escolha uma foto de até 15 MB."));
    createImageBitmap(file).then(b => {
      const sc = Math.min(1, 720 / Math.max(b.width, b.height)), c = document.createElement("canvas");
      c.width = Math.round(b.width * sc); c.height = Math.round(b.height * sc);
      c.getContext("2d").drawImage(b, 0, 0, c.width, c.height);
      res(c.toDataURL("image/jpeg", .7));
    }).catch(() => rej(Error("Não foi possível ler esta imagem. Tente outra foto (JPG ou PNG).")));
  });
}
async function photoChange(input, preview) {
  const file = input.files[0]; if (!file) return;
  try { const d = await compress(file); $(preview).src = d; $(preview).hidden = false; input.dataset.compressed = d; }
  catch (e) { input.value = ""; toast(e.message); }
}
function resetPetForm() {
  const f = $("petForm"); f.reset(); delete f.dataset.editId;
  $("photoPreview").hidden = true; $("petPhoto").value = ""; delete $("petPhoto").dataset.compressed;
  $("formTitle").textContent = "Vamos conhecer seu pet?"; $("formEyebrow").textContent = "NOVO CADASTRO";
}
function requireMember(msg) {
  if (state.user && isMemberActive() && !isAdminUser()) return true;
  if (isAdminUser()) { toast("Use a área administrativa para gerenciar cadastros. Para cadastrar seu próprio pet, entre com uma conta de morador."); return false; }
  toast(msg || "Entre ou crie seu acesso de morador primeiro.");
  modal("memberModal", true);
  return false;
}
function openPetForm() {
  if (!requireMember()) return;
  resetPetForm();
  const f = $("petForm");
  f.elements.owner.value = state.member?.name || "";
  f.elements.phone.value = state.member?.phone || "";
  modal("formModal", true);
}
async function beginEditPet(petId) {
  const pet = state.pets.find(x => x.id === petId);
  if (!pet || !state.user || pet.ownerUid !== state.user.uid) { toast("Este pet não está vinculado à sua conta. Peça à administração para fazer o vínculo."); return; }
  resetPetForm();
  const f = $("petForm"); f.dataset.editId = pet.id;
  for (const k of ["name", "type", "breed", "size", "traits", "description"]) if (f.elements[k]) f.elements[k].value = pet[k] || "";
  const c = state.contacts.get(pet.id), gs = c?.guardians || [];
  ["owner", "owner2", "owner3"].forEach((k, i) => f.elements[k].value = gs[i]?.name || (i === 0 ? state.member?.name || "" : ""));
  ["phone", "phone2", "phone3"].forEach((k, i) => f.elements[k].value = gs[i]?.phone || (i === 0 ? state.member?.phone || "" : ""));
  f.elements.allowAlerts.checked = c?.allowAlerts === true;
  try {
    const s = await getDoc(doc(db, "pet_private", pet.id));
    if (s.exists()) for (const k of ["street", "number", "referenceUnit", "houseColor", "nearbyReference"]) f.elements[k].value = s.data()[k] || "";
  } catch (e) { console.error(e); }
  $("formTitle").textContent = `Editar cadastro de ${pet.name}`; $("formEyebrow").textContent = "EDITAR CADASTRO";
  if (pet.photo) { $("photoPreview").src = pet.photo; $("photoPreview").hidden = false; $("petPhoto").dataset.compressed = pet.photo; }
  closePetDetails();
  modal("formModal", true);
}
async function savePet(e) {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.reportValidity()) return;
  if (!requireMember("Entre na área dos moradores para cadastrar seu pet.")) return;
  const photo = $("petPhoto").dataset.compressed;
  if (!photo) return toast("Adicione uma foto do pet.");
  const d = Object.fromEntries(new FormData(f));
  const btn = f.querySelector("[type=submit]"); btn.disabled = true;
  try {
    const editId = f.dataset.editId;
    const existing = editId ? state.pets.find(p => p.id === editId) : null;
    if (editId && existing?.ownerUid !== state.user.uid) throw new Error("Este pet não está vinculado à sua conta.");
    const id = editId || doc(collection(db, "pets_public")).id;
    const uid = state.user.uid;
    const publicPet = { name: d.name.trim(), type: d.type, breed: d.breed.trim(), size: d.size, traits: d.traits.trim(), description: (d.description || "").trim(), photo, ownerUid: uid, createdAt: existing?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() };
    const guardians = [[d.owner, d.phone], [d.owner2, d.phone2], [d.owner3, d.phone3]].map(([n, ph]) => ({ name: (n || "").trim(), phone: (ph || "").trim() })).filter(g => g.name || g.phone);
    const batch = writeBatch(db);
    batch.set(doc(db, "pets_public", id), publicPet);
    batch.set(doc(db, "pet_alert_contacts", id), { petId: id, petName: publicPet.name, guardians, allowAlerts: d.allowAlerts === "yes", ownerUid: uid });
    batch.set(doc(db, "pet_private", id), { petId: id, ownerUid: uid, street: d.street.trim(), number: d.number.trim(), referenceUnit: d.referenceUnit.trim(), houseColor: d.houseColor.trim(), nearbyReference: d.nearbyReference.trim() });
    await batch.commit();
    modal("formModal", false); resetPetForm();
    toast(editId ? "Cadastro atualizado!" : `${publicPet.name} foi cadastrado(a) e já aparece em Meus pets! 🐾`);
    await load();
    $("meus-pets").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error(err);
    toast(err.code === "permission-denied" ? "Sem permissão para salvar. Verifique se as regras novas do Firestore foram publicadas." : `Falha ao salvar: ${err.message || err.code}`);
  } finally { btn.disabled = false; }
}

// ---------- alertas de desaparecimento ----------
function openLost(petId = "") {
  if (!requireMember("Entre na área dos moradores para criar um alerta.")) return;
  const mine = myPets();
  if (!mine.length) { toast("Cadastre seu pet primeiro. Depois você poderá criar o alerta a partir de Meus pets."); return; }
  $("lostPetSelect").innerHTML = '<option value="">Selecione seu pet</option>' + mine.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${alertFor(p.id) ? " (alerta ativo)" : ""}</option>`).join("");
  $("lostPetSelect").value = petId;
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $("lostForm").elements.seenAt.value = now.toISOString().slice(0, 16);
  $("lostShare").hidden = true; $("lostForm").hidden = false;
  closePetDetails();
  modal("lostModal", true);
}
async function saveLost(e) {
  e.preventDefault();
  const f = e.currentTarget; if (!f.reportValidity()) return;
  const d = Object.fromEntries(new FormData(f)), pet = myPets().find(p => p.id === d.petId);
  if (!pet) return toast("Selecione um dos seus pets.");
  const btn = f.querySelector("[type=submit]"); btn.disabled = true;
  try {
    const a = { petId: pet.id, name: pet.name, photo: pet.photo || "", location: d.location.trim(), seenAt: d.seenAt, notes: (d.notes || "").trim(), ownerUid: state.user.uid, status: "active", createdAt: serverTimestamp() };
    await setDoc(doc(db, "lost_public", pet.id), a);
    f.reset(); f.hidden = true;
    $("lostShareText").textContent = lostMessage(a);
    $("lostShareWa").href = waShare(lostMessage(a));
    $("lostShareLink").textContent = petUrl(pet.id);
    $("lostShare").hidden = false;
    toast("Alerta publicado! Compartilhe no grupo do bairro.");
    await load();
  } catch (err) { console.error(err); toast(err.code === "permission-denied" ? "Sem permissão para publicar o alerta. Verifique as regras do Firestore." : "Não foi possível publicar o alerta."); }
  finally { btn.disabled = false; }
}
async function resolveLost(petId) {
  const a = alertFor(petId); if (!a) return;
  if (!confirm(`Confirmar que ${a.name} foi encontrado(a)? O alerta deixará de aparecer.`)) return;
  try {
    await updateDoc(doc(db, "lost_public", a.id), { status: "resolved", resolvedAt: serverTimestamp() });
    toast(`Que notícia boa! O alerta de ${a.name} foi encerrado. 💚`);
    closePetDetails();
    await load();
  } catch (err) { console.error(err); toast("Não foi possível encerrar o alerta."); }
}

// ---------- avistamento de pet cadastrado ----------
function openSighting(petId = "") {
  if (!requireMember("Entre na comunidade para avisar o responsável. Se o animal não for cadastrado, use “Cadastrar animal encontrado”.")) return;
  $("sightingPetSelect").innerHTML = '<option value="">Selecione o pet</option>' + state.pets.filter(p => p.ownerUid !== state.user.uid).map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.type)}${alertFor(p.id) ? " · DESAPARECIDO" : ""}</option>`).join("");
  $("sightingPetSelect").value = petId;
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $("sightingForm").elements.seenAt.value = now.toISOString().slice(0, 16);
  $("sightingForm").hidden = false; $("sightingResult").hidden = true;
  closePetDetails();
  modal("sightingModal", true);
}
async function saveSighting(e) {
  e.preventDefault();
  const f = e.currentTarget; if (!f.reportValidity()) return;
  const d = Object.fromEntries(new FormData(f)), pet = state.pets.find(p => p.id === d.petId);
  if (!pet) return toast("Selecione o pet que você viu.");
  const btn = f.querySelector("[type=submit]"); btn.disabled = true;
  try {
    await addDoc(collection(db, "sightings"), { petId: pet.id, petName: pet.name, petOwnerUid: pet.ownerUid || "", location: d.location.trim(), seenAt: d.seenAt, notes: (d.notes || "").trim(), reporterUid: state.user.uid, reporterName: state.member?.name || "", createdAt: serverTimestamp() });
    const c = state.contacts.get(pet.id);
    const msg = `Olá! Aqui é ${state.member?.name || "um(a) morador(a)"}, do Pets Bela Vista. 🐾\nVi o(a) *${pet.name}* na rua, próximo a: ${d.location.trim()}, em ${fmtDateTime(d.seenAt)}.${d.notes ? `\n${d.notes.trim()}` : ""}\nEstou avisando para você saber onde ele(a) foi visto(a).`;
    const gs = c?.allowAlerts ? (c.guardians || []).filter(g => g.phone) : [];
    $("sightingResult").innerHTML = gs.length
      ? `<p>Avistamento registrado! Agora envie o aviso para a família:</p><div class="owner-actions">${gs.map(g => `<a class="button button-primary" href="${waLink(g.phone, msg)}" target="_blank" rel="noopener">Avisar ${esc(g.name || "responsável")} no WhatsApp</a>`).join("")}</div>`
      : `<p>Avistamento registrado! O responsável não autorizou o contato direto por WhatsApp, mas o aviso aparece na área <b>Meus pets</b> dele e para a administração.</p>`;
    f.reset(); f.hidden = true; $("sightingResult").hidden = false;
  } catch (err) { console.error(err); toast(err.code === "permission-denied" ? "Sem permissão para registrar. Verifique as regras do Firestore." : "Não foi possível registrar o avistamento."); }
  finally { btn.disabled = false; }
}

// ---------- animal encontrado / reivindicação ----------
async function saveFound(e) {
  e.preventDefault();
  const f = e.currentTarget; if (!f.reportValidity()) return;
  const photo = $("foundPhoto").dataset.compressed; if (!photo) return toast("Adicione uma foto.");
  const d = Object.fromEntries(new FormData(f)), btn = f.querySelector("[type=submit]"); btn.disabled = true;
  try {
    await addDoc(collection(db, "found_submissions"), { type: d.type, appearance: d.appearance.trim(), traits: d.traits.trim(), location: d.location.trim(), seenDate: d.seenDate, reporter: d.reporter.trim(), phone: d.phone.trim(), reporterUid: state.user?.uid || "", photo, status: "pending", createdAt: serverTimestamp() });
    closeFound();
    toast("Obrigado! O registro será conferido pela administração e logo aparecerá em Encontrados na rua.");
  } catch (err) { console.error(err); toast("Falha ao enviar. Tente novamente."); }
  finally { btn.disabled = false; }
}
function closeFound() { modal("foundModal", false); $("foundForm").reset(); $("foundPreview").hidden = true; $("foundPhoto").value = ""; delete $("foundPhoto").dataset.compressed; }
async function saveClaim(e) {
  e.preventDefault();
  const f = e.currentTarget; if (!f.reportValidity()) return;
  const d = Object.fromEntries(new FormData(f)), btn = f.querySelector("[type=submit]"); btn.disabled = true;
  try {
    await addDoc(collection(db, "claim_submissions"), { foundPetId: d.foundPetId, owner: d.owner.trim(), phone: d.phone.trim(), proof: d.proof.trim(), claimantUid: state.user?.uid || "", status: "pending", createdAt: serverTimestamp() });
    modal("claimModal", false); f.reset();
    toast("Reivindicação enviada. A administração vai analisar e entrar em contato!");
  } catch (err) { console.error(err); toast("Não foi possível enviar a reivindicação."); }
  finally { btn.disabled = false; }
}

// ---------- acesso dos moradores ----------
async function ensureMemberDoc(user, name, phone) {
  const ref = doc(db, "members", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  // Contas criadas na versão anterior podem ter ficado sem cadastro em "members": cria agora, já ativo.
  const data = { name: (name || "Morador").trim().slice(0, 70), phone: (phone || "").trim().slice(0, 20), active: true, createdAt: serverTimestamp() };
  await setDoc(ref, data);
  return data;
}
async function login(e) {
  e?.preventDefault();
  const f = $("memberForm"), d = Object.fromEntries(new FormData(f));
  if (!d.phone || !d.password) return toast("Informe seu WhatsApp e sua senha.");
  const btns = f.querySelectorAll("button"); btns.forEach(b => b.disabled = true);
  try {
    const canon = canonicalPhone(d.phone), raw = digits(d.phone);
    let cred;
    try { cred = await signInWithEmailAndPassword(auth, loginEmail(canon), d.password); }
    catch (err) {
      if (raw !== canon && (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found")) cred = await signInWithEmailAndPassword(auth, loginEmail(raw), d.password);
      else throw err;
    }
    f.reset(); modal("memberModal", false);
  } catch (err) {
    console.error(err);
    toast(["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(err.code) ? "WhatsApp ou senha incorretos. Se ainda não tem acesso, toque em “Criar acesso”." : err.code === "auth/too-many-requests" ? "Muitas tentativas. Aguarde alguns minutos e tente de novo." : err.message);
  } finally { btns.forEach(b => b.disabled = false); }
}
async function signup() {
  const f = $("memberForm"), d = Object.fromEntries(new FormData(f));
  if (!d.name?.trim()) { f.elements.name.focus(); return toast("Informe seu nome para criar o acesso."); }
  if (!d.password || d.password.length < 6) return toast("A senha precisa ter pelo menos 6 caracteres.");
  const btns = f.querySelectorAll("button"); btns.forEach(b => b.disabled = true);
  state.signingUp = true;
  try {
    const canon = canonicalPhone(d.phone);
    const cred = await createUserWithEmailAndPassword(auth, loginEmail(canon), d.password);
    await setDoc(doc(db, "members", cred.user.uid), { name: d.name.trim(), phone: d.phone.trim(), active: true, createdAt: serverTimestamp() });
    state.signingUp = false;
    f.reset(); modal("memberModal", false);
    await onUser(cred.user);
    toast(`Bem-vindo(a), ${d.name.trim().split(" ")[0]}! Seu acesso está pronto. Agora você já pode cadastrar seus pets. 🐾`, 6000);
  } catch (err) {
    console.error(err);
    toast(err.code === "auth/email-already-in-use" ? "Já existe um acesso com este WhatsApp. Use “Entrar” com sua senha." : err.code === "auth/weak-password" ? "Senha fraca: use pelo menos 6 caracteres." : err.code === "permission-denied" ? "Não foi possível concluir o cadastro (regras do Firestore desatualizadas)." : err.message);
  } finally { state.signingUp = false; btns.forEach(b => b.disabled = false); }
}
async function onUser(user) {
  state.user = null; state.member = null;
  if (user) {
    if (user.uid === ADMIN_UID) { state.user = user; state.member = { name: "Administração", active: true }; }
    else {
      try {
        const me = await ensureMemberDoc(user);
        if (me.active !== true) {
          await signOut(auth);
          toast(me.status === "blocked" ? "Seu acesso está bloqueado. Fale com a administração." : "Seu acesso está desativado. Fale com a administração para reativá-lo.", 6000);
          return; // onAuthStateChanged(null) recarrega a página
        }
        state.user = user; state.member = me;
      } catch (err) { console.error(err); toast("Não foi possível verificar seu cadastro."); }
    }
  }
  await load();
}

// ---------- eventos ----------
$("petPhoto").addEventListener("change", e => photoChange(e.target, "photoPreview"));
$("foundPhoto").addEventListener("change", e => photoChange(e.target, "foundPreview"));
["openForm", "openFormSection", "emptyAdd", "joinBtn", "myPetsAdd"].forEach(id => $(id)?.addEventListener("click", openPetForm));
["openLostForm", "quickLost"].forEach(id => $(id)?.addEventListener("click", () => openLost()));
$("quickSighting").addEventListener("click", () => openSighting());
$("quickFound").addEventListener("click", () => $("encontrados").scrollIntoView({ behavior: "smooth" }));
["openFoundForm", "joinFoundBtn", "sightingToFound"].forEach(id => $(id)?.addEventListener("click", () => { modal("sightingModal", false); modal("foundModal", true); }));
$("closeForm").onclick = () => { modal("formModal", false); resetPetForm(); };
$("closeFoundForm").onclick = closeFound;
$("closeClaimForm").onclick = () => { modal("claimModal", false); $("claimForm").reset(); };
$("closeLostForm").onclick = () => { modal("lostModal", false); $("lostForm").reset(); };
$("closeSighting").onclick = () => { modal("sightingModal", false); $("sightingForm").reset(); };
$("closePetDetails").onclick = closePetDetails;
$("closeMember").onclick = () => modal("memberModal", false);
const closers = { formModal: "closeForm", foundModal: "closeFoundForm", claimModal: "closeClaimForm", lostModal: "closeLostForm", sightingModal: "closeSighting", petDetailsModal: "closePetDetails", memberModal: "closeMember" };
for (const [m, c] of Object.entries(closers)) $(m).addEventListener("click", e => { if (e.target.id === m) $(c).click(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") for (const [m, c] of Object.entries(closers)) if (!$(m).hidden) $(c).click(); });
$("searchInput").addEventListener("input", renderPets);
$("typeFilter").addEventListener("change", renderPets);
$("petForm").addEventListener("submit", savePet);
$("foundForm").addEventListener("submit", saveFound);
$("claimForm").addEventListener("submit", saveClaim);
$("lostForm").addEventListener("submit", saveLost);
$("sightingForm").addEventListener("submit", saveSighting);
$("memberForm").addEventListener("submit", login);
$("signupBtn").addEventListener("click", signup);
$("memberBtn").onclick = () => modal("memberModal", true);
$("logoutBtn").onclick = async () => { await signOut(auth); modal("memberModal", false); toast("Você saiu da sua conta."); };
$("goMyPets").onclick = () => { modal("memberModal", false); $("meus-pets").scrollIntoView({ behavior: "smooth" }); };
$("goAdmin").onclick = () => { location.href = "/admin.html"; };
$("foundGrid").addEventListener("click", e => { const b = e.target.closest(".claim-btn"); if (!b) return; $("claimForm").elements.foundPetId.value = b.dataset.id; if (state.member?.name) { $("claimForm").elements.owner.value = state.member.name; $("claimForm").elements.phone.value = state.member.phone || ""; } modal("claimModal", true); });
$("lostShareCopy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("lostShareText").textContent); toast("Mensagem copiada!"); } catch { toast("Não foi possível copiar. Selecione o texto manualmente."); } });

// Ações delegadas (cards, detalhes, alertas)
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-pet-details],[data-pet-edit],[data-lost-for],[data-resolve-lost],[data-sighting-for],[data-copy-link],[data-open-member]");
  if (!t) return;
  if (t.dataset.petDetails) return openPetDetails(t.dataset.petDetails);
  if (t.dataset.petEdit) return beginEditPet(t.dataset.petEdit);
  if (t.dataset.lostFor) return openLost(t.dataset.lostFor);
  if (t.dataset.resolveLost) return resolveLost(t.dataset.resolveLost);
  if (t.dataset.sightingFor) return openSighting(t.dataset.sightingFor);
  if (t.dataset.copyLink) { try { await navigator.clipboard.writeText(petUrl(t.dataset.copyLink)); toast("Link copiado!"); } catch { toast(petUrl(t.dataset.copyLink)); } return; }
  if ("openMember" in t.dataset) { closePetDetails(); modal("memberModal", true); }
});

// PWA
$("installBtn").addEventListener("click", async () => { if (!state.deferredPrompt) return; state.deferredPrompt.prompt(); await state.deferredPrompt.userChoice; state.deferredPrompt = null; $("installBtn").hidden = true; });
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); state.deferredPrompt = e; $("installBtn").hidden = false; });
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

onAuthStateChanged(auth, user => { if (state.signingUp) return; onUser(user); });
