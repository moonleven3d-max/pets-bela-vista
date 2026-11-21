import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp, updateDoc, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, ADMIN_UID } from "./firebase-config.js";

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);
const $ = id => document.getElementById(id);
let current = null;
const L = { members: [], pets: [], contacts: [], priv: [], lost: [], found: [], foundSubs: [], claims: [], petSubs: [], lostSubs: [], sightings: [] };
const COLS = { members: "members", pets: "pets_public", contacts: "pet_alert_contacts", priv: "pet_private", lost: "lost_public", found: "found_public", foundSubs: "found_submissions", claims: "claim_submissions", petSubs: "pet_submissions", lostSubs: "lost_submissions", sightings: "sightings" };
const PRIVATE_KEYS = ["street", "number", "referenceUnit", "houseColor", "nearbyReference"];
const PUBLIC_KEYS = ["name", "type", "breed", "size", "traits", "description", "photo", "ownerUid", "createdAt", "updatedAt"];

function esc(v = "") { return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function toast(m) { $("toast").textContent = m; $("toast").classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => $("toast").classList.remove("show"), 5000); }
const isAdmin = () => current?.uid === ADMIN_UID;
const byDate = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
const fmtTs = t => t?.toDate?.().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) || "—";
const fmtDT = v => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };
const member = uid => L.members.find(m => m.id === uid);
const memberName = uid => uid ? (member(uid)?.name || (uid === ADMIN_UID ? "Administração" : "conta sem cadastro")) : "não vinculado";
const memberStatus = m => m.active === true ? ["Ativo", "ok"] : m.status === "blocked" ? ["Bloqueado", "bad"] : ["Inativo", ""];
const contactOf = id => L.contacts.find(c => (c.petId || c.id) === id);
const privOf = id => L.priv.find(p => p.id === id);
const thumb = photo => photo ? `<img src="${esc(photo)}" alt="">` : `<div class="pending-placeholder">🐾</div>`;
function row(photo, title, detail, actions = "", attrs = "") { return `<div class="pending-item" ${attrs}>${thumb(photo)}<div class="pending-details"><b>${title}</b><small>${detail}</small></div><div class="pending-actions">${actions}</div></div>`; }
const btn = (cls, label, data) => `<button class="small-btn ${cls}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ")}>${label}</button>`;

// ---------- carregamento ----------
async function load() {
  if (!isAdmin()) return;
  try {
    const keys = Object.keys(COLS);
    const snaps = await Promise.all(keys.map(k => getDocs(collection(db, COLS[k])).catch(e => { console.error(COLS[k], e); return null; })));
    const failed = [];
    keys.forEach((k, i) => { if (!snaps[i]) failed.push(COLS[k]); L[k] = snaps[i] ? snaps[i].docs.map(d => ({ id: d.id, ...d.data() })).sort(byDate) : []; });
    render();
    if (failed.length) toast(`Sem permissão para ler: ${failed.join(", ")}. Publique as regras novas do Firestore.`);
  } catch (e) { console.error(e); toast(`Falha ao carregar (${e.code || "erro"}): ${e.message}`); }
}

