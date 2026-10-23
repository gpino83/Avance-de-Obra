// =========================================================
// Control de Avance de Obra — lógica principal
// =========================================================

let CURRENT_USER = null;   // { id, email }
let CURRENT_PROFILE = null; // { rol, nombre_completo }
let PROYECTOS = [];
let PARTIDAS = [];          // partidas del proyecto seleccionado
let AVANCES = [];           // avances del proyecto seleccionado (todas las partidas)
let ASIGNACIONES = [];      // asignaciones_frente del proyecto seleccionado (todos los usuarios)
let MIS_FRENTES = [];       // frentes asignados al usuario logueado (solo aplica a rol "residente")
let REVISIONES = [];        // revisiones_linea_base del proyecto (LB01, LB02, ...)
let REVISION_ACTIVA = null; // la revision marcada activa=true, o null si se usa la original (LB00)
let REVISION_EDITANDO = null; // revision que se esta editando en la pestaña "Líneas Base" (no necesariamente la activa)
let VIENDO_ORIGINAL = false;  // true = la pestaña "Líneas Base" esta mostrando LB00 (solo lectura)
let OVERRIDES_ACTIVA = {};  // partida_id -> fila de partidas_revision de la revision ACTIVA
let OVERRIDES_EDITANDO = {}; // partida_id -> fila de partidas_revision de la revision que se esta EDITANDO

// ---------------------------------------------------------
// Autenticación / arranque
// ---------------------------------------------------------
(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "index.html"; return; }
  CURRENT_USER = session.user;

  const { data: perfil } = await supabaseClient
    .from("perfiles")
    .select("*")
    .eq("id", CURRENT_USER.id)
    .single();
  CURRENT_PROFILE = perfil || { rol: "residente", nombre_completo: CURRENT_USER.email };
  if (CURRENT_PROFILE.rol === "postventa") { window.location.href = "postventa.html"; return; }
  if (["admin", "planner", "viewer"].includes(CURRENT_PROFILE.rol)) {
    const back = document.getElementById("backLink");
    if (back) back.style.display = "";
  }

  document.getElementById("userName").textContent = CURRENT_PROFILE.nombre_completo || CURRENT_USER.email;
  document.getElementById("userRole").textContent = "(" + CURRENT_PROFILE.rol + ")";

  if (CURRENT_PROFILE.rol === "admin") {
    const btnDel = document.getElementById("btnEliminarProyecto");
    if (btnDel) { btnDel.style.display = ""; btnDel.addEventListener("click", eliminarProyecto); }
    const tabBtn = document.getElementById("tabUsuariosBtn");
    if (tabBtn) tabBtn.style.display = "";
  }
  if (CURRENT_PROFILE.rol === "admin" || CURRENT_PROFILE.rol === "planner") {
    const tabBtn2 = document.getElementById("tabLineasBaseBtn");
    if (tabBtn2) tabBtn2.style.display = "";
    const tabBtn3 = document.getElementById("tabCargarBtn");
    if (tabBtn3) tabBtn3.style.display = "";
  }

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
  });

  setupTabs();
  initAsistente();
  initRestricciones();
  initEdt();
  initFlujoCaja();
  initCargar();
  await loadProyectos();
  setupAvanceForm();
  document.getElementById("buscarPartida").addEventListener("input", renderPartidasTable);

  // fecha por defecto = hoy
  document.getElementById("semanaFin").value = new Date().toISOString().slice(0,10);
})();

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("view-" + btn.dataset.view).classList.add("active");
      try {
        if (btn.dataset.view === "edt") renderEdt();
        if (btn.dataset.view === "flujo") renderFlujoCaja();
      } catch (e) { console.error("Error al abrir la pestaña:", e); }
    });
  });
}

// ---------------------------------------------------------
// Proyectos
// ---------------------------------------------------------
async function loadProyectos(seleccionarId) {
  const { data, error } = await supabaseClient.from("proyectos").select("*").order("created_at");
  if (error) { console.error(error); return; }
  PROYECTOS = data || [];

  const selects = [
    document.getElementById("proyectoSelectDash"),
    document.getElementById("proyectoSelectAvance"),
    document.getElementById("proyectoSelectPartidas"),
  ];
  const puedeCrear = CURRENT_PROFILE.rol === "admin" || CURRENT_PROFILE.rol === "planner";
  selects.forEach(sel => {
    sel.innerHTML = PROYECTOS.map(p => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("") +
      (puedeCrear ? `<option value="__nuevo">+ Proyecto nuevo…</option>` : "");
    sel.addEventListener("change", async () => {
      if (sel.value === "__nuevo") { await crearProyecto(sel); return; }
      onProyectoChange(sel.value);
    });
  });

  cgLlenarProyectos(seleccionarId);
  if (PROYECTOS.length > 0) await onProyectoChange(seleccionarId || undefined);
}

async function crearProyecto(sel) {
  const nombre = (prompt("Nombre del proyecto nuevo:") || "").trim();
  const volver = () => { sel.value = (PROYECTOS[0] && (PROYECTOS.find(p => p.id === PROYECTO_ACTUAL_ID) || PROYECTOS[0]).id) || ""; };
  if (!nombre) { volver(); return; }
  const cliente = (prompt("Cliente (opcional):") || "").trim();
  const { data, error } = await supabaseClient.from("proyectos").insert({ nombre, cliente: cliente || null }).select().single();
  if (error) { alert("No se pudo crear el proyecto: " + error.message); volver(); return; }
  PROYECTO_ACTUAL_ID = data.id;
  await loadProyectos(data.id);
}

let PROYECTO_ACTUAL_ID = null;
async function onProyectoChange(idElegido) {
  const proyectoId = idElegido || document.getElementById("proyectoSelectDash").value ||
                      document.getElementById("proyectoSelectAvance").value ||
                      document.getElementById("proyectoSelectPartidas").value;
  PROYECTO_ACTUAL_ID = proyectoId;
  // sincroniza los 3 selects al mismo proyecto
  [document.getElementById("proyectoSelectDash"),
   document.getElementById("proyectoSelectAvance"),
   document.getElementById("proyectoSelectPartidas")].forEach(sel => sel.value = proyectoId);

  await loadPartidasYAvances(proyectoId);
  await loadAsignaciones(proyectoId);
  await loadRevisiones(proyectoId);
  aplicarOverridesActivos();
  renderPartidasTable();
  renderPartidaSelectAvance();
  await renderUltimosAvances();
  renderDashboard();
  await loadRestricciones(proyectoId);
  if (CURRENT_PROFILE.rol === "admin") await renderUsuariosTab(proyectoId);
  if (CURRENT_PROFILE.rol === "admin" || CURRENT_PROFILE.rol === "planner") await renderLineasBaseTab(proyectoId);
}

// Supabase devuelve como maximo 1000 filas por consulta. Esta funcion pide paginas de 1000
// hasta traer todo. buildQuery debe devolver una consulta NUEVA (con orden estable) cada vez.
async function fetchAll(buildQuery) {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) { console.error(error); break; }
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function loadPartidasYAvances(proyectoId) {
  PARTIDAS = await fetchAll(() =>
    supabaseClient.from("partidas").select("*").eq("proyecto_id", proyectoId).order("orden").order("id"));

  const partidaIds = PARTIDAS.map(p => p.id);
  if (partidaIds.length === 0) { AVANCES = []; return; }

  // En bloques de 100 ids para no exceder el largo maximo de la URL
  AVANCES = [];
  for (let i = 0; i < partidaIds.length; i += 100) {
    const chunk = partidaIds.slice(i, i + 100);
    const parte = await fetchAll(() =>
      supabaseClient.from("avances_semanales").select("*").in("partida_id", chunk).order("semana_fin").order("id"));
    AVANCES = AVANCES.concat(parte);
  }
}

// ---------------------------------------------------------
// Asignaciones de frente (jefe de frente -> que frentes puede registrar)
// ---------------------------------------------------------
async function loadAsignaciones(proyectoId) {
  const { data, error } = await supabaseClient
    .from("asignaciones_frente").select("*").eq("proyecto_id", proyectoId);
  if (error) { console.error(error); ASIGNACIONES = []; MIS_FRENTES = []; return; }
  ASIGNACIONES = data || [];
  MIS_FRENTES = ASIGNACIONES.filter(a => a.perfil_id === CURRENT_USER.id).map(a => a.frente);
}

// ---------------------------------------------------------
// Líneas base adicionales (revisiones por cambios del cliente)
// ---------------------------------------------------------
async function loadRevisiones(proyectoId) {
  const { data, error } = await supabaseClient
    .from("revisiones_linea_base").select("*").eq("proyecto_id", proyectoId).order("fecha_creacion");
  if (error) { console.error(error); REVISIONES = []; REVISION_ACTIVA = null; OVERRIDES_ACTIVA = {}; return; }
  REVISIONES = data || [];
  REVISION_ACTIVA = REVISIONES.find(r => r.activa) || null;
  OVERRIDES_ACTIVA = {};
  if (REVISION_ACTIVA) {
    const overrides = await fetchAll(() =>
      supabaseClient.from("partidas_revision").select("*").eq("revision_id", REVISION_ACTIVA.id).order("id"));
    overrides.forEach(o => { OVERRIDES_ACTIVA[o.partida_id] = o; });
  }
}

// Aplica los valores de la revision ACTIVA sobre PARTIDAS (sobrescribe fecha_inicio_base,
// fecha_fin_base, metrado_total, precio_unitario, presupuesto_total), guardando los valores
// ORIGINALES (linea base contractual / LB00) en campos orig_* para poder dibujar ambas curvas.
// Si no hay revision activa, PARTIDAS queda igual que antes (orig_* = valor actual).
function aplicarOverridesActivos() {
  PARTIDAS.forEach(p => {
    p.orig_fecha_inicio_base = p.fecha_inicio_base;
    p.orig_fecha_fin_base = p.fecha_fin_base;
    p.orig_metrado_total = p.metrado_total;
    p.orig_precio_unitario = p.precio_unitario;
    p.orig_presupuesto_total = p.presupuesto_total;

    const o = OVERRIDES_ACTIVA[p.id];
    if (o) {
      if (o.fecha_inicio_base) p.fecha_inicio_base = o.fecha_inicio_base;
      if (o.fecha_fin_base) p.fecha_fin_base = o.fecha_fin_base;
      if (o.metrado_total !== null && o.metrado_total !== undefined) p.metrado_total = o.metrado_total;
      if (o.precio_unitario !== null && o.precio_unitario !== undefined) p.precio_unitario = o.precio_unitario;
      p.presupuesto_total = (o.presupuesto_total !== null && o.presupuesto_total !== undefined)
        ? o.presupuesto_total
        : Number(p.metrado_total || 0) * Number(p.precio_unitario || 0);
    }
  });
}

// ---------------------------------------------------------
// Vista: PARTIDAS (línea base editable)
// ---------------------------------------------------------
const MAX_FILAS_PARTIDAS = 300;

function renderPartidasTable() {
  const tbody = document.querySelector("#tablaPartidas tbody");
  const filtro = (document.getElementById("buscarPartida").value || "").trim().toLowerCase();
  tbody.innerHTML = "";
  const canEdit = CURRENT_PROFILE.rol === "admin" || CURRENT_PROFILE.rol === "planner";

  let lista = PARTIDAS;
  if (filtro.length >= 2) {
    lista = PARTIDAS.filter(p => p.nombre.toLowerCase().includes(filtro) || p.frente.toLowerCase().includes(filtro));
  } else if (PARTIDAS.length > MAX_FILAS_PARTIDAS) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted); padding:16px;">Hay ${PARTIDAS.length} partidas — escribe al menos 2 letras en el buscador para verlas (por nombre o por frente).</td></tr>`;
    return;
  }

  if (lista.length > MAX_FILAS_PARTIDAS) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted); padding:16px;">${lista.length} resultados — afina más la búsqueda (mostrando los primeros ${MAX_FILAS_PARTIDAS}).</td></tr>`;
    lista = lista.slice(0, MAX_FILAS_PARTIDAS);
  }

  let lastFrente = null;
  lista.forEach(p => {
    if (p.frente !== lastFrente) {
      lastFrente = p.frente;
      const trGroup = document.createElement("tr");
      trGroup.className = "frente-group-row";
      trGroup.innerHTML = `<td colspan="7">${escapeHtml(p.frente)}</td>`;
      tbody.appendChild(trGroup);
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding-left:20px;">${escapeHtml(p.nombre)}</td>
      <td>${fmtDate(p.fecha_inicio_base)}</td>
      <td>${fmtDate(p.fecha_fin_base)}</td>
      <td><input type="text" data-field="unidad" value="${escapeAttr(p.unidad || '')}" style="width:60px;" ${canEdit ? '' : 'disabled'}></td>
      <td><input type="number" step="0.0001" data-field="metrado_total" value="${p.metrado_total}" ${canEdit ? '' : 'disabled'}></td>
      <td><input type="number" step="0.0001" data-field="precio_unitario" value="${p.precio_unitario}" ${canEdit ? '' : 'disabled'}></td>
      <td class="presupuesto-cell" style="font-weight:600;">S/ ${Number(p.presupuesto_total || 0).toLocaleString('es-PE', {maximumFractionDigits:2})}</td>
    `;
    tbody.appendChild(tr);

    tr.querySelectorAll("input").forEach(input => {
      input.addEventListener("change", async () => {
        const field = input.dataset.field;
        const value = field === "unidad" ? input.value : parseFloat(input.value || "0");
        p[field] = value;

        const updates = { [field]: value };
        // presupuesto_total se recalcula automáticamente si cambia metrado o P.U.
        if (field === "metrado_total" || field === "precio_unitario") {
          p.presupuesto_total = Number(p.metrado_total || 0) * Number(p.precio_unitario || 0);
          updates.presupuesto_total = p.presupuesto_total;
          tr.querySelector(".presupuesto-cell").textContent = "S/ " + p.presupuesto_total.toLocaleString('es-PE', {maximumFractionDigits:2});
        }

        const { error } = await supabaseClient.from("partidas").update(updates).eq("id", p.id);
        if (error) { alert("No se pudo guardar: " + error.message); return; }
        renderDashboard();
      });
    });
  });
}

// ---------------------------------------------------------
// Vista: REGISTRAR AVANCE
// ---------------------------------------------------------
const MAX_OPCIONES_AVANCE = 150;

function renderPartidaSelectAvance() {
  const sel = document.getElementById("partidaSelect");
  const filtro = (document.getElementById("buscarPartidaAvance").value || "").trim().toLowerCase();

  // Un "residente" solo puede registrar avance en los frentes que tiene asignados.
  // admin/planner ven todo, sin restricción.
  const soloMisFrentes = CURRENT_PROFILE.rol === "residente";
  if (soloMisFrentes && MIS_FRENTES.length === 0) {
    sel.innerHTML = `<option disabled>No tienes frentes asignados — pídele al administrador que te asigne uno en "Usuarios / Asignaciones"</option>`;
    document.getElementById("unidadHint").textContent = "";
    document.getElementById("buscarPartidaAvance").oninput = renderPartidaSelectAvance;
    return;
  }

  let lista = soloMisFrentes ? PARTIDAS.filter(p => MIS_FRENTES.includes(p.frente)) : PARTIDAS;
  if (filtro.length >= 2) {
    lista = lista.filter(p => p.nombre.toLowerCase().includes(filtro) || p.frente.toLowerCase().includes(filtro));
  }
  const truncado = lista.length > MAX_OPCIONES_AVANCE;
  if (truncado) lista = lista.slice(0, MAX_OPCIONES_AVANCE);

  let lastFrente = null;
  let html = "";
  if (lista.length === 0) {
    html = `<option disabled>Sin resultados</option>`;
  }
  lista.forEach(p => {
    if (p.frente !== lastFrente) {
      if (lastFrente !== null) html += "</optgroup>";
      html += `<optgroup label="${escapeAttr(p.frente)}">`;
      lastFrente = p.frente;
    }
    html += `<option value="${p.id}" data-unidad="${escapeAttr(p.unidad || '')}">${escapeHtml(p.nombre)}</option>`;
  });
  if (lastFrente !== null) html += "</optgroup>";
  if (truncado) html += `<option disabled>… hay más resultados, afina la búsqueda</option>`;
  sel.innerHTML = html;
  updateUnidadHint();
  sel.onchange = updateUnidadHint;

  document.getElementById("buscarPartidaAvance").oninput = renderPartidaSelectAvance;
}

function updateUnidadHint() {
  const sel = document.getElementById("partidaSelect");
  const opt = sel.options[sel.selectedIndex];
  document.getElementById("unidadHint").textContent = opt ? `(${opt.dataset.unidad || 'unidad'})` : "";
}

function setupAvanceForm() {
  document.getElementById("avanceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const partidaId = document.getElementById("partidaSelect").value;
    const semanaFin = document.getElementById("semanaFin").value;
    const metrado = parseFloat(document.getElementById("metradoEjecutado").value || "0");
    const comentario = document.getElementById("comentarioAvance").value.trim();
    const msgBox = document.getElementById("avanceMsg");
    msgBox.innerHTML = "";

    const { error } = await supabaseClient.from("avances_semanales").upsert({
      partida_id: partidaId,
      semana_fin: semanaFin,
      metrado_ejecutado: metrado,
      comentario,
      registrado_por: CURRENT_USER.id,
    }, { onConflict: "partida_id,semana_fin,registrado_por" });

    if (error) {
      msgBox.innerHTML = `<div class="error-msg">${escapeHtml(error.message)}</div>`;
      return;
    }
    msgBox.innerHTML = `<div class="success-msg">Avance guardado.</div>`;
    document.getElementById("comentarioAvance").value = "";
    document.getElementById("metradoEjecutado").value = "";

    const proyectoId = document.getElementById("proyectoSelectAvance").value;
    await loadPartidasYAvances(proyectoId);
    await renderUltimosAvances();
    renderDashboard();
  });
}

async function renderUltimosAvances() {
  const tbody = document.querySelector("#tablaUltimosAvances tbody");
  tbody.innerHTML = "";
  const recientes = [...AVANCES].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 25);
  if (recientes.length === 0) return;

  const userIds = [...new Set(recientes.map(a => a.registrado_por))];
  const { data: perfiles } = await supabaseClient.from("perfiles").select("id,nombre_completo").in("id", userIds);
  const perfilMap = {};
  (perfiles || []).forEach(p => perfilMap[p.id] = p.nombre_completo);

  recientes.forEach(a => {
    const partida = PARTIDAS.find(p => p.id === a.partida_id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(a.created_at.slice(0,10))}</td>
      <td>${escapeHtml(partida ? partida.frente : '')}</td>
      <td>${escapeHtml(partida ? partida.nombre : '(eliminada)')}</td>
      <td>${fmtDate(a.semana_fin)}</td>
      <td>${a.metrado_ejecutado} ${escapeHtml(partida ? partida.unidad : '')}</td>
      <td>${escapeHtml(perfilMap[a.registrado_por] || '')}</td>
      <td></td>
    `;
    if (a.registrado_por === CURRENT_USER.id) {
      const delBtn = document.createElement("button");
      delBtn.className = "small-btn";
      delBtn.textContent = "Eliminar";
      delBtn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este avance?")) return;
        await supabaseClient.from("avances_semanales").delete().eq("id", a.id);
        const proyectoId = document.getElementById("proyectoSelectAvance").value;
        await loadPartidasYAvances(proyectoId);
        await renderUltimosAvances();
        renderDashboard();
      });
      tr.lastElementChild.appendChild(delBtn);
    }
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------
// Vista: DASHBOARD (Curva S física + económica + desface)
// ---------------------------------------------------------
let curvaEconomicaChartInstance = null;
let curvaFisicaChartInstance = null;
const GANTT_EXPANDED = new Set(); // frentes expandidos en el Gantt

// Peso ECONÓMICO: participación de la partida en el presupuesto total (para la curva de valorización S/)
// Usa la linea base EFECTIVA (la activa, o la original si no hay revision activa).
function pesoEconomico(p, totalPresupuesto) {
  if (totalPresupuesto > 0) return (p.presupuesto_total || 0) / totalPresupuesto;
  return 0;
}

// Igual que pesoEconomico pero siempre contra la línea base ORIGINAL (contractual / LB00),
// para poder dibujar la curva de comparación cuando hay una revisión activa.
function pesoEconomicoOriginal(p, totalPresupuestoOriginal) {
  if (totalPresupuestoOriginal > 0) return (p.orig_presupuesto_total || 0) / totalPresupuestoOriginal;
  return 0;
}

function avanceRealAcumuladoEnFecha(partidaId, fecha) {
  const partida = PARTIDAS.find(p => p.id === partidaId);
  if (!partida || !partida.metrado_total) return 0;
  const ejecutado = AVANCES
    .filter(a => a.partida_id === partidaId && a.semana_fin <= fecha)
    .reduce((sum, a) => sum + Number(a.metrado_ejecutado), 0);
  return Math.min(ejecutado / partida.metrado_total, 1);
}

// useOriginal=true calcula contra la línea base ORIGINAL (contractual / LB00) en vez de
// la efectiva (activa). Por defecto usa la efectiva, igual que antes.
function avancePlanificadoEnFecha(partida, fecha, useOriginal) {
  const d = new Date(fecha);
  const ini = new Date(useOriginal ? (partida.orig_fecha_inicio_base || partida.fecha_inicio_base) : partida.fecha_inicio_base);
  const fin = new Date(useOriginal ? (partida.orig_fecha_fin_base || partida.fecha_fin_base) : partida.fecha_fin_base);
  if (d <= ini) return 0;
  if (d >= fin) return 1;
  if (fin - ini <= 0) return 1;
  return (d - ini) / (fin - ini);
}

function generarSemanas() {
  if (PARTIDAS.length === 0) return [];
  // Cubre tanto la linea base efectiva como la original, para que ambas curvas se
  // dibujen completas cuando hay una revision activa con fechas distintas.
  const inicios = PARTIDAS.flatMap(p => [new Date(p.fecha_inicio_base), new Date(p.orig_fecha_inicio_base || p.fecha_inicio_base)]);
  const fines = PARTIDAS.flatMap(p => [new Date(p.fecha_fin_base), new Date(p.orig_fecha_fin_base || p.fecha_fin_base)]);
  const start = new Date(Math.min(...inicios));
  const today = new Date();
  const end = new Date(Math.max(...fines, today));
  const semanas = [];
  let d = new Date(start);
  while (d <= end) {
    semanas.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate() + 7);
  }
  semanas.push(end.toISOString().slice(0,10));
  return semanas;
}

