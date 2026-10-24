// =========================================================
// Módulo Logística: procura de materiales y cierres de subcontratas
// =========================================================
let U = null, PERFIL = null, PROYECTOS = [], PID = null;
let PARTIDAS = [], PAQ = [], COT = [];
let EDIT = null, COT_PAQ = null;

const ESTADOS = ["Por solicitar", "En cotización", "Adjudicado", "Orden / Contrato", "Cerrado", "Anulado"];
const ABIERTOS = ["Por solicitar", "En cotización"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fd = (iso) => iso ? iso.split("-").reverse().join("/") : "";
const dias = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const sumarDias = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const soles = (n) => n == null || n === "" ? "" : Number(n).toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const puedeEditar = () => ["admin", "planner", "logistica"].includes(PERFIL.rol);
const puedeBorrar = () => ["admin", "planner"].includes(PERFIL.rol);
const num = (id) => { const v = $(id).value.trim(); return v === "" ? null : Number(v); };
const txt = (id) => $(id).value.trim() || null;

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
  if (!["admin", "planner", "logistica", "viewer"].includes(PERFIL.rol)) { window.location.href = "modulos.html"; return; }
  $("userName").textContent = PERFIL.nombre_completo || U.email;
  $("userRole").textContent = "(" + PERFIL.rol + ")";
  if (PERFIL.rol !== "logistica") $("backLink").style.display = "";
  $("logoutBtn").addEventListener("click", async () => { await supabaseClient.auth.signOut(); window.location.href = "index.html"; });

  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    $("view-" + b.dataset.view).classList.add("active");
  }));

  $("pfEstado").innerHTML = ESTADOS.map(e => `<option>${e}</option>`).join("");
  $("pkFEstado").innerHTML = `<option value="abiertos">Por gestionar</option><option value="todos">Todos los estados</option>` + ESTADOS.map(e => `<option>${e}</option>`).join("");
  if (!puedeEditar()) $("pkNuevo").style.display = "none";
  enlazarEventos();

  const { data: proys } = await supabaseClient.from("proyectos").select("*").order("created_at");
  PROYECTOS = proys || [];
  $("lgProyecto").innerHTML = PROYECTOS.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
  $("lgProyecto").addEventListener("change", cargar);
  if (PROYECTOS.length) await cargar();
})();

async function cargar() {
  PID = $("lgProyecto").value;
  if (!PID) return;
  const [pa, pk] = await Promise.all([
    fetchAll(() => supabaseClient.from("partidas").select("id,frente,nombre,orden,presupuesto_total,fecha_inicio_base").eq("proyecto_id", PID).order("orden")),
    fetchAll(() => supabaseClient.from("lg_paquetes").select("*").eq("proyecto_id", PID).order("numero")),
  ]);
  PARTIDAS = pa; PAQ = pk;
  const ids = PAQ.map(p => p.id);
  COT = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseClient.from("lg_cotizaciones").select("*").in("paquete_id", ids.slice(i, i + 100)).order("monto");
    COT = COT.concat(data || []);
  }
  COT_PAQ = null; $("cotCard").style.display = "none";
  [renderTablero, renderPaquetes].forEach(fn => { try { fn(); } catch (e) { console.error(fn.name, e); } });
}

const frentes = () => [...new Set(PARTIDAS.map(p => p.frente))];
const partidaPorId = (id) => PARTIDAS.find(p => p.id === id);

// Alerta de un paquete: { nivel: "late"|"warn"|"", texto, limite }
function alertaDe(p) {
  const hoy = hoyISO();
  if (p.estado === "Anulado" || p.estado === "Cerrado") return { nivel: "", texto: "", limite: null };
  if (ABIERTOS.includes(p.estado)) {
    if (!p.fecha_necesaria) return { nivel: "", texto: "", limite: null };
    const limite = sumarDias(p.fecha_necesaria, -(p.plazo_dias || 0));
    const d = dias(hoy, limite);
    if (d < 0) return { nivel: "late", texto: `Vencido hace ${-d} d`, limite };
    if (d <= 14) return { nivel: "warn", texto: d === 0 ? "Vence hoy" : `Vence en ${d} d`, limite };
    return { nivel: "", texto: "", limite };
  }
  // Adjudicado u orden emitida: ¿llega a tiempo?
  if (p.fecha_necesaria && p.fecha_entrega_prevista && p.fecha_entrega_prevista > p.fecha_necesaria)
    return { nivel: "late", texto: `Llega ${dias(p.fecha_necesaria, p.fecha_entrega_prevista)} d tarde`, limite: null };
  if (p.fecha_necesaria && !p.fecha_entrega_prevista && p.fecha_necesaria < hoy)
    return { nivel: "late", texto: `Necesario hace ${dias(p.fecha_necesaria, hoy)} d`, limite: null };
  return { nivel: "", texto: "", limite: null };
}

