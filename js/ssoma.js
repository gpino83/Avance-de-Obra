// =========================================================
// Módulo SSOMA: seguridad, salud ocupacional y medio ambiente
// Inspecciones, charlas, incidentes, permisos y documentos, personal, EPP,
// medio ambiente y horas-hombre (índices de seguridad).
// =========================================================
let U = null, PERFIL = null, PROYECTOS = [], PID = null, PARTIDAS = [], HH = [];
const D = {};                 // datos por entidad: D.insp, D.cha, ...
const EDIT = {};              // fila en edición por entidad
const FOTOS = {};             // fotos por campo: { keep: [], pend: [] }
const ARCH = {};              // archivo adjunto actual por campo

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fd = (iso) => iso ? iso.split("-").reverse().join("/") : "";
const dias = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const puedeEditar = () => ["admin", "planner", "residente", "ssoma"].includes(PERFIL.rol);
const puedeBorrar = () => ["admin", "planner"].includes(PERFIL.rol);
const cod = (pre, n) => pre + "-" + String(n).padStart(3, "0");
const fmt = (n, d = 0) => n == null || n === "" || isNaN(n) ? "" : Number(n).toLocaleString("es-PE", { minimumFractionDigits: d, maximumFractionDigits: d });
const frentes = () => [...new Set(PARTIDAS.map(p => p.frente))];
const badge = (cls, t) => `<span class="badge ${cls}">${t}</span>`;
const mesDe = (iso) => (iso || "").slice(0, 7);
const INCAP = ["Accidente con tiempo perdido", "Accidente fatal"];

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

// vigencia de un documento del personal: badge y nivel
function vig(fecha) {
  if (!fecha) return { h: badge("warn", "Sin dato"), nivel: "warn", txt: "Sin fecha" };
  const d = dias(hoyISO(), fecha);
  if (d < 0) return { h: badge("late", "Vencido " + fd(fecha)), nivel: "late", txt: `Vencido hace ${-d} d` };
  if (d <= 30) return { h: badge("warn", "Vence " + fd(fecha)), nivel: "warn", txt: `Vence en ${d} d` };
  return { h: fd(fecha), nivel: "", txt: "" };
}
const permisoEstado = (r) => r.estado === "Vigente" && r.fecha_vencimiento && r.fecha_vencimiento < hoyISO() ? "Vencido" : r.estado;
const nombrePers = (id) => { const p = (D.pers || []).find(x => x.id === id); return p ? p.nombre : ""; };
const asistTotal = (r) => (r.asistentes || []).length + (Number(r.asistentes_extra) || 0);
const RIESGO_CLS = { "Crítico": "late", "Alto": "late", "Medio": "warn", "Bajo": "ok" };

