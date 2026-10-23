// =========================================================
// Módulo Post Venta
// =========================================================
let U = null, PERFIL = null, PROYECTOS = [], PID = null;
let UNIDADES = [], OBS = [], GARS = [];
let EDIT_OBS = null, EDIT_UNI = null;

const ESPECIALIDADES = ["Arquitectura", "Estructuras", "Sanitarias", "Eléctricas", "Mecánicas / HVAC", "Gas", "Carpintería", "Acabados", "Áreas comunes", "Otros"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fd = (iso) => iso ? iso.split("-").reverse().join("/") : "";
const dias = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const puedeEditar = () => ["admin", "planner", "postventa"].includes(PERFIL.rol);
const puedeBorrar = () => ["admin", "planner"].includes(PERFIL.rol);
const unidadPorId = (id) => UNIDADES.find(u => u.id === id);

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

function sumarMeses(iso, m) {
  const d = new Date(iso + "T00:00:00");
  const dia = d.getDate();
  d.setMonth(d.getMonth() + m);
  if (d.getDate() !== dia) d.setDate(0); // fin de mes
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "index.html"; return; }
  U = session.user;
  const { data: perfil } = await supabaseClient.from("perfiles").select("*").eq("id", U.id).single();
  PERFIL = perfil || { rol: "residente", nombre_completo: U.email };
  if (!["admin", "planner", "postventa", "viewer"].includes(PERFIL.rol)) { window.location.href = "modulos.html"; return; }
  $("userName").textContent = PERFIL.nombre_completo || U.email;
  $("userRole").textContent = "(" + PERFIL.rol + ")";
  if (PERFIL.rol !== "postventa") $("backLink").style.display = "";
  $("logoutBtn").addEventListener("click", async () => { await supabaseClient.auth.signOut(); window.location.href = "index.html"; });

  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    $("view-" + b.dataset.view).classList.add("active");
  }));

  // selects estáticos
  const optEsp = ESPECIALIDADES.map(e => `<option>${e}</option>`).join("");
  $("ofEsp").innerHTML = optEsp;
  $("gfEsp").innerHTML = optEsp;
  $("obsFEsp").innerHTML = `<option value="">Todas las especialidades</option>` + optEsp;

  if (!puedeEditar()) ["obsNueva", "uniNueva", "uniImportar", "garNueva"].forEach(id => $(id).style.display = "none");

  enlazarEventos();

  const { data: proys } = await supabaseClient.from("proyectos").select("*").order("created_at");
  PROYECTOS = proys || [];
  $("pvProyecto").innerHTML = PROYECTOS.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
  $("pvProyecto").addEventListener("change", cargar);
  if (PROYECTOS.length) await cargar();
})();

async function cargar() {
  PID = $("pvProyecto").value;
  const [u, o, g] = await Promise.all([
    fetchAll(() => supabaseClient.from("pv_unidades").select("*").eq("proyecto_id", PID).order("codigo")),
    fetchAll(() => supabaseClient.from("pv_observaciones").select("*").eq("proyecto_id", PID).order("numero")),
    fetchAll(() => supabaseClient.from("pv_garantias").select("*").eq("proyecto_id", PID).order("fecha_inicio")),
  ]);
  UNIDADES = u; OBS = o; GARS = g;
  renderTodo();
}

function renderTodo() {
  const render = [renderTablero, renderObs, renderUnidades, renderGarantias];
  render.forEach(fn => { try { fn(); } catch (e) { console.error(fn.name, e); } });
}

function estadoAlerta(o) {
  if (o.estado === "Cerrada" || o.estado === "Rechazada") return "";
  if (o.fecha_compromiso && o.fecha_compromiso < hoyISO()) return "late";
  return "";
}
const abierta = (o) => o.estado === "Abierta" || o.estado === "En proceso";

