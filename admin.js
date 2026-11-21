import {initializeApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {getFirestore,collection,getDocs,query,where,doc,setDoc,deleteDoc,serverTimestamp,updateDoc} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {firebaseConfig,ADMIN_UID} from "./firebase-config.js";
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);let current=null,lists={pets:[],found:[],claims:[],lost:[],publicPets:[],publicFound:[],publicLost:[]};const $=id=>document.getElementById(id);
function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function toast(m){$("toast").textContent=m;$("toast").classList.add("show");setTimeout(()=>$ ("toast").classList.remove("show"),5000)}
function card(p,title,detail,photo=""){return `<div class="pending-item">${photo?`<img src="${photo}" alt="">`:`<div class="pending-placeholder">🐾</div>`}<div class="pending-details"><b>${esc(title)}</b><small>${detail}</small></div></div>`}
async function loadMembers(){
 const snap=await getDocs(collection(db,"members"));
 const ms=snap.docs.map(d=>({id:d.id,...d.data()}));window.__adminMembers=ms;
 $("membersCount").textContent=ms.length;$("pendingCount").textContent=lists.pets.length+lists.found.length+lists.claims.length+lists.lost.length+ms.filter(m=>m.active!==true&&m.status!=="rejected"&&m.status!=="blocked").length;
 $("membersList").innerHTML=ms.map(m=>`<div class="pending-item member-row" data-member-open="${esc(m.id)}" role="button" tabindex="0" aria-label="Ver cadastro de ${esc(m.name||"morador")}">
   <span class="pending-placeholder">♙</span>
   <span class="pending-details"><b>${esc(m.name||"Morador")}</b><small>WhatsApp: ${esc(m.phone||"não informado")}<br>Cadastro: ${m.createdAt?.toDate?.().toLocaleDateString("pt-BR")||"—"}<br>Status: ${m.active===true?"Aprovado":m.status==="blocked"?"Bloqueado":m.status==="rejected"?"Recusado":"Aguardando aprovação"}<span class="member-row-hint">Ver cadastro e pets associados →</span></small></span>
   <span class="pending-actions">${m.active===true?`<button class="small-btn reject" data-member-action="block" data-member-id="${esc(m.id)}">Bloquear</button>`:`<button class="small-btn approve" data-member-action="approve" data-member-id="${esc(m.id)}">Aprovar</button><button class="small-btn reject" data-member-action="reject" data-member-id="${esc(m.id)}">Recusar</button>`}</span>
 </div>`).join("")||'<p class="admin-note">Nenhum morador cadastrado.</p>';
}
function openMemberDetails(memberId){
 const m=window.__adminMembers?.find(x=>x.id===memberId);
 if(!m)return;
 const linked=lists.publicPets.filter(p=>p.ownerUid===memberId);
 $("memberDetailsTitle").textContent=m.name||"Morador";
 $("memberDetailsSubtitle").textContent=`WhatsApp: ${m.phone||"não informado"} · ${m.active===true?"Acesso aprovado":m.status==="blocked"?"Acesso bloqueado":m.status==="rejected"?"Cadastro recusado":"Aguardando aprovação"}`;
 $("memberDetailsBody").innerHTML=`
  <div class="resident-info-grid">
   <div><small>Nome</small><b>${esc(m.name||"—")}</b></div>
   <div><small>WhatsApp</small><b>${esc(m.phone||"—")}</b></div>
   <div><small>Data de cadastro</small><b>${m.createdAt?.toDate?.().toLocaleString("pt-BR")||"—"}</b></div>
   <div><small>Status</small><b>${m.active===true?"Aprovado":m.status==="blocked"?"Bloqueado":m.status==="rejected"?"Recusado":"Pendente de aprovação"}</b></div>
   <div class="resident-uid"><small>Identificador da conta</small><code>${esc(m.id)}</code></div>
  </div>
  <section class="resident-pets"><h3>Pets vinculados (${linked.length})</h3>
   ${linked.length?linked.map(p=>`<div class="resident-pet">${p.photo?`<img src="${p.photo}" alt="">`:"🐾"}<span><b>${esc(p.name||"Pet")}</b><small>${esc(p.type||"")} · ${esc(p.breed||"")}</small></span></div>`).join(""):'<p class="admin-note">Nenhum pet vinculado a este morador.</p>'}
  </section>
  <div class="resident-actions">
   <button class="small-btn ${m.active===false?"approve":"reject"}" id="memberDetailToggle" data-member-id="${esc(m.id)}">${m.active===true?"Bloquear acesso":"Aprovar / liberar acesso"}</button>
   <button class="small-btn resident-reset-btn" id="memberResetInfo">Redefinir senha</button>
  </div>
  <p class="resident-security-note" id="residentResetNote" hidden>Como o acesso é feito com WhatsApp e senha, sem e-mail ou SMS, a administração não consegue trocar a senha diretamente pelo navegador. Para habilitar uma redefinição segura, será necessária uma função privada no servidor (Firebase Admin SDK). Não peça nem compartilhe a senha atual do morador.</p>`;
 $("memberDetailsModal").hidden=false;
}
function pendingCard(p,kind){let detail=kind==="pets"?`${esc(p.owner||"")} · ${esc(p.phone||"")}<br>${esc(p.street||"")}, ${esc(p.number||"")} · ${esc(p.referenceUnit||"")} · ${esc(p.houseColor||"")} · ${esc(p.nearbyReference||"")}`:kind==="lost"?`Último local: ${esc(p.location||"")} · ${esc(p.seenAt||"")}`:kind==="found"?`${esc(p.location||"")} · ${esc(p.seenDate||"")}<br>${esc(p.reporter||"")} · ${esc(p.phone||"")}`:`Pet: ${esc(p.foundPetId||"")} · ${esc(p.owner||"")} · ${esc(p.phone||"")}`;return `<div class="pending-item">${p.photo?`<img src="${p.photo}" alt="">`:`<div class="pending-placeholder">🐾</div>`}<div class="pending-details"><b>${esc(p.name|| (kind==="found"?"Animal encontrado":"Solicitação"))}</b><small>${detail}</small></div><div class="pending-actions">${kind==="pets"?`<button class="small-btn approve" data-approve-pet="${p.id}">Aprovar pet</button>`:""}<button class="small-btn reject" data-delete-pending="${kind}" data-id="${p.id}">Excluir</button></div></div>`}
async function load(){if(!current||current.uid!==ADMIN_UID)return;try{
 const cols=["pet_submissions","found_submissions","claim_submissions","lost_submissions","pets_public","found_public","lost_public"];
 const snaps=await Promise.all(cols.map(c=>getDocs(collection(db,c))));
 ["pets","found","claims","lost","publicPets","publicFound","publicLost"].forEach((k,i)=>lists[k]=snaps[i].docs.map(d=>({id:d.id,...d.data()})));
 $("pendingCount").textContent=lists.pets.length+lists.found.length+lists.claims.length+lists.lost.length;
 $("pendingList").innerHTML=[...lists.pets.map(p=>pendingCard(p,"pets")),...lists.found.map(p=>pendingCard(p,"found")),...lists.claims.map(p=>pendingCard(p,"claims")),...lists.lost.map(p=>pendingCard(p,"lost"))].join("")||'<p class="admin-note">Nenhuma solicitação pendente.</p>';
 $("adminPetsCount").textContent=lists.publicPets.length;$("adminPetsList").innerHTML=lists.publicPets.map(p=>card(p,p.name,`${esc(p.type)} · Responsável UID: ${esc(p.ownerUid||"não vinculado")}`,p.photo)).join("")||'<p class="admin-note">Nenhum pet cadastrado.</p>';
 $("adminLostCount").textContent=lists.publicLost.filter(p=>p.status==="active").length;$("adminLostList").innerHTML=lists.publicLost.map(p=>card(p,p.name,`${esc(p.location)} · ${esc(p.seenAt)} · ${esc(p.status)}`,p.photo)).join("")||'<p class="admin-note">Nenhum alerta.</p>';
 $("adminFoundCount").textContent=lists.publicFound.length;$("adminFoundList").innerHTML=lists.publicFound.map(p=>card(p,p.type,`${esc(p.location)} · ${esc(p.seenDate)} · ${esc(p.status)}`,p.photo)).join("")||'<p class="admin-note">Nenhum animal encontrado.</p>';
 await loadMembers();
 }catch(e){console.error("Erro detalhado na administração:",e);toast(`Falha ao carregar (${e.code||"erro"}): ${e.message||"verifique as regras e o UID administrador"}`)}}