function calcularCurvas() {
  const totalPresupuesto = PARTIDAS.reduce((s,p) => s + (p.presupuesto_total || 0), 0);
  const partidasConMetrado = PARTIDAS.filter(p => p.metrado_total > 0);
  const semanas = generarSemanas();
  const hayRevisionActiva = !!REVISION_ACTIVA;

  // --- Curva ECONÓMICA (S/): ponderada por presupuesto -> mide valorización real ---
  const economicoPlan = semanas.map(fecha =>
    PARTIDAS.reduce((sum, p) => sum + pesoEconomico(p, totalPresupuesto) * avancePlanificadoEnFecha(p, fecha), 0) * 100
  );
  const economicoReal = semanas.map(fecha =>
    PARTIDAS.reduce((sum, p) => sum + pesoEconomico(p, totalPresupuesto) * avanceRealAcumuladoEnFecha(p.id, fecha), 0) * 100
  );

  // --- Curva FÍSICA / EJECUCIÓN (%): promedio simple entre partidas, sin ponderar por costo ---
  const n = partidasConMetrado.length;
  const fisicoPlan = semanas.map(fecha =>
    n === 0 ? 0 : partidasConMetrado.reduce((sum, p) => sum + avancePlanificadoEnFecha(p, fecha), 0) / n * 100
  );
  const fisicoReal = semanas.map(fecha =>
    n === 0 ? 0 : partidasConMetrado.reduce((sum, p) => sum + avanceRealAcumuladoEnFecha(p.id, fecha), 0) / n * 100
  );

  // --- Curvas de comparación contra la línea base ORIGINAL (contractual / LB00),
  //     solo se calculan cuando hay una revisión activa (si no, serían idénticas a las de arriba) ---
  let economicoPlanOriginal = null, fisicoPlanOriginal = null, totalPresupuestoOriginal = 0;
  if (hayRevisionActiva) {
    totalPresupuestoOriginal = PARTIDAS.reduce((s,p) => s + (p.orig_presupuesto_total || 0), 0);
    economicoPlanOriginal = semanas.map(fecha =>
      PARTIDAS.reduce((sum, p) => sum + pesoEconomicoOriginal(p, totalPresupuestoOriginal) * avancePlanificadoEnFecha(p, fecha, true), 0) * 100
    );
    fisicoPlanOriginal = semanas.map(fecha =>
      n === 0 ? 0 : partidasConMetrado.reduce((sum, p) => sum + avancePlanificadoEnFecha(p, fecha, true), 0) / n * 100
    );
  }

  return {
    semanas, economicoPlan, economicoReal, fisicoPlan, fisicoReal, totalPresupuesto, nPartidasConMetrado: n,
    hayRevisionActiva, economicoPlanOriginal, fisicoPlanOriginal, totalPresupuestoOriginal,
  };
}

function renderDashboard() {
  const {
    semanas, economicoPlan, economicoReal, fisicoPlan, fisicoReal, totalPresupuesto,
    hayRevisionActiva, economicoPlanOriginal, fisicoPlanOriginal, totalPresupuestoOriginal,
  } = calcularCurvas();
  const hoy = new Date().toISOString().slice(0,10);

  // Aviso de línea base activa (si hay una revisión por cambios del cliente en uso)
  const avisoLB = document.getElementById("avisoLineaBaseActiva");
  if (avisoLB) {
    if (hayRevisionActiva) {
      const deltaPresupuesto = totalPresupuesto - totalPresupuestoOriginal;
      const finOriginal = PARTIDAS.reduce((max, p) => { const f = p.orig_fecha_fin_base; return (!max || (f && f > max)) ? f : max; }, null);
      const finActivo = PARTIDAS.reduce((max, p) => { const f = p.fecha_fin_base; return (!max || (f && f > max)) ? f : max; }, null);
      const deltaDias = (finOriginal && finActivo) ? Math.round((new Date(finActivo) - new Date(finOriginal)) / 86400000) : null;
      avisoLB.style.display = "";
      avisoLB.innerHTML = `
        <b>Línea base activa: ${escapeHtml(REVISION_ACTIVA.nombre)}</b>${REVISION_ACTIVA.motivo ? " — " + escapeHtml(REVISION_ACTIVA.motivo) : ""}.
        Frente a la línea base original (LB00): presupuesto
        ${deltaPresupuesto >= 0 ? "+" : ""}S/ ${deltaPresupuesto.toLocaleString('es-PE', {maximumFractionDigits:0})}
        ${deltaDias !== null ? `, fin de obra ${deltaDias >= 0 ? "+" : ""}${deltaDias} días` : ""}.
        La línea gris punteada del gráfico es la original; la línea base activa usada para el desface es la revisada.
      `;
    } else {
      avisoLB.style.display = "none";
      avisoLB.innerHTML = "";
    }
  }

  // Importante: los stats de "hoy" se calculan EN LA FECHA DE HOY, no tomando el último
  // punto del gráfico (que llega hasta el fin de obra, no hasta la fecha actual).
  const partidasConMetrado = PARTIDAS.filter(p => p.metrado_total > 0);
  const n = partidasConMetrado.length;

  const econRealHoy = PARTIDAS.reduce((sum, p) => sum + pesoEconomico(p, totalPresupuesto) * avanceRealAcumuladoEnFecha(p.id, hoy), 0) * 100;
  const econPlanHoy = PARTIDAS.reduce((sum, p) => sum + pesoEconomico(p, totalPresupuesto) * avancePlanificadoEnFecha(p, hoy), 0) * 100;
  const econDesface = econRealHoy - econPlanHoy;
  const montoValorizado = totalPresupuesto * econRealHoy / 100;

  const fisRealHoy = n === 0 ? 0 : partidasConMetrado.reduce((sum, p) => sum + avanceRealAcumuladoEnFecha(p.id, hoy), 0) / n * 100;
  const fisPlanHoy = n === 0 ? 0 : partidasConMetrado.reduce((sum, p) => sum + avancePlanificadoEnFecha(p, hoy), 0) / n * 100;
  const fisDesface = fisRealHoy - fisPlanHoy;

  const statRow = document.getElementById("statRow");
  statRow.innerHTML = `
    <div class="stat-tile">
      <div class="label">Avance económico (valorizado)</div>
      <div class="value">${econRealHoy.toFixed(1)}%</div>
    </div>
    <div class="stat-tile">
      <div class="label">Monto valorizado a hoy</div>
      <div class="value">${totalPresupuesto > 0 ? 'S/ ' + montoValorizado.toLocaleString('es-PE', {maximumFractionDigits:0}) : 'Sin datos'}</div>
    </div>
    <div class="stat-tile">
      <div class="label">Desface económico</div>
      <div class="value ${econDesface >= 0 ? 'good' : 'bad'}">${econDesface >= 0 ? '+' : ''}${econDesface.toFixed(1)}%</div>
    </div>
    <div class="stat-tile">
      <div class="label">Avance físico (ejecución)</div>
      <div class="value">${fisRealHoy.toFixed(1)}%</div>
    </div>
    <div class="stat-tile">
      <div class="label">Desface físico</div>
      <div class="value ${fisDesface >= 0 ? 'good' : 'bad'}">${fisDesface >= 0 ? '+' : ''}${fisDesface.toFixed(1)}%</div>
    </div>
    <div class="stat-tile">
      <div class="label">Presupuesto total (línea base)</div>
      <div class="value">${totalPresupuesto > 0 ? 'S/ ' + totalPresupuesto.toLocaleString('es-PE', {maximumFractionDigits:0}) : 'Sin datos'}</div>
    </div>
  `;

  if (totalPresupuesto === 0) {
    statRow.insertAdjacentHTML("beforeend", `
      <div class="stat-tile" style="grid-column:1/-1;">
        <div class="label" style="color:var(--red);">⚠ Aún no hay presupuesto cargado en "Partidas" — la curva económica no puede ponderar hasta completar esos datos.</div>
      </div>
    `);
  }

  const labels = semanas.map(fmtDate);

  const econCtx = document.getElementById("curvaEconomicaChart").getContext("2d");
  if (curvaEconomicaChartInstance) curvaEconomicaChartInstance.destroy();
  curvaEconomicaChartInstance = new Chart(econCtx, lineChartConfig(labels, economicoPlan, economicoReal, "#898781", "#2a78d6", "rgba(42,120,214,0.08)", economicoPlanOriginal));

  const fisCtx = document.getElementById("curvaFisicaChart").getContext("2d");
  if (curvaFisicaChartInstance) curvaFisicaChartInstance.destroy();
  curvaFisicaChartInstance = new Chart(fisCtx, lineChartConfig(labels, fisicoPlan, fisicoReal, "#898781", "#1baf7a", "rgba(27,175,122,0.08)", fisicoPlanOriginal));

  renderTablaDesfacePorFrente(totalPresupuesto, hoy);
  renderGantt();
  [() => renderControlAvance(totalPresupuesto, hoy), renderKpis, renderEdt, renderFlujoCaja].forEach(fn => {
    try { fn(); } catch (e) { console.error("Error al dibujar una pestaña:", e); }
  });
}

// ---------------------------------------------------------
// Pestaña "Control de Avance": KPIs gerenciales
// ---------------------------------------------------------
let ctrlCurvaInstance = null, ctrlMensualInstance = null;

