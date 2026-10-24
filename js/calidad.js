// =========================================================
// Módulo Calidad: protocolos de inspección, no conformidades y pruebas / ensayos
// =========================================================
let U = null, PERFIL = null, PROYECTOS = [], PID = null;
let PARTIDAS = [], PROT = [], NC = [], ENS = [];
let EDIT_PROT = null, EDIT_NC = null, EDIT_ENS = null, CHK = [], ESTADO_TOCADO = false, LINK_ENS = null;
let FOTOS = { prot: { keep: [], pend: [] }, nc: { keep: [], pend: [] }, ncc: { keep: [], pend: [] } };
let ENS_ARCH = null;

const TIPOS_PROT = ["Concreto", "Acero de refuerzo", "Encofrado", "Movimiento de tierras", "Albañilería", "Estructura metálica", "Instalaciones sanitarias", "Instalaciones eléctricas", "Acabados", "Otro"];
const ESTADOS_PROT = ["Pendiente", "En inspección", "Aprobado", "Aprobado con observaciones", "Rechazado"];
const PLANTILLAS = {
  "Concreto": ["Planos y especificaciones vigentes en el frente", "Encofrado limpio, alineado y apuntalado", "Acero colocado según planos (diámetros y espaciamiento)", "Recubrimientos y separadores correctos", "Instalaciones embebidas verificadas", "Slump y temperatura del concreto dentro de especificación", "Probetas tomadas y rotuladas", "Curado programado"],
  "Acero de refuerzo": ["Diámetros y calidad del acero según planos", "Espaciamientos y cantidad de barras", "Longitudes de traslape y anclaje", "Estribos y ganchos según detalle", "Recubrimientos y separadores", "Acero limpio, sin óxido suelto ni contaminantes"],
  "Encofrado": ["Dimensiones y niveles según planos", "Verticalidad y alineamiento", "Apuntalamiento y arriostres estables", "Juntas selladas, sin fugas de pasta", "Desmoldante aplicado", "Limpieza interior antes del vaciado"],
  "Movimiento de tierras": ["Niveles y pendientes según planos", "Material de relleno aprobado", "Espesor de capas y compactación", "Densidad de campo realizada", "Fondo de excavación limpio y estable"],
  "Albañilería": ["Unidades de albañilería según especificación", "Alineamiento y plomo del muro", "Juntas de mortero uniformes", "Amarres y refuerzos según planos", "Vanos y niveles verificados"],
  "Estructura metálica": ["Perfiles y planchas según planos", "Soldaduras inspeccionadas", "Pernos y torques según especificación", "Protección anticorrosiva aplicada", "Alineamiento y nivelación del montaje"],
  "Instalaciones sanitarias": ["Diámetros y materiales según planos", "Pendientes de desagüe", "Pruebas de estanqueidad / presión realizadas", "Soportes y pasamuros colocados", "Accesorios y registros ubicados correctamente"],
  "Instalaciones eléctricas": ["Canalizaciones y cajas según planos", "Conductores y calibres correctos", "Continuidad y aislamiento medidos", "Tableros y rotulado", "Puesta a tierra verificada"],
  "Acabados": ["Superficie base preparada y aprobada", "Materiales y colores según especificación", "Nivel, plomo y planeidad", "Juntas y remates", "Limpieza y protección del acabado"],
  "Otro": ["Conforme con planos y especificaciones", "Materiales aprobados", "Trabajo terminado y limpio"],
};
const TIPOS_ENS = ["Rotura de probetas de concreto", "Slump del concreto", "Densidad de campo", "Ensayo de acero de refuerzo", "Prueba hidráulica", "Prueba de presión", "Prueba de estanqueidad", "Otro"];
const DEF_ENS = {
  "Rotura de probetas de concreto": { crit: "min", und: "kg/cm²" }, "Slump del concreto": { crit: "max", und: "pulg" }, "Densidad de campo": { crit: "min", und: "%" },
  "Ensayo de acero de refuerzo": { crit: "min", und: "kg/cm²" }, "Prueba hidráulica": { crit: "min", und: "h" }, "Prueba de presión": { crit: "min", und: "bar" }, "Prueba de estanqueidad": { crit: "min", und: "h" },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fd = (iso) => iso ? iso.split("-").reverse().join("/") : "";
const dias = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const puedeEditar = () => ["admin", "planner", "residente", "calidad"].includes(PERFIL.rol);
const puedeBorrar = () => ["admin", "planner"].includes(PERFIL.rol);
const num = (id) => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };
const txt = (id) => $(id).value.trim() || null;
const opts = (l) => l.map(x => `<option>${esc(x)}</option>`).join("");
const cod = (pre, n) => pre + "-" + String(n).padStart(3, "0");
const fmt = (n) => n == null ? "" : Number(n).toLocaleString("es-PE", { maximumFractionDigits: 2 });
const soles = (n) => Number(n || 0).toLocaleString("es-PE", { maximumFractionDigits: 0 });
const frentes = () => [...new Set(PARTIDAS.map(p => p.frente))];