// ---------------- Tablero ----------------
function renderTablero() {
  const act = PAQ.filter(p => p.estado !== "Anulado");
  const alertas = act.map(p => ({ p, a: alertaDe(p) })).filter(x => x.a.nivel);
  const comprometidos = act.filter(p => ["Adjudicado", "Orden / Contrato", "Cerrado"].includes(p.estado));
  const comp = comprometidos.reduce((s, p) => s + (Number(p.monto_comprometido) || 0), 0);
  const pptoAdj = comprometidos.reduce((s, p) => s + (Number(p.presupuesto_ref) || 0), 0);
  const dif = pptoAdj - comp;
  const tile = (l, v, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}">${v}</div></div>`;
  $("lgStats").innerHTML =
    tile("Paquetes", act.length) +
    tile("Por gestionar", act.filter(p => ABIERTOS.includes(p.estado)).length) +
    tile("Vencidos / por vencer", alertas.length, alertas.some(x => x.a.nivel === "late") ? "bad" : "") +
    tile("Cerrados", act.filter(p => p.estado === "Cerrado").length) +
    tile("Comprometido (S/)", soles(comp)) +
    tile("Ahorro / sobrecosto (S/)", (dif >= 0 ? "+" : "−") + soles(Math.abs(dif)), dif >= 0 ? "good" : "bad");

  alertas.sort((x, y) => (x.a.limite || "9999").localeCompare(y.a.limite || "9999"));
  $("lgTabAlertas").querySelector("tbody").innerHTML = alertas.map(({ p, a }) =>
    `<tr><td>${p.numero}</td><td>${p.tipo}</td><td>${esc(p.nombre)}</td><td>${esc(p.frente)}</td><td>${p.estado}</td><td>${fd(p.fecha_necesaria)}</td><td>${fd(a.limite)}</td><td><span class="badge ${a.nivel}">${a.texto}</span></td><td>${esc(p.responsable)}</td></tr>`).join("")
    || `<tr><td colspan="9" style="color:var(--text-muted);">No hay alertas.</td></tr>`;

  const fr = [...new Set(act.map(p => p.frente || "Sin frente"))].sort();
  $("lgTabFrente").querySelector("tbody").innerHTML = fr.map(f => {
    const l = act.filter(p => (p.frente || "Sin frente") === f);
    const adj = l.filter(p => ["Adjudicado", "Orden / Contrato", "Cerrado"].includes(p.estado));
    const pp = adj.reduce((s, p) => s + (Number(p.presupuesto_ref) || 0), 0);
    const cc = adj.reduce((s, p) => s + (Number(p.monto_comprometido) || 0), 0);
    const d = pp - cc;
    const cer = l.filter(p => p.estado === "Cerrado").length;
    return `<tr><td>${esc(f)}</td><td class="num">${l.length}</td><td class="num">${soles(pp)}</td><td class="num">${soles(cc)}</td><td class="num" style="color:${d < 0 ? "var(--red)" : "inherit"};">${adj.length ? (d >= 0 ? "" : "−") + soles(Math.abs(d)) : ""}</td><td><div class="bar-h"><i style="width:${Math.round(cer / l.length * 100)}%"></i></div></td></tr>`;
  }).join("") || `<tr><td colspan="6" style="color:var(--text-muted);">Aún no hay paquetes.</td></tr>`;

  $("lgTabEstado").querySelector("tbody").innerHTML = ESTADOS.map(e => {
    const m = PAQ.filter(p => p.estado === e && p.tipo === "Material").length, s = PAQ.filter(p => p.estado === e && p.tipo === "Subcontrata").length;
    return `<tr><td>${e}</td><td class="num">${m}</td><td class="num">${s}</td><td class="num">${m + s}</td></tr>`;
  }).join("");
}

