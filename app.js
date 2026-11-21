import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let pets = [], deferredPrompt = null;
const $ = id => document.getElementById(id);
function escapeHTML(v = "") { return String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function toast(msg) { $("toast").textContent = msg; $("toast").classList.add("show"); setTimeout(() => $("toast").classList.remove("show"), 3500); }

function renderPets() {
  const q = $("searchInput").value.trim().toLocaleLowerCase("pt-BR"), type = $("typeFilter").value;
  const visible = pets.filter(p => (type === "todos" || p.type === type) && [p.name,p.breed,p.traits,p.type].join(" ").toLocaleLowerCase("pt-BR").includes(q));
  $("approvedCount").textContent = pets.length;
  $("petGrid").innerHTML = visible.map(p => `<article class="pet-card">${p.photo ? `<img class="pet-photo" src="${p.photo}" alt="Foto de ${escapeHTML(p.name)}">` : `<div class="pet-photo-placeholder">${p.type === "Gato" ? "🐱" : "🐶"}</div>`}<div class="pet-info"><div class="pet-title"><h3>${escapeHTML(p.name)}</h3><span class="species">${escapeHTML(p.type)}</span></div><p>${escapeHTML([p.breed,p.size,p.traits].filter(Boolean).join(" · "))}</p></div></article>`).join("");
  $("emptyState").classList.toggle("show", visible.length === 0); $("petGrid").style.display = visible.length ? "grid" : "none";
}
async function loadPublicPets() {
  try { const snap = await getDocs(collection(db,"pets_public")); pets = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)); renderPets(); }
  catch(e) { console.error(e); toast("Não foi possível carregar os pets. Confira as regras do Firestore."); }
}
function openForm(){ $("formModal").hidden=false; document.body.style.overflow="hidden"; }
function closeForm(){ $("formModal").hidden=true; document.body.style.overflow=""; $("petForm").reset(); $("photoPreview").hidden=true; $("photoPreview").src=""; delete $("petPhoto").dataset.compressed; }
["openForm","emptyAdd","joinBtn"].forEach(id=>$(id).addEventListener("click",openForm));
$("closeForm").addEventListener("click",closeForm);
$("formModal").addEventListener("click",e=>{if(e.target===$("formModal"))closeForm();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("formModal").hidden)closeForm();});
$("searchInput").addEventListener("input",renderPets); $("typeFilter").addEventListener("change",renderPets);

async function compressImage(file){
  if(!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  const bitmap=await createImageBitmap(file), max=640, scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement("canvas"); canvas.width=Math.round(bitmap.width*scale); canvas.height=Math.round(bitmap.height*scale);
  canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",0.68);
}
$("petPhoto").addEventListener("change",async e=>{
  const file=e.target.files[0]; if(!file)return;
  try{const data=await compressImage(file);$("photoPreview").src=data;$("photoPreview").hidden=false;$("petPhoto").dataset.compressed=data;}
  catch(err){toast(err.message||"Não foi possível processar a foto.");e.target.value="";}
});
$("petForm").addEventListener("submit",async e=>{
  e.preventDefault(); const form=e.currentTarget; if(!form.reportValidity())return;
  const photo=$("petPhoto").dataset.compressed; if(!photo){toast("Adicione uma foto do pet.");return;}
  const d=Object.fromEntries(new FormData(form).entries());
  const submission={name:d.name.trim(),type:d.type,breed:d.breed.trim(),size:d.size,traits:d.traits.trim(),owner:d.owner.trim(),phone:d.phone.trim(),street:d.street.trim(),number:d.number.trim(),photo,status:"pending",createdAt:serverTimestamp()};
  const btn=form.querySelector('button[type="submit"]'); btn.disabled=true; btn.textContent="Enviando...";
  try{await addDoc(collection(db,"pet_submissions"),submission);closeForm();toast("Cadastro enviado! Ele aparecerá após a aprovação.");}
  catch(err){console.error(err);toast("Não foi possível enviar. Confira a configuração do Firestore.");}
  finally{btn.disabled=false;btn.innerHTML='Enviar para aprovação <span>→</span>';}
});
$("installBtn").addEventListener("click",async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").hidden=true;});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").hidden=false;});
if("serviceWorker"in navigator&&location.protocol.startsWith("http"))window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
await loadPublicPets();