// =========================================================
// Definición de las entidades (cada una genera su pestaña, formulario y tabla)
// =========================================================
const ENT = [
  {
    k: "insp", tabla: "ss_inspecciones", pref: "OB", tab: "Inspecciones", titulo: "Inspecciones y observaciones de seguridad", nuevo: "+ Nueva observación", carpeta: "inspecciones",
    campos: [
      { k: "fecha", l: "Fecha", t: "date", def: hoyISO },
      { k: "tipo", l: "Tipo", t: "select", op: ["Acto subestándar", "Condición subestándar", "Inspección planificada", "Observación positiva"], def: "Condición subestándar" },
      { k: "riesgo", l: "Nivel de riesgo", t: "select", op: ["Bajo", "Medio", "Alto", "Crítico"], def: "Medio" },
      { k: "descripcion", l: "Descripción", t: "text", req: 1, full: 1 },
      { k: "frente", l: "Frente", t: "frente" }, { k: "ubicacion", l: "Ubicación", t: "text" },
      { k: "inspector", l: "Inspector", t: "text", def: () => PERFIL.nombre_completo || "" }, { k: "responsable", l: "Responsable de la corrección", t: "text" },
      { k: "estado", l: "Estado", t: "select", op: ["Abierta", "En proceso", "Cerrada"], def: "Abierta" },
      { k: "accion_correctiva", l: "Acción correctiva", t: "text", full: 1 },
      { k: "fecha_compromiso", l: "Fecha compromiso", t: "date" }, { k: "fecha_cierre", l: "Fecha de cierre", t: "date" },
      { k: "fotos", l: "Fotos de la observación", t: "fotos", full: 1 }, { k: "fotos_cierre", l: "Fotos del cierre (evidencia)", t: "fotos", full: 1 },
    ],
    cols: [
      { l: "Código", h: r => cod("OB", r.numero) }, { l: "Fecha", h: r => fd(r.fecha) }, { l: "Tipo", h: r => esc(r.tipo) },
      { l: "Descripción", h: r => `<span style="min-width:220px;display:inline-block;">${esc(r.descripcion)}</span>` }, { l: "Frente", h: r => esc(r.frente) },
      { l: "Riesgo", h: r => badge(RIESGO_CLS[r.riesgo] || "", r.riesgo) }, { l: "Responsable", h: r => esc(r.responsable) },
      { l: "Compromiso", h: r => fd(r.fecha_compromiso) }, { l: "Estado", h: r => badge(r.estado === "Cerrada" ? "ok" : r.estado === "En proceso" ? "warn" : "late", r.estado) },
      { l: "Alerta", h: r => insAbierta(r) && r.fecha_compromiso && r.fecha_compromiso < hoyISO() ? badge("late", `Vencida ${dias(r.fecha_compromiso, hoyISO())} d`) : "" },
    ],
    filtros: [
      { id: "estado", ops: [["abiertas", "Abiertas"], ["todas", "Todas"], ["Abierta", "Abierta"], ["En proceso", "En proceso"], ["Cerrada", "Cerrada"]], f: (r, v) => v === "abiertas" ? insAbierta(r) : v === "todas" || r.estado === v },
      { id: "riesgo", ops: [["", "Todos los riesgos"], ["Crítico", "Crítico"], ["Alto", "Alto"], ["Medio", "Medio"], ["Bajo", "Bajo"]], f: (r, v) => !v || r.riesgo === v },
    ],
    pre: (r) => { if (r.estado === "Cerrada" && !r.fecha_cierre) r.fecha_cierre = hoyISO(); },
    sort: (a, b) => b.numero - a.numero,
  },
  {
    k: "cha", tabla: "ss_charlas", pref: "CH", tab: "Charlas y capacitaciones", titulo: "Charlas y capacitaciones", nuevo: "+ Nueva charla", carpeta: "charlas",
    campos: [
      { k: "fecha", l: "Fecha", t: "date", def: hoyISO },
      { k: "tipo", l: "Tipo", t: "select", op: ["Charla de 5 minutos", "Inducción", "Capacitación", "Simulacro", "Charla semanal de seguridad", "Otro"], def: "Charla de 5 minutos" },
      { k: "tema", l: "Tema", t: "text", req: 1, full: 1 }, { k: "expositor", l: "Expositor", t: "text", def: () => PERFIL.nombre_completo || "" },
      { k: "duracion_min", l: "Duración (minutos)", t: "number", def: 5 },
      { k: "asistentes", l: "Asistentes registrados (del módulo Personal)", t: "asist", full: 1 },
      { k: "asistentes_extra", l: "Otros asistentes no registrados (cantidad)", t: "number", nn: 0 },
      { k: "observaciones", l: "Observaciones", t: "text", full: 1 }, { k: "fotos", l: "Fotos / registro", t: "fotos", full: 1 },
    ],
    cols: [
      { l: "Código", h: r => cod("CH", r.numero) }, { l: "Fecha", h: r => fd(r.fecha) }, { l: "Tipo", h: r => esc(r.tipo) }, { l: "Tema", h: r => `<span style="min-width:220px;display:inline-block;">${esc(r.tema)}</span>` },
      { l: "Expositor", h: r => esc(r.expositor) }, { l: "Duración (min)", h: r => r.duracion_min ?? "", cls: "num" }, { l: "Asistentes", h: r => asistTotal(r), cls: "num" },
      { l: "HH capacitación", h: r => fmt(horasCharla(r), 1), cls: "num" },
    ],
    filtros: [{ id: "tipo", ops: [["", "Todos los tipos"], ["Charla de 5 minutos", "Charla de 5 minutos"], ["Inducción", "Inducción"], ["Capacitación", "Capacitación"], ["Simulacro", "Simulacro"]], f: (r, v) => !v || r.tipo === v }],
    sort: (a, b) => b.numero - a.numero,
  },
  {
    k: "inc", tabla: "ss_incidentes", pref: "AC", tab: "Incidentes y accidentes", titulo: "Incidentes y accidentes", nuevo: "+ Nuevo incidente", carpeta: "incidentes",
    campos: [
      { k: "fecha", l: "Fecha", t: "date", def: hoyISO },
      { k: "tipo", l: "Tipo", t: "select", op: ["Casi accidente", "Incidente", "Accidente sin tiempo perdido", "Accidente con tiempo perdido", "Accidente fatal", "Daño a la propiedad", "Incidente ambiental"], def: "Incidente" },
      { k: "estado", l: "Estado", t: "select", op: ["Reportado", "En investigación", "Cerrado"], def: "Reportado" },
      { k: "descripcion", l: "Descripción de lo ocurrido", t: "text", req: 1, full: 1 },
      { k: "frente", l: "Frente", t: "frente" }, { k: "ubicacion", l: "Lugar", t: "text" },
      { k: "afectado", l: "Persona afectada", t: "text" }, { k: "empresa", l: "Empresa del afectado", t: "text" }, { k: "parte_cuerpo", l: "Parte del cuerpo", t: "text" },
      { k: "dias_perdidos", l: "Días perdidos (accidente con tiempo perdido)", t: "number", nn: 0 },
      { k: "causa_inmediata", l: "Causa inmediata", t: "text", full: 1 }, { k: "causa_raiz", l: "Causa raíz", t: "text", full: 1 }, { k: "acciones", l: "Acciones correctivas", t: "text", full: 1 },
      { k: "responsable", l: "Responsable del seguimiento", t: "text" }, { k: "fecha_compromiso", l: "Fecha compromiso", t: "date" },
      { k: "fotos", l: "Fotos", t: "fotos", full: 1 },
    ],
    cols: [
      { l: "Código", h: r => cod("AC", r.numero) }, { l: "Fecha", h: r => fd(r.fecha) },
      { l: "Tipo", h: r => `<span${INCAP.includes(r.tipo) ? ' style="color:var(--red);font-weight:600;"' : ""}>${esc(r.tipo)}</span>` },
      { l: "Descripción", h: r => `<span style="min-width:220px;display:inline-block;">${esc(r.descripcion)}</span>` }, { l: "Afectado", h: r => esc(r.afectado) },
      { l: "Días perdidos", h: r => r.dias_perdidos || 0, cls: "num" }, { l: "Estado", h: r => badge(r.estado === "Cerrado" ? "ok" : r.estado === "En investigación" ? "warn" : "late", r.estado) },
      { l: "Alerta", h: r => r.estado !== "Cerrado" && dias(r.fecha, hoyISO()) > 7 ? badge("warn", `Abierto hace ${dias(r.fecha, hoyISO())} d`) : "" },
    ],
    filtros: [
      { id: "estado", ops: [["abiertos", "Sin cerrar"], ["todos", "Todos"], ["Reportado", "Reportado"], ["En investigación", "En investigación"], ["Cerrado", "Cerrado"]], f: (r, v) => v === "abiertos" ? r.estado !== "Cerrado" : v === "todos" || r.estado === v },
      { id: "tipo", ops: [["", "Todos los tipos"], ["Casi accidente", "Casi accidente"], ["Incidente", "Incidente"], ["Accidente sin tiempo perdido", "Accidente sin tiempo perdido"], ["Accidente con tiempo perdido", "Accidente con tiempo perdido"], ["Accidente fatal", "Accidente fatal"], ["Daño a la propiedad", "Daño a la propiedad"], ["Incidente ambiental", "Incidente ambiental"]], f: (r, v) => !v || r.tipo === v },
    ],
    sort: (a, b) => b.numero - a.numero,
  },
  {
    k: "per", tabla: "ss_permisos", pref: "PE", tab: "Permisos y documentos", titulo: "Permisos de trabajo y documentos de seguridad", nuevo: "+ Nuevo permiso / documento", carpeta: "permisos",
    campos: [
      { k: "tipo", l: "Tipo", t: "select", op: ["IPERC", "ATS (análisis de trabajo seguro)", "PETAR trabajo en altura", "PETAR trabajos en caliente", "PETAR espacios confinados", "PETAR excavaciones", "PETAR izaje de cargas", "Plan de seguridad", "Otro"], def: "ATS (análisis de trabajo seguro)" },
      { k: "descripcion", l: "Trabajo, actividad o documento", t: "text", req: 1, full: 1 },
      { k: "frente", l: "Frente", t: "frente" }, { k: "ubicacion", l: "Ubicación", t: "text" }, { k: "responsable", l: "Responsable", t: "text" },
      { k: "fecha_emision", l: "Fecha de emisión", t: "date", def: hoyISO }, { k: "fecha_vencimiento", l: "Fecha de vencimiento", t: "date" },
      { k: "estado", l: "Estado", t: "select", op: ["Vigente", "Cerrado", "Anulado"], def: "Vigente" },
      { k: "archivo_path", l: "Documento escaneado (PDF o imagen)", t: "archivo", k2: "archivo_nombre", full: 1 },
      { k: "observaciones", l: "Observaciones", t: "text", full: 1 },
    ],
    cols: [
      { l: "Código", h: r => cod("PE", r.numero) }, { l: "Tipo", h: r => esc(r.tipo) }, { l: "Trabajo / documento", h: r => `<span style="min-width:220px;display:inline-block;">${esc(r.descripcion)}</span>` },
      { l: "Frente", h: r => esc(r.frente) }, { l: "Responsable", h: r => esc(r.responsable) }, { l: "Emisión", h: r => fd(r.fecha_emision) }, { l: "Vencimiento", h: r => fd(r.fecha_vencimiento) },
      { l: "Estado", h: r => { const e = permisoEstado(r); return badge(e === "Vigente" ? "ok" : e === "Vencido" ? "late" : "", e); } },
      { l: "Archivo", h: r => r.archivo_path ? `<button class="btn secondary mini" data-arch="${r.id}">Ver</button>` : "" },
    ],
    filtros: [
      { id: "estado", ops: [["todos", "Todos"], ["vigentes", "Vigentes"], ["Vencido", "Vencidos"], ["Cerrado", "Cerrados"], ["Anulado", "Anulados"]], f: (r, v) => v === "vigentes" ? permisoEstado(r) === "Vigente" : v === "todos" || permisoEstado(r) === v },
      { id: "tipo", ops: [["", "Todos los tipos"], ["IPERC", "IPERC"], ["ATS (análisis de trabajo seguro)", "ATS"], ["PETAR trabajo en altura", "PETAR altura"], ["PETAR trabajos en caliente", "PETAR caliente"], ["PETAR espacios confinados", "PETAR espacios confinados"], ["PETAR excavaciones", "PETAR excavaciones"], ["PETAR izaje de cargas", "PETAR izaje"]], f: (r, v) => !v || r.tipo === v },
    ],
    sort: (a, b) => b.numero - a.numero,
  },
  {
    k: "pers", tabla: "ss_personal", pref: null, tab: "Personal", titulo: "Personal y vigencias", nuevo: "+ Nuevo trabajador", carpeta: "personal",
    campos: [
      { k: "nombre", l: "Nombre completo", t: "text", req: 1, full: 1 }, { k: "documento", l: "DNI / documento", t: "text" }, { k: "cargo", l: "Cargo", t: "text" },
      { k: "empresa", l: "Empresa (propia o subcontratista)", t: "text", list: "empresa" }, { k: "fecha_ingreso", l: "Fecha de ingreso", t: "date", def: hoyISO },
      { k: "induccion_fecha", l: "Inducción realizada el", t: "date" }, { k: "sctr_vence", l: "SCTR vigente hasta", t: "date" }, { k: "examen_medico_vence", l: "Examen médico vigente hasta", t: "date" },
      { k: "activo", l: "Estado", t: "bool", def: "true" }, { k: "observaciones", l: "Observaciones", t: "text", full: 1 },
    ],
    cols: [
      { l: "Nombre", h: r => esc(r.nombre) }, { l: "Documento", h: r => esc(r.documento) }, { l: "Cargo", h: r => esc(r.cargo) }, { l: "Empresa", h: r => esc(r.empresa) },
      { l: "Ingreso", h: r => fd(r.fecha_ingreso) }, { l: "Inducción", h: r => r.induccion_fecha ? fd(r.induccion_fecha) : badge("warn", "Pendiente") },
      { l: "SCTR", h: r => vig(r.sctr_vence).h }, { l: "Examen médico", h: r => vig(r.examen_medico_vence).h }, { l: "Estado", h: r => r.activo ? "Activo" : "Inactivo" },
    ],
    filtros: [
      { id: "estado", ops: [["activos", "Activos"], ["todos", "Todos"], ["inactivos", "Inactivos"]], f: (r, v) => v === "todos" || (v === "activos" ? r.activo : !r.activo) },
      { id: "vig", ops: [["", "Todas las vigencias"], ["alerta", "Con alertas (vencidas o por vencer)"]], f: (r, v) => !v || [vig(r.sctr_vence).nivel, vig(r.examen_medico_vence).nivel, r.induccion_fecha ? "" : "warn"].some(x => x) },
    ],
    sort: (a, b) => a.nombre.localeCompare(b.nombre),
  },
  {
    k: "epp", tabla: "ss_epp", pref: null, tab: "EPP", titulo: "Entrega de equipos de protección personal (EPP)", nuevo: "+ Nueva entrega de EPP", carpeta: "epp",
    campos: [
      { k: "personal_id", l: "Trabajador", t: "personal", req: 1 }, { k: "fecha_entrega", l: "Fecha de entrega", t: "date", def: hoyISO },
      { k: "item", l: "Equipo", t: "select", op: ["Casco", "Lentes de seguridad", "Guantes", "Botas de seguridad", "Arnés de seguridad", "Chaleco", "Protección auditiva", "Respirador", "Careta facial", "Ropa de trabajo", "Otro"], def: "Casco" },
      { k: "cantidad", l: "Cantidad", t: "number", nn: 1, def: 1 }, { k: "detalle", l: "Talla / marca / detalle", t: "text" },
      { k: "proxima_reposicion", l: "Próxima reposición", t: "date" }, { k: "observaciones", l: "Observaciones", t: "text", full: 1 },
    ],
    cols: [
      { l: "Fecha", h: r => fd(r.fecha_entrega) }, { l: "Trabajador", h: r => esc(nombrePers(r.personal_id)) }, { l: "Equipo", h: r => esc(r.item) }, { l: "Cant.", h: r => fmt(r.cantidad, 0), cls: "num" },
      { l: "Detalle", h: r => esc(r.detalle) }, { l: "Próxima reposición", h: r => r.proxima_reposicion ? vig(r.proxima_reposicion).h : "" }, { l: "Obs.", h: r => esc(r.observaciones) },
    ],
    filtros: [{ id: "item", ops: [["", "Todos los equipos"], ["Casco", "Casco"], ["Lentes de seguridad", "Lentes"], ["Guantes", "Guantes"], ["Botas de seguridad", "Botas"], ["Arnés de seguridad", "Arnés"], ["Chaleco", "Chaleco"], ["Protección auditiva", "Protección auditiva"], ["Respirador", "Respirador"]], f: (r, v) => !v || r.item === v }],
    txt: (r) => nombrePers(r.personal_id),
    sort: (a, b) => (b.fecha_entrega || "").localeCompare(a.fecha_entrega || ""),
  },
  {
    k: "amb", tabla: "ss_ambiente", pref: "MA", tab: "Medio ambiente", titulo: "Control ambiental", nuevo: "+ Nuevo registro ambiental", carpeta: "ambiente",
    campos: [
      { k: "fecha", l: "Fecha", t: "date", def: hoyISO },
      { k: "tipo", l: "Tipo", t: "select", op: ["Residuos sólidos no peligrosos", "Residuos peligrosos", "Escombros / desmonte", "Consumo de agua", "Consumo de energía", "Control de polvo", "Control de ruido", "Otro"], def: "Residuos sólidos no peligrosos" },
      { k: "descripcion", l: "Descripción", t: "text", req: 1, full: 1 },
      { k: "cantidad", l: "Cantidad", t: "number" }, { k: "unidad", l: "Unidad", t: "text", list: "unidad" },
      { k: "destino", l: "Disposición final / empresa (EO-RS, botadero)", t: "text" }, { k: "documento", l: "Manifiesto / guía / documento", t: "text" },
      { k: "observaciones", l: "Observaciones", t: "text", full: 1 }, { k: "fotos", l: "Fotos", t: "fotos", full: 1 },
    ],
    cols: [
      { l: "Código", h: r => cod("MA", r.numero) }, { l: "Fecha", h: r => fd(r.fecha) }, { l: "Tipo", h: r => esc(r.tipo) }, { l: "Descripción", h: r => `<span style="min-width:200px;display:inline-block;">${esc(r.descripcion)}</span>` },
      { l: "Cantidad", h: r => r.cantidad != null ? fmt(r.cantidad, 2) + " " + esc(r.unidad || "") : "", cls: "num" }, { l: "Disposición final", h: r => esc(r.destino) }, { l: "Documento", h: r => esc(r.documento) },
    ],
    filtros: [{ id: "tipo", ops: [["", "Todos los tipos"], ["Residuos sólidos no peligrosos", "Residuos no peligrosos"], ["Residuos peligrosos", "Residuos peligrosos"], ["Escombros / desmonte", "Escombros"], ["Consumo de agua", "Consumo de agua"], ["Consumo de energía", "Consumo de energía"], ["Control de polvo", "Polvo"], ["Control de ruido", "Ruido"]], f: (r, v) => !v || r.tipo === v }],
    resumen: true,
    sort: (a, b) => b.numero - a.numero,
  },
];
const insAbierta = (r) => r.estado !== "Cerrada";
const horasCharla = (r) => (Number(r.duracion_min) || 0) * asistTotal(r) / 60;
const entDe = (k) => ENT.find(e => e.k === k);
const fid = (e, c) => `${e.k}_${c.k}`;