function renderControlAvance(totalPresupuesto, hoy) {
  const kpis = document.getElementById("ctrlKpis");
  if (!kpis) return;
  const fmtM = v => "S/ " + (v / 1e6).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " M";
  const pct = v => v.toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  const hay = !!REVISION_ACTIVA;
  const peso = p => totalPresupuesto > 0 ? (p.presupuesto_total || 0) / totalPresupuesto : 0;
  const totalOrig = PARTIDAS.reduce((s, p) => s + (p.orig_presupuesto_total ?? p.presupuesto_total ?? 0), 0);
  const pesoO = p => totalOrig > 0 ? (p.orig_presupuesto_total ?? p.presupuesto_total ?? 0) / totalOrig : 0;
  const iniO = p => p.orig_fecha_inicio_base || p.fecha_inicio_base;
  const finO = p => p.orig_fecha_fin_base || p.fecha_fin_base;
  const planO = (p, f) => avancePlanificadoEnFecha({ ...p, fecha_inicio_base: iniO(p), fecha_fin_base: finO(p) }, f);

  const econReal = PARTIDAS.reduce((s, p) => s + peso(p) * avanceRealAcumuladoEnFecha(p.id, hoy), 0) * 100;
  const econPlan = PARTIDAS.reduce((s, p) => s + peso(p) * avancePlanificadoEnFecha(p, hoy), 0) * 100;
  const desface = econReal - econPlan;
  const frentes = [...new Set(PARTIDAS.map(p => p.frente))];
  const inicioObra = PARTIDAS.reduce((m, p) => (!m || p.fecha_inicio_base < m) ? p.fecha_inicio_base : m, null);
  const finVig = PARTIDAS.reduce((m, p) => (!m || p.fecha_fin_base > m) ? p.fecha_fin_base : m, null);
  const finOrig = PARTIDAS.reduce((m, p) => (!m || finO(p) > m) ? finO(p) : m, null);
  const plazo = inicioObra && finVig ? Math.round((new Date(finVig) - new Date(inicioObra)) / 86400000) : 0;
  const deltaFin = (finOrig && finVig) ? Math.round((new Date(finVig) - new Date(finOrig)) / 86400000) : 0;

  // meses
  const meses = [];
  if (inicioObra) {
    const fin = new Date([finVig, finOrig, hoy].reduce((a, b) => a > b ? a : b));
    let d = new Date(inicioObra); d = new Date(d.getFullYear(), d.getMonth(), 1);
    while (d <= fin) {
      const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      meses.push(ultimo.toISOString().slice(0, 10));
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }
  const cumO = meses.map(f => PARTIDAS.reduce((s, p) => s + pesoO(p) * planO(p, f), 0) * 100);
  const cumV = meses.map(f => PARTIDAS.reduce((s, p) => s + peso(p) * avancePlanificadoEnFecha(p, f), 0) * 100);
  const cumR = meses.map(f => f <= hoy || f.slice(0, 7) === hoy.slice(0, 7)
    ? PARTIDAS.reduce((s, p) => s + peso(p) * avanceRealAcumuladoEnFecha(p.id, f > hoy ? hoy : f), 0) * 100 : null);
  const brecha = hay ? Math.max(...cumO.map((v, i) => v - cumV[i])) : 0;
  const brechaMonto = totalPresupuesto * brecha / 100;

  document.getElementById("ctrlAviso").style.display = hay ? "" : "none";
  if (hay) document.getElementById("ctrlAviso").innerHTML = `Línea base vigente: <b>${escapeHtml(REVISION_ACTIVA.nombre)}</b>. Se compara contra el contrato original (LB00).`;

  const tile = (l, v, cls) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${cls || ""}">${v}</div></div>`;
  kpis.innerHTML =
    tile("Presupuesto controlado", fmtM(totalPresupuesto)) +
    tile("Partidas / Frentes", PARTIDAS.length.toLocaleString("es-PE") + " / " + frentes.length) +
    tile("Plazo (días)", plazo) +
    tile("Avance económico real", pct(econReal)) +
    tile("Planificado a hoy", pct(econPlan)) +
    tile("Desface económico", (desface >= 0 ? "+" : "") + pct(desface), desface >= 0 ? "good" : "bad") +
    (hay ? tile("Fin de obra vs. LB00", (deltaFin >= 0 ? "+" : "") + deltaFin + " días", deltaFin > 0 ? "bad" : "good") +
           tile("Brecha máx. LB00 vs. vigente", pct(brecha) + " · " + fmtM(brechaMonto), "bad") : "");

  // Curva S
  const labels = meses.map(f => new Date(f + "T12:00:00").toLocaleDateString("es-PE", { month: "short", year: "2-digit" }));
  if (ctrlCurvaInstance) ctrlCurvaInstance.destroy();
  const dsCurva = [{ label: "LB00 · contrato original", data: cumO, borderColor: "#2a78d6", backgroundColor: "transparent", borderWidth: 3, tension: 0.2, pointRadius: 2 }];
  if (hay) dsCurva.push({ label: "Vigente · " + REVISION_ACTIVA.nombre, data: cumV, borderColor: "#e07b22", backgroundColor: "transparent", borderWidth: 3, tension: 0.2, pointRadius: 2 });
  dsCurva.push({ label: "Avance real", data: cumR, borderColor: "#1baf7a", backgroundColor: "rgba(27,175,122,0.1)", fill: true, borderWidth: 3, tension: 0.2, pointRadius: 3, spanGaps: false });
  ctrlCurvaInstance = new Chart(document.getElementById("ctrlCurvaChart").getContext("2d"), {
    type: "line", data: { labels, datasets: dsCurva },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100, ticks: { callback: v => v + "%" } } } },
  });

  // Producción mensual
  const dif = a => a.map((v, i) => v === null ? null : (v - (i > 0 && a[i - 1] !== null ? a[i - 1] : 0)) * totalPresupuesto / 100 / 1e6);
  const dsMes = [{ label: "LB00", data: dif(cumO), backgroundColor: "#2a78d6" }];
  if (hay) dsMes.push({ label: "Vigente", data: dif(cumV), backgroundColor: "#e07b22" });
  dsMes.push({ label: "Real", data: dif(cumR), backgroundColor: "#1baf7a" });
  if (ctrlMensualInstance) ctrlMensualInstance.destroy();
  ctrlMensualInstance = new Chart(document.getElementById("ctrlMensualChart").getContext("2d"), {
    type: "bar", data: { labels, datasets: dsMes },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => v + " M" } } } },
  });

  // Presupuesto por especialidad
  const esp = {};
  PARTIDAS.forEach(p => { const k = (p.frente.split(" — ")[1] || p.frente); esp[k] = (esp[k] || 0) + (p.presupuesto_total || 0); });
  const espArr = Object.entries(esp).sort((a, b) => b[1] - a[1]);
  const maxE = espArr.length ? espArr[0][1] : 1;
  document.getElementById("ctrlEspecialidades").innerHTML = espArr.map(([k, v]) => `
    <div style="display:flex; align-items:center; gap:10px; margin:6px 0; font-size:13px;">
      <div style="width:170px;">${escapeHtml(k)}</div>
      <div style="flex:1;"><div style="height:16px; width:${Math.max(v / maxE * 100, 0.5)}%; background:#2a78d6; border-radius:4px;"></div></div>
      <div style="width:150px; text-align:right;"><b>${fmtM(v)}</b> · ${totalPresupuesto > 0 ? (v / totalPresupuesto * 100).toFixed(1) : 0}%</div>
    </div>`).join("");

  // Tabla de plazo por frente
  const tb = document.querySelector("#ctrlTablaPlazo tbody");
  tb.innerHTML = frentes.sort().map(f => {
    const ps = PARTIDAS.filter(p => p.frente === f);
    const pres = ps.reduce((s, p) => s + (p.presupuesto_total || 0), 0);
    const fo = ps.reduce((m, p) => finO(p) > m ? finO(p) : m, "");
    const fv = ps.reduce((m, p) => p.fecha_fin_base > m ? p.fecha_fin_base : m, "");
    const dd = Math.round((new Date(fv) - new Date(fo)) / 86400000);
    return `<tr><td>${escapeHtml(f)}</td><td>${fmtM(pres)}</td><td>${fmtDate(fo)}</td><td>${fmtDate(fv)}</td><td style="color:${dd > 0 ? "var(--red)" : "inherit"}">${dd > 0 ? "+" + dd + " días" : "Sin cambio"}</td></tr>`;
  }).join("");
}

function lineChartConfig(labels, planData, realData, colorPlan, colorReal, fillReal, planOriginalData) {
  const datasets = [
    { label: planOriginalData ? "Línea base activa (revisada)" : "Línea base (planificado)", data: planData, borderColor: colorPlan, backgroundColor: "transparent", borderDash: [5,3], tension: 0.15, pointRadius: 0 },
    { label: "Avance real", data: realData, borderColor: colorReal, backgroundColor: fillReal, fill: true, tension: 0.15, pointRadius: 0 },
  ];
  if (planOriginalData) {
    datasets.push({ label: "Línea base original (LB00)", data: planOriginalData, borderColor: "#b5b4ac", backgroundColor: "transparent", borderDash: [2,2], tension: 0.15, pointRadius: 0 });
  }
  return {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: !!planOriginalData, position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + "%" } },
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 16 } },
      },
    },
  };
}

function renderTablaDesfacePorFrente(totalPresupuesto, hoy) {
  const frentes = [...new Set(PARTIDAS.map(p => p.frente))];
  const tbody = document.querySelector("#tablaDesfaceFrente tbody");
  tbody.innerHTML = "";

  frentes.forEach(frente => {
    const partidasFrente = PARTIDAS.filter(p => p.frente === frente);
    const pesoTotalFrente = partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto), 0);
    if (pesoTotalFrente === 0) {
      tbody.insertAdjacentHTML("beforeend", `<tr><td>${escapeHtml(frente)}</td><td colspan="4" style="color:var(--text-muted);">Sin presupuesto cargado</td></tr>`);
      return;
    }
    const real = partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto) * avanceRealAcumuladoEnFecha(p.id, hoy), 0) / pesoTotalFrente * 100;
    const plan = partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto) * avancePlanificadoEnFecha(p, hoy), 0) / pesoTotalFrente * 100;
    const desface = real - plan;
    let badge = 'ok', texto = 'En línea';
    if (desface < -10) { badge = 'late'; texto = 'Atrasado'; }
    else if (desface < -2) { badge = 'warn'; texto = 'Leve atraso'; }

    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(frente)}</td>
        <td>${real.toFixed(1)}%</td>
        <td>${plan.toFixed(1)}%</td>
        <td style="color:${desface >= 0 ? 'var(--green)' : 'var(--red)'}">${desface >= 0 ? '+' : ''}${desface.toFixed(1)}%</td>
        <td><span class="badge ${badge}">${texto}</span></td>
      </tr>
    `);
  });
}

// ---------------------------------------------------------
// Vista: GANTT DE AVANCE (por frente, expandible a partidas)
// ---------------------------------------------------------
function renderGantt() {
  const wrap = document.getElementById("ganttWrap");
  if (!wrap) return;

  if (PARTIDAS.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-muted);">Sin partidas cargadas para este proyecto.</p>`;
    return;
  }

  const totalPresupuesto = PARTIDAS.reduce((s,p) => s + (p.presupuesto_total || 0), 0);
  const hoy = new Date().toISOString().slice(0,10);

  const conFechas = PARTIDAS.filter(p => p.fecha_inicio_base && p.fecha_fin_base);
  if (conFechas.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-muted);">Ninguna partida tiene fechas base cargadas todavía.</p>`;
    return;
  }

  const start = new Date(Math.min(...conFechas.map(p => new Date(p.fecha_inicio_base))));
  const end = new Date(Math.max(...conFechas.map(p => new Date(p.fecha_fin_base))));
  const totalMs = end - start;
  if (!(totalMs > 0)) {
    wrap.innerHTML = `<p style="color:var(--text-muted);">Fechas base insuficientes para dibujar el Gantt.</p>`;
    return;
  }

  const pct = (date) => Math.max(0, Math.min(100, (date - start) / totalMs * 100));
  const todayPct = pct(new Date());

  // Agrupa por frente y calcula rango de fechas + % avance económico a hoy
  const frentes = [...new Set(PARTIDAS.map(p => p.frente))];
  const frenteData = frentes.map(frente => {
    const partidasFrente = PARTIDAS.filter(p => p.frente === frente && p.fecha_inicio_base && p.fecha_fin_base);
    if (partidasFrente.length === 0) return null;
    const fIni = new Date(Math.min(...partidasFrente.map(p => new Date(p.fecha_inicio_base))));
    const fFin = new Date(Math.max(...partidasFrente.map(p => new Date(p.fecha_fin_base))));
    const pesoTotalFrente = partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto), 0);
    const real = pesoTotalFrente > 0
      ? partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto) * avanceRealAcumuladoEnFecha(p.id, hoy), 0) / pesoTotalFrente * 100
      : 0;
    return { frente, partidas: partidasFrente, fIni, fFin, real };
  }).filter(Boolean);

  // Meses para la cabecera de la grilla
  const meses = [];
  let dm = new Date(start.getFullYear(), start.getMonth(), 1);
  while (dm <= end) {
    meses.push(new Date(dm));
    dm.setMonth(dm.getMonth() + 1);
  }
  const mesesNombres = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  const gridlinesHtml = meses.map(m =>
    `<div class="gantt-gridline" style="left:${pct(m)}%"></div><div class="gantt-month-label" style="left:${pct(m)}%">${mesesNombres[m.getMonth()]} ${m.getFullYear()}</div>`
  ).join("");

  let labelsHtml = `<div class="gantt-row gantt-header-row"><div class="gantt-label"></div></div>`;
  let tracksHtml = `<div class="gantt-track-row header-row"><div class="gantt-gridlines">${gridlinesHtml}</div></div>`;

  function barRow(left, width, avancePct, colorFill) {
    const w = Math.max(width, 0.4);
    const fillW = w * Math.max(0, Math.min(avancePct, 100)) / 100;
    const completo = avancePct >= 100;
    return `
      <div class="gantt-bar-bg" style="left:${left}%; width:${w}%;"></div>
      <div class="gantt-bar-fill ${completo ? 'completo' : ''}" style="left:${left}%; width:${fillW}%; background:${colorFill};"></div>
      <div class="gantt-pct-label" style="left:${Math.min(left + w + 1, 95)}%;">${avancePct.toFixed(0)}%</div>
      <div class="gantt-today-line" style="left:${todayPct}%;"></div>
    `;
  }

  frenteData.forEach(fd => {
    const expanded = GANTT_EXPANDED.has(fd.frente);
    const left = pct(fd.fIni);
    const width = pct(fd.fFin) - left;

    labelsHtml += `<div class="gantt-row frente-row" data-frente="${escapeAttr(fd.frente)}"><div class="gantt-label">${expanded ? '▾' : '▸'} ${escapeHtml(fd.frente)}</div></div>`;
    tracksHtml += `<div class="gantt-track-row frente-row" data-frente="${escapeAttr(fd.frente)}">${barRow(left, width, fd.real, '#2a78d6')}</div>`;

    if (expanded) {
      fd.partidas.forEach(p => {
        const pReal = avanceRealAcumuladoEnFecha(p.id, hoy) * 100;
        const pLeft = pct(new Date(p.fecha_inicio_base));
        const pWidth = pct(new Date(p.fecha_fin_base)) - pLeft;

        labelsHtml += `<div class="gantt-row partida-row"><div class="gantt-label" title="${escapeAttr(p.nombre)}">${escapeHtml(p.nombre)}</div></div>`;
        tracksHtml += `<div class="gantt-track-row">${barRow(pLeft, pWidth, pReal, '#1baf7a')}</div>`;
      });
    }
  });

  wrap.innerHTML = `
    <div class="gantt-chart">
      <div class="gantt-labels-col">${labelsHtml}</div>
      <div class="gantt-chart-col">${tracksHtml}</div>
    </div>
    <div class="legend-row">
      <span><span class="legend-dot" style="background:#2a78d6"></span>Avance económico por frente</span>
      <span><span class="legend-dot" style="background:#1baf7a"></span>Avance económico por partida (al expandir)</span>
      <span><span class="legend-dot" style="background:var(--red)"></span>Hoy</span>
    </div>
  `;

  wrap.querySelectorAll(".frente-row[data-frente]").forEach(row => {
    row.addEventListener("click", () => {
      const frente = row.dataset.frente;
      if (GANTT_EXPANDED.has(frente)) GANTT_EXPANDED.delete(frente);
      else GANTT_EXPANDED.add(frente);
      renderGantt();
    });
  });
}