// ---------------- Tablero ----------------
function renderTablero() {
  const hoy = hoyISO();
  const pend = OBS.filter(abierta);
  const venc = pend.filter(o => o.fecha_compromiso && o.fecha_compromiso < hoy);
  const cerradas = OBS.filter(o => o.estado === "Cerrada");
  const entregadas = UNIDADES.filter(u => u.estado_entrega === "Entregada").length;
  const tiempos = cerradas.filter(o => o.fecha_reporte && o.fecha_cierre).map(o => dias(o.fecha_reporte, o.fecha_cierre));
  const prom = tiempos.length ? (tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : null;
  const pct = OBS.length ? Math.round(cerradas.length / OBS.length * 100) : 0;
  const tile = (l, v, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}">${v}</div></div>`;
  $("pvStats").innerHTML =
    tile("Unidades", UNIDADES.length) +
    tile("Entregadas", `${entregadas} / ${UNIDADES.length}`) +
    tile("Observaciones totales", OBS.length) +
    tile("Pendientes", pend.length) +
    tile("Vencidas", venc.length, venc.length ? "bad" : "good") +
    tile("% cerradas", pct + "%", pct >= 80 ? "good" : "") +
    tile("Tiempo prom. de cierre", prom === null ? "—" : Math.round(prom) + " d");

  const esps = [...new Set(OBS.map(o => o.especialidad || "Sin especialidad"))].sort();
  $("pvTabEsp").querySelector("tbody").innerHTML = esps.map(e => {
    const l = OBS.filter(o => (o.especialidad || "Sin especialidad") === e);
    const c = l.filter(o => o.estado === "Cerrada").length;
    const p = Math.round(c / l.length * 100);
    return `<tr><td>${esc(e)}</td><td style="text-align:right;">${l.length}</td><td style="text-align:right;">${l.filter(abierta).length}</td><td style="text-align:right;">${c}</td><td><div class="bar-h"><i style="width:${p}%"></i></div></td></tr>`;
  }).join("") || `<tr><td colspan="5" style="color:var(--text-muted);">Sin observaciones.</td></tr>`;

  const resps = [...new Set(pend.map(o => o.responsable || "Sin asignar"))].sort();
  $("pvTabResp").querySelector("tbody").innerHTML = resps.map(r => {
    const l = pend.filter(o => (o.responsable || "Sin asignar") === r);
    const v = l.filter(o => o.fecha_compromiso && o.fecha_compromiso < hoy).length;
    const ant = l.filter(o => o.fecha_reporte).map(o => dias(o.fecha_reporte, hoy));
    const a = ant.length ? Math.round(ant.reduce((x, y) => x + y, 0) / ant.length) : "—";
    return `<tr><td>${esc(r)}</td><td style="text-align:right;">${l.length}</td><td style="text-align:right; ${v ? "color:var(--red);font-weight:600;" : ""}">${v}</td><td style="text-align:right;">${a}</td></tr>`;
  }).join("") || `<tr><td colspan="4" style="color:var(--text-muted);">No hay pendientes.</td></tr>`;

  const porVencer = GARS.map(g => ({ g, v: sumarMeses(g.fecha_inicio, g.plazo_meses) }))
    .map(x => ({ ...x, d: dias(hoy, x.v) })).filter(x => x.d >= 0 && x.d <= 90).sort((a, b) => a.d - b.d);
  $("pvTabGarVenc").querySelector("tbody").innerHTML = porVencer.map(x =>
    `<tr><td>${esc(nombreUnidad(x.g.unidad_id))}</td><td>${esc(x.g.especialidad)}</td><td>${fd(x.v)}</td><td style="text-align:right;">${x.d}</td></tr>`).join("")
    || `<tr><td colspan="4" style="color:var(--text-muted);">Ninguna garantía vence en los próximos 90 días.</td></tr>`;
}

function nombreUnidad(id) { const u = unidadPorId(id); return u ? u.codigo : (id ? "—" : "General"); }

// ---------------- Observaciones ----------------
function obsFiltradas() {
  const fe = $("obsFEstado").value, esp = $("obsFEsp").value, q = $("obsBuscar").value.trim().toLowerCase();
  return OBS.filter(o => {
    if (fe === "abiertas" ? !abierta(o) : (fe !== "todas" && o.estado !== fe)) return false;
    if (esp && o.especialidad !== esp) return false;
    if (q) {
      const u = unidadPorId(o.unidad_id);
      const t = [u && u.codigo, u && u.cliente, o.descripcion, o.ambiente, o.responsable, o.especialidad].join(" ").toLowerCase();
      if (!t.includes(q)) return false;
    }
    return true;
  });
}

function renderObs() {
  const optU = `<option value="">— sin unidad —</option>` + UNIDADES.map(u => `<option value="${u.id}">${esc(u.codigo)}${u.cliente ? " · " + esc(u.cliente) : ""}</option>`).join("");
  const sel = $("ofUnidad").value;
  $("ofUnidad").innerHTML = optU; $("ofUnidad").value = sel;
  $("pvRespList").innerHTML = [...new Set(OBS.map(o => o.responsable).filter(Boolean))].map(r => `<option value="${esc(r)}">`).join("");
  const rows = obsFiltradas();
  const hoy = hoyISO();
  $("obsTabla").querySelector("tbody").innerHTML = rows.map(o => {
    const u = unidadPorId(o.unidad_id);
    const al = estadoAlerta(o);
    const cls = o.estado === "Cerrada" ? "ok" : o.estado === "Rechazada" ? "" : o.estado === "En proceso" ? "warn" : "late";
    const prio = o.prioridad === "Alta" ? ` style="color:var(--red);font-weight:600;"` : "";
    return `<tr><td>${o.numero}</td><td>${esc(u ? u.codigo : "—")}</td><td>${esc(u ? u.cliente : "")}</td><td>${esc(o.especialidad)}</td><td>${esc(o.ambiente)}</td><td style="min-width:220px;">${esc(o.descripcion)}</td><td${prio}>${o.prioridad}</td><td>${esc(o.responsable)}</td><td>${fd(o.fecha_reporte)}</td><td>${fd(o.fecha_compromiso)}</td><td><span class="badge ${cls}">${o.estado}</span></td><td>${al ? `<span class="badge late">Vencida ${dias(o.fecha_compromiso, hoy)} d</span>` : ""}</td><td style="white-space:nowrap;">${puedeEditar() ? `<button class="btn secondary mini" data-oe="${o.id}">Editar</button> ` : ""}${puedeBorrar() ? `<button class="btn secondary mini" data-od="${o.id}">Borrar</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="13" style="color:var(--text-muted);">No hay observaciones con este filtro.</td></tr>`;
}

function abrirObs(o) {
  EDIT_OBS = o || null;
  $("obsFormTitulo").textContent = o ? "Editar observación N° " + o.numero : "Nueva observación";
  $("ofUnidad").value = o ? (o.unidad_id || "") : "";
  $("ofEsp").value = o ? (o.especialidad || ESPECIALIDADES[0]) : ESPECIALIDADES[0];
  $("ofAmb").value = o ? (o.ambiente || "") : "";
  $("ofPrio").value = o ? o.prioridad : "Media";
  $("ofDesc").value = o ? o.descripcion : "";
  $("ofResp").value = o ? (o.responsable || "") : "";
  $("ofEstado").value = o ? o.estado : "Abierta";
  $("ofFRep").value = o ? (o.fecha_reporte || "") : hoyISO();
  $("ofFComp").value = o ? (o.fecha_compromiso || "") : "";
  $("ofFCierre").value = o ? (o.fecha_cierre || "") : "";
  $("ofCom").value = o ? (o.comentarios || "") : "";
  $("obsMsg").textContent = "";
  $("obsForm").style.display = "";
  $("obsForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function guardarObs(e) {
  e.preventDefault();
  const v = (id) => $(id).value.trim() || null;
  const estado = $("ofEstado").value;
  const fila = {
    proyecto_id: PID, unidad_id: $("ofUnidad").value || null, especialidad: $("ofEsp").value, ambiente: v("ofAmb"),
    descripcion: $("ofDesc").value.trim(), prioridad: $("ofPrio").value, responsable: v("ofResp"), estado,
    fecha_reporte: v("ofFRep"), fecha_compromiso: v("ofFComp"), comentarios: v("ofCom"),
    fecha_cierre: v("ofFCierre") || (estado === "Cerrada" ? hoyISO() : null),
  };
  const q = EDIT_OBS ? supabaseClient.from("pv_observaciones").update(fila).eq("id", EDIT_OBS.id) : supabaseClient.from("pv_observaciones").insert(fila);
  const { error } = await q;
  if (error) { $("obsMsg").textContent = "No se pudo guardar: " + error.message; return; }
  $("obsForm").style.display = "none";
  await cargar();
}

// ---------------- Unidades ----------------
function renderUnidades() {
  const fe = $("uniFEstado").value, q = $("uniBuscar").value.trim().toLowerCase();
  const rows = UNIDADES.filter(u => (fe === "todas" || u.estado_entrega === fe) &&
    (!q || [u.codigo, u.cliente, u.tipo, u.piso].join(" ").toLowerCase().includes(q)));
  $("uniTabla").querySelector("tbody").innerHTML = rows.map(u => {
    const n = OBS.filter(o => o.unidad_id === u.id && abierta(o)).length;
    const cls = u.estado_entrega === "Entregada" ? "ok" : u.estado_entrega === "Programada" ? "warn" : "";
    const cont = [u.telefono, u.correo].filter(Boolean).map(esc).join("<br>");
    const f = u.estado_entrega === "Entregada" ? fd(u.fecha_entrega) : fd(u.fecha_programada);
    return `<tr><td><b>${esc(u.codigo)}</b></td><td>${esc(u.tipo)}</td><td>${esc(u.piso)}</td><td>${esc(u.cliente)}</td><td>${cont}</td><td><span class="badge ${cls}">${u.estado_entrega}</span></td><td>${f}</td><td style="text-align:right;">${n}</td><td style="white-space:nowrap;">${puedeEditar() ? `<button class="btn secondary mini" data-ue="${u.id}">Editar</button> ` : ""}${puedeBorrar() ? `<button class="btn secondary mini" data-ud="${u.id}">Borrar</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="9" style="color:var(--text-muted);">No hay unidades registradas.</td></tr>`;
}

function abrirUni(u) {
  EDIT_UNI = u || null;
  $("uniFormTitulo").textContent = u ? "Editar unidad " + u.codigo : "Nueva unidad";
  const set = (id, k) => $(id).value = u ? (u[k] || "") : "";
  set("ufCodigo", "codigo"); set("ufTipo", "tipo"); set("ufPiso", "piso"); set("ufCliente", "cliente");
  set("ufTel", "telefono"); set("ufMail", "correo"); set("ufFProg", "fecha_programada"); set("ufFEnt", "fecha_entrega");
  set("ufRecibe", "recibido_por"); set("ufActa", "observaciones_acta");
  $("ufEstado").value = u ? u.estado_entrega : "Pendiente";
  $("uniMsg").textContent = "";
  $("uniForm").style.display = "";
  $("uniForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function guardarUni(e) {
  e.preventDefault();
  const v = (id) => $(id).value.trim() || null;
  const estado = $("ufEstado").value;
  const fila = {
    proyecto_id: PID, codigo: $("ufCodigo").value.trim(), tipo: v("ufTipo"), piso: v("ufPiso"), cliente: v("ufCliente"),
    telefono: v("ufTel"), correo: v("ufMail"), estado_entrega: estado, fecha_programada: v("ufFProg"),
    fecha_entrega: v("ufFEnt") || (estado === "Entregada" ? hoyISO() : null), recibido_por: v("ufRecibe"), observaciones_acta: v("ufActa"),
  };
  const q = EDIT_UNI ? supabaseClient.from("pv_unidades").update(fila).eq("id", EDIT_UNI.id) : supabaseClient.from("pv_unidades").insert(fila);
  const { error } = await q;
  if (error) { $("uniMsg").textContent = error.message.includes("duplicate") ? "Ya existe una unidad con ese código en este proyecto." : "No se pudo guardar: " + error.message; return; }
  $("uniForm").style.display = "none";
  await cargar();
}

async function importarUnidades() {
  const lineas = $("uniImpTxt").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const filas = lineas.map(l => l.split("\t")).filter(c => c[0] && c[0].trim()).map(c => ({
    proyecto_id: PID, codigo: c[0].trim(), tipo: (c[1] || "").trim() || null, piso: (c[2] || "").trim() || null,
    cliente: (c[3] || "").trim() || null, telefono: (c[4] || "").trim() || null, correo: (c[5] || "").trim() || null,
  }));
  if (!filas.length) { alert("No hay filas para importar. Pega desde Excel (columnas separadas por tabulación)."); return; }
  const existentes = new Set(UNIDADES.map(u => u.codigo.toLowerCase()));
  const nuevas = filas.filter(f => !existentes.has(f.codigo.toLowerCase()));
  if (!nuevas.length) { alert("Todas esas unidades ya existen."); return; }
  const { error } = await supabaseClient.from("pv_unidades").insert(nuevas);
  if (error) { alert("No se pudo importar: " + error.message); return; }
  alert(`Se importaron ${nuevas.length} unidades` + (filas.length > nuevas.length ? ` (${filas.length - nuevas.length} ya existían).` : "."));
  $("uniImpTxt").value = ""; $("uniImpBox").style.display = "none";
  await cargar();
}

// ---------------- Garantías ----------------
function garantiasCalc() {
  const hoy = hoyISO();
  return GARS.map(g => {
    const vence = sumarMeses(g.fecha_inicio, g.plazo_meses);
    const d = dias(hoy, vence);
    return { ...g, vence, d, estado: d < 0 ? "Vencida" : d <= 90 ? "Por vencer" : "Vigente" };
  }).sort((a, b) => a.vence.localeCompare(b.vence));
}

function renderGarantias() {
  const optU = `<option value="">— General del proyecto —</option>` + UNIDADES.map(u => `<option value="${u.id}">${esc(u.codigo)}${u.cliente ? " · " + esc(u.cliente) : ""}</option>`).join("");
  const sel = $("gfUnidad").value; $("gfUnidad").innerHTML = optU; $("gfUnidad").value = sel;
  const fe = $("garFEstado").value;
  const rows = garantiasCalc().filter(g => fe === "todas" || g.estado === fe);
  $("garTabla").querySelector("tbody").innerHTML = rows.map(g => {
    const cls = g.estado === "Vencida" ? "late" : g.estado === "Por vencer" ? "warn" : "ok";
    const txt = g.estado === "Vigente" ? `Vigente (${g.d} d)` : g.estado === "Por vencer" ? `Por vencer (${g.d} d)` : `Vencida hace ${-g.d} d`;
    return `<tr><td>${esc(nombreUnidad(g.unidad_id))}</td><td>${esc(g.especialidad)}${g.descripcion ? `<br><span style="color:var(--text-muted);font-size:11.5px;">${esc(g.descripcion)}</span>` : ""}</td><td>${esc(g.proveedor)}</td><td>${fd(g.fecha_inicio)}</td><td style="text-align:right;">${g.plazo_meses}</td><td>${fd(g.vence)}</td><td><span class="badge ${cls}">${txt}</span></td><td>${puedeBorrar() ? `<button class="btn secondary mini" data-gd="${g.id}">Borrar</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="8" style="color:var(--text-muted);">No hay garantías registradas.</td></tr>`;
}

async function guardarGar(e) {
  e.preventDefault();
  const fila = {
    proyecto_id: PID, unidad_id: $("gfUnidad").value || null, especialidad: $("gfEsp").value,
    proveedor: $("gfProv").value.trim() || null, descripcion: $("gfDesc").value.trim() || null,
    fecha_inicio: $("gfIni").value, plazo_meses: parseInt($("gfPlazo").value, 10),
  };
  const { error } = await supabaseClient.from("pv_garantias").insert(fila);
  if (error) { $("garMsg").textContent = "No se pudo guardar: " + error.message; return; }
  $("garForm").style.display = "none";
  await cargar();
}

// ---------------- CSV ----------------
function descargarCSV(nombre, cabecera, filas) {
  const celda = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const txt = "﻿" + [cabecera, ...filas].map(f => f.map(celda).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
  a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------- Eventos ----------------
function enlazarEventos() {
  $("obsNueva").addEventListener("click", () => abrirObs(null));
  $("obsCancelar").addEventListener("click", () => $("obsForm").style.display = "none");
  $("obsForm").addEventListener("submit", guardarObs);
  ["obsFEstado", "obsFEsp"].forEach(id => $(id).addEventListener("change", renderObs));
  $("obsBuscar").addEventListener("input", renderObs);
  $("obsTabla").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.oe) abrirObs(OBS.find(o => o.id === b.dataset.oe));
    if (b.dataset.od && confirm("¿Borrar esta observación?")) {
      const { error } = await supabaseClient.from("pv_observaciones").delete().eq("id", b.dataset.od);
      if (error) alert(error.message); else await cargar();
    }
  });
  $("obsCSV").addEventListener("click", () => descargarCSV("observaciones_postventa.csv",
    ["N°", "Unidad", "Cliente", "Especialidad", "Ambiente", "Descripción", "Prioridad", "Responsable", "Reporte", "Compromiso", "Cierre", "Estado", "Comentarios"],
    obsFiltradas().map(o => { const u = unidadPorId(o.unidad_id) || {}; return [o.numero, u.codigo, u.cliente, o.especialidad, o.ambiente, o.descripcion, o.prioridad, o.responsable, fd(o.fecha_reporte), fd(o.fecha_compromiso), fd(o.fecha_cierre), o.estado, o.comentarios]; })));

  $("uniNueva").addEventListener("click", () => abrirUni(null));
  $("uniCancelar").addEventListener("click", () => $("uniForm").style.display = "none");
  $("uniForm").addEventListener("submit", guardarUni);
  $("uniFEstado").addEventListener("change", renderUnidades);
  $("uniBuscar").addEventListener("input", renderUnidades);
  $("uniImportar").addEventListener("click", () => $("uniImpBox").style.display = "");
  $("uniImpNo").addEventListener("click", () => $("uniImpBox").style.display = "none");
  $("uniImpOk").addEventListener("click", importarUnidades);
  $("uniTabla").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ue) abrirUni(unidadPorId(b.dataset.ue));
    if (b.dataset.ud && confirm("¿Borrar la unidad? Sus garantías se borran y sus observaciones quedan sin unidad.")) {
      const { error } = await supabaseClient.from("pv_unidades").delete().eq("id", b.dataset.ud);
      if (error) alert(error.message); else await cargar();
    }
  });
  $("uniCSV").addEventListener("click", () => descargarCSV("unidades_postventa.csv",
    ["Unidad", "Tipo", "Piso", "Cliente", "Teléfono", "Correo", "Estado entrega", "F. programada", "F. entrega", "Recibido por", "Obs. acta"],
    UNIDADES.map(u => [u.codigo, u.tipo, u.piso, u.cliente, u.telefono, u.correo, u.estado_entrega, fd(u.fecha_programada), fd(u.fecha_entrega), u.recibido_por, u.observaciones_acta])));

  $("garNueva").addEventListener("click", () => {
    $("garForm").reset(); $("garMsg").textContent = ""; $("garForm").style.display = "";
    $("garForm").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("garCancelar").addEventListener("click", () => $("garForm").style.display = "none");
  $("garForm").addEventListener("submit", guardarGar);
  $("gfUnidad").addEventListener("change", () => {
    const u = unidadPorId($("gfUnidad").value);
    if (u && u.fecha_entrega && !$("gfIni").value) $("gfIni").value = u.fecha_entrega;
  });
  $("garFEstado").addEventListener("change", renderGarantias);
  $("garTabla").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-gd]"); if (!b) return;
    if (confirm("¿Borrar esta garantía?")) {
      const { error } = await supabaseClient.from("pv_garantias").delete().eq("id", b.dataset.gd);
      if (error) alert(error.message); else await cargar();
    }
  });
  $("garCSV").addEventListener("click", () => descargarCSV("garantias_postventa.csv",
    ["Unidad", "Especialidad", "Proveedor", "Inicio", "Plazo (meses)", "Vence", "Estado"],
    garantiasCalc().map(g => [nombreUnidad(g.unidad_id), g.especialidad, g.proveedor, fd(g.fecha_inicio), g.plazo_meses, fd(g.vence), g.estado])));
}