// =========================================================
// Inicio
// =========================================================
(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "index.html"; return; }
  U = session.user;
  const { data: perfil } = await supabaseClient.from("perfiles").select("*").eq("id", U.id).single();
  PERFIL = perfil || { rol: "residente", nombre_completo: U.email };
  if (!["admin", "planner", "residente", "viewer", "ssoma"].includes(PERFIL.rol)) { window.location.href = "modulos.html"; return; }
  $("userName").textContent = PERFIL.nombre_completo || U.email;
  $("userRole").textContent = "(" + PERFIL.rol + ")";
  if (PERFIL.rol !== "ssoma") $("backLink").style.display = "";
  $("logoutBtn").addEventListener("click", async () => { await supabaseClient.auth.signOut(); window.location.href = "index.html"; });

  ENT.forEach(construirVista);
  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); $("view-" + b.dataset.view).classList.add("active");
  }));
  enlazarGlobal();

  const { data: proys } = await supabaseClient.from("proyectos").select("*").order("created_at");
  PROYECTOS = proys || [];
  $("ssProyecto").innerHTML = PROYECTOS.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
  $("ssProyecto").addEventListener("change", cargar);
  if (PROYECTOS.length) await cargar();
})();

async function cargar() {
  PID = $("ssProyecto").value;
  if (!PID) return;
  const lote = await Promise.all([
    fetchAll(() => supabaseClient.from("partidas").select("id,frente,orden").eq("proyecto_id", PID).order("orden")),
    fetchAll(() => supabaseClient.from("ss_hh").select("*").eq("proyecto_id", PID).order("periodo")),
    ...ENT.map(e => fetchAll(() => supabaseClient.from(e.tabla).select("*").eq("proyecto_id", PID))),
  ]);
  PARTIDAS = lote[0]; HH = lote[1];
  ENT.forEach((e, i) => { D[e.k] = (lote[i + 2] || []).slice().sort(e.sort); });
  [renderTablero, ...ENT.map(e => () => renderEnt(e))].forEach(fn => { try { fn(); } catch (err) { console.error(fn.name, err); } });
}