// ---------------------------------------------------------
// Vista: USUARIOS / ASIGNACIONES (solo admin)
// ---------------------------------------------------------
async function renderUsuariosTab(proyectoId) {
  const wrap = document.getElementById("asignacionesWrap");
  if (!wrap) return;

  const { data: perfiles, error } = await supabaseClient
    .from("perfiles").select("id,nombre_completo,rol").order("nombre_completo");
  if (error) { wrap.innerHTML = `<p style="color:var(--red);">No se pudo cargar usuarios: ${escapeHtml(error.message)}</p>`; return; }

  const residentes = (perfiles || []).filter(p => p.rol === "residente");
  const frentes = [...new Set(PARTIDAS.map(p => p.frente))].sort();

  if (frentes.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-muted);">Este proyecto todavía no tiene partidas cargadas.</p>`;
    return;
  }
  if (residentes.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-muted);">No hay usuarios con rol "residente" todavía. Deben registrarse primero desde la pantalla de login; luego les asignas frente aquí.</p>`;
    return;
  }

  let html = `<table class="data-table"><thead><tr><th>Usuario</th>${frentes.map(f => `<th>${escapeHtml(f)}</th>`).join("")}</tr></thead><tbody>`;
  residentes.forEach(u => {
    html += `<tr><td>${escapeHtml(u.nombre_completo || u.id)}</td>`;
    frentes.forEach(f => {
      const asignado = ASIGNACIONES.some(a => a.perfil_id === u.id && a.frente === f);
      html += `<td style="text-align:center;"><input type="checkbox" data-perfil="${escapeAttr(u.id)}" data-frente="${escapeAttr(f)}" ${asignado ? "checked" : ""}></td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll("input[type=checkbox]").forEach(chk => {
    chk.addEventListener("change", async () => {
      const perfilId = chk.dataset.perfil;
      const frente = chk.dataset.frente;
      chk.disabled = true;

      if (chk.checked) {
        const { error } = await supabaseClient.from("asignaciones_frente").insert({
          perfil_id: perfilId, proyecto_id: proyectoId, frente,
        });
        if (error) { alert("No se pudo asignar: " + error.message); chk.checked = false; chk.disabled = false; return; }
      } else {
        const { error } = await supabaseClient.from("asignaciones_frente")
          .delete().eq("perfil_id", perfilId).eq("proyecto_id", proyectoId).eq("frente", frente);
        if (error) { alert("No se pudo quitar: " + error.message); chk.checked = true; chk.disabled = false; return; }
      }

      chk.disabled = false;
      await loadAsignaciones(proyectoId);
      if (perfilId === CURRENT_USER.id) renderPartidaSelectAvance();
    });
  });
}

// ---------------------------------------------------------
// Vista: LÍNEAS BASE (revisiones adicionales por cambios del cliente) — admin/planner
// ---------------------------------------------------------
async function loadOverridesEditando() {
  OVERRIDES_EDITANDO = {};
  if (!REVISION_EDITANDO) return;
  const data = await fetchAll(() =>
    supabaseClient.from("partidas_revision").select("*").eq("revision_id", REVISION_EDITANDO.id).order("id"));
  data.forEach(o => { OVERRIDES_EDITANDO[o.partida_id] = o; });
}

async function renderLineasBaseTab(proyectoId) {
  const wrap = document.getElementById("lineasBaseWrap");
  if (!wrap) return;

  if (REVISION_EDITANDO && !REVISIONES.find(r => r.id === REVISION_EDITANDO.id)) REVISION_EDITANDO = null;
  if (!REVISION_EDITANDO && !VIENDO_ORIGINAL && REVISIONES.length > 0) REVISION_EDITANDO = REVISION_ACTIVA || REVISIONES[REVISIONES.length - 1];
  if (REVISION_EDITANDO) VIENDO_ORIGINAL = false;
  await loadOverridesEditando();

  let html = `<div class="card" style="margin-bottom:12px;">
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">
      <select id="selectRevision" style="padding:7px 10px; border-radius:8px; border:1px solid var(--border);">
        <option value="">— Línea base original (LB00, contractual) —</option>
        ${REVISIONES.map(r => `<option value="${r.id}" ${REVISION_EDITANDO && REVISION_EDITANDO.id === r.id ? "selected" : ""}>${escapeHtml(r.nombre)}${r.activa ? " (ACTIVA)" : ""}</option>`).join("")}
      </select>
      <button class="small-btn primary" id="btnNuevaRevision">+ Nueva línea base</button>
      ${REVISION_EDITANDO ? `<button class="small-btn" id="btnActivarRevision" ${REVISION_EDITANDO.activa ? "disabled" : ""}>${REVISION_EDITANDO.activa ? "Es la activa" : "Activar esta línea base"}</button>` : ""}
      ${(REVISION_EDITANDO && REVISION_EDITANDO.activa) || (!REVISION_EDITANDO && REVISION_ACTIVA) ? `<button class="small-btn" id="btnDesactivarRevision">Usar LB00 como línea base oficial</button>` : ""}
    </div>
    <p class="save-hint">${REVISION_EDITANDO
      ? escapeHtml(REVISION_EDITANDO.motivo || "Sin motivo registrado") + " — creada " + fmtDate(REVISION_EDITANDO.fecha_creacion)
      : "Línea base original (LB00, contractual): solo lectura. " + (REVISION_ACTIVA ? "La línea base oficial hoy es " + escapeHtml(REVISION_ACTIVA.nombre) + "." : "Es la línea base oficial hoy.")}</p>
  </div>`;

  if (!REVISION_EDITANDO) {
    html += `<div class="card">
      <h2>Línea base original (LB00) — valores contractuales</h2>
      <input type="text" id="buscarPartidaOriginal" placeholder="Buscar partida o frente..." style="width:100%; margin-bottom:10px; padding:7px 10px; border-radius:8px; border:1px solid var(--border);">
      <table class="data-table" id="tablaOriginalPartidas">
        <thead><tr><th>Frente / Partida</th><th>Inicio</th><th>Fin</th><th>Unidad</th><th>Metrado total</th><th>P.U. (S/)</th><th>Presupuesto (S/)</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>`;
  }

  if (REVISION_EDITANDO) {
    html += `<div class="card">
      <h2>Editar partidas de "${escapeHtml(REVISION_EDITANDO.nombre)}"</h2>
      <p class="save-hint">Edita solo las partidas que realmente cambiaron por este motivo — las que no toques siguen usando el valor original (LB00). Los cambios se guardan al salir del campo. Deja una fecha vacía para volver a usar la original en esa partida.</p>
      <input type="text" id="buscarPartidaRevision" placeholder="Buscar partida o frente..." style="width:100%; margin-bottom:10px; padding:7px 10px; border-radius:8px; border:1px solid var(--border);">
      <table class="data-table" id="tablaRevisionPartidas">
        <thead><tr><th>Frente / Partida</th><th>Inicio base</th><th>Fin base</th><th>Metrado total</th><th>P.U. (S/)</th><th>Presupuesto (S/)</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>`;
  }

  wrap.innerHTML = html;

  document.getElementById("selectRevision").addEventListener("change", async (e) => {
    const id = e.target.value;
    REVISION_EDITANDO = id ? REVISIONES.find(r => r.id === id) : null;
    VIENDO_ORIGINAL = !id;
    await renderLineasBaseTab(proyectoId);
  });

  document.getElementById("btnNuevaRevision").addEventListener("click", async () => {
    const nombre = prompt("Nombre de la nueva línea base (ej. 'LB01 - Cambios cliente oct 2026'):");
    if (!nombre) return;
    const motivo = prompt("Motivo del cambio (opcional):") || null;
    const { data, error } = await supabaseClient.from("revisiones_linea_base").insert({
      proyecto_id: proyectoId, nombre, motivo, creado_por: CURRENT_USER.id, activa: false,
    }).select().single();
    if (error) { alert("No se pudo crear: " + error.message); return; }
    await loadRevisiones(proyectoId);
    REVISION_EDITANDO = data;
    await renderLineasBaseTab(proyectoId);
  });

  const btnActivar = document.getElementById("btnActivarRevision");
  if (btnActivar) btnActivar.addEventListener("click", async () => {
    if (!confirm(`¿Activar "${REVISION_EDITANDO.nombre}" como línea base? Reemplaza a la que usan hoy el dashboard, el Gantt y los desfaces, para todos los usuarios.`)) return;
    await supabaseClient.from("revisiones_linea_base").update({ activa: false }).eq("proyecto_id", proyectoId);
    const { error } = await supabaseClient.from("revisiones_linea_base").update({ activa: true }).eq("id", REVISION_EDITANDO.id);
    if (error) { alert("No se pudo activar: " + error.message); return; }
    await onProyectoChange();
  });

  const btnDesactivar = document.getElementById("btnDesactivarRevision");
  if (btnDesactivar) btnDesactivar.addEventListener("click", async () => {
    if (!confirm("¿Volver a usar la línea base original (LB00) en el dashboard?")) return;
    await supabaseClient.from("revisiones_linea_base").update({ activa: false }).eq("proyecto_id", proyectoId);
    await onProyectoChange();
  });

  if (REVISION_EDITANDO) {
    renderTablaRevisionPartidas();
    document.getElementById("buscarPartidaRevision").addEventListener("input", renderTablaRevisionPartidas);
  } else {
    renderTablaOriginalPartidas();
    document.getElementById("buscarPartidaOriginal").addEventListener("input", renderTablaOriginalPartidas);
  }
}

// Tabla de solo lectura con los valores ORIGINALES (LB00) de cada partida
function renderTablaOriginalPartidas() {
  const tbody = document.querySelector("#tablaOriginalPartidas tbody");
  if (!tbody) return;
  const filtro = (document.getElementById("buscarPartidaOriginal").value || "").trim().toLowerCase();
  tbody.innerHTML = "";

  let lista = PARTIDAS;
  if (filtro.length >= 2) {
    lista = lista.filter(p => p.nombre.toLowerCase().includes(filtro) || p.frente.toLowerCase().includes(filtro));
  } else if (PARTIDAS.length > MAX_FILAS_REVISION) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted); padding:16px;">Hay ${PARTIDAS.length} partidas — escribe al menos 2 letras en el buscador.</td></tr>`;
    return;
  }
  if (lista.length > MAX_FILAS_REVISION) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted); padding:16px;">${lista.length} resultados — afina más la búsqueda.</td></tr>`;
    lista = lista.slice(0, MAX_FILAS_REVISION);
  }

  let lastFrente = null;
  lista.forEach(p => {
    if (p.frente !== lastFrente) {
      lastFrente = p.frente;
      tbody.insertAdjacentHTML("beforeend", `<tr class="frente-group-row"><td colspan="7">${escapeHtml(p.frente)}</td></tr>`);
    }
    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td style="padding-left:20px;">${escapeHtml(p.nombre)}</td>
        <td>${fmtDate(p.orig_fecha_inicio_base)}</td>
        <td>${fmtDate(p.orig_fecha_fin_base)}</td>
        <td>${escapeHtml(p.unidad || "")}</td>
        <td>${p.orig_metrado_total}</td>
        <td>${p.orig_precio_unitario}</td>
        <td style="font-weight:600;">S/ ${Number(p.orig_presupuesto_total || 0).toLocaleString('es-PE', {maximumFractionDigits:2})}</td>
      </tr>`);
  });
}

const MAX_FILAS_REVISION = 300;

function renderTablaRevisionPartidas() {
  const tbody = document.querySelector("#tablaRevisionPartidas tbody");
  if (!tbody) return;
  const filtro = (document.getElementById("buscarPartidaRevision").value || "").trim().toLowerCase();
  tbody.innerHTML = "";

  let lista = PARTIDAS;
  if (filtro.length >= 2) {
    lista = lista.filter(p => p.nombre.toLowerCase().includes(filtro) || p.frente.toLowerCase().includes(filtro));
  } else if (PARTIDAS.length > MAX_FILAS_REVISION) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted); padding:16px;">Hay ${PARTIDAS.length} partidas — escribe al menos 2 letras en el buscador.</td></tr>`;
    return;
  }
  if (lista.length > MAX_FILAS_REVISION) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted); padding:16px;">${lista.length} resultados — afina más la búsqueda.</td></tr>`;
    lista = lista.slice(0, MAX_FILAS_REVISION);
  }

  let lastFrente = null;
  lista.forEach(p => {
    const o = OVERRIDES_EDITANDO[p.id];
    const tieneCambio = !!o;
    if (p.frente !== lastFrente) {
      lastFrente = p.frente;
      const trGroup = document.createElement("tr");
      trGroup.className = "frente-group-row";
      trGroup.innerHTML = `<td colspan="6">${escapeHtml(p.frente)}</td>`;
      tbody.appendChild(trGroup);
    }
    const fIni = (o && o.fecha_inicio_base) || p.orig_fecha_inicio_base;
    const fFin = (o && o.fecha_fin_base) || p.orig_fecha_fin_base;
    const metrado = (o && o.metrado_total !== null && o.metrado_total !== undefined) ? o.metrado_total : p.orig_metrado_total;
    const pu = (o && o.precio_unitario !== null && o.precio_unitario !== undefined) ? o.precio_unitario : p.orig_precio_unitario;
    const presu = (o && o.presupuesto_total !== null && o.presupuesto_total !== undefined) ? o.presupuesto_total : Number(metrado||0) * Number(pu||0);

    const tr = document.createElement("tr");
    if (tieneCambio) tr.style.background = "color-mix(in srgb, var(--yellow) 12%, transparent)";
    tr.innerHTML = `
      <td style="padding-left:20px;">${escapeHtml(p.nombre)}${tieneCambio ? ' <span class="badge warn" style="margin-left:6px;">modificado</span>' : ""}</td>
      <td><input type="date" data-field="fecha_inicio_base" value="${fIni || ""}"></td>
      <td><input type="date" data-field="fecha_fin_base" value="${fFin || ""}"></td>
      <td><input type="number" step="0.0001" data-field="metrado_total" value="${metrado}"></td>
      <td><input type="number" step="0.0001" data-field="precio_unitario" value="${pu}"></td>
      <td class="presupuesto-cell" style="font-weight:600;">S/ ${Number(presu || 0).toLocaleString('es-PE', {maximumFractionDigits:2})}</td>
    `;
    tbody.appendChild(tr);

    tr.querySelectorAll("input").forEach(input => {
      input.addEventListener("change", async () => {
        const current = OVERRIDES_EDITANDO[p.id] || {
          revision_id: REVISION_EDITANDO.id, partida_id: p.id,
          fecha_inicio_base: p.orig_fecha_inicio_base, fecha_fin_base: p.orig_fecha_fin_base,
          metrado_total: p.orig_metrado_total, precio_unitario: p.orig_precio_unitario, presupuesto_total: p.orig_presupuesto_total,
        };
        const field = input.dataset.field;
        current[field] = (field === "fecha_inicio_base" || field === "fecha_fin_base")
          ? (input.value || null)
          : parseFloat(input.value || "0");
        if (field === "metrado_total" || field === "precio_unitario") {
          current.presupuesto_total = Number(current.metrado_total || 0) * Number(current.precio_unitario || 0);
          tr.querySelector(".presupuesto-cell").textContent = "S/ " + current.presupuesto_total.toLocaleString('es-PE', {maximumFractionDigits:2});
        }
        const { error } = await supabaseClient.from("partidas_revision").upsert(current, { onConflict: "revision_id,partida_id" });
        if (error) { alert("No se pudo guardar: " + error.message); return; }
        OVERRIDES_EDITANDO[p.id] = current;
        if (REVISION_EDITANDO.activa) {
          OVERRIDES_ACTIVA[p.id] = current;
          aplicarOverridesActivos();
          renderDashboard();
        }
      });
    });
  });
}