// ---------- renderização ----------
function render() {
  const pendingFound = L.foundSubs.filter(s => (s.status || "pending") === "pending");
  const pendingClaims = L.claims.filter(s => (s.status || "pending") === "pending");
  const activeLost = L.lost.filter(a => a.status === "active");
  $("adminStats").innerHTML = [
    [L.pets.length, "pets cadastrados"], [L.members.length, "moradores"], [L.found.filter(f => f.status === "active").length, "animais encontrados"],
    [activeLost.length, "alertas ativos"], [pendingClaims.length, "reivindicações pendentes"], [L.sightings.length, "avistamentos"]
  ].map(([n, t]) => `<div><strong>${n}</strong><span>${t}</span></div>`).join("");

  // Pendências
  const published = new Set(L.pets.map(p => p.id));
  const pend = [
    ...pendingFound.map(s => row(s.photo, `Animal encontrado · ${esc(s.type || "")}`, `${esc(s.appearance || "")} ${esc(s.traits || "")}<br>📍 ${esc(s.location || "")} · ${esc(s.seenDate || "")}<br>Enviado por ${esc(s.reporter || "")} · ${esc(s.phone || "")}`, btn("approve", "Publicar", { act: "approve-found", id: s.id }) + btn("reject", "Excluir", { act: "del", col: "foundSubs", id: s.id }))),
    ...pendingClaims.map(s => { const f = L.found.find(x => x.id === s.foundPetId); return row(f?.photo, `Reivindicação · ${esc(s.owner || "")}`, `WhatsApp: ${esc(s.phone || "")}<br>Animal: ${esc(f ? `${f.type} visto em ${f.location}` : s.foundPetId || "não encontrado")}<br>Comprovação: ${esc(s.proof || "")}`, btn("approve", "Confirmar devolução", { act: "approve-claim", id: s.id }) + btn("reject", "Recusar", { act: "reject-claim", id: s.id })); }),
    ...L.petSubs.map(s => row(s.photo, `Cadastro antigo · ${esc(s.name || "Pet")}${published.has(s.id) ? '<span class="tag ok">já publicado</span>' : '<span class="tag">pendente</span>'}`, `${esc(s.owner || "")} · ${esc(s.phone || "")} · morador: ${esc(memberName(s.ownerUid))}<br>${esc([s.street, s.number, s.referenceUnit, s.houseColor, s.nearbyReference].filter(Boolean).join(" · "))}`, (published.has(s.id) ? "" : btn("approve", "Publicar pet", { act: "approve-petsub", id: s.id })) + btn("reject", published.has(s.id) ? "Remover duplicata" : "Excluir", { act: "del", col: "petSubs", id: s.id }))),
    ...L.lostSubs.filter(s => (s.status || "pending") === "pending").map(s => row(s.photo, `Alerta antigo · ${esc(s.name || "")}`, `Último local: ${esc(s.location || "")} · ${esc(fmtDT(s.seenAt))}`, btn("approve", "Publicar alerta", { act: "approve-lostsub", id: s.id }) + btn("reject", "Excluir", { act: "del", col: "lostSubs", id: s.id })))
  ];
  $("pendingCount").textContent = pend.length;
  $("pendingList").innerHTML = pend.join("") || '<p class="admin-note">Nenhuma solicitação pendente.</p>';

  renderPets(); renderMembers();

  $("adminLostCount").textContent = activeLost.length;
  $("adminLostList").innerHTML = L.lost.map(a => row(a.photo, `${esc(a.name)} <span class="tag ${a.status === "active" ? "bad" : "ok"}">${a.status === "active" ? "ativo" : "encerrado"}</span>`, `📍 ${esc(a.location || "")} · ${esc(fmtDT(a.seenAt))}<br>${esc(a.notes || "")}<br>Tutor: ${esc(memberName(a.ownerUid))}`, (a.status === "active" ? btn("approve", "Encerrar (encontrado)", { act: "close-lost", id: a.id }) : btn("approve", "Reabrir", { act: "reopen-lost", id: a.id })) + btn("reject", "Excluir", { act: "del", col: "lost", id: a.id }))).join("") || '<p class="admin-note">Nenhum alerta.</p>';

  $("adminFoundCount").textContent = L.found.length;
  $("adminFoundList").innerHTML = L.found.map(f => { const sub = L.foundSubs.find(s => s.id === f.id); return row(f.photo, `${esc(f.type)} <span class="tag ${f.status === "active" ? "" : "ok"}">${f.status === "active" ? "publicado" : "resolvido"}</span>`, `📍 ${esc(f.location || "")} · ${esc(f.seenDate || "")}<br>${esc([f.appearance, f.traits].filter(Boolean).join(" · "))}${sub ? `<br>Quem registrou: ${esc(sub.reporter || "")} · ${esc(sub.phone || "")}` : ""}`, (f.status === "active" ? btn("approve", "Marcar como resolvido", { act: "resolve-found", id: f.id }) : "") + btn("reject", "Excluir", { act: "del", col: "found", id: f.id })); }).join("") || '<p class="admin-note">Nenhum animal encontrado.</p>';

  $("adminSightCount").textContent = L.sightings.length;
  $("adminSightList").innerHTML = L.sightings.map(s => row("", `${esc(s.petName || "Pet")} visto na rua`, `📍 ${esc(s.location || "")} · ${esc(fmtDT(s.seenAt))}${s.notes ? ` · ${esc(s.notes)}` : ""}<br>Avisado por ${esc(s.reporterName || memberName(s.reporterUid))} · tutor: ${esc(memberName(s.petOwnerUid))}`, btn("reject", "Excluir", { act: "del", col: "sightings", id: s.id }))).join("") || '<p class="admin-note">Nenhum avistamento.</p>';
}
function dupKey(p) { return `${(p.name || "").trim().toLocaleLowerCase("pt-BR")}|${p.type || ""}`; }
function renderPets() {
  const q = $("petsFilter").value.trim().toLocaleLowerCase("pt-BR");
  const counts = {}; L.pets.forEach(p => counts[dupKey(p)] = (counts[dupKey(p)] || 0) + 1);
  const legacyPrivate = L.contacts.filter(c => PRIVATE_KEYS.some(k => k in c) || "ownerPhone" in c).length + L.pets.filter(p => Object.keys(p).some(k => !PUBLIC_KEYS.includes(k) && k !== "id")).length;
  $("migrateBtn").hidden = legacyPrivate === 0;
  $("migrateBtn").textContent = `Separar dados privados antigos (${legacyPrivate})`;
  const v = L.pets.filter(p => [p.name, p.type, p.breed, memberName(p.ownerUid)].join(" ").toLocaleLowerCase("pt-BR").includes(q));
  $("adminPetsCount").textContent = L.pets.length;
  $("adminPetsList").innerHTML = v.map(p => {
    const c = contactOf(p.id), pr = privOf(p.id), linked = p.ownerUid && member(p.ownerUid);
    return row(p.photo, `${esc(p.name)}${!linked ? '<span class="tag bad">sem morador vinculado</span>' : ""}${counts[dupKey(p)] > 1 ? '<span class="tag">possível duplicado</span>' : ""}${L.lost.some(a => (a.petId || a.id) === p.id && a.status === "active") ? '<span class="tag bad">desaparecido</span>' : ""}`,
      `${esc([p.type, p.breed, p.size].filter(Boolean).join(" · "))}<br>Morador: ${esc(memberName(p.ownerUid))}${c?.guardians?.length ? ` · contatos: ${esc(c.guardians.map(g => `${g.name} ${g.phone}`).join(", "))}${c.allowAlerts ? " (visíveis a moradores)" : " (privados)"}` : ""}<br>${pr ? `🏠 ${esc([pr.street, pr.number, pr.referenceUnit, pr.houseColor, pr.nearbyReference].filter(Boolean).join(" · "))}` : "Sem endereço cadastrado"}`,
      btn("approve", "Abrir / editar", { act: "edit-pet", id: p.id }) + btn("reject", "Excluir", { act: "delete-pet", id: p.id }));
  }).join("") || '<p class="admin-note">Nenhum pet encontrado.</p>';
}
function renderMembers() {
  const q = $("membersFilter").value.trim().toLocaleLowerCase("pt-BR");
  const v = L.members.filter(m => [m.name, m.phone].join(" ").toLocaleLowerCase("pt-BR").includes(q));
  $("membersCount").textContent = L.members.length;
  $("membersList").innerHTML = v.map(m => {
    const [st, cls] = memberStatus(m), n = L.pets.filter(p => p.ownerUid === m.id).length;
    return `<div class="pending-item member-row" data-member-open="${esc(m.id)}" role="button" tabindex="0"><span class="pending-placeholder">♙</span><span class="pending-details"><b>${esc(m.name || "Morador")} <span class="tag ${cls}">${st}</span></b><small>WhatsApp: ${esc(m.phone || "não informado")} · ${n} pet(s)<br>Cadastro: ${fmtTs(m.createdAt)}<span class="member-row-hint"> · Ver ficha →</span></small></span><span class="pending-actions">${m.active === true ? btn("reject", "Bloquear", { act: "block", id: m.id }) : btn("approve", "Reativar", { act: "activate", id: m.id })}</span></div>`;
  }).join("") || '<p class="admin-note">Nenhum morador encontrado.</p>';
}