// =========================================================
// Motor genérico: pestaña, formulario y tabla de cada entidad
// =========================================================
function campoHtml(e, c) {
  const id = fid(e, c), full = c.full ? " full" : "";
  const w = (inner) => `<div class="field${full}"><label>${c.l}</label>${inner}</div>`;
  switch (c.t) {
    case "text": return w(`<input type="text" class="in" id="${id}"${c.req ? " required" : ""}${c.list ? ` list="dl-${c.list}"` : ""}>`);
    case "date": return w(`<input type="date" class="in" id="${id}">`);
    case "number": return w(`<input type="number" class="in" id="${id}" step="any" min="0"${c.req ? " required" : ""}>`);
    case "select": return w(`<select class="in" id="${id}">${c.op.map(o => `<option>${esc(o)}</option>`).join("")}</select>`);
    case "frente": case "personal": return w(`<select class="in" id="${id}"${c.req ? " required" : ""}></select>`);
    case "bool": return w(`<select class="in" id="${id}"><option value="true">Activo</option><option value="false">Inactivo</option></select>`);
    case "asist": return w(`<div class="chk-list" id="${id}"></div>`);
    case "fotos": return w(`<input type="file" id="${id}_in" accept="image/*" multiple><div class="save-hint" id="${id}_cnt"></div><div class="fotos-act" id="${id}_act"></div>`);
    case "archivo": return w(`<input type="file" id="${id}_in" accept=".pdf,image/*"><div class="save-hint" id="${id}_act"></div>`);
  }
  return "";
}