// ---------------------------------------------------------
// Utilidades
// ---------------------------------------------------------
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${String(d.getDate()).padStart(2,'0')}-${meses[d.getMonth()]}-${d.getFullYear()}`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }


// ---------------------------------------------------------
// Asistente IA (Edge Function "asistente" en Supabase). No envia montos en soles.
// ---------------------------------------------------------
let ASIST_HISTORIAL = [];

function buildContextoObra() {
  const hoy = new Date().toISOString().slice(0, 10);
  const total = PARTIDAS.reduce((s, p) => s + (p.presupuesto_total || 0), 0);
  const peso = p => total > 0 ? (p.presupuesto_total || 0) / total : 0;
  const real = p => avanceRealAcumuladoEnFecha(p.id, hoy) * 100;
  const plan = p => avancePlanificadoEnFecha(p, hoy) * 100;
  const proy = PROYECTOS.find(p => p.id === document.getElementById("proyectoSelectDash").value);
  const econReal = PARTIDAS.reduce((s, p) => s + peso(p) * real(p), 0);
  const econPlan = PARTIDAS.reduce((s, p) => s + peso(p) * plan(p), 0);
  const frentes = [...new Set(PARTIDAS.map(p => p.frente))].map(f => {
    const ps = PARTIDAS.filter(p => p.frente === f);
    const w = ps.reduce((s, p) => s + (p.presupuesto_total || 0), 0) || 1;
    const r = ps.reduce((s, p) => s + (p.presupuesto_total || 0) * real(p), 0) / w;
    const pl = ps.reduce((s, p) => s + (p.presupuesto_total || 0) * plan(p), 0) / w;
    const ini = ps.reduce((m, p) => (!m || p.fecha_inicio_base < m) ? p.fecha_inicio_base : m, null);
    const fin = ps.reduce((m, p) => (!m || p.fecha_fin_base > m) ? p.fecha_fin_base : m, null);
    return { f, r, pl, d: r - pl, ini, fin, n: ps.length, pesoPct: total > 0 ? w / total * 100 : 0 };
  }).sort((a, b) => a.d - b.d);
  const criticas = PARTIDAS.filter(p => p.metrado_total > 0)
    .map(p => ({ p, d: real(p) - plan(p) })).filter(x => x.d < -0.5)
    .sort((a, b) => a.d - b.d).slice(0, 15);
  const lines = [];
  lines.push(`Proyecto: ${proy ? proy.nombre : ""}. Fecha de hoy: ${hoy}. Usuario con rol: ${CURRENT_PROFILE.rol}.`);
  lines.push(`Linea base vigente: ${REVISION_ACTIVA ? REVISION_ACTIVA.nombre : "LB00 (contrato original)"}.`);
  lines.push(`Avance economico real ${econReal.toFixed(1)}%, planificado a hoy ${econPlan.toFixed(1)}%, desface ${(econReal - econPlan).toFixed(1)} puntos.`);
  lines.push(`Partidas: ${PARTIDAS.length}. Registros de avance: ${AVANCES.length}.`);
  lines.push("Frentes (real% / planificado% / desface / peso en presupuesto% / inicio-fin base):");
  frentes.forEach(x => lines.push(`- ${x.f}: ${x.r.toFixed(1)} / ${x.pl.toFixed(1)} / ${x.d.toFixed(1)} / ${x.pesoPct.toFixed(1)}% / ${x.ini} a ${x.fin} (${x.n} partidas)`));
  if (criticas.length) {
    lines.push("Partidas con mayor atraso (real% / plan%):");
    criticas.forEach(x => lines.push(`- ${x.p.frente} / ${x.p.nombre}: ${real(x.p).toFixed(0)} / ${plan(x.p).toFixed(0)}`));
  } else lines.push("No hay partidas con atraso registrado a hoy.");
  return lines.join("\n");
}

function asistAgregar(rol, texto, extra) {
  const chat = document.getElementById("asistChat");
  const bg = rol === "user" ? "#eef4fc" : "#f4f3ef";
  chat.insertAdjacentHTML("beforeend",
    `<div style="margin:8px 0; padding:8px 12px; border-radius:8px; background:${bg}; white-space:pre-wrap;"><b>${rol === "user" ? "Tú" : "Asistente"}</b>${extra ? ` <span style="color:var(--text-muted); font-size:11px;">(${escapeHtml(extra)})</span>` : ""}<br>${escapeHtml(String(texto).replace(/\*\*/g, ""))}</div>`);
  chat.scrollTop = chat.scrollHeight;
}

async function asistEnviar(pregunta) {
  if (!pregunta.trim()) return;
  const btn = document.getElementById("asistBtn");
  asistAgregar("user", pregunta);
  ASIST_HISTORIAL.push({ role: "user", content: pregunta });
  btn.disabled = true; btn.textContent = "Pensando...";
  try {
    const { data, error } = await supabaseClient.functions.invoke("asistente", {
      body: { messages: ASIST_HISTORIAL, contexto: buildContextoObra() },
    });
    if (error) {
      let msg = error.message;
      try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (_) {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    ASIST_HISTORIAL.push({ role: "assistant", content: data.respuesta });
    asistAgregar("assistant", data.respuesta);
  } catch (e) {
    ASIST_HISTORIAL.pop();
    asistAgregar("assistant", "No pude responder: " + e.message);
  }
  btn.disabled = false; btn.textContent = "Enviar";
}

function initAsistente() {
  const form = document.getElementById("asistForm");
  if (!form) return;
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const inp = document.getElementById("asistInput");
    const q = inp.value; inp.value = "";
    asistEnviar(q);
  });
  document.querySelectorAll("#view-asistente [data-q]").forEach(b =>
    b.addEventListener("click", () => asistEnviar(b.dataset.q)));
}


// ---------------------------------------------------------
// Pestaña "Restricciones": matriz de restricciones online + estadisticas
// ---------------------------------------------------------
let RESTRICCIONES = [];
let REST_EDIT_ID = null;
let restChartLookahead = null, restChartCategoria = null, restChartEstado = null, restChartResp = null;

const REST_CATEGORIAS = ["Ingeniería y diseño", "Información / RFI", "Materiales", "Mano de obra", "Equipos y maquinaria", "Subcontratos",
  "Permisos y licencias", "Cliente / Operación del mall", "SSOMA", "Interferencias y coordinación", "Financiero / Contractual",
  "Accesos y logística", "Clima y entorno"];
const REST_ESTADOS = ["Identificada", "En gestión", "Levantada"];
const REST_RESPONSABLES = ["Residente de obra", "Ingeniero de campo", "Planeamiento", "Logística / Compras", "Oficina técnica", "SSOMA",
  "Calidad", "Gerencia de proyecto", "Cliente (Open Plaza)", "Proyectista", "Subcontratista"];
const REST_SEMANAS = ["Vencida", "Sem 1", "Sem 2", "Sem 3", "Sem 4", "Sem 5", "Sem 6", "Más de 6 sem"];

function restPuedeEditar() { return ["admin", "planner", "residente"].includes(CURRENT_PROFILE.rol); }
function restPuedeBorrar() { return ["admin", "planner"].includes(CURRENT_PROFILE.rol); }

function restDias(r, hoy) {
  if (!r.fecha_requerida || r.estado === "Levantada") return null;
  return Math.round((new Date(r.fecha_requerida + "T00:00:00") - new Date(hoy + "T00:00:00")) / 86400000);
}
function restAlerta(r, hoy) {
  if (r.estado === "Levantada") return "Cerrada";
  const d = restDias(r, hoy);
  if (d === null) return "";
  if (d < 0) return "Vencida";
  if (d <= 7) return "Urgente";
  if (d <= 21) return "Próxima";
  return "En plazo";
}
function restSemana(r, hoy) {
  const d = restDias(r, hoy);
  if (d === null) return null;
  if (d < 0) return "Vencida";
  const n = Math.floor(d / 7) + 1;
  return n > 6 ? "Más de 6 sem" : "Sem " + n;
}
function restSeveridad(r) { return (r.probabilidad && r.impacto) ? r.probabilidad * r.impacto : null; }
function restNivel(r) {
  const s = restSeveridad(r);
  if (s === null) return "";
  return s >= 15 ? "Crítico" : s >= 10 ? "Alto" : s >= 5 ? "Medio" : "Bajo";
}
function restCodigo(r) { return "R-" + String(r.numero).padStart(3, "0"); }
function restBadge(texto, mapa) {
  if (!texto) return "";
  const c = mapa[texto] || ["#e5e7eb", "#111"];
  return `<span style="background:${c[0]}; color:${c[1]}; padding:2px 8px; border-radius:10px; font-size:11.5px; white-space:nowrap;">${escapeHtml(texto)}</span>`;
}
const REST_COL_ALERTA = { "Vencida": ["#c00000", "#fff"], "Urgente": ["#f4b183", "#000"], "Próxima": ["#ffe699", "#000"], "En plazo": ["#c6e0b4", "#000"], "Cerrada": ["#d9d9d9", "#444"] };
const REST_COL_NIVEL = { "Crítico": ["#c00000", "#fff"], "Alto": ["#f4b183", "#000"], "Medio": ["#ffe699", "#000"], "Bajo": ["#c6e0b4", "#000"] };

async function loadRestricciones(proyectoId) {
  RESTRICCIONES = await fetchAll(() => supabaseClient.from("restricciones").select("*").eq("proyecto_id", proyectoId).order("numero"));
  renderRestricciones();
}

function restOpcionesFrente() {
  return ["General / Todo el proyecto", ...[...new Set(PARTIDAS.map(p => p.frente))].sort()];
}

function renderRestricciones() {
  const cont = document.getElementById("restKpis");
  if (!cont) return;
  const hoy = new Date().toISOString().slice(0, 10);
  const abiertas = RESTRICCIONES.filter(r => r.estado !== "Levantada");
  const levantadas = RESTRICCIONES.length - abiertas.length;
  const vencidas = abiertas.filter(r => restAlerta(r, hoy) === "Vencida").length;
  const urgentes = abiertas.filter(r => restAlerta(r, hoy) === "Urgente").length;
  const criticas = abiertas.filter(r => ["Crítico", "Alto"].includes(restNivel(r))).length;
  const sumPlazo = abiertas.reduce((s, r) => s + (Number(r.impacto_plazo_dias) || 0), 0);
  const indice = RESTRICCIONES.length ? (levantadas / RESTRICCIONES.length * 100) : 0;
  const tile = (l, v, cls) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${cls || ""}">${v}</div></div>`;
  cont.innerHTML =
    tile("Registradas", RESTRICCIONES.length) +
    tile("Abiertas", abiertas.length) +
    tile("Vencidas", vencidas, vencidas > 0 ? "bad" : "good") +
    tile("Urgentes (≤ 7 días)", urgentes, urgentes > 0 ? "bad" : "") +
    tile("Críticas o altas abiertas", criticas, criticas > 0 ? "bad" : "") +
    tile("Índice de levantamiento", indice.toFixed(0) + "%") +
    tile("Impacto en plazo abiertas (suma ref.)", sumPlazo + " d");

  // Lookahead apilado por nivel de riesgo
  const niveles = ["Crítico", "Alto", "Medio", "Bajo", "Sin evaluar"];
  const colNivel = { "Crítico": "#c00000", "Alto": "#f4b183", "Medio": "#ffe699", "Bajo": "#c6e0b4", "Sin evaluar": "#bdbdbd" };
  const dsLook = niveles.map(n => ({
    label: n, backgroundColor: colNivel[n],
    data: REST_SEMANAS.map(s => abiertas.filter(r => restSemana(r, hoy) === s && (restNivel(r) || "Sin evaluar") === n).length),
  }));
  if (restChartLookahead) restChartLookahead.destroy();
  restChartLookahead = new Chart(document.getElementById("restChartLookahead").getContext("2d"), {
    type: "bar", data: { labels: REST_SEMANAS, datasets: dsLook },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
  });

  // Por categoría: abiertas vs levantadas
  const cats = [...new Set(RESTRICCIONES.map(r => r.categoria).filter(Boolean))];
  if (restChartCategoria) restChartCategoria.destroy();
  restChartCategoria = new Chart(document.getElementById("restChartCategoria").getContext("2d"), {
    type: "bar",
    data: { labels: cats, datasets: [
      { label: "Abiertas", backgroundColor: "#2a78d6", data: cats.map(c => RESTRICCIONES.filter(r => r.categoria === c && r.estado !== "Levantada").length) },
      { label: "Levantadas", backgroundColor: "#1baf7a", data: cats.map(c => RESTRICCIONES.filter(r => r.categoria === c && r.estado === "Levantada").length) },
    ] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true } } },
  });

  // Por estado
  if (restChartEstado) restChartEstado.destroy();
  restChartEstado = new Chart(document.getElementById("restChartEstado").getContext("2d"), {
    type: "doughnut",
    data: { labels: REST_ESTADOS, datasets: [{ data: REST_ESTADOS.map(e => RESTRICCIONES.filter(r => r.estado === e).length), backgroundColor: ["#e07b22", "#2a78d6", "#1baf7a"] }] },
    options: { responsive: true, maintainAspectRatio: false },
  });

  // Por responsable: abiertas y vencidas
  const resp = [...new Set(abiertas.map(r => r.responsable).filter(Boolean))];
  if (restChartResp) restChartResp.destroy();
  restChartResp = new Chart(document.getElementById("restChartResp").getContext("2d"), {
    type: "bar",
    data: { labels: resp, datasets: [
      { label: "Abiertas", backgroundColor: "#2a78d6", data: resp.map(x => abiertas.filter(r => r.responsable === x).length) },
      { label: "Vencidas", backgroundColor: "#c00000", data: resp.map(x => abiertas.filter(r => r.responsable === x && restAlerta(r, hoy) === "Vencida").length) },
    ] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
  });

  // Mapa de calor 5x5 (abiertas)
  let heat = `<table class="data-table" style="width:auto; text-align:center;"><thead><tr><th>Prob. \\ Impacto</th>${[1, 2, 3, 4, 5].map(i => `<th>${i}</th>`).join("")}</tr></thead><tbody>`;
  for (let p = 5; p >= 1; p--) {
    heat += `<tr><th>${p}</th>`;
    for (let i = 1; i <= 5; i++) {
      const sev = p * i;
      const bg = sev >= 15 ? "#c00000" : sev >= 10 ? "#f4b183" : sev >= 5 ? "#ffe699" : "#c6e0b4";
      const n = abiertas.filter(r => r.probabilidad === p && r.impacto === i).length;
      heat += `<td style="background:${bg}; color:${sev >= 15 ? "#fff" : "#000"}; font-weight:700; min-width:48px;">${n || ""}</td>`;
    }
    heat += "</tr>";
  }
  document.getElementById("restHeatmap").innerHTML = heat + "</tbody></table>";

  // Filtros (se conservan los valores elegidos)
  const fill = (id, items, todos) => {
    const sel = document.getElementById(id); const v = sel.value;
    sel.innerHTML = `<option value="">${todos}</option>` + items.map(x => `<option>${escapeHtml(x)}</option>`).join("");
    sel.value = v;
  };
  fill("restFiltCat", REST_CATEGORIAS, "Todas las categorías");
  fill("restFiltFrente", restOpcionesFrente(), "Todos los frentes");
  restRenderTabla();
  renderKpis();
}

function restRenderTabla() {
  const hoy = new Date().toISOString().slice(0, 10);
  const fe = document.getElementById("restFiltEstado").value;
  const fc = document.getElementById("restFiltCat").value;
  const ff = document.getElementById("restFiltFrente").value;
  const q = document.getElementById("restBuscar").value.trim().toLowerCase();
  let lista = RESTRICCIONES.filter(r => {
    if (fe === "abiertas" && r.estado === "Levantada") return false;
    if (fe && fe !== "abiertas" && fe !== "todas" && r.estado !== fe) return false;
    if (fc && r.categoria !== fc) return false;
    if (ff && r.frente !== ff) return false;
    if (q && !((r.descripcion || "") + " " + (r.actividad || "") + " " + (r.responsable || "") + " " + restCodigo(r)).toLowerCase().includes(q)) return false;
    return true;
  });
  lista.sort((a, b) => {
    const la = a.estado === "Levantada" ? 1 : 0, lb = b.estado === "Levantada" ? 1 : 0;
    if (la !== lb) return la - lb;
    return (a.fecha_requerida || "9999").localeCompare(b.fecha_requerida || "9999");
  });
  const tb = document.querySelector("#restTabla tbody");
  const puedeE = restPuedeEditar(), puedeB = restPuedeBorrar();
  tb.innerHTML = lista.length ? lista.map(r => `
    <tr>
      <td><b>${restCodigo(r)}</b></td>
      <td>${escapeHtml(r.frente || "")}</td>
      <td>${escapeHtml(r.actividad || "")}</td>
      <td style="min-width:260px;">${escapeHtml(r.descripcion || "")}</td>
      <td>${escapeHtml(r.categoria || "")}</td>
      <td>${escapeHtml(r.responsable || "")}</td>
      <td>${r.fecha_requerida ? fmtDate(r.fecha_requerida) : ""}</td>
      <td>${escapeHtml(r.estado || "")}</td>
      <td>${restBadge(restAlerta(r, hoy), REST_COL_ALERTA)}</td>
      <td>${restSemana(r, hoy) || ""}</td>
      <td>${restBadge(restNivel(r), REST_COL_NIVEL)}</td>
      <td style="white-space:nowrap;">
        ${puedeE ? `<button class="btn" data-ract="edit" data-id="${r.id}" style="padding:3px 8px; font-size:11.5px;">Editar</button>` : ""}
        ${puedeE && r.estado !== "Levantada" ? `<button class="btn" data-ract="levantar" data-id="${r.id}" style="padding:3px 8px; font-size:11.5px;">Levantar</button>` : ""}
        ${puedeB ? `<button class="btn" data-ract="del" data-id="${r.id}" style="padding:3px 8px; font-size:11.5px; background:var(--red);">Borrar</button>` : ""}
      </td>
    </tr>`).join("") : `<tr><td colspan="12" style="color:var(--text-muted);">No hay restricciones con estos filtros.</td></tr>`;
  tb.querySelectorAll("[data-ract]").forEach(b => b.addEventListener("click", () => restAccion(b.dataset.ract, b.dataset.id)));
}