// ---------- ficha do morador ----------
function openMemberDetails(id) {
  const m = member(id); if (!m) return;
  const linked = L.pets.filter(p => p.ownerUid === id), [st] = memberStatus(m);
  $("memberDetailsTitle").textContent = m.name || "Morador";
  $("memberDetailsSubtitle").textContent = `WhatsApp: ${m.phone || "não informado"} · ${st}`;
  $("memberDetailsBody").innerHTML = `<div class="resident-info-grid">
    <div><small>Nome</small><b>${esc(m.name || "—")}</b></div><div><small>WhatsApp</small><b>${esc(m.phone || "—")}</b></div>
    <div><small>Data de cadastro</small><b>${fmtTs(m.createdAt)}</b></div><div><small>Status da conta</small><b>${st}</b></div>
    <div class="resident-uid"><small>UID (identificador da conta)</small><code>${esc(m.id)}</code></div></div>
    <section class="resident-pets"><h3>Pets vinculados (${linked.length})</h3>${linked.length ? linked.map(p => `<div class="resident-pet">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : "🐾"}<span><b>${esc(p.name)}</b><small>${esc([p.type, p.breed].filter(Boolean).join(" · "))}</small></span>${btn("approve", "Abrir", { act: "edit-pet", id: p.id })}</div>`).join("") : '<p class="admin-note">Nenhum pet vinculado. Para vincular um pet antigo (ex.: a Lua), abra o pet na lista e escolha este morador em “Responsável”.</p>'}</section>
    <div class="resident-actions">${m.active === true ? btn("reject", "Bloquear acesso", { act: "block", id: m.id }) : btn("approve", "Reativar acesso", { act: "activate", id: m.id })}<button class="small-btn resident-reset-btn" id="memberResetInfo">Redefinir senha</button></div>
    <p class="resident-security-note" id="residentResetNote" hidden>A troca da senha de outra pessoa não pode ser feita com segurança pelo navegador. Opções: (1) no Firebase Console &gt; Authentication, excluir a conta <code>${esc((m.phone || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, ""))}@login.petsbelavista.invalid</code> e pedir para o morador criar o acesso de novo (depois, vincule os pets à nova conta); ou (2) ativar uma função de servidor com o Firebase Admin SDK. Nunca peça a senha atual do morador.</p>`;
  $("memberDetailsModal").hidden = false;
}