// ---------------- Paquetes ----------------
function paqFiltrados() {
  const ft = $("pkFTipo").value, fe = $("pkFEstado").value, ff = $("pkFFrente").value, q = $("pkBuscar").value.trim().toLowerCase();
  return PAQ.filter(p => {
    if (ft && p.tipo !== ft) return false;
    if (fe === "abiertos" ? !ABIERTOS.includes(p.estado) : (fe !== "todos" && p.estado !== fe)) return false;
    if (ff && p.frente !== ff) return false;
    if (q && ![p.nombre, p.proveedor, p.responsable, p.frente].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderPaquetes() {
  const selF = $("pkFFrente").value;
  $("pkFFrente").innerHTML = `<option value="">Todos los frentes</option>` + [...new Set(PAQ.map(p => p.frente).filter(Boolean))].sort().map(f => `<option>${esc(f)}</option>`).join("");
  $("pkFFrente").value = selF;
  $("lgRespList").innerHTML = [...new Set(PAQ.map(p => p.responsable).filter(Boolean))].map(r => `<option value="${esc(r)}">`).join("");
  const nCot = (id) => COT.filter(c => c.paquete_id === id).length;
  $("pkTabla").querySelector("tbody").innerHTML = paqFiltrados().map(p => {
    const a = alertaDe(p);
    const cls = p.estado === "Cerrado" ? "ok" : p.estado === "Anulado" ? "" : ABIERTOS.includes(p.estado) ? "late" : "warn";
    return `<tr><td>${p.numero}</td><td>${p.tipo}</td><td style="min-width:200px;">${esc(p.nombre)}</td><td>${esc(p.frente)}</td><td><span class="badge ${cls}">${p.estado}</span></td><td class="num">${soles(p.presupuesto_ref)}</td><td class="num">${soles(p.monto_comprometido)}</td><td>${esc(p.proveedor)}</td><td>${fd(p.fecha_necesaria)}</td><td>${a.nivel ? `<span class="badge ${a.nivel}">${a.texto}</span>` : ""}</td><td style="white-space:nowrap;"><button class="btn secondary mini" data-cot="${p.id}">Ofertas (${nCot(p.id)})</button> ${puedeEditar() ? `<button class="btn secondary mini" data-ed="${p.id}">Editar</button> ` : ""}${puedeBorrar() ? `<button class="btn secondary mini" data-del="${p.id}">Borrar</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="11" style="color:var(--text-muted);">No hay paquetes con este filtro.</td></tr>`;
}

function llenarPartidas(frente, sel) {
  const l = PARTIDAS.filter(p => !frente || p.frente === frente);
  $("pfPartida").innerHTML = `<option value="">— ninguna —</option>` + l.map(p => `<option value="${p.id}">${esc(p.nombre.slice(0, 80))}</option>`).join("");
  if (sel) $("pfPartida").value = sel;
}

function abrir(p) {
  EDIT = p || null;
  $("pkFormTitulo").textContent = p ? "Editar paquete N° " + p.numero : "Nuevo paquete";
  $("pfFrente").innerHTML = `<option value="">— sin frente —</option>` + frentes().map(f => `<option>${esc(f)}</option>`).join("");
  $("pfTipo").value = p ? p.tipo : "Material";
  $("pfNombre").value = p ? p.nombre : "";
  $("pfFrente").value = p ? (p.frente || "") : "";
  llenarPartidas($("pfFrente").value, p && p.partida_id);
  $("pfResp").value = p ? (p.responsable || "") : "";
  $("pfEstado").value = p ? p.estado : "Por solicitar";
  $("pfPpto").value = p && p.presupuesto_ref != null ? p.presupuesto_ref : "";
  $("pfPlazo").value = p && p.plazo_dias != null ? p.plazo_dias : "";
  $("pfFReq").value = p ? (p.fecha_requerimiento || "") : hoyISO();
  $("pfFNec").value = p ? (p.fecha_necesaria || "") : "";
  $("pfFAdj").value = p ? (p.fecha_adjudicacion || "") : "";
  $("pfFPrev").value = p ? (p.fecha_entrega_prevista || "") : "";
  $("pfFCierre").value = p ? (p.fecha_cierre || "") : "";
  $("pfProv").value = p ? (p.proveedor || "") : "";
  $("pfMonto").value = p && p.monto_comprometido != null ? p.monto_comprometido : "";
  $("pfObs").value = p ? (p.observaciones || "") : "";
  $("pkMsg").textContent = "";
  $("pkForm").style.display = "";
  $("pkForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function guardar(e) {
  e.preventDefault();
  const estado = $("pfEstado").value;
  const fila = {
    proyecto_id: PID, tipo: $("pfTipo").value, nombre: $("pfNombre").value.trim(), frente: txt("pfFrente"),
    partida_id: $("pfPartida").value || null, responsable: txt("pfResp"), estado,
    presupuesto_ref: num("pfPpto"), plazo_dias: num("pfPlazo"), fecha_requerimiento: txt("pfFReq"), fecha_necesaria: txt("pfFNec"),
    fecha_adjudicacion: txt("pfFAdj") || (["Adjudicado", "Orden / Contrato", "Cerrado"].includes(estado) ? hoyISO() : null),
    fecha_entrega_prevista: txt("pfFPrev"), fecha_cierre: txt("pfFCierre") || (estado === "Cerrado" ? hoyISO() : null),
    proveedor: txt("pfProv"), monto_comprometido: num("pfMonto"), observaciones: txt("pfObs"),
  };
  const q = EDIT ? supabaseClient.from("lg_paquetes").update(fila).eq("id", EDIT.id) : supabaseClient.from("lg_paquetes").insert(fila);
  const { error } = await q;
  if (error) { $("pkMsg").textContent = "No se pudo guardar: " + error.message; return; }
  $("pkForm").style.display = "none";
  await cargar();
}

// ---------------- Cotizaciones ----------------
function abrirCot(id) {
  COT_PAQ = PAQ.find(p => p.id === id);
  if (!COT_PAQ) return;
  $("cotCard").style.display = "";
  $("cotTitulo").textContent = `Cuadro comparativo — N° ${COT_PAQ.numero} ${COT_PAQ.nombre}`;
  $("cotRef").textContent = COT_PAQ.presupuesto_ref != null ? `Presupuesto de referencia: S/ ${soles(COT_PAQ.presupuesto_ref)}` : "Este paquete no tiene presupuesto de referencia.";
  $("cotForm").style.display = puedeEditar() ? "" : "none";
  $("cotMsg").textContent = "";
  renderCot();
  $("cotCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderCot() {
  if (!COT_PAQ) return;
  const l = COT.filter(c => c.paquete_id === COT_PAQ.id).sort((a, b) => a.monto - b.monto);
  const ref = Number(COT_PAQ.presupuesto_ref) || 0;
  $("cotTabla").querySelector("tbody").innerHTML = l.map((c, i) => {
    const d = ref ? (c.monto - ref) / ref * 100 : null;
    const sel = c.seleccionada;
    return `<tr${sel ? ' style="background:#eaf6ee;"' : ""}><td>${esc(c.proveedor)}${i === 0 ? ' <span class="badge ok">Menor oferta</span>' : ""}${sel ? ' <span class="badge ok">Adjudicada</span>' : ""}</td><td class="num">${soles(c.monto)}</td><td class="num" style="color:${d > 0 ? "var(--red)" : "var(--green)"};">${d == null ? "" : (d > 0 ? "+" : "") + d.toFixed(1) + " %"}</td><td class="num">${c.plazo_dias ?? ""}</td><td>${esc(c.condiciones)}</td><td style="white-space:nowrap;">${puedeEditar() && !sel ? `<button class="btn secondary mini" data-adj="${c.id}">Adjudicar</button> ` : ""}${puedeBorrar() ? `<button class="btn secondary mini" data-cdel="${c.id}">Borrar</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="6" style="color:var(--text-muted);">Aún no hay ofertas registradas.</td></tr>`;
}

async function agregarCot(e) {
  e.preventDefault();
  const fila = { paquete_id: COT_PAQ.id, proveedor: $("cfProv").value.trim(), monto: Number($("cfMonto").value), plazo_dias: num("cfPlazo"), condiciones: txt("cfCond") };
  const { error } = await supabaseClient.from("lg_cotizaciones").insert(fila);
  if (error) { $("cotMsg").textContent = "No se pudo guardar: " + error.message; return; }
  const id = COT_PAQ.id;
  $("cotForm").reset();
  if (COT_PAQ.estado === "Por solicitar") await supabaseClient.from("lg_paquetes").update({ estado: "En cotización" }).eq("id", id);
  await cargar(); abrirCot(id);
}

async function adjudicar(cid) {
  const c = COT.find(x => x.id === cid);
  if (!c || !confirm(`¿Adjudicar a ${c.proveedor} por S/ ${soles(c.monto)}? Se actualiza el paquete con proveedor, monto y plazo.`)) return;
  const id = c.paquete_id;
  await supabaseClient.from("lg_cotizaciones").update({ seleccionada: false }).eq("paquete_id", id);
  await supabaseClient.from("lg_cotizaciones").update({ seleccionada: true }).eq("id", cid);
  const p = PAQ.find(x => x.id === id);
  const upd = { proveedor: c.proveedor, monto_comprometido: c.monto, fecha_adjudicacion: hoyISO() };
  if (c.plazo_dias != null) upd.plazo_dias = c.plazo_dias;
  if (c.plazo_dias != null) upd.fecha_entrega_prevista = sumarDias(hoyISO(), c.plazo_dias);
  if (ABIERTOS.includes(p.estado)) upd.estado = "Adjudicado";
  const { error } = await supabaseClient.from("lg_paquetes").update(upd).eq("id", id);
  if (error) { alert("No se pudo adjudicar: " + error.message); return; }
  await cargar(); abrirCot(id);
}

// ---------------- CSV y eventos ----------------
function descargarCSV(nombre, cabecera, filas) {
  const celda = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const t = "﻿" + [cabecera, ...filas].map(f => f.map(celda).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([t], { type: "text/csv;charset=utf-8" }));
  a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function enlazarEventos() {
  $("pkNuevo").addEventListener("click", () => abrir(null));
  $("pkCancelar").addEventListener("click", () => $("pkForm").style.display = "none");
  $("pkForm").addEventListener("submit", guardar);
  $("pfFrente").addEventListener("change", () => llenarPartidas($("pfFrente").value));
  $("pfPartida").addEventListener("change", () => {
    const p = partidaPorId($("pfPartida").value);
    if (!p) return;
    if (!$("pfFrente").value) { $("pfFrente").value = p.frente; }
    if (!$("pfFNec").value && p.fecha_inicio_base) $("pfFNec").value = p.fecha_inicio_base;
    if (!$("pfPpto").value && p.presupuesto_total) $("pfPpto").value = p.presupuesto_total;
  });
  ["pkFTipo", "pkFEstado", "pkFFrente"].forEach(id => $(id).addEventListener("change", renderPaquetes));
  $("pkBuscar").addEventListener("input", renderPaquetes);
  $("pkTabla").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.cot) abrirCot(b.dataset.cot);
    if (b.dataset.ed) abrir(PAQ.find(p => p.id === b.dataset.ed));
    if (b.dataset.del && confirm("¿Borrar este paquete y sus ofertas?")) {
      const { error } = await supabaseClient.from("lg_paquetes").delete().eq("id", b.dataset.del);
      if (error) alert(error.message); else await cargar();
    }
  });
  $("cotForm").addEventListener("submit", agregarCot);
  $("cotCerrar").addEventListener("click", () => { COT_PAQ = null; $("cotCard").style.display = "none"; });
  $("cotTabla").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.adj) await adjudicar(b.dataset.adj);
    if (b.dataset.cdel && confirm("¿Borrar esta oferta?")) {
      const id = COT_PAQ.id;
      const { error } = await supabaseClient.from("lg_cotizaciones").delete().eq("id", b.dataset.cdel);
      if (error) alert(error.message); else { await cargar(); abrirCot(id); }
    }
  });
  $("pkCSV").addEventListener("click", () => descargarCSV("logistica_paquetes.csv",
    ["N°", "Tipo", "Paquete", "Frente", "Responsable", "Estado", "Presupuesto ref.", "Comprometido", "Proveedor", "Plazo (d)", "Requerimiento", "Necesario", "Adjudicación", "Entrega prevista", "Cierre", "Alerta", "Observaciones"],
    paqFiltrados().map(p => [p.numero, p.tipo, p.nombre, p.frente, p.responsable, p.estado, p.presupuesto_ref, p.monto_comprometido, p.proveedor, p.plazo_dias, fd(p.fecha_requerimiento), fd(p.fecha_necesaria), fd(p.fecha_adjudicacion), fd(p.fecha_entrega_prevista), fd(p.fecha_cierre), alertaDe(p).texto, p.observaciones])));
}