function restAbrirForm(r) {
  REST_EDIT_ID = r ? r.id : null;
  const f = document.getElementById("restForm");
  f.style.display = "";
  document.getElementById("restFormTitulo").textContent = r ? "Editar " + restCodigo(r) : "Nueva restricción";
  const set = (id, v) => { document.getElementById(id).value = v == null ? "" : v; };
  const optList = (id, items, val) => { const s = document.getElementById(id); s.innerHTML = items.map(x => `<option>${escapeHtml(x)}</option>`).join(""); s.value = val || items[0]; };
  optList("rfFrente", restOpcionesFrente(), r && r.frente);
  optList("rfCategoria", REST_CATEGORIAS, r && r.categoria);
  optList("rfEstado", REST_ESTADOS, r && r.estado);
  document.getElementById("rfRespList").innerHTML = REST_RESPONSABLES.map(x => `<option value="${escapeAttr(x)}">`).join("");
  set("rfActividad", r && r.actividad); set("rfDescripcion", r && r.descripcion); set("rfResponsable", r && r.responsable);
  set("rfFIdent", r ? r.fecha_identificacion : new Date().toISOString().slice(0, 10));
  set("rfFReq", r && r.fecha_requerida); set("rfFComp", r && r.fecha_compromiso); set("rfFLev", r && r.fecha_levantamiento);
  set("rfProb", r && r.probabilidad); set("rfImpacto", r && r.impacto);
  set("rfPlazo", r && r.impacto_plazo_dias); set("rfCosto", r && r.impacto_costo);
  set("rfAccion", r && r.accion); set("rfObs", r && r.observaciones);
  document.getElementById("restMsg").textContent = "";
  f.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function restGuardar(ev) {
  ev.preventDefault();
  const v = id => document.getElementById(id).value.trim();
  const num = id => v(id) === "" ? null : Number(v(id));
  const dat = id => v(id) === "" ? null : v(id);
  const estado = v("rfEstado");
  const fila = {
    proyecto_id: document.getElementById("proyectoSelectDash").value,
    frente: v("rfFrente"), actividad: v("rfActividad"), descripcion: v("rfDescripcion"),
    categoria: v("rfCategoria"), responsable: v("rfResponsable"),
    fecha_identificacion: dat("rfFIdent"), fecha_requerida: dat("rfFReq"), fecha_compromiso: dat("rfFComp"),
    fecha_levantamiento: dat("rfFLev") || (estado === "Levantada" ? new Date().toISOString().slice(0, 10) : null),
    estado, probabilidad: num("rfProb"), impacto: num("rfImpacto"),
    impacto_plazo_dias: num("rfPlazo"), impacto_costo: num("rfCosto"),
    accion: v("rfAccion"), observaciones: v("rfObs"),
  };
  const msg = document.getElementById("restMsg");
  if (!fila.descripcion) { msg.textContent = "Escribe la descripción de la restricción."; return; }
  let error;
  if (REST_EDIT_ID) {
    delete fila.proyecto_id;
    ({ error } = await supabaseClient.from("restricciones").update(fila).eq("id", REST_EDIT_ID));
  } else {
    ({ error } = await supabaseClient.from("restricciones").insert(fila));
  }
  if (error) { msg.textContent = "No se pudo guardar: " + error.message; return; }
  document.getElementById("restForm").style.display = "none";
  await loadRestricciones(document.getElementById("proyectoSelectDash").value);
}

async function restAccion(accion, id) {
  const r = RESTRICCIONES.find(x => x.id === id);
  if (!r) return;
  if (accion === "edit") return restAbrirForm(r);
  let error;
  if (accion === "levantar") {
    ({ error } = await supabaseClient.from("restricciones").update({ estado: "Levantada", fecha_levantamiento: new Date().toISOString().slice(0, 10) }).eq("id", id));
  } else if (accion === "del") {
    if (!confirm("¿Borrar " + restCodigo(r) + "? Esta acción no se puede deshacer.")) return;
    ({ error } = await supabaseClient.from("restricciones").delete().eq("id", id));
  }
  if (error) { alert("No se pudo completar: " + error.message); return; }
  await loadRestricciones(document.getElementById("proyectoSelectDash").value);
}

function restExportarCSV() {
  const hoy = new Date().toISOString().slice(0, 10);
  const cab = ["ID", "Frente", "Actividad", "Restricción", "Categoría", "Responsable", "F. identificación", "F. requerida", "F. compromiso", "F. levantamiento", "Estado", "Días para requerida", "Alerta", "Semana lookahead", "Probabilidad", "Impacto", "Severidad", "Nivel", "Impacto plazo (días)", "Impacto costo (S/)", "Acción", "Observaciones"];
  const esc = x => { const s = x == null ? "" : String(x); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const filas = RESTRICCIONES.map(r => [restCodigo(r), r.frente, r.actividad, r.descripcion, r.categoria, r.responsable, r.fecha_identificacion, r.fecha_requerida, r.fecha_compromiso, r.fecha_levantamiento, r.estado, restDias(r, hoy), restAlerta(r, hoy), restSemana(r, hoy), r.probabilidad, r.impacto, restSeveridad(r), restNivel(r), r.impacto_plazo_dias, r.impacto_costo, r.accion, r.observaciones].map(esc).join(";"));
  const blob = new Blob(["﻿" + [cab.join(";"), ...filas].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "matriz_restricciones_" + hoy + ".csv"; a.click();
}

function initRestricciones() {
  const f = document.getElementById("restForm");
  if (!f) return;
  f.addEventListener("submit", restGuardar);
  document.getElementById("restNueva").addEventListener("click", () => restAbrirForm(null));
  document.getElementById("restCancelar").addEventListener("click", () => { f.style.display = "none"; });
  document.getElementById("restCSV").addEventListener("click", restExportarCSV);
  ["restFiltEstado", "restFiltCat", "restFiltFrente"].forEach(id => document.getElementById(id).addEventListener("change", restRenderTabla));
  document.getElementById("restBuscar").addEventListener("input", restRenderTabla);
  if (!restPuedeEditar()) document.getElementById("restNueva").style.display = "none";
}


// ---------------------------------------------------------
// Pestaña "KPIs": indicadores de control de obra calculados con los datos existentes
// (no repite los de Dashboard / Control de Avance / Restricciones)
// ---------------------------------------------------------
let kpiChartPareto = null, kpiChartSemanal = null;

function kpiFmtSoles(v) { return "S/ " + Math.round(v).toLocaleString("es-PE"); }
function kpiDias(a, b) { return Math.round((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000); }
function kpiSumarDias(iso, n) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

function renderKpis() {
  const cont = document.getElementById("kpiGrupoPlazo");
  if (!cont || !PARTIDAS.length) return;
  const hoy = new Date().toISOString().slice(0, 10);
  const total = PARTIDAS.reduce((s, p) => s + (p.presupuesto_total || 0), 0);
  const conMetrado = PARTIDAS.filter(p => p.metrado_total > 0);
  const real = p => avanceRealAcumuladoEnFecha(p.id, hoy) * 100;
  const plan = p => avancePlanificadoEnFecha(p, hoy) * 100;
  const econReal = total > 0 ? PARTIDAS.reduce((s, p) => s + (p.presupuesto_total || 0) * real(p), 0) / total : 0;
  const econPlan = total > 0 ? PARTIDAS.reduce((s, p) => s + (p.presupuesto_total || 0) * plan(p), 0) / total : 0;
  const fisReal = conMetrado.length ? conMetrado.reduce((s, p) => s + real(p), 0) / conMetrado.length : 0;
  const fisPlan = conMetrado.length ? conMetrado.reduce((s, p) => s + plan(p), 0) / conMetrado.length : 0;
  const inicio = PARTIDAS.reduce((m, p) => (!m || p.fecha_inicio_base < m) ? p.fecha_inicio_base : m, null);
  const fin = PARTIDAS.reduce((m, p) => (!m || p.fecha_fin_base > m) ? p.fecha_fin_base : m, null);
  const plazoTotal = kpiDias(fin, inicio);
  const transcurrido = kpiDias(hoy, inicio);
  const hayAvance = AVANCES.length > 0;

  const tile = (l, v, hint, cls) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${cls || ""}">${v}</div>${hint ? `<div style="font-size:11px; color:var(--text-muted); margin-top:3px;">${hint}</div>` : ""}</div>`;

  // --- Plazo y ritmo ---
  const spiE = econPlan > 0 ? econReal / econPlan : null;
  const spiF = fisPlan > 0 ? fisReal / fisPlan : null;
  const clsSpi = v => v === null ? "" : v >= 0.95 ? "good" : "bad";
  let proy = "—", proyHint = "Disponible desde la 3.ª semana de obra con avance registrado", proyCls = "";
  if (spiE && spiE > 0 && transcurrido >= 14 && hayAvance) {
    const dur = plazoTotal / spiE;
    const fechaProy = kpiSumarDias(inicio, Math.round(dur));
    const dev = kpiDias(fechaProy, fin);
    proy = fmtDate(fechaProy);
    proyHint = `${dev >= 0 ? "+" : ""}${dev} días frente al fin base (${fmtDate(fin)}). Proyección simple: plazo ÷ SPI`;
    proyCls = dev > 0 ? "bad" : "good";
  }
  const pendiente = total * (1 - econReal / 100);
  const semRest = Math.max(kpiDias(fin, hoy < inicio ? inicio : hoy) / 7, 0);
  const ritmoNec = semRest > 0 ? pendiente / semRest : null;
  const desde28 = kpiSumarDias(hoy, -28);
  const valor = a => { const p = PARTIDAS.find(x => x.id === a.partida_id); return p ? Number(a.metrado_ejecutado) * (p.precio_unitario || 0) : 0; };
  const prod4 = AVANCES.filter(a => a.semana_fin > desde28 && a.semana_fin <= hoy).reduce((s, a) => s + valor(a), 0) / 4;
  const relRitmo = (ritmoNec && hayAvance) ? prod4 / ritmoNec : null;
  cont.innerHTML =
    tile("SPI económico", spiE === null ? "—" : spiE.toFixed(2), "Avance real ÷ planificado a hoy (1.00 = según plan)", clsSpi(spiE)) +
    tile("SPI físico", spiF === null ? "—" : spiF.toFixed(2), "Promedio de partidas, sin ponderar por costo", clsSpi(spiF)) +
    tile("Fin de obra proyectado", proy, proyHint, proyCls) +
    tile("Ritmo necesario", ritmoNec === null ? "—" : kpiFmtSoles(ritmoNec) + " / sem", `Lo pendiente (${kpiFmtSoles(pendiente)}) ÷ ${semRest.toFixed(0)} semanas hasta el fin base`) +
    tile("Ritmo real (últimas 4 sem)", hayAvance ? kpiFmtSoles(prod4) + " / sem" : "Sin avance", "Valorización promedio semanal registrada") +
    tile("Ritmo real ÷ necesario", relRitmo === null ? "—" : (relRitmo * 100).toFixed(0) + "%", "Menos de 100% = el ritmo actual no alcanza para terminar a tiempo", relRitmo === null ? "" : relRitmo >= 1 ? "good" : "bad");

  // --- Atraso ---
  const encurso = conMetrado.filter(p => plan(p) > 0);
  const atrasadas = encurso.filter(p => real(p) - plan(p) < -5);
  const sinIniciar = encurso.filter(p => real(p) === 0);
  const deb = encurso.length;
  document.getElementById("kpiGrupoAtraso").innerHTML =
    tile("Partidas que ya debían haber iniciado", deb, `de ${conMetrado.length} partidas con metrado`) +
    tile("Partidas atrasadas (desface < −5 pts)", atrasadas.length, deb ? (atrasadas.length / deb * 100).toFixed(0) + "% de las que ya debían estar en curso" : "Aún no hay partidas en curso", atrasadas.length ? "bad" : "good") +
    tile("Debieron iniciar y no tienen avance", sinIniciar.length, deb ? (sinIniciar.length / deb * 100).toFixed(0) + "% de las que ya debían estar en curso" : "", sinIniciar.length ? "bad" : "good");

  // Pareto del atraso (soles pendientes frente al plan)
  const atr = PARTIDAS.map(p => ({ p, v: Math.max(0, plan(p) - real(p)) / 100 * (p.presupuesto_total || 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const totAtr = atr.reduce((s, x) => s + x.v, 0);
  const top = atr.slice(0, 10);
  let acum = 0;
  const lineaAcum = top.map(x => { acum += x.v; return totAtr ? acum / totAtr * 100 : 0; });
  document.getElementById("kpiParetoTotal").textContent = totAtr > 0
    ? `Atraso total frente al plan: ${kpiFmtSoles(totAtr)}. Las 10 partidas mostradas explican el ${(lineaAcum[lineaAcum.length - 1] || 0).toFixed(0)}%.`
    : "Sin atraso frente al plan a la fecha de hoy.";
  if (kpiChartPareto) kpiChartPareto.destroy();
  kpiChartPareto = new Chart(document.getElementById("kpiChartPareto").getContext("2d"), {
    data: {
      labels: top.map(x => (x.p.nombre || "").slice(0, 28)),
      datasets: [
        { type: "bar", label: "Atraso (S/)", data: top.map(x => Math.round(x.v)), backgroundColor: "#d03b3b", yAxisID: "y" },
        { type: "line", label: "% acumulado", data: lineaAcum, borderColor: "#12233b", backgroundColor: "#12233b", yAxisID: "y1", tension: 0.15, pointRadius: 3 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true }, y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: v => v + "%" } } } },
  });

  // Producción semanal (ultimas 8 semanas) vs ritmo necesario
  const etiquetas = [], reales = [];
  for (let i = 8; i >= 1; i--) {
    const hasta = kpiSumarDias(hoy, -7 * (i - 1)), desde = kpiSumarDias(hoy, -7 * i);
    etiquetas.push("al " + fmtDate(hasta));
    reales.push(Math.round(AVANCES.filter(a => a.semana_fin > desde && a.semana_fin <= hasta).reduce((s, a) => s + valor(a), 0)));
  }
  if (kpiChartSemanal) kpiChartSemanal.destroy();
  kpiChartSemanal = new Chart(document.getElementById("kpiChartSemanal").getContext("2d"), {
    data: {
      labels: etiquetas,
      datasets: [
        { type: "bar", label: "Producción real (S/)", data: reales, backgroundColor: "#1baf7a" },
        ...(ritmoNec ? [{ type: "line", label: "Ritmo necesario (S/ por semana)", data: etiquetas.map(() => Math.round(ritmoNec)), borderColor: "#e07b22", borderDash: [6, 4], pointRadius: 0 }] : []),
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
  });

  // --- Gestión de restricciones (solo indicadores nuevos) ---
  const rs = (typeof RESTRICCIONES !== "undefined") ? RESTRICCIONES : [];
  const lev = rs.filter(r => r.estado === "Levantada" && r.fecha_levantamiento && r.fecha_identificacion);
  const abiertas = rs.filter(r => r.estado !== "Levantada");
  const tProm = lev.length ? lev.reduce((s, r) => s + kpiDias(r.fecha_levantamiento, r.fecha_identificacion), 0) / lev.length : null;
  const conFecha = abiertas.filter(r => r.fecha_identificacion);
  const antig = conFecha.length ? conFecha.reduce((s, r) => s + kpiDias(hoy, r.fecha_identificacion), 0) / conFecha.length : null;
  const compIncump = abiertas.filter(r => r.fecha_compromiso && r.fecha_compromiso < hoy).length;
  const sinFecha = abiertas.filter(r => !r.fecha_requerida).length;
  const sinEval = abiertas.filter(r => !r.probabilidad || !r.impacto).length;
  const cumpl = rs.filter(r => r.estado === "Levantada" && r.fecha_requerida && r.fecha_levantamiento);
  const aTiempo = cumpl.length ? cumpl.filter(r => r.fecha_levantamiento <= r.fecha_requerida).length / cumpl.length * 100 : null;
  document.getElementById("kpiGrupoRest").innerHTML =
    tile("Tiempo promedio de levantamiento", tProm === null ? "—" : tProm.toFixed(1) + " d", "Desde la identificación hasta el levantamiento") +
    tile("Antigüedad promedio de abiertas", antig === null ? "—" : antig.toFixed(1) + " d", "Desde la identificación hasta hoy") +
    tile("Levantadas dentro de la fecha requerida", aTiempo === null ? "—" : aTiempo.toFixed(0) + "%", "Cumplimiento del need-by", aTiempo === null ? "" : aTiempo >= 80 ? "good" : "bad") +
    tile("Compromisos incumplidos", compIncump, "Abiertas con fecha compromiso ya vencida", compIncump ? "bad" : "good") +
    tile("Abiertas sin fecha requerida", sinFecha, "No entran al lookahead", sinFecha ? "bad" : "good") +
    tile("Abiertas sin evaluar riesgo", sinEval, "Falta probabilidad o impacto", sinEval ? "bad" : "good");
}

// ---------------------------------------------------------
// Pestaña "EDT": estructura de desglose del trabajo (jerarquia del cronograma)
// con presupuesto, peso, fechas, avance planificado/real y desface acumulados por nivel
// ---------------------------------------------------------
let EDT_ABIERTOS = new Set();
let EDT_FILTRO = "";
let EDT_INICIAL = true;
let EDT_KEYS = [];

function edtConstruir(hoy) {
  const raiz = { key: "", hijos: new Map(), hojas: [], nivel: 0 };
  PARTIDAS.forEach(p => {
    const segs = (p.edt || "").split(" > ").map(s => s.trim()).filter(Boolean);
    if (!segs.length) return;
    const plan = avancePlanificadoEnFecha(p, hoy) * 100;
    const real = avanceRealAcumuladoEnFecha(p.id, hoy) * 100;
    const pres = p.presupuesto_total || 0;
    let nodo = raiz;
    const pila = [raiz];
    segs.slice(0, -1).forEach((s, i) => {
      if (!nodo.hijos.has(s)) nodo.hijos.set(s, { key: nodo.key + "|" + s, nombre: s, nivel: i + 1, hijos: new Map(), hojas: [], pres: 0, plan: 0, real: 0, ini: null, fin: null, n: 0 });
      nodo = nodo.hijos.get(s);
      pila.push(nodo);
    });
    const hoja = { p, nombre: segs[segs.length - 1], pres, planPct: plan, realPct: real };
    nodo.hojas.push(hoja);
    pila.slice(1).forEach(n => {
      n.pres += pres; n.plan += pres * plan; n.real += pres * real; n.n++;
      if (p.fecha_inicio_base && (!n.ini || p.fecha_inicio_base < n.ini)) n.ini = p.fecha_inicio_base;
      if (p.fecha_fin_base && (!n.fin || p.fecha_fin_base > n.fin)) n.fin = p.fecha_fin_base;
    });
  });
  return raiz;
}

function edtCoincide(nodo, f) {
  if (!f) return true;
  if ((nodo.nombre || "").toLowerCase().includes(f)) return true;
  if (nodo.hojas.some(h => h.nombre.toLowerCase().includes(f))) return true;
  for (const h of nodo.hijos.values()) if (edtCoincide(h, f)) return true;
  return false;
}

function renderEdt() {
  const tb = document.getElementById("edtTabla");
  if (!tb) return;
  const hoy = new Date().toISOString().slice(0, 10);
  const total = PARTIDAS.reduce((s, p) => s + (p.presupuesto_total || 0), 0);
  const conEdt = PARTIDAS.filter(p => p.edt).length;
  const aviso = document.getElementById("edtAviso");
  if (!PARTIDAS.length || !conEdt) {
    tb.innerHTML = "";
    aviso.textContent = PARTIDAS.length ? "Las partidas aún no tienen EDT cargada. Ejecuta el script agregar_edt.sql en Supabase." : "Selecciona un proyecto con partidas.";
    return;
  }
  aviso.textContent = `${conEdt.toLocaleString("es-PE")} partidas organizadas en la EDT. Los porcentajes de cada nivel se calculan ponderando por presupuesto, a la fecha de hoy.`;
  const raiz = edtConstruir(hoy);
  if (EDT_INICIAL) { raiz.hijos.forEach(n => EDT_ABIERTOS.add(n.key)); EDT_INICIAL = false; }
  const f = EDT_FILTRO.trim().toLowerCase();
  const cls = d => d < -5 ? "bad" : d >= -0.5 ? "good" : "";
  const filas = [];
  EDT_KEYS = [];
  const fila = (cuerpo, nivel, esHoja, key, abierto, pres, ini, fin, plan, real, n) => {
    const d = real - plan;
    const peso = total > 0 ? (pres / total * 100) : 0;
    const toggle = esHoja ? `<span style="display:inline-block; width:16px;"></span>` : `<span style="display:inline-block; width:16px; cursor:pointer;">${abierto ? "▾" : "▸"}</span>`;
    filas.push(`<tr ${esHoja ? "" : `data-edt="${EDT_KEYS.push(key) - 1}" style="cursor:pointer; background:${nivel === 1 ? "#eef1f6" : nivel === 2 ? "#f6f7fa" : "transparent"}; font-weight:${nivel <= 2 ? 600 : 400};"`}>
      <td style="padding-left:${8 + nivel * 16}px;">${toggle}${escapeHtml(cuerpo)}${!esHoja ? ` <span style="color:var(--text-muted); font-weight:400; font-size:11px;">(${n})</span>` : ""}</td>
      <td style="text-align:right;">${kpiFmtSoles(pres)}</td>
      <td style="text-align:right;">${peso.toFixed(2)}%</td>
      <td>${ini ? fmtDate(ini) : "—"}</td><td>${fin ? fmtDate(fin) : "—"}</td>
      <td style="text-align:right;">${plan.toFixed(1)}%</td>
      <td style="text-align:right;">${real.toFixed(1)}%</td>
      <td style="text-align:right;" class="${cls(d)}">${d >= 0 ? "+" : ""}${d.toFixed(1)}</td></tr>`);
  };
  const recorrer = nodo => {
    const hijos = [...nodo.hijos.values()].sort((a, b) => (a.ini || "").localeCompare(b.ini || "") || a.nombre.localeCompare(b.nombre));
    hijos.forEach(n => {
      if (f && !edtCoincide(n, f)) return;
      const abierto = f ? true : EDT_ABIERTOS.has(n.key);
      fila(n.nombre, n.nivel, false, n.key, abierto, n.pres, n.ini, n.fin, n.pres ? n.plan / n.pres : 0, n.pres ? n.real / n.pres : 0, n.n);
      if (abierto) {
        recorrer(n);
        n.hojas.slice().sort((a, b) => (a.p.fecha_inicio_base || "").localeCompare(b.p.fecha_inicio_base || "") || a.nombre.localeCompare(b.nombre))
          .filter(h => !f || h.nombre.toLowerCase().includes(f) || n.nombre.toLowerCase().includes(f))
          .forEach(h => fila(h.nombre, n.nivel + 1, true, "", false, h.pres, h.p.fecha_inicio_base, h.p.fecha_fin_base, h.planPct, h.realPct, 1));
      }
    });
  };
  recorrer(raiz);
  tb.innerHTML = filas.join("") || `<tr><td colspan="8" style="color:var(--text-muted); padding:12px;">Sin resultados para la búsqueda.</td></tr>`;
  tb.querySelectorAll("tr[data-edt]").forEach(tr => tr.addEventListener("click", () => {
    const k = EDT_KEYS[Number(tr.dataset.edt)];
    if (EDT_ABIERTOS.has(k)) EDT_ABIERTOS.delete(k); else EDT_ABIERTOS.add(k);
    renderEdt();
  }));
}

function edtNiveles(hasta) {
  EDT_ABIERTOS = new Set();
  const hoy = new Date().toISOString().slice(0, 10);
  const rec = n => { n.hijos.forEach(h => { if (h.nivel < hasta) EDT_ABIERTOS.add(h.key); rec(h); }); };
  rec(edtConstruir(hoy));
  EDT_INICIAL = false;
  renderEdt();
}

function initEdt() {
  const b = document.getElementById("edtBuscar");
  if (b) b.addEventListener("input", () => { EDT_FILTRO = b.value; renderEdt(); });
  [["edtN1", 1], ["edtN2", 2], ["edtN3", 3], ["edtN4", 4]].forEach(([id, n]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => edtNiveles(n));
  });
  const t = document.getElementById("edtTodo");
  if (t) t.addEventListener("click", () => edtNiveles(99));
}

// ---------------------------------------------------------
// Pestaña "Flujo de Caja": ingresos (valorizaciones cobradas) y egresos (costos pagados)
// por mes, con supuestos editables. Valores sin IGV.
// ---------------------------------------------------------
let fcChart = null;
const FC_DEFAULTS = { gg: 12.37, util: 6.0, costo: 100, adelanto: 20, retencion: 0, cobro: 30, pago: 30, devolucion: 90 };
const FC_CAMPOS = [
  ["fcGG", "gg", "Gastos generales de obra (% del directo, cuota fija mensual)"],
  ["fcUtil", "util", "Utilidad (% del directo, cuota fija mensual)"],
  ["fcCosto", "costo", "Costo directo (% del presupuesto)"],
  ["fcAdelanto", "adelanto", "Adelanto directo (% del contrato)"],
  ["fcRetencion", "retencion", "Retención / fondo de garantía (%)"],
  ["fcCobro", "cobro", "Plazo de cobro al cliente (días desde el corte)"],
  ["fcPago", "pago", "Plazo de pago de costos (días desde el corte)"],
  ["fcDevolucion", "devolucion", "Devolución de retención (días tras el fin de obra)"],
];

function fcLeerParams() {
  let g = {};
  try { g = JSON.parse(localStorage.getItem("fc_params") || "{}"); } catch (e) { g = {}; }
  const p = { ...FC_DEFAULTS };
  FC_CAMPOS.forEach(([, k]) => { if (typeof g[k] === "number" && isFinite(g[k])) p[k] = g[k]; });
  return p;
}
function fcGuardarParams(p) { try { localStorage.setItem("fc_params", JSON.stringify(p)); } catch (e) { /* sin almacenamiento */ } }

function fcFinMes(clave) { // "2026-10" -> "2026-10-31"
  const [a, m] = clave.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 0));
  return d.toISOString().slice(0, 10);
}
function fcMeses(desde, hasta) {
  const out = []; let [a, m] = desde.split("-").map(Number);
  const [ah, mh] = hasta.split("-").map(Number);
  while (a < ah || (a === ah && m <= mh)) { out.push(a + "-" + String(m).padStart(2, "0")); m++; if (m > 12) { m = 1; a++; } }
  return out;
}
const FC_MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fcEtiqueta = k => FC_MESES_ES[Number(k.slice(5)) - 1] + "-" + k.slice(2, 4);

function fcCalcular(prodMes, meses, p, finObra, iniK, finK) {
  // prodMes: produccion directa (S/) por mes. Gastos generales y utilidad: monto total repartido
  // en cuotas iguales en cada mes de obra (valorizacion). Devuelve el flujo mensual.
  const ix = {}; meses.forEach((k, i) => ix[k] = i);
  const n = meses.length;
  const z = () => new Array(n).fill(0);
  const val = z(), cobros = z(), egresos = z(), adel = z();
  const cBruto = z(), amortL = z(), retL = z(), devol = z();
  const directoTotal = prodMes.reduce((s, v) => s + v, 0);
  const enObra = meses.map(k => k >= iniK && k <= finK);
  const nObra = Math.max(enObra.filter(Boolean).length, 1);
  const ggMes = directoTotal * p.gg / 100 / nObra, utilMes = directoTotal * p.util / 100 / nObra;
  const venta = prodMes.map((v, i) => v + (enObra[i] ? ggMes + utilMes : 0));
  const totalVenta = venta.reduce((s, v) => s + v, 0);
  // el plazo (dias) se traduce a meses de desfase (dias / 30); si no es exacto, se reparte entre dos meses
  const sumarLag = (arr, idx, dias, monto) => {
    const lag = dias / 30, m0 = Math.floor(lag), fr = lag - m0;
    const poner = (j, v) => { if (v) arr[Math.min(j, n - 1)] += v; };
    poner(idx + m0, monto * (1 - fr)); poner(idx + m0 + 1, monto * fr);
  };
  // adelanto: ingresa en el primer mes y se amortiza prorrata en cada valorizacion
  adel[0] = totalVenta * p.adelanto / 100;
  let retenido = 0;
  meses.forEach((k, i) => {
    val[i] = venta[i];
    const amort = venta[i] * p.adelanto / 100, ret = venta[i] * p.retencion / 100;
    retenido += ret;
    sumarLag(cobros, i, p.cobro, venta[i] - amort - ret);
    sumarLag(cBruto, i, p.cobro, venta[i]); sumarLag(amortL, i, p.cobro, amort); sumarLag(retL, i, p.cobro, ret);
    const costo = prodMes[i] * p.costo / 100 + (enObra[i] ? ggMes : 0);
    sumarLag(egresos, i, p.pago, costo);
  });
  if (retenido > 0) { sumarLag(cobros, Math.max(ix[finK] ?? n - 1, 0), p.devolucion, retenido); sumarLag(devol, Math.max(ix[finK] ?? n - 1, 0), p.devolucion, retenido); }
  const neto = meses.map((_, i) => cobros[i] + adel[i] - egresos[i]);
  let a = 0; const acum = neto.map(v => a += v);
  return { val, cobros, adel, egresos, neto, acum, totalVenta, cBruto, amortL, retL, devol };
}

function renderFlujoCaja() {
  const cont = document.getElementById("fcTabla");
  if (!cont) return;
  const aviso = document.getElementById("fcAviso");
  if (!PARTIDAS.length) { cont.innerHTML = ""; aviso.textContent = "Selecciona un proyecto con partidas."; return; }
  const p = fcLeerParams();
  FC_CAMPOS.forEach(([id, k]) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = p[k]; });
  const hoy = new Date().toISOString().slice(0, 10);
  const ini = PARTIDAS.reduce((m, x) => (!m || x.fecha_inicio_base < m) ? x.fecha_inicio_base : m, null);
  const fin = PARTIDAS.reduce((m, x) => (!m || x.fecha_fin_base > m) ? x.fecha_fin_base : m, null);
  const ultimo = kpiSumarDias(fin, Math.max(p.cobro, p.pago, p.retencion > 0 ? p.devolucion : 0) + 62).slice(0, 7);
  const meses = fcMeses(ini.slice(0, 7), ultimo);
  const hoyK = hoy.slice(0, 7);
  const prodProg = meses.map(() => 0), prodReal = meses.map(() => 0);
  PARTIDAS.forEach(x => {
    const pres = x.presupuesto_total || 0; if (!pres) return;
    let aP = 0, aR = 0;
    meses.forEach((k, i) => {
      const f = fcFinMes(k);
      const cP = avancePlanificadoEnFecha(x, f);
      prodProg[i] += (cP - aP) * pres; aP = cP;
      if (k <= hoyK) {
        const fr = f > hoy ? hoy : f;
        const cR = avanceRealAcumuladoEnFecha(x.id, fr);
        prodReal[i] += (cR - aR) * pres; aR = cR;
      }
    });
  });
  let prog = fcCalcular(prodProg, meses, p, fin, ini.slice(0, 7), fin.slice(0, 7));
  // se corta el flujo en el ultimo mes con movimiento (cobros o pagos pendientes despues del fin de obra)
  let ult = 0; meses.forEach((k, i) => { if (Math.abs(prog.cobros[i]) + Math.abs(prog.adel[i]) + Math.abs(prog.egresos[i]) + prodProg[i] > 1) ult = i; });
  meses.length = ult + 1; prodProg.length = ult + 1; prodReal.length = ult + 1;
  prog = fcCalcular(prodProg, meses, p, fin, ini.slice(0, 7), fin.slice(0, 7));
  const real = fcCalcular(prodReal, meses, p, fin, ini.slice(0, 7), fin.slice(0, 7));
  const hayReal = AVANCES.length > 0;
  // indicadores
  const minV = Math.min(...prog.acum), iMin = prog.acum.indexOf(minV);
  const maxFin = prog.acum[prog.acum.length - 1];
  let iRec = -1; for (let i = iMin; i < prog.acum.length; i++) { if (prog.acum[i] >= 0) { iRec = i; break; } }
  const tile = (l, v, h, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}">${v}</div>${h ? `<div style="font-size:11px; color:var(--text-muted); margin-top:3px;">${h}</div>` : ""}</div>`;
  const directo = prodProg.reduce((s, v) => s + v, 0);
  document.getElementById("fcTiles").innerHTML =
    tile("Contrato valorizado", kpiFmtSoles(prog.totalVenta), "Directo + gastos generales + utilidad (sin IGV)") +
    tile("Necesidad máxima de caja", minV < 0 ? kpiFmtSoles(-minV) : "Sin déficit", minV < 0 ? "En " + fcEtiqueta(meses[iMin]) + ": lo que hay que financiar" : "El flujo acumulado nunca es negativo", minV < 0 ? "bad" : "good") +
    tile("Mes en que se recupera", minV < 0 ? (iRec >= 0 ? fcEtiqueta(meses[iRec]) : "No se recupera") : "—", minV < 0 ? "Flujo acumulado vuelve a positivo" : "") +
    tile("Resultado final", kpiFmtSoles(maxFin), "Utilidad = ingresos − egresos al cierre", maxFin >= 0 ? "good" : "bad") +
    tile("Costo directo", kpiFmtSoles(directo), "Presupuesto cargado en la línea base");
  aviso.textContent = "Flujo mensual sin IGV. El corte de cada valorización es el fin de mes y el plazo de cobro o pago se traslada en meses (30 días = 1 mes). Gastos generales y utilidad se reparten en cuotas iguales en cada mes de obra. El costo directo usa el presupuesto de venta mientras no se cargue el presupuesto de costos. Los supuestos son editables y se guardan en este navegador.";
  // grafico
  const labels = meses.map(fcEtiqueta);
  if (fcChart) fcChart.destroy();
  fcChart = new Chart(document.getElementById("fcChart").getContext("2d"), {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Flujo neto mensual (programado)", data: prog.neto.map(Math.round), backgroundColor: prog.neto.map(v => v >= 0 ? "#1baf7a" : "#d03b3b"), yAxisID: "y" },
        { type: "line", label: "Acumulado programado", data: prog.acum.map(Math.round), borderColor: "#12233b", backgroundColor: "#12233b", tension: 0.15, pointRadius: 2, yAxisID: "y" },
        ...(hayReal ? [{ type: "line", label: "Acumulado real", data: real.acum.map((v, i) => meses[i] <= hoyK ? Math.round(v) : null), borderColor: "#e07b22", backgroundColor: "#e07b22", pointRadius: 3, spanGaps: false, yAxisID: "y" }] : []),
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { callback: v => (v / 1e6).toFixed(1) + " M" } } } },
  });
  // tabla
  const f0 = v => Math.round(v).toLocaleString("es-PE");
  const th = h => `<th style="text-align:right;">${h}</th>`;
  let html = `<thead><tr><th>Mes</th>${th("Producción directa")}${th("Valorización")}${th("Cobros")}${th("Egresos")}${th("Flujo neto")}${th("Acumulado prog.")}${hayReal ? th("Acumulado real") : ""}</tr></thead><tbody>`;
  meses.forEach((k, i) => {
    const neg = prog.acum[i] < 0 ? "bad" : "";
    html += `<tr><td>${fcEtiqueta(k)}</td><td style="text-align:right;">${f0(prodProg[i])}</td><td style="text-align:right;">${f0(prog.val[i])}</td>
      <td style="text-align:right;">${f0(prog.cobros[i] + prog.adel[i])}</td><td style="text-align:right;">${f0(prog.egresos[i])}</td>
      <td style="text-align:right;">${f0(prog.neto[i])}</td><td style="text-align:right;" class="${neg}">${f0(prog.acum[i])}</td>
      ${hayReal ? `<td style="text-align:right;">${k <= hoyK ? f0(real.acum[i]) : "—"}</td>` : ""}</tr>`;
  });
  const sum = a => a.reduce((s, v) => s + v, 0);
  html += `<tr style="font-weight:700;"><td>Total</td><td style="text-align:right;">${f0(directo)}</td><td style="text-align:right;">${f0(sum(prog.val))}</td><td style="text-align:right;">${f0(sum(prog.cobros) + sum(prog.adel))}</td><td style="text-align:right;">${f0(sum(prog.egresos))}</td><td style="text-align:right;">${f0(sum(prog.neto))}</td><td></td>${hayReal ? "<td></td>" : ""}</tr></tbody>`;
  cont.innerHTML = html;
  fcRenderOperativo(prog, meses);
}

let fcChart2 = null;
function fcRenderOperativo(prog, meses) {
  const t2 = document.getElementById("fcTabla2");
  if (!t2) return;
  const f0 = v => Math.round(v).toLocaleString("es-PE");
  const n = meses.length;
  const operativo = meses.map((_, i) => prog.cBruto[i] - prog.retL[i] + prog.devol[i] - prog.egresos[i]);
  const movAdel = meses.map((_, i) => prog.adel[i] - prog.amortL[i]);
  let a1 = 0, a2 = 0, a3 = 0;
  const acOp = operativo.map(v => a1 += v);
  const saldoAdel = movAdel.map(v => a2 += v);
  const acTot = meses.map((_, i) => acOp[i] + saldoAdel[i]);
  const th = h => `<th style="text-align:right;">${h}</th>`;
  let html = `<thead><tr><th>Mes</th>${th("Cobro de valorización")}${th("Retención (−) / devolución (+)")}${th("Egresos")}${th("Flujo operativo")}${th("Acum. operativo")}${th("Adelanto recibido")}${th("Adelanto amortizado")}${th("Saldo del adelanto")}${th("Flujo neto")}</tr></thead><tbody>`;
  let saldo = 0;
  meses.forEach((k, i) => {
    saldo += movAdel[i];
    const ret = prog.devol[i] - prog.retL[i];
    html += `<tr><td>${fcEtiqueta(k)}</td><td style="text-align:right;">${f0(prog.cBruto[i])}</td><td style="text-align:right;">${f0(ret)}</td><td style="text-align:right;">${f0(prog.egresos[i])}</td>
      <td style="text-align:right;" class="${operativo[i] < 0 ? "bad" : ""}">${f0(operativo[i])}</td><td style="text-align:right;">${f0(acOp[i])}</td>
      <td style="text-align:right;">${f0(prog.adel[i])}</td><td style="text-align:right;">${f0(-prog.amortL[i])}</td><td style="text-align:right;">${f0(saldo)}</td>
      <td style="text-align:right;">${f0(operativo[i] + movAdel[i])}</td></tr>`;
  });
  const sum = a => a.reduce((s, v) => s + v, 0);
  html += `<tr style="font-weight:700;"><td>Total</td><td style="text-align:right;">${f0(sum(prog.cBruto))}</td><td style="text-align:right;">${f0(sum(prog.devol) - sum(prog.retL))}</td><td style="text-align:right;">${f0(sum(prog.egresos))}</td><td style="text-align:right;">${f0(sum(operativo))}</td><td></td><td style="text-align:right;">${f0(sum(prog.adel))}</td><td style="text-align:right;">${f0(-sum(prog.amortL))}</td><td style="text-align:right;">${f0(sum(movAdel))}</td><td style="text-align:right;">${f0(sum(operativo) + sum(movAdel))}</td></tr></tbody>`;
  t2.innerHTML = html;
  if (fcChart2) fcChart2.destroy();
  fcChart2 = new Chart(document.getElementById("fcChart2").getContext("2d"), {
    data: {
      labels: meses.map(fcEtiqueta),
      datasets: [
        { type: "bar", label: "Flujo operativo mensual", data: operativo.map(Math.round), backgroundColor: operativo.map(v => v >= 0 ? "#1baf7a" : "#d03b3b"), yAxisID: "y" },
        { type: "line", label: "Acumulado operativo", data: acOp.map(Math.round), borderColor: "#12233b", backgroundColor: "#12233b", tension: 0.15, pointRadius: 2, yAxisID: "y" },
        { type: "line", label: "Saldo del adelanto", data: saldoAdel.map(Math.round), borderColor: "#e07b22", backgroundColor: "#e07b22", tension: 0.15, pointRadius: 2, yAxisID: "y" },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { ticks: { callback: v => (v / 1e6).toFixed(1) + " M" } } } },
  });
}

function initFlujoCaja() {
  { const p0 = fcLeerParams(); FC_CAMPOS.forEach(([id, k]) => { const el = document.getElementById(id); if (el) el.value = p0[k]; }); }
  FC_CAMPOS.forEach(([id, k]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const p = fcLeerParams(); const v = parseFloat(el.value);
      p[k] = isFinite(v) && v >= 0 ? v : FC_DEFAULTS[k];
      fcGuardarParams(p); renderFlujoCaja();
    });
  });
  const r = document.getElementById("fcRestablecer");
  if (r) r.addEventListener("click", () => { fcGuardarParams({ ...FC_DEFAULTS }); renderFlujoCaja(); });
}

// =========================================================
// Pestaña "Cargar Proyecto": carga de partidas desde Excel (solo admin/planner)
// Columnas: Frente | EDT | Partida | Unidad | Metrado | Precio unitario | Monto | Inicio | Fin
// =========================================================
let CG_FILAS = [];

function cgNorm(t) {
  return String(t == null ? "" : t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function cgNum(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[sS]\/\.?|\s/g, "").replace(/,/g, ""));
  return isNaN(n) ? NaN : n;
}
function cgFecha(v) {
  if (v === "" || v == null) return null;
  const p2 = (n) => String(n).padStart(2, "0");
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${p2(d.m)}-${p2(d.d)}` : NaN;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${p2(m[2])}-${p2(m[1])}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  return NaN;
}

function cgDescargarPlantilla() {
  const cab = ["Frente", "EDT", "Partida", "Unidad", "Metrado", "Precio unitario", "Monto", "Inicio", "Fin"];
  const ws = XLSX.utils.aoa_to_sheet([cab]);
  ws["!cols"] = [{ wch: 34 }, { wch: 48 }, { wch: 48 }, { wch: 9 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 12 }];
  const ins = [
    ["Cómo llenar la hoja Partidas"],
    [""],
    ["Una fila por partida (o por rubro de costo). El orden de las filas es el orden de presentación."],
    ["Frente (obligatorio): agrupador principal, por ejemplo sector, edificio o especialidad."],
    ["EDT (opcional): ruta jerárquica separada por \" > \", por ejemplo: Sector 1 > Estructuras > Zapatas."],
    ["Partida (obligatorio): nombre de la partida o rubro."],
    ["Unidad (opcional): m2, m3, kg, glb, etc."],
    ["Metrado y Precio unitario: el presupuesto de la partida es Metrado x Precio unitario."],
    ["Monto (opcional): si no tienes metrado ni precio unitario, escribe solo el monto y se carga como 1 glb."],
    ["Inicio y Fin (obligatorios): fechas del cronograma de esa partida, en formato dd/mm/aaaa o como fecha de Excel."],
    ["Sin gastos generales, utilidad ni IGV: solo el costo directo."],
  ];
  const wi = XLSX.utils.aoa_to_sheet(ins);
  wi["!cols"] = [{ wch: 110 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Partidas");
  XLSX.utils.book_append_sheet(wb, wi, "Instrucciones");
  XLSX.writeFile(wb, "Plantilla_carga_proyecto.xlsx");
}

function cgLeerArchivo(file) {
  const msg = document.getElementById("cgMsg");
  msg.textContent = "";
  document.getElementById("cgConfirmar").style.display = "none";
  document.getElementById("cgResumen").innerHTML = "";
  document.querySelector("#cgPreview tbody").innerHTML = "";
  CG_FILAS = [];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const hoja = wb.Sheets["Partidas"] || wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: "" });
      cgProcesar(filas);
    } catch (err) {
      msg.style.color = "var(--red)";
      msg.textContent = "No se pudo leer el archivo: " + err.message;
    }
  };
  rd.readAsArrayBuffer(file);
}

function cgProcesar(filas) {
  const msg = document.getElementById("cgMsg");
  const claves = { frente: ["frente"], edt: ["edt"], nombre: ["partida", "descripcion", "rubro"], unidad: ["unidad", "und"],
    metrado: ["metrado"], pu: ["precio unitario", "p u", "pu"], monto: ["monto", "presupuesto", "costo"], ini: ["inicio", "fecha inicio"], fin: ["fin", "fecha fin", "termino"] };
  const cab = (filas[0] || []).map(cgNorm);
  const idx = {};
  for (const k in claves) idx[k] = cab.findIndex(h => claves[k].includes(h));
  const faltan = ["frente", "nombre", "ini", "fin"].filter(k => idx[k] < 0);
  if (faltan.length) {
    msg.style.color = "var(--red)";
    msg.textContent = "Faltan columnas en la fila 1: " + faltan.map(k => ({ frente: "Frente", nombre: "Partida", ini: "Inicio", fin: "Fin" }[k])).join(", ") + ". Usa la plantilla.";
    return;
  }
  const errores = [], ok = [];
  let orden = 0;
  for (let i = 1; i < filas.length; i++) {
    const r = filas[i];
    if (r.every(c => c === "" || c == null)) continue;
    const fila = i + 1;
    const frente = String(r[idx.frente] ?? "").trim();
    const nombre = String(r[idx.nombre] ?? "").trim();
    if (!frente || !nombre) { errores.push(`Fila ${fila}: falta Frente o Partida.`); continue; }
    const ini = cgFecha(r[idx.ini]), fin = cgFecha(r[idx.fin]);
    if (!ini || !fin || ini !== ini || fin !== fin) { errores.push(`Fila ${fila}: Inicio o Fin vacío o con formato inválido.`); continue; }
    if (fin < ini) { errores.push(`Fila ${fila}: la fecha de fin es anterior al inicio.`); continue; }
    let met = idx.metrado >= 0 ? cgNum(r[idx.metrado]) : null;
    let pu = idx.pu >= 0 ? cgNum(r[idx.pu]) : null;
    const monto = idx.monto >= 0 ? cgNum(r[idx.monto]) : null;
    if ([met, pu, monto].some(x => x !== null && isNaN(x))) { errores.push(`Fila ${fila}: Metrado, Precio unitario o Monto no son números.`); continue; }
    let unidad = idx.unidad >= 0 ? String(r[idx.unidad] ?? "").trim() : "";
    if (met === null || pu === null) {
      if (monto === null) { errores.push(`Fila ${fila}: indica Metrado y Precio unitario, o el Monto.`); continue; }
      met = 1; pu = monto; unidad = unidad || "glb";
    }
    ok.push({ frente, edt: idx.edt >= 0 ? String(r[idx.edt] ?? "").trim() : "", nombre, unidad, metrado_total: met, precio_unitario: pu,
      presupuesto_total: Math.round(met * pu * 100) / 100, fecha_inicio_base: ini, fecha_fin_base: fin, orden: ++orden });
  }
  CG_FILAS = ok;
  const total = ok.reduce((a, f) => a + f.presupuesto_total, 0);
  const frentes = new Set(ok.map(f => f.frente));
  const ini = ok.length ? ok.reduce((a, f) => f.fecha_inicio_base < a ? f.fecha_inicio_base : a, "9999") : "";
  const fin = ok.length ? ok.reduce((a, f) => f.fecha_fin_base > a ? f.fecha_fin_base : a, "0000") : "";
  document.getElementById("cgResumen").innerHTML =
    `<div class="stat-row"><div class="stat-tile"><div class="label">Partidas válidas</div><div class="value">${ok.length}</div></div>` +
    `<div class="stat-tile"><div class="label">Frentes</div><div class="value">${frentes.size}</div></div>` +
    `<div class="stat-tile"><div class="label">Presupuesto total</div><div class="value">S/ ${total.toLocaleString("es-PE", { maximumFractionDigits: 0 })}</div></div>` +
    `<div class="stat-tile"><div class="label">Inicio → Fin</div><div class="value" style="font-size:15px;">${ini ? fmtDate(ini) + " → " + fmtDate(fin) : "—"}</div></div></div>` +
    (errores.length ? `<div class="card" style="border-color:var(--red); font-size:12.5px;"><b>${errores.length} fila(s) con error (no se cargarán):</b><br>${errores.slice(0, 25).map(escapeHtml).join("<br>")}${errores.length > 25 ? "<br>…" : ""}</div>` : "");
  document.querySelector("#cgPreview tbody").innerHTML = ok.slice(0, 30).map(f =>
    `<tr><td>${escapeHtml(f.frente)}</td><td>${escapeHtml(f.nombre)}</td><td>${escapeHtml(f.unidad)}</td><td style="text-align:right;">${f.metrado_total}</td><td style="text-align:right;">${f.precio_unitario}</td><td style="text-align:right;">${f.presupuesto_total.toLocaleString("es-PE")}</td><td>${fmtDate(f.fecha_inicio_base)}</td><td>${fmtDate(f.fecha_fin_base)}</td></tr>`).join("") +
    (ok.length > 30 ? `<tr><td colspan="8" style="color:var(--text-muted);">… y ${ok.length - 30} partidas más</td></tr>` : "");
  document.getElementById("cgConfirmar").style.display = ok.length ? "" : "none";
  msg.style.color = "var(--text-muted)";
  msg.textContent = ok.length ? "Revisa el resumen. Al confirmar, las partidas actuales del proyecto elegido se reemplazan por estas." : "";
}

async function cgConfirmar() {
  const msg = document.getElementById("cgMsg");
  const pid = document.getElementById("cgProyecto").value;
  const proy = PROYECTOS.find(p => p.id === pid);
  if (!pid || !CG_FILAS.length) return;
  msg.style.color = "var(--text-muted)"; msg.textContent = "Verificando...";
  const { count: nAv } = await supabaseClient.from("avances_semanales").select("id, partidas!inner(proyecto_id)", { count: "exact", head: true }).eq("partidas.proyecto_id", pid);
  if (nAv > 0) { msg.style.color = "var(--red)"; msg.textContent = `Este proyecto ya tiene ${nAv} avances registrados. Para no perderlos, no se reemplazan las partidas.`; return; }
  const { count: nPart } = await supabaseClient.from("partidas").select("id", { count: "exact", head: true }).eq("proyecto_id", pid);
  const aviso = nPart > 0 ? `Se reemplazarán las ${nPart} partidas actuales de "${proy.nombre}" por ${CG_FILAS.length} partidas nuevas. ¿Continuar?` : `Se cargarán ${CG_FILAS.length} partidas en "${proy.nombre}". ¿Continuar?`;
  if (!confirm(aviso)) { msg.textContent = ""; return; }
  document.getElementById("cgConfirmar").disabled = true;
  try {
    msg.textContent = "Cargando...";
    if (nPart > 0) {
      const { error } = await supabaseClient.from("partidas").delete().eq("proyecto_id", pid);
      if (error) throw error;
    }
    const conEdt = CG_FILAS.some(f => f.edt);
    const filas = CG_FILAS.map(f => {
      const o = { proyecto_id: pid, frente: f.frente, nombre: f.nombre, nivel: 4, orden: f.orden, unidad: f.unidad, metrado_total: f.metrado_total,
        precio_unitario: f.precio_unitario, presupuesto_total: f.presupuesto_total, fecha_inicio_base: f.fecha_inicio_base, fecha_fin_base: f.fecha_fin_base };
      if (conEdt) o.edt = f.edt || null;
      return o;
    });
    for (let i = 0; i < filas.length; i += 300) {
      msg.textContent = `Cargando ${Math.min(i + 300, filas.length)} de ${filas.length}...`;
      const { error } = await supabaseClient.from("partidas").insert(filas.slice(i, i + 300));
      if (error) throw error;
    }
    const ini = filas.reduce((a, f) => f.fecha_inicio_base < a ? f.fecha_inicio_base : a, "9999");
    const fin = filas.reduce((a, f) => f.fecha_fin_base > a ? f.fecha_fin_base : a, "0000");
    await supabaseClient.from("proyectos").update({ fecha_inicio_contractual: ini, fecha_fin_contractual: fin }).eq("id", pid);
    msg.style.color = "var(--green)";
    msg.textContent = `Listo: ${filas.length} partidas cargadas en "${proy.nombre}".`;
    CG_FILAS = [];
    document.getElementById("cgConfirmar").style.display = "none";
    document.getElementById("cgArchivo").value = "";
    PROYECTO_ACTUAL_ID = pid;
    await loadProyectos(pid);
  } catch (err) {
    msg.style.color = "var(--red)";
    msg.textContent = "No se pudo completar la carga: " + (err.message || err) + (err.message && /edt/i.test(err.message) ? " (corre agregar_edt.sql o deja la columna EDT vacía)" : "");
  } finally {
    document.getElementById("cgConfirmar").disabled = false;
  }
}

function initCargar() {
  const btn = document.getElementById("cgPlantilla");
  if (!btn) return;
  btn.addEventListener("click", cgDescargarPlantilla);
  document.getElementById("cgArchivo").addEventListener("change", (e) => cgLeerArchivo(e.target.files[0]));
  document.getElementById("cgConfirmar").addEventListener("click", cgConfirmar);
}
function cgLlenarProyectos(idActual) {
  const sel = document.getElementById("cgProyecto");
  if (!sel) return;
  sel.innerHTML = PROYECTOS.map(p => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
  if (idActual) sel.value = idActual;
}

// ---------------------------------------------------------
// Eliminar proyecto (solo admin): borra el proyecto y todo lo que depende de él
// ---------------------------------------------------------
async function eliminarProyecto() {
  const pid = document.getElementById("proyectoSelectDash").value;
  const proy = PROYECTOS.find(p => p.id === pid);
  if (!proy) return;
  const cuenta = async (tabla) => {
    const { count, error } = await supabaseClient.from(tabla).select("id", { count: "exact", head: true }).eq("proyecto_id", pid);
    return error ? 0 : (count || 0);
  };
  const { count: nAv } = await supabaseClient.from("avances_semanales").select("id, partidas!inner(proyecto_id)", { count: "exact", head: true }).eq("partidas.proyecto_id", pid);
  const [nPart, nRest, nObs, nUni] = await Promise.all([cuenta("partidas"), cuenta("restricciones"), cuenta("pv_observaciones"), cuenta("pv_unidades")]);
  const detalle = `${nPart} partidas, ${nAv || 0} avances registrados, ${nRest} restricciones, ${nUni} unidades y ${nObs} observaciones de Post Venta`;
  const escrito = prompt(`Vas a ELIMINAR el proyecto "${proy.nombre}" con todos sus datos (${detalle}). Esto no se puede deshacer.\n\nPara confirmar, escribe el nombre exacto del proyecto:`);
  if (escrito === null) return;
  if (escrito.trim() !== proy.nombre.trim()) { alert("El nombre no coincide. No se eliminó nada."); return; }
  const { error } = await supabaseClient.from("proyectos").delete().eq("id", pid);
  if (error) { alert("No se pudo eliminar: " + error.message); return; }
  PROYECTO_ACTUAL_ID = null;
  await loadProyectos();
  alert(`Proyecto "${proy.nombre}" eliminado.`);
}