$("loginBtn").onclick=async()=>{try{const c=await signInWithEmailAndPassword(auth,$("adminEmail").value.trim(),$("adminPassword").value);if(c.user.uid!==ADMIN_UID){await signOut(auth);toast("A conta entrou, mas o UID não está autorizado como administrador.")}}catch(e){console.error(e);toast(`Falha no login (${e.code||"erro"}): ${e.message||"confira e-mail e senha"}`)}};
$("logoutBtn").onclick=()=>signOut(auth);
onAuthStateChanged(auth,async u=>{current=u;const ok=!!u&&u.uid===ADMIN_UID;$("adminLogin").hidden=ok;$("adminContent").hidden=!ok;if(ok){$("adminEmail").value=u.email||"";await load()}});
$("membersList").onclick=async e=>{const action=e.target.closest("[data-member-action]");if(action&&current?.uid===ADMIN_UID){const id=action.dataset.memberId,kind=action.dataset.memberAction;try{if(kind==="approve")await updateDoc(doc(db,"members",id),{active:true,status:"approved",approvedAt:serverTimestamp()});else if(kind==="reject")await updateDoc(doc(db,"members",id),{active:false,status:"rejected",reviewedAt:serverTimestamp()});else await updateDoc(doc(db,"members",id),{active:false,status:"blocked"});toast(kind==="approve"?"Morador aprovado e acesso liberado.":kind==="reject"?"Cadastro recusado.":"Acesso bloqueado.");await load()}catch(err){console.error(err);toast(`Não foi possível atualizar (${err.code||"erro"}).`)}return}const row=e.target.closest("[data-member-open]");if(row)openMemberDetails(row.dataset.memberOpen)};
$("closeMemberDetails").onclick=()=>{$("memberDetailsModal").hidden=true};
$("memberDetailsModal").onclick=e=>{if(e.target.id==="memberDetailsModal")$("memberDetailsModal").hidden=true};
$("memberDetailsBody").onclick=async e=>{
 const toggle=e.target.closest("#memberDetailToggle");
 if(toggle&&current?.uid===ADMIN_UID){
  try{const memberId=toggle.dataset.memberId;const m=window.__adminMembers.find(x=>x.id===memberId);await updateDoc(doc(db,"members",memberId),{active:m.active===false,status:m.active===false?"approved":"blocked"});toast(m.active===false?"Morador reativado.":"Acesso do morador bloqueado.");$("memberDetailsModal").hidden=true;await loadMembers()}catch(err){console.error(err);toast(`Não foi possível alterar o acesso (${err.code||"erro"}).`)}
 }
 if(e.target.closest("#memberResetInfo")){$("residentResetNote").hidden=false}
};
$("pendingList").onclick=async e=>{if(!current||current.uid!==ADMIN_UID)return;const approve=e.target.closest("[data-approve-pet]");if(approve){const id=approve.dataset.approvePet,p=lists.pets.find(x=>x.id===id);if(!p)return;if(!confirm(`Aprovar o cadastro de ${p.name}?`))return;try{const guardians=[{name:p.owner||"",phone:p.phone||""},...(p.owner2&&p.phone2?[{name:p.owner2,phone:p.phone2}]:[]),...(p.owner3&&p.phone3?[{name:p.owner3,phone:p.phone3}]:[])].filter(g=>g.name||g.phone);await setDoc(doc(db,"pets_public",id),{name:p.name,type:p.type,breed:p.breed||"",size:p.size||"",traits:p.traits||"",description:p.description||"",photo:p.photo||"",ownerUid:p.ownerUid,createdAt:p.createdAt||serverTimestamp()},{merge:true});await setDoc(doc(db,"pet_alert_contacts",id),{petId:id,petName:p.name,guardians,allowAlerts:p.allowAlerts===true,ownerUid:p.ownerUid,ownerPhone:p.phone||"",street:p.street||"",number:p.number||"",referenceUnit:p.referenceUnit||"",houseColor:p.houseColor||"",nearbyReference:p.nearbyReference||""},{merge:true});await deleteDoc(doc(db,"pet_submissions",id));toast("Pet aprovado e publicado.");await load()}catch(err){console.error(err);toast(`Falha ao aprovar pet (${err.code||"erro"}).`)}return}const b=e.target.closest("[data-delete-pending]");if(!b)return;const k=b.dataset.deletePending,cols={pets:"pet_submissions",found:"found_submissions",claims:"claim_submissions",lost:"lost_submissions"};if(!confirm("Excluir esta solicitação pendente?"))return;try{await deleteDoc(doc(db,cols[k],b.dataset.id));toast("Solicitação excluída.");await load()}catch(err){console.error(err);toast(`Falha ao excluir (${err.code||"erro"}).`)}};
$("exportBtn").onclick=()=>{const blob=new Blob([JSON.stringify(lists,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="pets-bela-vista-dados-admin.json";a.click();URL.revokeObjectURL(a.href)};