function construirVista(e) {
  const tabs = $("ssTabs");
  const b = document.createElement("button"); b.className = "tab-btn"; b.dataset.view = e.k; b.textContent = e.tab; tabs.appendChild(b);
  const sec = document.createElement("section"); sec.className = "view"; sec.id = "view-" + e.k;
  const filtros = e.filtros.map(f => `<select class="in" id="fl-${e.k}-${f.id}">${f.ops.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("")}</select>`).join("");
  sec.innerHTML = `
    <form class="card" id="f-${e.k}" style="display:none;">
      <h2 id="ft-${e.k}"></h2>
      <div class="grid-f">${e.campos.map(c => campoHtml(e, c)).join("")}
        <div class="field full" style="display:flex; gap:8px;"><button type="submit" class="btn">Guardar</button><button type="button" class="btn secondary" id="fc-${e.k}">Cancelar</button></div>
      </div>
      <div id="fm-${e.k}" style="color:var(--red); font-size:12.5px;"></div>
    </form>
    ${e.resumen ? `<div class="card"><h2>Resumen por tipo</h2><div style="overflow-x:auto;"><table class="data-table" id="rs-${e.k}"><thead><tr><th>Tipo</th><th>Unidad</th><th class="num">Total</th><th class="num">Registros</th></tr></thead><tbody></tbody></table></div></div>` : ""}
    <div class="card">
      <h2>${e.titulo}</h2>
      <div class="bar"><button class="btn" type="button" id="nv-${e.k}">${e.nuevo}</button>${filtros}
        <input type="text" class="in" id="bs-${e.k}" placeholder="Buscar..." style="flex:1; min-width:160px;"><button class="btn secondary" type="button" id="csv-${e.k}">Exportar a Excel (CSV)</button></div>
      <div style="overflow-x:auto;"><table class="data-table" id="t-${e.k}"><thead><tr>${e.cols.map(c => `<th${c.cls ? ` class="${c.cls}"` : ""}>${c.l}</th>`).join("")}${tieneFotos(e) ? "<th>Fotos</th>" : ""}<th></th></tr></thead><tbody></tbody></table></div>
    </div>`;
  $("ssMain").appendChild(sec);
  if (!puedeEditar()) $("nv-" + e.k).style.display = "none";
  if (!$("dl-empresa")) {
    const dl = (id, l) => `<datalist id="dl-${id}">${l.map(x => `<option>${x}</option>`).join("")}</datalist>`;
    document.body.insertAdjacentHTML("beforeend", dl("empresa", ["Propia"]) + dl("unidad", ["kg", "ton", "m3", "L", "kWh", "und"]));
  }
  // eventos de la entidad
  $("nv-" + e.k).addEventListener("click", () => abrir(e, null));
  $("fc-" + e.k).addEventListener("click", () => $("f-" + e.k).style.display = "none");
  $("f-" + e.k).addEventListener("submit", (ev) => guardar(ev, e));
  e.filtros.forEach(f => $(`fl-${e.k}-${f.id}`).addEventListener("change", () => renderEnt(e)));
  $("bs-" + e.k).addEventListener("input", () => renderEnt(e));
  e.campos.filter(c => c.t === "fotos").forEach(c => {
    const id = fid(e, c); FOTOS[id] = { keep: [], pend: [] };
    $(id + "_in").addEventListener("change", (ev) => { FOTOS[id].pend = FOTOS[id].pend.concat([...ev.target.files]); ev.target.value = ""; pintarFotos(id); });
  });
  $("t-" + e.k).addEventListener("click", (ev) => accionTabla(ev, e));
  $("csv-" + e.k).addEventListener("click", () => csvEnt(e));
}
const tieneFotos = (e) => e.campos.some(c => c.t === "fotos");

function filtradas(e) {
  const q = $("bs-" + e.k).value.trim().toLowerCase();
  return (D[e.k] || []).filter(r => {
    if (!e.filtros.every(f => f.f(r, $(`fl-${e.k}-${f.id}`).value))) return false;
    if (!q) return true;
    const t = Object.values(r).filter(v => typeof v === "string").join(" ") + " " + (e.txt ? e.txt(r) : "") + " " + (e.pref && r.numero ? cod(e.pref, r.numero) : "");
    return t.toLowerCase().includes(q);
  });
}