// ---------- edição do pet ----------
function openPetEdit(id) {
  const p = L.pets.find(x => x.id === id); if (!p) return;
  const c = contactOf(id) || {}, pr = privOf(id) || {}, f = $("petEditForm");
  f.dataset.id = id;
  $("petEditTitle").textContent = p.name;
  for (const k of ["name", "type", "breed", "size", "traits", "description"]) f.elements[k].value = p[k] || "";
  const opts = [...L.members].sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
  $("petEditOwner").innerHTML = `<option value="">— não vinculado —</option>` + opts.map(m => `<option value="${esc(m.id)}">${esc(m.name || "Morador")} · ${esc(m.phone || "")}</option>`).join("") + (p.ownerUid && !member(p.ownerUid) ? `<option value="${esc(p.ownerUid)}">Conta sem cadastro (${esc(p.ownerUid)})</option>` : "");
  f.elements.ownerUid.value = p.ownerUid || "";
  const gs = c.guardians || [];
  [0, 1, 2].forEach(i => { f.elements[`g${i}n`].value = gs[i]?.name || ""; f.elements[`g${i}p`].value = gs[i]?.phone || ""; });
  f.elements.allowAlerts.checked = c.allowAlerts === true;
  for (const k of PRIVATE_KEYS) f.elements[k].value = pr[k] ?? c[k] ?? "";
  $("petViewLink").href = `/pet/${encodeURIComponent(id)}`;
  $("memberDetailsModal").hidden = true;
  $("petEditModal").hidden = false;
}
async function savePetEdit(e) {
  e.preventDefault();
  const f = e.currentTarget, id = f.dataset.id, p = L.pets.find(x => x.id === id); if (!p) return;
  const d = Object.fromEntries(new FormData(f)), owner = d.ownerUid || "";
  const guardians = [0, 1, 2].map(i => ({ name: d[`g${i}n`].trim(), phone: d[`g${i}p`].trim() })).filter(g => g.name || g.phone);
  try {
    const b = writeBatch(db);
    b.set(doc(db, "pets_public", id), { name: d.name.trim(), type: d.type, breed: d.breed.trim(), size: d.size, traits: d.traits.trim(), description: d.description.trim(), photo: p.photo || "", ownerUid: owner, createdAt: p.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
    b.set(doc(db, "pet_alert_contacts", id), { petId: id, petName: d.name.trim(), guardians, allowAlerts: d.allowAlerts === "yes", ownerUid: owner });
    b.set(doc(db, "pet_private", id), { petId: id, ownerUid: owner, ...Object.fromEntries(PRIVATE_KEYS.map(k => [k, (d[k] || "").trim()])) });
    for (const a of L.lost.filter(a => (a.petId || a.id) === id)) b.update(doc(db, "lost_public", a.id), { ownerUid: owner, name: d.name.trim() });
    await b.commit();
    $("petEditModal").hidden = true;
    toast(owner !== (p.ownerUid || "") ? `Pet salvo e vinculado a ${memberName(owner)}.` : "Pet atualizado.");
    await load();
  } catch (err) { console.error(err); toast(`Falha ao salvar (${err.code || "erro"}).`); }
}
async function deletePet(id) {
  const p = L.pets.find(x => x.id === id); if (!p) return;
  if (!confirm(`Excluir definitivamente o cadastro de ${p.name}? Isso remove perfil, contatos, endereço e alertas.`)) return;
  try {
    const b = writeBatch(db);
    ["pets_public", "pet_alert_contacts", "pet_private"].forEach(c => b.delete(doc(db, c, id)));
    L.lost.filter(a => (a.petId || a.id) === id).forEach(a => b.delete(doc(db, "lost_public", a.id)));
    await b.commit();
    $("petEditModal").hidden = true;
    toast("Pet excluído."); await load();
  } catch (err) { console.error(err); toast(`Falha ao excluir (${err.code || "erro"}).`); }
}

// ---------- migração de dados antigos ----------
async function migratePrivate() {
  if (!confirm("Mover endereços e telefones antigos para a área privada e limpar os documentos públicos?")) return;
  try {
    let n = 0;
    const privMap = new Map(L.priv.map(p => [p.id, { ...p }]));
    const mergePriv = (id, ownerUid, src) => {
      const cur = privMap.get(id) || {};
      const next = { petId: id, ownerUid: cur.ownerUid || ownerUid || "", ...Object.fromEntries(PRIVATE_KEYS.map(k => [k, cur[k] || src[k] || ""])) };
      privMap.set(id, next);
      return next;
    };
    for (const c of L.contacts) {
      if (!(PRIVATE_KEYS.some(k => k in c) || "ownerPhone" in c)) continue;
      const id = c.petId || c.id, b = writeBatch(db);
      b.set(doc(db, "pet_private", id), mergePriv(id, c.ownerUid, c));
      b.update(doc(db, "pet_alert_contacts", c.id), { ...Object.fromEntries(PRIVATE_KEYS.map(k => [k, deleteField()])), ownerPhone: deleteField() });
      await b.commit(); n++;
    }
    for (const p of L.pets) {
      const extra = Object.keys(p).filter(k => !PUBLIC_KEYS.includes(k) && k !== "id");
      if (!extra.length) continue;
      const b = writeBatch(db);
      b.set(doc(db, "pets_public", p.id), Object.fromEntries(PUBLIC_KEYS.filter(k => k in p).map(k => [k, p[k]])));
      if (PRIVATE_KEYS.some(k => p[k])) b.set(doc(db, "pet_private", p.id), mergePriv(p.id, p.ownerUid, p));
      await b.commit(); n++;
    }
    toast(`${n} cadastro(s) corrigido(s). Dados privados separados.`); await load();
  } catch (err) { console.error(err); toast(`Falha na migração (${err.code || "erro"}).`); }
}

// ---------- ações ----------
async function act(t) {
  const { act: a, id, col } = t.dataset;
  try {
    if (a === "edit-pet") return openPetEdit(id);
    if (a === "delete-pet") return deletePet(id);
    if (a === "block" || a === "activate") {
      await updateDoc(doc(db, "members", id), a === "block" ? { active: false, status: "blocked" } : { active: true, status: "active" });
      toast(a === "block" ? "Acesso bloqueado." : "Acesso reativado.");
      $("memberDetailsModal").hidden = true;
    } else if (a === "del") {
      if (!confirm("Excluir este registro?")) return;
      await deleteDoc(doc(db, COLS[col], id)); toast("Registro excluído.");
    } else if (a === "approve-found") {
      const s = L.foundSubs.find(x => x.id === id);
      await setDoc(doc(db, "found_public", id), { type: s.type || "", appearance: s.appearance || "", traits: s.traits || "", location: s.location || "", seenDate: s.seenDate || "", photo: s.photo || "", status: "active", createdAt: s.createdAt || serverTimestamp() });
      await updateDoc(doc(db, "found_submissions", id), { status: "approved", reviewedAt: serverTimestamp() });
      toast("Animal encontrado publicado.");
    } else if (a === "approve-claim" || a === "reject-claim") {
      const s = L.claims.find(x => x.id === id);
      await updateDoc(doc(db, "claim_submissions", id), { status: a === "approve-claim" ? "approved" : "rejected", reviewedAt: serverTimestamp() });
      if (a === "approve-claim" && L.found.some(f => f.id === s.foundPetId)) await updateDoc(doc(db, "found_public", s.foundPetId), { status: "resolved", resolvedAt: serverTimestamp() });
      toast(a === "approve-claim" ? "Reivindicação confirmada; o animal saiu da lista de encontrados." : "Reivindicação recusada.");
    } else if (a === "approve-petsub") {
      const s = L.petSubs.find(x => x.id === id);
      const guardians = [[s.owner, s.phone], [s.owner2, s.phone2], [s.owner3, s.phone3]].map(([n, p]) => ({ name: n || "", phone: p || "" })).filter(g => g.name || g.phone);
      const owner = s.ownerUid || "";
      const b = writeBatch(db);
      b.set(doc(db, "pets_public", id), { name: s.name || "Pet", type: ["Cachorro", "Gato", "Outro"].includes(s.type) ? s.type : "Outro", breed: s.breed || "", size: s.size || "", traits: s.traits || "", description: s.description || "", photo: s.photo || "", ownerUid: owner, createdAt: s.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
      b.set(doc(db, "pet_alert_contacts", id), { petId: id, petName: s.name || "Pet", guardians, allowAlerts: s.allowAlerts === true, ownerUid: owner });
      b.set(doc(db, "pet_private", id), { petId: id, ownerUid: owner, ...Object.fromEntries(PRIVATE_KEYS.map(k => [k, s[k] || ""])) });
      b.delete(doc(db, "pet_submissions", id));
      await b.commit();
      toast(owner ? "Pet publicado." : "Pet publicado. Ele está sem morador vinculado: abra o pet para vincular.");
    } else if (a === "approve-lostsub") {
      const s = L.lostSubs.find(x => x.id === id), petId = s.petId || id;
      await setDoc(doc(db, "lost_public", petId), { petId, name: s.name || "", photo: s.photo || "", location: s.location || "", seenAt: s.seenAt || "", notes: s.notes || "", ownerUid: s.ownerUid || "", status: "active", createdAt: s.createdAt || serverTimestamp() });
      await deleteDoc(doc(db, "lost_submissions", id));
      toast("Alerta publicado.");
    } else if (a === "close-lost" || a === "reopen-lost") {
      await updateDoc(doc(db, "lost_public", id), a === "close-lost" ? { status: "resolved", resolvedAt: serverTimestamp() } : { status: "active" });
      toast(a === "close-lost" ? "Alerta encerrado." : "Alerta reaberto.");
    } else if (a === "resolve-found") {
      await updateDoc(doc(db, "found_public", id), { status: "resolved", resolvedAt: serverTimestamp() });
      toast("Marcado como resolvido.");
    } else return;
    await load();
    if (!$("memberDetailsModal").hidden) $("memberDetailsModal").hidden = true;
  } catch (err) { console.error(err); toast(`Não foi possível concluir (${err.code || "erro"}): ${err.message || ""}`); }
}

// ---------- eventos ----------
$("loginBtn").onclick = async () => {
  try {
    const c = await signInWithEmailAndPassword(auth, $("adminEmail").value.trim(), $("adminPassword").value);
    if (c.user.uid !== ADMIN_UID) { await signOut(auth); toast("A conta entrou, mas o UID não está autorizado como administrador."); }
  } catch (e) { console.error(e); toast(`Falha no login (${e.code || "erro"}): confira e-mail e senha.`); }
};
$("adminPassword").addEventListener("keydown", e => { if (e.key === "Enter") $("loginBtn").click(); });
$("logoutBtn").onclick = () => signOut(auth);
$("reloadBtn").onclick = load;
$("migrateBtn").onclick = migratePrivate;
$("petsFilter").addEventListener("input", renderPets);
$("membersFilter").addEventListener("input", renderMembers);
$("petEditForm").addEventListener("submit", savePetEdit);
$("petDeleteBtn").onclick = () => deletePet($("petEditForm").dataset.id);
$("closePetEdit").onclick = () => { $("petEditModal").hidden = true; };
$("closeMemberDetails").onclick = () => { $("memberDetailsModal").hidden = true; };
for (const m of ["petEditModal", "memberDetailsModal"]) $(m).addEventListener("click", e => { if (e.target.id === m) $(m).hidden = true; });
document.addEventListener("keydown", e => { if (e.key === "Escape") { $("petEditModal").hidden = true; $("memberDetailsModal").hidden = true; } });
document.addEventListener("click", e => {
  if (!isAdmin()) return;
  const a = e.target.closest("[data-act]");
  if (a) { e.stopPropagation(); return act(a); }
  if (e.target.closest("#memberResetInfo")) { $("residentResetNote").hidden = false; return; }
  const r = e.target.closest("[data-member-open]");
  if (r) openMemberDetails(r.dataset.memberOpen);
});
$("membersList").addEventListener("keydown", e => { const r = e.target.closest("[data-member-open]"); if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openMemberDetails(r.dataset.memberOpen); } });
$("exportBtn").onclick = () => { const blob = new Blob([JSON.stringify(L, null, 2)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `pets-bela-vista-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href); };
onAuthStateChanged(auth, async u => {
  current = u;
  const ok = !!u && u.uid === ADMIN_UID;
  $("adminLogin").hidden = ok; $("adminContent").hidden = !ok;
  if (ok) await load();
});