async function fetchAll(build) {
  let from = 0, all = [];
  while (true) {
    const { data, error } = await build().range(from, from + 999);
    if (error) { console.error(error); break; }
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return all;
}

(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "index.html"; return; }
  U = session.user;
  const { data: perfil } = await supabaseClient.from("perfiles").select("*").eq("id", U.id).single();
  PERFIL = perfil || { rol: "residente", nombre_completo: U.email };
  if (!["admin", "planner", "residente", "viewer", "calidad"].includes(PERFIL.rol)) { window.location.href = "modulos.html"; return; }
  $("userName").textContent = PERFIL.nombre_completo || U.email;
  $("userRole").textContent = "(" + PERFIL.rol + ")";
  if (PERFIL.rol !== "calidad") $("backLink").style.display = "";
  $("logoutBtn").addEventListener("click", async () => { await supabaseClient.auth.signOut(); window.location.href = "index.html"; });
  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); $("view-" + b.dataset.view).classList.add("active");
  }));

  $("pfTipo").innerHTML = opts(TIPOS_PROT); $("pfEstado").innerHTML = opts(ESTADOS_PROT);
  $("prFEstado").innerHTML = `<option value="pend">Por resolver</option><option value="todos">Todos los estados</option>` + opts(ESTADOS_PROT);
  $("prFTipo").innerHTML = `<option value="">Todos los tipos</option>` + opts(TIPOS_PROT);
  $("efTipo").innerHTML = opts(TIPOS_ENS); $("enFTipo").innerHTML = `<option value="">Todos los tipos</option>` + opts(TIPOS_ENS);
  ["prNuevo", "ncNuevo", "enNuevo"].forEach(id => { if (!puedeEditar()) $(id).style.display = "none"; });
  enlazarEventos();

  const { data: proys } = await supabaseClient.from("proyectos").select("*").order("created_at");
  PROYECTOS = proys || [];
  $("clProyecto").innerHTML = PROYECTOS.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
  $("clProyecto").addEventListener("change", cargar);
  if (PROYECTOS.length) await cargar();
})();

async function cargar() {
  PID = $("clProyecto").value;
  if (!PID) return;
  const [pa, pr, nc, en] = await Promise.all([
    fetchAll(() => supabaseClient.from("partidas").select("id,frente,nombre,orden").eq("proyecto_id", PID).order("orden")),
    fetchAll(() => supabaseClient.from("cal_protocolos").select("*").eq("proyecto_id", PID).order("numero")),
    fetchAll(() => supabaseClient.from("cal_nc").select("*").eq("proyecto_id", PID).order("numero")),
    fetchAll(() => supabaseClient.from("cal_ensayos").select("*").eq("proyecto_id", PID).order("numero")),
  ]);
  PARTIDAS = pa; PROT = pr; NC = nc; ENS = en;
  [renderTablero, renderProtocolos, renderNC, renderEnsayos].forEach(fn => { try { fn(); } catch (e) { console.error(fn.name, e); } });
}

// ---------------- utilidades de fotos ----------------
async function pintarFotos(clave, cont, cnt) {
  const f = FOTOS[clave];
  $(cnt).textContent = f.pend.length ? f.pend.length + " foto(s) por subir al guardar" : "";
  const el = $(cont); el.innerHTML = "";
  for (const ruta of f.keep) {
    const u = await FotosObra.url(ruta); if (!u) continue;
    const d = document.createElement("div"); d.className = "foto-th";
    d.innerHTML = `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="foto"></a><button type="button" title="Quitar" data-q="${clave}" data-r="${esc(ruta)}" data-c="${cont}" data-n="${cnt}">×</button>`;
    el.appendChild(d);
  }
}
function ligarFotos(clave, inputId, cont, cnt) {
  $(inputId).addEventListener("change", (e) => { FOTOS[clave].pend = FOTOS[clave].pend.concat([...e.target.files]); e.target.value = ""; pintarFotos(clave, cont, cnt); });
}
async function subirFotos(clave, carpeta) {
  const f = FOTOS[clave];
  return f.keep.concat(f.pend.length ? await FotosObra.subir(f.pend, `${PID}/calidad/${carpeta}`) : []);
}
async function verFotos(titulo, rep, cie, t1) {
  $("fmTitulo").textContent = titulo; $("fmT1").textContent = t1 || "Fotos"; $("fmCieW").style.display = cie ? "" : "none";
  for (const [id, rutas] of [["fmRep", rep || []], ["fmCie", cie || []]]) {
    const cont = $(id); cont.innerHTML = rutas.length ? "" : `<span class="save-hint">Sin fotos.</span>`;
    for (const r of rutas) {
      const url = await FotosObra.url(r); if (!url) continue;
      const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.innerHTML = `<img src="${url}" alt="foto">`; cont.appendChild(a);
    }
  }
  $("fotoModal").style.display = "flex";
}
const btnFotos = (id, n, attr) => n ? `<button class="btn secondary mini" data-${attr}="${id}">📷 ${n}</button>` : "";

function llenarPartidas(selId, frente, sel) {
  const l = PARTIDAS.filter(p => !frente || p.frente === frente);
  $(selId).innerHTML = `<option value="">— ninguna —</option>` + l.map(p => `<option value="${p.id}">${esc(p.nombre.slice(0, 80))}</option>`).join("");
  if (sel) $(selId).value = sel;
}
function llenarFrentes(selId, valor) {
  $(selId).innerHTML = `<option value="">— sin frente —</option>` + frentes().map(f => `<option>${esc(f)}</option>`).join("");
  $(selId).value = valor || "";
}

// =========================================================
// PROTOCOLOS
// =========================================================
const resChk = (p) => { const l = p.checklist || []; return { n: l.length, ev: l.filter(x => x.res).length, c: l.filter(x => x.res === "C").length, nc: l.filter(x => x.res === "NC").length, na: l.filter(x => x.res === "NA").length }; };
const protAbierto = (p) => ["Pendiente", "En inspección"].includes(p.estado);
const claseProt = (e) => e === "Aprobado" ? "ok" : e === "Rechazado" ? "late" : "warn";