function renderEnt(e) {
  const rows = filtradas(e), hf = tieneFotos(e);
  const fotosKeys = e.campos.filter(c => c.t === "fotos").map(c => c.k);
  $("t-" + e.k).querySelector("tbody").innerHTML = rows.map(r => {
    const nf = fotosKeys.reduce((s, k) => s + (r[k] || []).length, 0);
    return `<tr>${e.cols.map(c => `<td${c.cls ? ` class="${c.cls}"` : ""}>${c.h(r)}</td>`).join("")}${hf ? `<td>${nf ? `<button class="btn secondary mini" data-f="${r.id}">📷 ${nf}</button>` : ""}</td>` : ""}<td style="white-space:nowrap;">${puedeEditar() ? `<button class="btn secondary mini" data-e="${r.id}">Editar</button> ` : ""}${puedeBorrar() ? `<button class="btn secondary mini" data-d="${r.id}">Borrar</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="${e.cols.length + (hf ? 2 : 1)}" style="color:var(--text-muted);">No hay registros con este filtro.</td></tr>`;
  if (e.resumen) {
    const m = new Map();
    (D[e.k] || []).forEach(r => { const k = r.tipo + "|" + (r.unidad || ""); const x = m.get(k) || { tipo: r.tipo, und: r.unidad || "", tot: 0, n: 0 }; x.tot += Number(r.cantidad) || 0; x.n++; m.set(k, x); });
    $("rs-" + e.k).querySelector("tbody").innerHTML = [...m.values()].sort((a, b) => a.tipo.localeCompare(b.tipo)).map(x => `<tr><td>${esc(x.tipo)}</td><td>${esc(x.und)}</td><td class="num">${fmt(x.tot, 2)}</td><td class="num">${x.n}</td></tr>`).join("") || `<tr><td colspan="4" style="color:var(--text-muted);">Sin registros.</td></tr>`;
  }
}

async function accionTabla(ev, e) {
  const b = ev.target.closest("button"); if (!b) return;
  const r = (D[e.k] || []).find(x => x.id === (b.dataset.e || b.dataset.d || b.dataset.f || b.dataset.arch));
  if (!r) return;
  if (b.dataset.e) abrir(e, r);
  if (b.dataset.f) {
    const fc = e.campos.filter(c => c.t === "fotos");
    verFotos(`${e.pref && r.numero ? cod(e.pref, r.numero) + " — " : ""}${(r.descripcion || r.tema || "").slice(0, 80)}`, r[fc[0].k], fc[1] ? r[fc[1].k] : null, fc[0].l);
  }
  if (b.dataset.arch) { const u = await FotosObra.url(r.archivo_path); if (u) window.open(u, "_blank"); else alert("No se pudo abrir el archivo."); }
  if (b.dataset.d && confirm("¿Borrar este registro?")) {
    const { error } = await supabaseClient.from(e.tabla).delete().eq("id", r.id);
    if (error) alert(error.message); else await cargar();
  }
}

function opcionesSel(c) {
  if (c.t === "frente") return `<option value="">— sin frente —</option>` + frentes().map(f => `<option>${esc(f)}</option>`).join("");
  return `<option value="">— elegir —</option>` + (D.pers || []).filter(p => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
}

function abrir(e, r) {
  EDIT[e.k] = r || null;
  $("ft-" + e.k).textContent = (r ? "Editar: " : "Nuevo registro — ") + e.titulo;
  for (const c of e.campos) {
    const id = fid(e, c), v = r ? r[c.k] : (typeof c.def === "function" ? c.def() : c.def);
    switch (c.t) {
      case "text": case "date": case "number": $(id).value = v ?? ""; break;
      case "select": $(id).value = v ?? c.op[0]; break;
      case "bool": $(id).value = r ? String(!!r.activo) : "true"; break;
      case "frente": case "personal": $(id).innerHTML = opcionesSel(c); $(id).value = v ?? ""; break;
      case "asist": {
        const sel = new Set(r ? (r.asistentes || []) : []);
        $(id).innerHTML = (D.pers || []).filter(p => p.activo || sel.has(p.nombre)).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(p => `<label><input type="checkbox" value="${esc(p.nombre)}"${sel.has(p.nombre) ? " checked" : ""}> ${esc(p.nombre)}</label>`).join("") || `<span class="save-hint">Aún no hay personal registrado en la pestaña Personal.</span>`;
        break;
      }
      case "fotos": FOTOS[id] = { keep: r ? (r[c.k] || []).slice() : [], pend: [] }; $(id + "_in").value = ""; pintarFotos(id); break;
      case "archivo": ARCH[id] = r && r[c.k] ? { path: r[c.k], nombre: r[c.k2] } : null; $(id + "_in").value = ""; $(id + "_act").textContent = ARCH[id] ? "Archivo actual: " + (ARCH[id].nombre || ARCH[id].path.split("/").pop()) : ""; break;
    }
  }
  $("fm-" + e.k).textContent = ""; $("f-" + e.k).style.display = "";
  $("f-" + e.k).scrollIntoView({ behavior: "smooth", block: "start" });
}

async function guardar(ev, e) {
  ev.preventDefault();
  const btn = $("f-" + e.k).querySelector('button[type="submit"]'), msg = $("fm-" + e.k);
  const fila = { proyecto_id: PID };
  try {
    btn.disabled = true;
    for (const c of e.campos) {
      const id = fid(e, c), el = $(id);
      switch (c.t) {
        case "text": case "date": fila[c.k] = el.value.trim() || null; break;
        case "number": { const v = el.value.trim(); fila[c.k] = v === "" ? (c.nn ?? null) : Number(v); break; }
        case "select": fila[c.k] = el.value; break;
        case "bool": fila[c.k] = el.value === "true"; break;
        case "frente": case "personal": fila[c.k] = el.value || null; break;
        case "asist": fila[c.k] = [...el.querySelectorAll("input:checked")].map(i => i.value); break;
        case "fotos": { const f = FOTOS[id]; if (f.pend.length) msg.textContent = "Subiendo fotos..."; fila[c.k] = f.keep.concat(f.pend.length ? await FotosObra.subir(f.pend, `${PID}/ssoma/${e.carpeta}`) : []); break; }
        case "archivo": {
          const f = $(id + "_in").files[0];
          if (f) { msg.textContent = "Subiendo documento..."; const path = await FotosObra.subirArchivo(f, `${PID}/ssoma/${e.carpeta}`); fila[c.k] = path; fila[c.k2] = f.name; }
          else { const a = ARCH[id]; fila[c.k] = a ? a.path : null; fila[c.k2] = a ? a.nombre : null; }
          break;
        }
      }
    }
  } catch (err) { btn.disabled = false; msg.textContent = "No se pudieron subir los archivos: " + (err.message || err); return; }
  if (e.pre) e.pre(fila);
  const q = EDIT[e.k] ? supabaseClient.from(e.tabla).update(fila).eq("id", EDIT[e.k].id) : supabaseClient.from(e.tabla).insert(fila);
  const { error } = await q;
  btn.disabled = false;
  if (error) { msg.textContent = "No se pudo guardar: " + error.message; return; }
  $("f-" + e.k).style.display = "none";
  await cargar();
}

// ---------------- fotos ----------------
async function pintarFotos(id) {
  const f = FOTOS[id];
  $(id + "_cnt").textContent = f.pend.length ? f.pend.length + " foto(s) por subir al guardar" : "";
  const el = $(id + "_act"); el.innerHTML = "";
  for (const ruta of f.keep) {
    const u = await FotosObra.url(ruta); if (!u) continue;
    const d = document.createElement("div"); d.className = "foto-th";
    d.innerHTML = `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="foto"></a><button type="button" title="Quitar" data-q="${id}" data-r="${esc(ruta)}">×</button>`;
    el.appendChild(d);
  }
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

// ---------------- CSV ----------------
function descargarCSV(nombre, cabecera, filas) {
  const celda = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const t = "﻿" + [cabecera, ...filas].map(f => f.map(celda).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([t], { type: "text/csv;charset=utf-8" }));
  a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function csvEnt(e) {
  const tmp = document.createElement("div");
  const plano = (h) => { tmp.innerHTML = h; return tmp.textContent.trim(); };
  descargarCSV(`ssoma_${e.k}.csv`, e.cols.map(c => c.l), filtradas(e).map(r => e.cols.map(c => plano(String(c.h(r))))));
}

// =========================================================
// Tablero, horas-hombre e índices
// =========================================================
function indices(acc, dp, hh) {
  if (!hh) return { f: null, s: null, a: null };
  const f = acc * 1e6 / hh, s = dp * 1e6 / hh;
  return { f, s, a: f * s / 1000 };
}
function accMes(mes) {
  const l = (D.inc || []).filter(r => INCAP.includes(r.tipo) && mesDe(r.fecha) === mes);
  return { n: l.length, dp: l.reduce((s, r) => s + (Number(r.dias_perdidos) || 0), 0) };
}

function renderTablero() {
  const hoy = hoyISO(), mes = hoy.slice(0, 7);
  const incap = (D.inc || []).filter(r => INCAP.includes(r.tipo));
  const hhT = HH.reduce((s, x) => s + Number(x.horas_hombre), 0);
  const dpT = incap.reduce((s, r) => s + (Number(r.dias_perdidos) || 0), 0);
  const ind = indices(incap.length, dpT, hhT);
  const ult = incap.reduce((m, r) => (!m || r.fecha > m) ? r.fecha : m, null);
  const obsAb = (D.insp || []).filter(insAbierta);
  const chaMes = (D.cha || []).filter(r => mesDe(r.fecha) === mes);
  const persAlerta = (D.pers || []).filter(p => p.activo && (vig(p.sctr_vence).nivel === "late" || vig(p.examen_medico_vence).nivel === "late")).length;
  const tile = (l, v, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}">${v}</div></div>`;
  $("ssStats").innerHTML =
    tile("Horas-hombre acumuladas", fmt(hhT)) + tile("Índice de frecuencia", ind.f == null ? "—" : fmt(ind.f, 2)) + tile("Índice de severidad", ind.s == null ? "—" : fmt(ind.s, 2)) +
    tile("Índice de accidentabilidad", ind.a == null ? "—" : fmt(ind.a, 2)) + tile("Días sin accidente con tiempo perdido", ult ? dias(ult, hoy) : "—", ult && dias(ult, hoy) < 30 ? "bad" : "good") +
    tile("Observaciones abiertas", obsAb.length, obsAb.length ? "bad" : "good") + tile("Incidentes del mes", (D.inc || []).filter(r => mesDe(r.fecha) === mes).length) +
    tile("Charlas del mes", chaMes.length) + tile("Personal con vigencias vencidas", persAlerta, persAlerta ? "bad" : "good");

  // alertas
  const al = [];
  (D.insp || []).filter(insAbierta).forEach(r => {
    const venc = r.fecha_compromiso && r.fecha_compromiso < hoy, alto = r.riesgo === "Alto" || r.riesgo === "Crítico";
    if (venc || alto) al.push({ area: "Inspección " + cod("OB", r.numero), det: r.descripcion, fecha: r.fecha_compromiso || r.fecha, nivel: "late", txt: venc ? `Vencida ${dias(r.fecha_compromiso, hoy)} d${alto ? " · riesgo " + r.riesgo.toLowerCase() : ""}` : "Riesgo " + r.riesgo.toLowerCase() + " abierto" });
  });
  (D.inc || []).filter(r => r.estado !== "Cerrado" && dias(r.fecha, hoy) > 7).forEach(r =>
    al.push({ area: "Incidente " + cod("AC", r.numero), det: `${r.tipo}: ${r.descripcion}`, fecha: r.fecha, nivel: INCAP.includes(r.tipo) ? "late" : "warn", txt: `Sin cerrar hace ${dias(r.fecha, hoy)} d` }));
  (D.per || []).forEach(r => {
    const e = permisoEstado(r);
    if (e === "Vencido") al.push({ area: "Permiso " + cod("PE", r.numero), det: `${r.tipo}: ${r.descripcion}`, fecha: r.fecha_vencimiento, nivel: "late", txt: `Vencido hace ${dias(r.fecha_vencimiento, hoy)} d` });
    else if (e === "Vigente" && r.fecha_vencimiento && dias(hoy, r.fecha_vencimiento) <= 7) al.push({ area: "Permiso " + cod("PE", r.numero), det: `${r.tipo}: ${r.descripcion}`, fecha: r.fecha_vencimiento, nivel: "warn", txt: `Vence en ${dias(hoy, r.fecha_vencimiento)} d` });
  });
  (D.pers || []).filter(p => p.activo).forEach(p => {
    [["SCTR", p.sctr_vence], ["Examen médico", p.examen_medico_vence]].forEach(([n, f]) => { const v = vig(f); if (v.nivel) al.push({ area: "Personal", det: `${p.nombre} — ${n}`, fecha: f, nivel: v.nivel, txt: v.txt }); });
    if (!p.induccion_fecha) al.push({ area: "Personal", det: `${p.nombre} — inducción`, fecha: p.fecha_ingreso, nivel: "warn", txt: "Sin inducción registrada" });
  });
  const ultEpp = new Map();
  (D.epp || []).forEach(r => { const k = r.personal_id + "|" + r.item; const x = ultEpp.get(k); if (!x || r.fecha_entrega > x.fecha_entrega) ultEpp.set(k, r); });
  [...ultEpp.values()].filter(r => r.proxima_reposicion && r.proxima_reposicion < hoy && (D.pers || []).some(p => p.id === r.personal_id && p.activo)).forEach(r =>
    al.push({ area: "EPP", det: `${nombrePers(r.personal_id)} — ${r.item}`, fecha: r.proxima_reposicion, nivel: "warn", txt: `Reposición vencida hace ${dias(r.proxima_reposicion, hoy)} d` }));
  al.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "late" ? -1 : 1) || (a.fecha || "").localeCompare(b.fecha || ""));
  $("ssTabAlertas").querySelector("tbody").innerHTML = al.map(a => `<tr><td>${esc(a.area)}</td><td>${esc(a.det)}</td><td>${fd(a.fecha)}</td><td>${badge(a.nivel, esc(a.txt))}</td></tr>`).join("") || `<tr><td colspan="4" style="color:var(--text-muted);">No hay alertas.</td></tr>`;

  // horas-hombre por mes
  const meses = [...new Set([...HH.map(x => x.periodo)])].sort().reverse();
  $("hhTabla").querySelector("tbody").innerHTML = meses.map(m => {
    const x = HH.find(h => h.periodo === m), a = accMes(m), i = indices(a.n, a.dp, Number(x.horas_hombre));
    return `<tr><td>${m}</td><td class="num">${x.trabajadores ?? ""}</td><td class="num">${fmt(x.horas_hombre)}</td><td class="num">${a.n}</td><td class="num">${a.dp}</td><td class="num">${i.f == null ? "" : fmt(i.f, 2)}</td><td class="num">${i.s == null ? "" : fmt(i.s, 2)}</td><td class="num">${i.a == null ? "" : fmt(i.a, 2)}</td><td style="white-space:nowrap;">${puedeEditar() ? `<button class="btn secondary mini" data-hhe="${x.id}">Editar</button> ` : ""}${puedeBorrar() ? `<button class="btn secondary mini" data-hhd="${x.id}">Borrar</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="9" style="color:var(--text-muted);">Aún no hay horas-hombre registradas.</td></tr>`;
  $("hhForm").style.display = puedeEditar() ? "" : "none";

  // resumen del proyecto
  const inc = D.inc || [], ins = D.insp || [], cha = D.cha || [];
  const filas = [
    ["Horas-hombre trabajadas", fmt(hhT)], ["Accidentes con tiempo perdido o fatales", incap.length], ["Días perdidos", dpT],
    ["Índice de frecuencia", ind.f == null ? "—" : fmt(ind.f, 2)], ["Índice de severidad", ind.s == null ? "—" : fmt(ind.s, 2)], ["Índice de accidentabilidad", ind.a == null ? "—" : fmt(ind.a, 2)],
    ["Casi accidentes reportados", inc.filter(r => r.tipo === "Casi accidente").length], ["Incidentes y accidentes en total", inc.length],
    ["Inspecciones y observaciones (total / cerradas)", `${ins.length} / ${ins.filter(r => r.estado === "Cerrada").length}`],
    ["Charlas y capacitaciones", cha.length], ["Horas-hombre de capacitación", fmt(cha.reduce((s, r) => s + horasCharla(r), 0), 1)],
    ["Personal activo", (D.pers || []).filter(p => p.activo).length], ["Permisos y documentos vigentes", (D.per || []).filter(r => permisoEstado(r) === "Vigente").length],
  ];
  $("ssTabRes").querySelector("tbody").innerHTML = filas.map(f => `<tr><td>${f[0]}</td><td class="num">${f[1]}</td></tr>`).join("");
}

// ---------------- eventos globales ----------------
function enlazarGlobal() {
  $("fmCerrar").addEventListener("click", () => $("fotoModal").style.display = "none");
  $("fotoModal").addEventListener("click", (e) => { if (e.target.id === "fotoModal") $("fotoModal").style.display = "none"; });
  document.addEventListener("click", (ev) => {   // quitar foto de un formulario
    const b = ev.target.closest("button[data-q]"); if (!b) return;
    FOTOS[b.dataset.q].keep = FOTOS[b.dataset.q].keep.filter(r => r !== b.dataset.r); pintarFotos(b.dataset.q);
  });
  // horas-hombre
  $("hhPeriodo").value = hoyISO().slice(0, 7);
  $("hhPeriodo").addEventListener("change", () => { const x = HH.find(h => h.periodo === $("hhPeriodo").value); $("hhHoras").value = x ? x.horas_hombre : ""; $("hhTrab").value = x && x.trabajadores != null ? x.trabajadores : ""; });
  $("hhForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const periodo = $("hhPeriodo").value, ex = HH.find(h => h.periodo === periodo);
    const fila = { proyecto_id: PID, periodo, horas_hombre: Number($("hhHoras").value) || 0, trabajadores: $("hhTrab").value.trim() === "" ? null : Number($("hhTrab").value) };
    const { error } = ex ? await supabaseClient.from("ss_hh").update(fila).eq("id", ex.id) : await supabaseClient.from("ss_hh").insert(fila);
    if (error) { $("hhMsg").textContent = "No se pudo guardar: " + error.message; return; }
    $("hhMsg").textContent = ""; $("hhForm").reset(); $("hhPeriodo").value = hoyISO().slice(0, 7);
    await cargar();
  });
  $("hhTabla").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.hhe) { const x = HH.find(h => h.id === b.dataset.hhe); $("hhPeriodo").value = x.periodo; $("hhHoras").value = x.horas_hombre; $("hhTrab").value = x.trabajadores ?? ""; $("hhHoras").focus(); }
    if (b.dataset.hhd && confirm("¿Borrar las horas-hombre de este mes?")) {
      const { error } = await supabaseClient.from("ss_hh").delete().eq("id", b.dataset.hhd);
      if (error) alert(error.message); else await cargar();
    }
  });
}