function protFiltrados() {
  const fe = $("prFEstado").value, ft = $("prFTipo").value, ff = $("prFFrente").value, q = $("prBuscar").value.trim().toLowerCase();
  return PROT.filter(p => {
    if (fe === "pend" ? !(protAbierto(p) || p.estado === "Rechazado") : (fe !== "todos" && p.estado !== fe)) return false;
    if (ft && p.tipo !== ft) return false;
    if (ff && p.frente !== ff) return false;
    if (q && ![p.titulo, p.ubicacion, p.inspector, p.frente, cod("PC", p.numero)].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderProtocolos() {
  const sel = $("prFFrente").value;
  $("prFFrente").innerHTML = `<option value="">Todos los frentes</option>` + [...new Set(PROT.map(p => p.frente).filter(Boolean))].sort().map(f => `<option>${esc(f)}</option>`).join("");
  $("prFFrente").value = sel;
  $("clInspList").innerHTML = [...new Set(PROT.map(p => p.inspector).filter(Boolean))].map(r => `<option value="${esc(r)}">`).join("");
  $("prTabla").querySelector("tbody").innerHTML = protFiltrados().map(p => {
    const r = resChk(p), nf = (p.fotos || []).length;
    return `<tr><td>${cod("PC", p.numero)}</td><td>${esc(p.tipo)}</td><td style="min-width:200px;">${esc(p.titulo)}</td><td>${esc(p.frente)}</td><td>${esc(p.ubicacion)}</td><td>${fd(p.fecha_inspeccion)}</td><td>${esc(p.inspector)}</td><td><span class="badge ${claseProt(p.estado)}">${p.estado}</span></td><td class="num">${r.n ? `${r.c + r.na}/${r.n}${r.nc ? ` · <span style="color:var(--red);">${r.nc} NC</span>` : ""}` : ""}</td><td>${btnFotos(p.id, nf, "pf")}</td><td style="white-space:nowrap;"><button class="btn secondary mini" data-pp="${p.id}">Imprimir</button> ${puedeEditar() ? `<button class="btn secondary mini" data-pe="${p.id}">Editar</button> ` : ""}${puedeBorrar() ? `<button class="btn secondary mini" data-pd="${p.id}">Borrar</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="11" style="color:var(--text-muted);">No hay protocolos con este filtro.</td></tr>`;
}

function pintarChecklist() {
  const cont = $("pfChecklist");
  cont.innerHTML = CHK.map((x, i) => `<div class="chk-row"><input type="text" class="in" data-ci="${i}" value="${esc(x.item)}"><select class="in" data-cr="${i}"><option value="">Pendiente</option><option value="C"${x.res === "C" ? " selected" : ""}>Conforme</option><option value="NC"${x.res === "NC" ? " selected" : ""}>No conforme</option><option value="NA"${x.res === "NA" ? " selected" : ""}>No aplica</option></select><button type="button" data-cd="${i}" title="Quitar ítem">×</button></div>`).join("");
  actualizarResumenChk();
}
function actualizarResumenChk() {
  const r = resChk({ checklist: CHK });
  $("pfResumen").textContent = r.n ? `${r.c} conforme · ${r.nc} no conforme · ${r.na} no aplica · ${r.n - r.ev} pendiente` : "";
  if (!ESTADO_TOCADO && r.n) {
    if (r.ev === r.n) $("pfEstado").value = r.nc > 0 ? "Rechazado" : "Aprobado";
    else if (r.ev > 0) $("pfEstado").value = "En inspección";
    else $("pfEstado").value = "Pendiente";
  }
}

function abrirProt(p) {
  EDIT_PROT = p || null; ESTADO_TOCADO = !!p;
  $("prFormTitulo").textContent = p ? "Editar protocolo " + cod("PC", p.numero) : "Nuevo protocolo";
  $("pfTipo").value = p ? p.tipo : TIPOS_PROT[0];
  $("pfTitulo").value = p ? p.titulo : "";
  llenarFrentes("pfFrente", p && p.frente); llenarPartidas("pfPartida", $("pfFrente").value, p && p.partida_id);
  $("pfUbic").value = p ? (p.ubicacion || "") : ""; $("pfFecha").value = p ? (p.fecha_inspeccion || "") : hoyISO();
  $("pfInsp").value = p ? (p.inspector || "") : (PERFIL.nombre_completo || "");
  $("pfEstado").value = p ? p.estado : "Pendiente";
  CHK = p ? (p.checklist || []).map(x => ({ item: x.item, res: x.res || "" })) : (PLANTILLAS[TIPOS_PROT[0]] || []).map(i => ({ item: i, res: "" }));
  pintarChecklist();
  $("pfObs").value = p ? (p.observaciones || "") : "";
  FOTOS.prot = { keep: p ? (p.fotos || []).slice() : [], pend: [] }; $("pfFotosIn").value = "";
  pintarFotos("prot", "pfFotosAct", "pfFotosCnt");
  $("prMsg").textContent = ""; $("prForm").style.display = "";
  $("prForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function guardarProt(e) {
  e.preventDefault();
  const btn = $("prForm").querySelector('button[type="submit"]');
  let fotos;
  try { if (FOTOS.prot.pend.length) { btn.disabled = true; $("prMsg").textContent = "Subiendo fotos..."; } fotos = await subirFotos("prot", "protocolos"); }
  catch (err) { btn.disabled = false; $("prMsg").textContent = "No se pudieron subir las fotos: " + (err.message || err); return; }
  btn.disabled = false;
  const checklist = CHK.map(x => ({ item: x.item.trim(), res: x.res })).filter(x => x.item);
  const fila = {
    proyecto_id: PID, tipo: $("pfTipo").value, titulo: $("pfTitulo").value.trim(), frente: txt("pfFrente"), partida_id: $("pfPartida").value || null,
    ubicacion: txt("pfUbic"), fecha_inspeccion: txt("pfFecha"), inspector: txt("pfInsp"), estado: $("pfEstado").value, checklist, observaciones: txt("pfObs"), fotos,
  };
  let error, id = EDIT_PROT && EDIT_PROT.id;
  if (EDIT_PROT) ({ error } = await supabaseClient.from("cal_protocolos").update(fila).eq("id", id));
  else { const r = await supabaseClient.from("cal_protocolos").insert(fila).select().single(); error = r.error; id = r.data && r.data.id; }
  if (error) { $("prMsg").textContent = "No se pudo guardar: " + error.message; return; }
  $("prForm").style.display = "none";
  await cargar();
  const fallos = checklist.filter(x => x.res === "NC");
  if (id && fila.estado !== "Aprobado" && fila.estado !== "Pendiente" && fallos.length && !NC.some(n => n.protocolo_id === id) && puedeEditar() &&
      confirm("El protocolo tiene ítems no conformes. ¿Crear una no conformidad a partir de él?")) {
    document.querySelector('[data-view="nc"]').click();
    abrirNC(null, { protocolo_id: id, frente: fila.frente, partida_id: fila.partida_id, descripcion: `${fila.titulo}: ` + fallos.map(x => x.item).join("; ") });
  }
}

function imprimirProt(p) {
  const proy = PROYECTOS.find(x => x.id === PID);
  const r = resChk(p);
  const etiqueta = { C: "Conforme", NC: "No conforme", NA: "No aplica", "": "Pendiente" };
  (async () => {
    const urls = await Promise.all((p.fotos || []).map(f => FotosObra.url(f)));
    const w = window.open("", "_blank");
    if (!w) { alert("El navegador bloqueó la ventana. Permite ventanas emergentes para imprimir."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${cod("PC", p.numero)}</title><style>
      body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111} h1{font-size:17px;margin:0 0 4px} table{border-collapse:collapse;width:100%;margin:8px 0}
      th,td{border:1px solid #999;padding:5px 7px;text-align:left;vertical-align:top} th{background:#eee} .k{width:150px;background:#f4f4f4;font-weight:bold}
      .fotos img{height:150px;margin:4px 6px 0 0;border:1px solid #ccc} .firmas{display:flex;gap:30px;margin-top:60px} .firmas div{flex:1;border-top:1px solid #333;text-align:center;padding-top:4px}</style></head><body>
      <h1>Protocolo de inspección ${cod("PC", p.numero)} — ${esc(p.tipo)}</h1><div>${esc(proy ? proy.nombre : "")}</div>
      <table><tr><td class="k">Título</td><td colspan="3">${esc(p.titulo)}</td></tr>
      <tr><td class="k">Frente</td><td>${esc(p.frente)}</td><td class="k">Ubicación</td><td>${esc(p.ubicacion)}</td></tr>
      <tr><td class="k">Fecha</td><td>${fd(p.fecha_inspeccion)}</td><td class="k">Inspector</td><td>${esc(p.inspector)}</td></tr>
      <tr><td class="k">Resultado</td><td colspan="3"><b>${p.estado}</b> (${r.c} conforme, ${r.nc} no conforme, ${r.na} no aplica)</td></tr></table>
      <table><thead><tr><th style="width:30px;">N°</th><th>Ítem de verificación</th><th style="width:110px;">Resultado</th></tr></thead><tbody>${(p.checklist || []).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.item)}</td><td>${etiqueta[x.res || ""]}</td></tr>`).join("")}</tbody></table>
      ${p.observaciones ? `<p><b>Observaciones:</b> ${esc(p.observaciones)}</p>` : ""}
      ${urls.filter(Boolean).length ? `<h3>Registro fotográfico</h3><div class="fotos">${urls.filter(Boolean).map(u => `<img src="${u}">`).join("")}</div>` : ""}
      <div class="firmas"><div>Residente de obra</div><div>Control de calidad</div><div>Supervisión / Cliente</div></div>
      <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`);
    w.document.close();
  })();
}

// =========================================================
// NO CONFORMIDADES
// =========================================================
const ncAbierta = (n) => ["Abierta", "En corrección"].includes(n.estado);
const ncVencida = (n) => ncAbierta(n) && n.fecha_compromiso && n.fecha_compromiso < hoyISO();
const claseNC = (e) => e === "Cerrada" ? "ok" : e === "Anulada" ? "" : e === "En corrección" ? "warn" : "late";

function ncFiltradas() {
  const fe = $("ncFEstado").value, fs = $("ncFSev").value, q = $("ncBuscar").value.trim().toLowerCase();
  return NC.filter(n => {
    if (fe === "abiertas" ? !ncAbierta(n) : (fe !== "todas" && n.estado !== fe)) return false;
    if (fs && n.severidad !== fs) return false;
    if (q && ![n.descripcion, n.responsable, n.frente, n.causa, cod("NC", n.numero)].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderNC() {
  $("clRespList").innerHTML = [...new Set(NC.map(n => n.responsable).filter(Boolean))].map(r => `<option value="${esc(r)}">`).join("");
  $("ncTabla").querySelector("tbody").innerHTML = ncFiltradas().map(n => {
    const nf = (n.fotos || []).length + (n.fotos_cierre || []).length;
    const sev = n.severidad === "Crítica" ? ` style="color:var(--red);font-weight:600;"` : n.severidad === "Mayor" ? ` style="font-weight:600;"` : "";
    return `<tr><td>${cod("NC", n.numero)}</td><td${sev}>${n.severidad}</td><td style="min-width:240px;">${esc(n.descripcion)}</td><td>${esc(n.frente)}</td><td>${esc(n.responsable)}</td><td>${fd(n.fecha_deteccion)}</td><td>${fd(n.fecha_compromiso)}</td><td><span class="badge ${claseNC(n.estado)}">${n.estado}</span></td><td>${ncVencida(n) ? `<span class="badge late">Vencida ${dias(n.fecha_compromiso, hoyISO())} d</span>` : ""}</td><td>${btnFotos(n.id, nf, "nf")}</td><td style="white-space:nowrap;">${puedeEditar() ? `<button class="btn secondary mini" data-ne="${n.id}">Editar</button> ` : ""}${puedeBorrar() ? `<button class="btn secondary mini" data-nd="${n.id}">Borrar</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="11" style="color:var(--text-muted);">No hay no conformidades con este filtro.</td></tr>`;
}

function abrirNC(n, pre) {
  EDIT_NC = n || null; pre = pre || {};
  $("ncFormTitulo").textContent = n ? "Editar no conformidad " + cod("NC", n.numero) : "Nueva no conformidad";
  $("nfDesc").value = n ? n.descripcion : (pre.descripcion || "");
  $("nfSev").value = n ? n.severidad : "Menor";
  llenarFrentes("nfFrente", n ? n.frente : pre.frente); llenarPartidas("nfPartida", $("nfFrente").value, n ? n.partida_id : pre.partida_id);
  $("nfProt").innerHTML = `<option value="">— ninguno —</option>` + PROT.map(p => `<option value="${p.id}">${cod("PC", p.numero)} — ${esc(p.titulo.slice(0, 60))}</option>`).join("");
  $("nfProt").value = n ? (n.protocolo_id || "") : (pre.protocolo_id || "");
  $("nfResp").value = n ? (n.responsable || "") : "";
  $("nfEstado").value = n ? n.estado : "Abierta";
  $("nfFDet").value = n ? (n.fecha_deteccion || "") : hoyISO(); $("nfFComp").value = n ? (n.fecha_compromiso || "") : ""; $("nfFCierre").value = n ? (n.fecha_cierre || "") : "";
  $("nfCosto").value = n && n.costo_estimado != null ? n.costo_estimado : "";
  $("nfCausa").value = n ? (n.causa || "") : ""; $("nfCorr").value = n ? (n.accion_correctiva || "") : ""; $("nfPrev").value = n ? (n.accion_preventiva || "") : "";
  FOTOS.nc = { keep: n ? (n.fotos || []).slice() : [], pend: [] }; FOTOS.ncc = { keep: n ? (n.fotos_cierre || []).slice() : [], pend: [] };
  $("nfFotosIn").value = ""; $("nfFotosCieIn").value = "";
  pintarFotos("nc", "nfFotosAct", "nfFotosCnt"); pintarFotos("ncc", "nfFotosCieAct", "nfFotosCieCnt");
  LINK_ENS = pre.ensayo_id || null;
  $("ncMsg").textContent = ""; $("ncForm").style.display = "";
  $("ncForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function guardarNC(e) {
  e.preventDefault();
  const btn = $("ncForm").querySelector('button[type="submit"]');
  let fotos, fotos_cierre;
  try {
    if (FOTOS.nc.pend.length || FOTOS.ncc.pend.length) { btn.disabled = true; $("ncMsg").textContent = "Subiendo fotos..."; }
    fotos = await subirFotos("nc", "nc"); fotos_cierre = await subirFotos("ncc", "nc");
  } catch (err) { btn.disabled = false; $("ncMsg").textContent = "No se pudieron subir las fotos: " + (err.message || err); return; }
  btn.disabled = false;
  const estado = $("nfEstado").value;
  const fila = {
    proyecto_id: PID, protocolo_id: $("nfProt").value || null, descripcion: $("nfDesc").value.trim(), frente: txt("nfFrente"), partida_id: $("nfPartida").value || null,
    severidad: $("nfSev").value, causa: txt("nfCausa"), accion_correctiva: txt("nfCorr"), accion_preventiva: txt("nfPrev"), responsable: txt("nfResp"),
    fecha_deteccion: txt("nfFDet"), fecha_compromiso: txt("nfFComp"), fecha_cierre: txt("nfFCierre") || (estado === "Cerrada" ? hoyISO() : null),
    estado, costo_estimado: num("nfCosto"), fotos, fotos_cierre,
  };
  let error, id = EDIT_NC && EDIT_NC.id;
  if (EDIT_NC) ({ error } = await supabaseClient.from("cal_nc").update(fila).eq("id", id));
  else { const r = await supabaseClient.from("cal_nc").insert(fila).select().single(); error = r.error; id = r.data && r.data.id; }
  if (error) { $("ncMsg").textContent = "No se pudo guardar: " + error.message; return; }
  if (LINK_ENS && id) { await supabaseClient.from("cal_ensayos").update({ nc_id: id }).eq("id", LINK_ENS); LINK_ENS = null; }
  $("ncForm").style.display = "none";
  await cargar();
}

// =========================================================
// ENSAYOS
// =========================================================
function resultadoEns(crit, esp, obt) {
  if (obt == null || esp == null) return "Pendiente";
  return (crit === "max" ? obt <= esp : obt >= esp) ? "Cumple" : "No cumple";
}
const claseRes = (r) => r === "Cumple" ? "ok" : r === "No cumple" ? "late" : "warn";

function ensFiltrados() {
  const fr = $("enFRes").value, ft = $("enFTipo").value, q = $("enBuscar").value.trim().toLowerCase();
  return ENS.filter(x => (!fr || x.resultado === fr) && (!ft || x.tipo === ft) && (!q || [x.descripcion, x.laboratorio, x.frente, cod("EN", x.numero)].join(" ").toLowerCase().includes(q)));
}

function renderEnsayos() {
  $("enTabla").querySelector("tbody").innerHTML = ensFiltrados().map(x =>
    `<tr><td>${cod("EN", x.numero)}</td><td>${esc(x.tipo)}</td><td style="min-width:200px;">${esc(x.descripcion)}</td><td>${esc(x.frente)}</td><td>${fd(x.fecha_muestra)}</td><td class="num">${x.edad_dias ?? ""}</td><td>${fd(x.fecha_ensayo)}</td><td>${esc(x.laboratorio)}</td><td class="num">${x.especificado != null ? (x.criterio === "max" ? "≤ " : "≥ ") + fmt(x.especificado) + " " + esc(x.unidad || "") : ""}</td><td class="num">${x.obtenido != null ? fmt(x.obtenido) : ""}</td><td><span class="badge ${claseRes(x.resultado)}">${x.resultado}</span>${x.nc_id ? ' <span class="save-hint">NC</span>' : ""}</td><td>${x.archivo_path ? `<button class="btn secondary mini" data-ea="${x.id}">Ver</button>` : ""}</td><td style="white-space:nowrap;">${puedeEditar() ? `<button class="btn secondary mini" data-ee="${x.id}">Editar</button> ` : ""}${puedeBorrar() ? `<button class="btn secondary mini" data-ed="${x.id}">Borrar</button>` : ""}</td></tr>`).join("")
    || `<tr><td colspan="13" style="color:var(--text-muted);">No hay pruebas ni ensayos con este filtro.</td></tr>`;
}

function mostrarResEns() {
  const r = resultadoEns($("efCrit").value, num("efEsp"), num("efObt"));
  $("efResultado").textContent = "Resultado: " + r;
}

function abrirEns(x) {
  EDIT_ENS = x || null; ENS_ARCH = x && x.archivo_path ? { path: x.archivo_path, nombre: x.archivo_nombre } : null;
  $("enFormTitulo").textContent = x ? "Editar ensayo " + cod("EN", x.numero) : "Nueva prueba o ensayo";
  $("efTipo").value = x ? x.tipo : TIPOS_ENS[0];
  $("efDesc").value = x ? x.descripcion : "";
  llenarFrentes("efFrente", x && x.frente); llenarPartidas("efPartida", $("efFrente").value, x && x.partida_id);
  $("efLab").value = x ? (x.laboratorio || "") : ""; $("efFMues").value = x ? (x.fecha_muestra || "") : hoyISO();
  $("efEdad").value = x && x.edad_dias != null ? x.edad_dias : ""; $("efFEns").value = x ? (x.fecha_ensayo || "") : "";
  const d = DEF_ENS[$("efTipo").value] || {};
  $("efCrit").value = x ? x.criterio : (d.crit || "min");
  $("efEsp").value = x && x.especificado != null ? x.especificado : ""; $("efUnd").value = x ? (x.unidad || "") : (d.und || "");
  $("efObt").value = x && x.obtenido != null ? x.obtenido : "";
  $("efArchivo").value = ""; $("efArchivoAct").textContent = ENS_ARCH ? "Archivo actual: " + (ENS_ARCH.nombre || ENS_ARCH.path.split("/").pop()) : "";
  $("efObs").value = x ? (x.observaciones || "") : "";
  mostrarResEns();
  $("enMsg").textContent = ""; $("enForm").style.display = "";
  $("enForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function guardarEns(e) {
  e.preventDefault();
  const btn = $("enForm").querySelector('button[type="submit"]');
  let arch = ENS_ARCH;
  const f = $("efArchivo").files[0];
  try { if (f) { btn.disabled = true; $("enMsg").textContent = "Subiendo informe..."; arch = { path: await FotosObra.subirArchivo(f, `${PID}/calidad/ensayos`), nombre: f.name }; } }
  catch (err) { btn.disabled = false; $("enMsg").textContent = "No se pudo subir el informe: " + (err.message || err); return; }
  btn.disabled = false;
  const crit = $("efCrit").value, esp = num("efEsp"), obt = num("efObt");
  const fila = {
    proyecto_id: PID, tipo: $("efTipo").value, descripcion: $("efDesc").value.trim(), frente: txt("efFrente"), partida_id: $("efPartida").value || null,
    fecha_muestra: txt("efFMues"), edad_dias: num("efEdad"), fecha_ensayo: txt("efFEns"), laboratorio: txt("efLab"),
    criterio: crit, especificado: esp, unidad: txt("efUnd"), obtenido: obt, resultado: resultadoEns(crit, esp, obt),
    archivo_path: arch ? arch.path : null, archivo_nombre: arch ? arch.nombre : null, observaciones: txt("efObs"),
  };
  let error, id = EDIT_ENS && EDIT_ENS.id;
  if (EDIT_ENS) ({ error } = await supabaseClient.from("cal_ensayos").update(fila).eq("id", id));
  else { const r = await supabaseClient.from("cal_ensayos").insert(fila).select().single(); error = r.error; id = r.data && r.data.id; }
  if (error) { $("enMsg").textContent = "No se pudo guardar: " + error.message; return; }
  $("enForm").style.display = "none";
  await cargar();
  const ya = EDIT_ENS && EDIT_ENS.nc_id;
  if (id && fila.resultado === "No cumple" && !ya && puedeEditar() && confirm("El ensayo no cumple la especificación. ¿Crear una no conformidad?")) {
    document.querySelector('[data-view="nc"]').click();
    abrirNC(null, { ensayo_id: id, frente: fila.frente, partida_id: fila.partida_id, descripcion: `${fila.tipo} no cumple (${fila.descripcion}): obtenido ${fmt(obt)} ${fila.unidad || ""}, especificado ${crit === "max" ? "≤" : "≥"} ${fmt(esp)}` });
  }
}

// =========================================================
// TABLERO
// =========================================================
function renderTablero() {
  const hoy = hoyISO();
  const pAp = PROT.filter(p => p.estado === "Aprobado" || p.estado === "Aprobado con observaciones").length;
  const pct = PROT.length ? Math.round(pAp / PROT.length * 100) : 0;
  const ncAb = NC.filter(ncAbierta), ncV = ncAb.filter(ncVencida), ncCr = ncAb.filter(n => n.severidad === "Crítica");
  const enNo = ENS.filter(x => x.resultado === "No cumple"), enPend = ENS.filter(x => x.resultado === "Pendiente");
  const tile = (l, v, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}">${v}</div></div>`;
  $("clStats").innerHTML =
    tile("Protocolos", PROT.length) + tile("% aprobados", pct + " %", pct >= 80 ? "good" : "") +
    tile("NC abiertas", ncAb.length, ncAb.length ? "bad" : "good") + tile("NC vencidas", ncV.length, ncV.length ? "bad" : "good") +
    tile("NC críticas abiertas", ncCr.length, ncCr.length ? "bad" : "good") + tile("Ensayos que no cumplen", enNo.length, enNo.length ? "bad" : "good") +
    tile("Ensayos pendientes", enPend.length);

  const al = [];
  NC.filter(n => ncAbierta(n) && (ncVencida(n) || n.severidad === "Crítica")).forEach(n =>
    al.push({ cod: cod("NC", n.numero), tipo: "No conformidad " + n.severidad.toLowerCase(), det: n.descripcion, frente: n.frente, fecha: n.fecha_compromiso || n.fecha_deteccion, nivel: "late",
      txt: ncVencida(n) ? `Vencida ${dias(n.fecha_compromiso, hoy)} d` : "Crítica abierta" }));
  PROT.filter(p => protAbierto(p) && p.fecha_inspeccion && p.fecha_inspeccion < hoy).forEach(p =>
    al.push({ cod: cod("PC", p.numero), tipo: "Protocolo", det: p.titulo, frente: p.frente, fecha: p.fecha_inspeccion, nivel: "warn", txt: `Sin resolver hace ${dias(p.fecha_inspeccion, hoy)} d` }));
  ENS.filter(x => x.resultado === "Pendiente" && x.fecha_ensayo && x.fecha_ensayo <= hoy).forEach(x =>
    al.push({ cod: cod("EN", x.numero), tipo: "Ensayo", det: `${x.tipo}: ${x.descripcion}`, frente: x.frente, fecha: x.fecha_ensayo, nivel: "warn", txt: "Resultado pendiente" }));
  enNo.filter(x => !x.nc_id).forEach(x =>
    al.push({ cod: cod("EN", x.numero), tipo: "Ensayo", det: `${x.tipo}: ${x.descripcion}`, frente: x.frente, fecha: x.fecha_ensayo, nivel: "late", txt: "No cumple, sin NC" }));
  al.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "late" ? -1 : 1) || (a.fecha || "").localeCompare(b.fecha || ""));
  $("clTabAlertas").querySelector("tbody").innerHTML = al.map(a =>
    `<tr><td>${a.cod}</td><td>${esc(a.tipo)}</td><td>${esc(a.det)}</td><td>${esc(a.frente)}</td><td>${fd(a.fecha)}</td><td><span class="badge ${a.nivel}">${a.txt}</span></td></tr>`).join("")
    || `<tr><td colspan="6" style="color:var(--text-muted);">No hay alertas.</td></tr>`;

  const fr = [...new Set([...PROT, ...NC, ...ENS].map(x => x.frente || "Sin frente"))].sort();
  $("clTabFrente").querySelector("tbody").innerHTML = fr.map(f => {
    const l = PROT.filter(p => (p.frente || "Sin frente") === f), ap = l.filter(p => p.estado === "Aprobado" || p.estado === "Aprobado con observaciones").length;
    const p = l.length ? Math.round(ap / l.length * 100) : 0;
    return `<tr><td>${esc(f)}</td><td class="num">${l.length}</td><td class="num">${ap}</td><td><div class="bar-h"><i style="width:${p}%"></i></div></td><td class="num">${NC.filter(n => ncAbierta(n) && (n.frente || "Sin frente") === f).length}</td><td class="num">${enNo.filter(x => (x.frente || "Sin frente") === f).length}</td></tr>`;
  }).join("") || `<tr><td colspan="6" style="color:var(--text-muted);">Aún no hay registros de calidad.</td></tr>`;

  $("clTabSev").querySelector("tbody").innerHTML = ["Crítica", "Mayor", "Menor"].map(s => {
    const l = NC.filter(n => n.severidad === s && n.estado !== "Anulada"), ab = l.filter(ncAbierta).length;
    return `<tr><td>${s}</td><td class="num">${ab}</td><td class="num">${l.filter(n => n.estado === "Cerrada").length}</td><td class="num">${l.length}</td><td class="num">${soles(l.reduce((t, n) => t + (Number(n.costo_estimado) || 0), 0))}</td></tr>`;
  }).join("");
}

// =========================================================
// CSV y eventos
// =========================================================
function descargarCSV(nombre, cabecera, filas) {
  const celda = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const t = "﻿" + [cabecera, ...filas].map(f => f.map(celda).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([t], { type: "text/csv;charset=utf-8" }));
  a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function enlazarEventos() {
  $("fmCerrar").addEventListener("click", () => $("fotoModal").style.display = "none");
  $("fotoModal").addEventListener("click", (e) => { if (e.target.id === "fotoModal") $("fotoModal").style.display = "none"; });
  document.addEventListener("click", (e) => {   // quitar foto de un formulario
    const b = e.target.closest("button[data-q]"); if (!b) return;
    FOTOS[b.dataset.q].keep = FOTOS[b.dataset.q].keep.filter(r => r !== b.dataset.r);
    pintarFotos(b.dataset.q, b.dataset.c, b.dataset.n);
  });

  // Protocolos
  $("prNuevo").addEventListener("click", () => abrirProt(null));
  $("prCancelar").addEventListener("click", () => $("prForm").style.display = "none");
  $("prForm").addEventListener("submit", guardarProt);
  ligarFotos("prot", "pfFotosIn", "pfFotosAct", "pfFotosCnt");
  $("pfFrente").addEventListener("change", () => llenarPartidas("pfPartida", $("pfFrente").value));
  $("pfEstado").addEventListener("change", () => ESTADO_TOCADO = true);
  $("pfTipo").addEventListener("change", () => {
    if (EDIT_PROT && (EDIT_PROT.checklist || []).length) return;
    if (CHK.every(x => !x.res) && (!CHK.length || confirm("¿Cargar la lista de verificación estándar de este tipo?")))
    { CHK = (PLANTILLAS[$("pfTipo").value] || []).map(i => ({ item: i, res: "" })); pintarChecklist(); }
  });
  $("pfAddItem").addEventListener("click", () => { CHK.push({ item: "", res: "" }); pintarChecklist(); });
  $("pfChecklist").addEventListener("input", (e) => { if (e.target.dataset.ci != null) CHK[e.target.dataset.ci].item = e.target.value; });
  $("pfChecklist").addEventListener("change", (e) => { if (e.target.dataset.cr != null) { CHK[e.target.dataset.cr].res = e.target.value; actualizarResumenChk(); } });
  $("pfChecklist").addEventListener("click", (e) => { const b = e.target.closest("button[data-cd]"); if (b) { CHK.splice(Number(b.dataset.cd), 1); pintarChecklist(); } });
  ["prFEstado", "prFTipo", "prFFrente"].forEach(id => $(id).addEventListener("change", renderProtocolos));
  $("prBuscar").addEventListener("input", renderProtocolos);
  $("prTabla").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const p = PROT.find(x => x.id === (b.dataset.pe || b.dataset.pp || b.dataset.pf || b.dataset.pd));
    if (b.dataset.pe) abrirProt(p);
    if (b.dataset.pp) imprimirProt(p);
    if (b.dataset.pf) verFotos(`${cod("PC", p.numero)} — ${p.titulo}`, p.fotos, null, "Fotos del protocolo");
    if (b.dataset.pd && confirm("¿Borrar este protocolo?")) {
      const { error } = await supabaseClient.from("cal_protocolos").delete().eq("id", p.id);
      if (error) alert(error.message); else await cargar();
    }
  });
  $("prCSV").addEventListener("click", () => descargarCSV("protocolos_calidad.csv", ["Código", "Tipo", "Título", "Frente", "Ubicación", "Fecha", "Inspector", "Estado", "Conformes", "No conformes", "Observaciones"],
    protFiltrados().map(p => { const r = resChk(p); return [cod("PC", p.numero), p.tipo, p.titulo, p.frente, p.ubicacion, fd(p.fecha_inspeccion), p.inspector, p.estado, r.c, r.nc, p.observaciones]; })));

  // No conformidades
  $("ncNuevo").addEventListener("click", () => abrirNC(null));
  $("ncCancelar").addEventListener("click", () => $("ncForm").style.display = "none");
  $("ncForm").addEventListener("submit", guardarNC);
  ligarFotos("nc", "nfFotosIn", "nfFotosAct", "nfFotosCnt"); ligarFotos("ncc", "nfFotosCieIn", "nfFotosCieAct", "nfFotosCieCnt");
  $("nfFrente").addEventListener("change", () => llenarPartidas("nfPartida", $("nfFrente").value));
  ["ncFEstado", "ncFSev"].forEach(id => $(id).addEventListener("change", renderNC));
  $("ncBuscar").addEventListener("input", renderNC);
  $("ncTabla").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const n = NC.find(x => x.id === (b.dataset.ne || b.dataset.nf || b.dataset.nd));
    if (b.dataset.ne) abrirNC(n);
    if (b.dataset.nf) verFotos(`${cod("NC", n.numero)} — ${n.descripcion.slice(0, 80)}`, n.fotos, n.fotos_cierre || [], "No conformidad");
    if (b.dataset.nd && confirm("¿Borrar esta no conformidad?")) {
      const { error } = await supabaseClient.from("cal_nc").delete().eq("id", n.id);
      if (error) alert(error.message); else await cargar();
    }
  });
  $("ncCSV").addEventListener("click", () => descargarCSV("no_conformidades.csv", ["Código", "Severidad", "Descripción", "Frente", "Causa", "Acción correctiva", "Acción preventiva", "Responsable", "Detección", "Compromiso", "Cierre", "Estado", "Costo estimado (S/)"],
    ncFiltradas().map(n => [cod("NC", n.numero), n.severidad, n.descripcion, n.frente, n.causa, n.accion_correctiva, n.accion_preventiva, n.responsable, fd(n.fecha_deteccion), fd(n.fecha_compromiso), fd(n.fecha_cierre), n.estado, n.costo_estimado])));

  // Ensayos
  $("enNuevo").addEventListener("click", () => abrirEns(null));
  $("enCancelar").addEventListener("click", () => $("enForm").style.display = "none");
  $("enForm").addEventListener("submit", guardarEns);
  $("efFrente").addEventListener("change", () => llenarPartidas("efPartida", $("efFrente").value));
  $("efTipo").addEventListener("change", () => {
    const d = DEF_ENS[$("efTipo").value]; if (!d || EDIT_ENS) return;
    $("efCrit").value = d.crit; if (!$("efUnd").value || Object.values(DEF_ENS).some(v => v.und === $("efUnd").value)) $("efUnd").value = d.und;
    mostrarResEns();
  });
  ["efCrit", "efEsp", "efObt"].forEach(id => $(id).addEventListener("input", mostrarResEns));
  ["enFRes", "enFTipo"].forEach(id => $(id).addEventListener("change", renderEnsayos));
  $("enBuscar").addEventListener("input", renderEnsayos);
  $("enTabla").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const x = ENS.find(r => r.id === (b.dataset.ee || b.dataset.ea || b.dataset.ed));
    if (b.dataset.ee) abrirEns(x);
    if (b.dataset.ea) { const u = await FotosObra.url(x.archivo_path); if (u) window.open(u, "_blank"); else alert("No se pudo abrir el archivo."); }
    if (b.dataset.ed && confirm("¿Borrar este ensayo?")) {
      const { error } = await supabaseClient.from("cal_ensayos").delete().eq("id", x.id);
      if (error) alert(error.message); else await cargar();
    }
  });
  $("enCSV").addEventListener("click", () => descargarCSV("pruebas_y_ensayos.csv", ["Código", "Tipo", "Elemento", "Frente", "Fecha de muestra", "Edad (d)", "Fecha de ensayo", "Laboratorio", "Criterio", "Especificado", "Unidad", "Obtenido", "Resultado", "Observaciones"],
    ensFiltrados().map(x => [cod("EN", x.numero), x.tipo, x.descripcion, x.frente, fd(x.fecha_muestra), x.edad_dias, fd(x.fecha_ensayo), x.laboratorio, x.criterio === "max" ? "máximo" : "mínimo", x.especificado, x.unidad, x.obtenido, x.resultado, x.observaciones])));
}
