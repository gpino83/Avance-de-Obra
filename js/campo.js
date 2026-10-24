// =========================================================
// Control de Obra > Campo: Reporte diario, Reporte semanal y Cuaderno de obra
// Se carga DESPUÉS de app.js, fotos.js y grupos.js.
// =========================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s);
  const ESCRIBE = ["admin", "planner", "residente"];
  const inp = "padding:7px 10px; border-radius:8px; border:1px solid var(--border); font:inherit; width:100%;";
  const lab = "font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;";
  const pid = () => (typeof PROYECTO_ACTUAL_ID !== "undefined" && PROYECTO_ACTUAL_ID) || ($("proyectoSelectDash") && $("proyectoSelectDash").value);
  const proyNombre = () => { const p = PROYECTOS.find(x => x.id === pid()); return p ? p.nombre : ""; };
  const sumarDias = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const diaSemana = (iso) => ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date(iso + "T00:00:00").getDay()];

  let DIARIOS = [], SEMANALES = [], ASIENTOS = [], cargadoPara = null;
  let fotosPendientes = { diario: [], cuaderno: [] };

  async function cargar(forzar) {
    const p = pid(); if (!p) return false;
    if (!forzar && cargadoPara === p) return true;
    const [d, s, c] = await Promise.all([
      supabaseClient.from("reportes_diarios").select("*").eq("proyecto_id", p).order("fecha", { ascending: false }).limit(400),
      supabaseClient.from("reportes_semanales").select("*").eq("proyecto_id", p),
      supabaseClient.from("cuaderno_asientos").select("*").eq("proyecto_id", p).order("numero", { ascending: false }),
    ]);
    DIARIOS = d.data || []; SEMANALES = s.data || []; ASIENTOS = c.data || [];
    cargadoPara = p;
    return true;
  }

  // Abre una ventana con el contenido listo para imprimir o guardar como PDF
  async function imprimir(titulo, cuerpo) {
    const w = window.open("", "_blank");
    if (!w) { alert("El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio."); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:12.5px;line-height:1.45}
      h1{font-size:18px;margin:0 0 2px} h2{font-size:14px;margin:16px 0 4px;border-bottom:1px solid #999;padding-bottom:2px}
      .sub{color:#555;margin-bottom:10px} table{border-collapse:collapse;width:100%;margin:4px 0} td,th{border:1px solid #bbb;padding:4px 6px;text-align:left;vertical-align:top}
      th{background:#eee} .num{text-align:right} .fotos img{height:150px;margin:4px 6px 0 0;border:1px solid #ccc} p{margin:3px 0;white-space:pre-wrap}
      .asiento{border:1px solid #999;padding:8px 10px;margin:8px 0;page-break-inside:avoid}
      @media print{body{margin:10mm}}
    </style></head><body>${cuerpo}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 700);
  }
  async function fotosHtml(rutas) {
    if (!rutas || !rutas.length) return "";
    const us = await Promise.all(rutas.map(r => FotosObra.url(r)));
    return `<div class="fotos">${us.filter(Boolean).map(u => `<img src="${u}">`).join("")}</div>`;
  }

  // ---------------- REPORTE DIARIO ----------------
  function limpiarFotos(clave, cont) { fotosPendientes[clave] = []; if (cont) cont.innerHTML = ""; }

  async function llenarDiario(fecha) {
    const r = DIARIOS.find(x => x.fecha === fecha);
    $("rdFecha").value = fecha;
    $("rdClima").value = r ? (r.clima || "") : "";
    $("rdPropio").value = r && r.personal_propio != null ? r.personal_propio : "";
    $("rdSub").value = r && r.personal_subcontrata != null ? r.personal_subcontrata : "";
    $("rdEquipos").value = r ? (r.equipos || "") : "";
    $("rdActiv").value = r ? (r.actividades || "") : "";
    $("rdInc").value = r ? (r.incidencias || "") : "";
    $("rdObs").value = r ? (r.observaciones || "") : "";
    limpiarFotos("diario");
    $("rdFotosSel").textContent = "";
    $("rdFotos").innerHTML = "";
    if (r && r.fotos && r.fotos.length) await FotosObra.mostrar($("rdFotos"), r.fotos);
    $("rdTitulo").textContent = `${diaSemana(fecha)} ${fdmy(fecha)}${r ? "" : " — nuevo reporte"}`;
    $("rdMsg").textContent = "";
  }

  function renderDiarios() {
    $("rdLista").querySelector("tbody").innerHTML = DIARIOS.slice(0, 60).map(r =>
      `<tr data-f="${r.fecha}" style="cursor:pointer;"><td>${fdmy(r.fecha)}</td><td>${diaSemana(r.fecha)}</td><td>${esc(r.clima)}</td><td class="num">${(r.personal_propio || 0) + (r.personal_subcontrata || 0)}</td><td>${esc((r.actividades || "").slice(0, 90))}</td><td class="num">${(r.fotos || []).length}</td></tr>`).join("")
      || `<tr><td colspan="6" style="color:var(--text-muted);">Aún no hay reportes diarios.</td></tr>`;
  }

  async function guardarDiario(e) {
    e.preventDefault();
    const fecha = $("rdFecha").value;
    const prev = DIARIOS.find(x => x.fecha === fecha);
    const btn = $("rdGuardar"); btn.disabled = true;
    try {
      $("rdMsg").style.color = "var(--text-muted)"; $("rdMsg").textContent = "Guardando...";
      let fotos = prev ? (prev.fotos || []) : [];
      if (fotosPendientes.diario.length) fotos = fotos.concat(await FotosObra.subir(fotosPendientes.diario, `${pid()}/diario/${fecha}`));
      const n = (id) => $(id).value === "" ? null : Number($(id).value);
      const t = (id) => $(id).value.trim() || null;
      const fila = { proyecto_id: pid(), fecha, clima: t("rdClima"), personal_propio: n("rdPropio"), personal_subcontrata: n("rdSub"), equipos: t("rdEquipos"), actividades: t("rdActiv"), incidencias: t("rdInc"), observaciones: t("rdObs"), fotos };
      const { error } = await supabaseClient.from("reportes_diarios").upsert(fila, { onConflict: "proyecto_id,fecha" });
      if (error) throw error;
      await cargar(true); renderDiarios(); await llenarDiario(fecha);
      $("rdMsg").style.color = "var(--green)"; $("rdMsg").textContent = "Reporte guardado.";
    } catch (err) {
      $("rdMsg").style.color = "var(--red)"; $("rdMsg").textContent = "No se pudo guardar: " + (err.message || err);
    } finally { btn.disabled = false; }
  }

  function traerAvances() {
    const fin = $("rdFecha").value, ini = sumarDias(fin, -6);
    const puPor = {}; PARTIDAS.forEach(x => puPor[x.id] = x);
    const lineas = AVANCES.filter(a => a.semana_fin >= ini && a.semana_fin <= fin && Number(a.metrado_ejecutado) > 0)
      .map(a => { const x = puPor[a.partida_id]; return x ? `- ${x.nombre}: ${Number(a.metrado_ejecutado).toLocaleString("es-PE")} ${x.unidad || ""}` : null; }).filter(Boolean);
    if (!lineas.length) { alert("No hay avances registrados entre " + fdmy(ini) + " y " + fdmy(fin) + "."); return; }
    $("rdActiv").value = ($("rdActiv").value ? $("rdActiv").value + "\n" : "") + "Avance registrado en la semana:\n" + lineas.join("\n");
  }

  async function imprimirDiario() {
    const f = $("rdFecha").value;
    const r = DIARIOS.find(x => x.fecha === f);
    if (!r) { alert("Guarda primero el reporte de este día."); return; }
    const cuerpo = `<h1>Reporte diario de obra</h1><div class="sub">${esc(proyNombre())} — ${diaSemana(f)} ${fdmy(f)}</div>
      <table><tr><th>Clima</th><td>${esc(r.clima)}</td><th>Personal propio</th><td>${r.personal_propio ?? ""}</td><th>Personal subcontratas</th><td>${r.personal_subcontrata ?? ""}</td></tr></table>
      <h2>Equipos y maquinaria</h2><p>${esc(r.equipos)}</p><h2>Actividades ejecutadas</h2><p>${esc(r.actividades)}</p>
      <h2>Incidencias</h2><p>${esc(r.incidencias)}</p><h2>Observaciones</h2><p>${esc(r.observaciones)}</p>${(r.fotos || []).length ? "<h2>Registro fotográfico</h2>" + await fotosHtml(r.fotos) : ""}`;
    imprimir("Reporte diario " + f, cuerpo);
  }

  // ---------------- REPORTE SEMANAL ----------------
  function calcSemana(fin) {
    const ini = sumarDias(fin, -6);
    const puPor = {}; PARTIDAS.forEach(x => puPor[x.id] = x);
    const total = PARTIDAS.reduce((s, x) => s + (x.presupuesto_total || 0), 0);
    const enSemana = AVANCES.filter(a => a.semana_fin >= ini && a.semana_fin <= fin);
    const porPartida = {};
    enSemana.forEach(a => { const x = puPor[a.partida_id]; if (!x) return; porPartida[x.id] = (porPartida[x.id] || 0) + Number(a.metrado_ejecutado) * (Number(x.precio_unitario) || 0); });
    const prodSemana = Object.values(porPartida).reduce((s, v) => s + v, 0);
    let real = 0, plan = 0;
    PARTIDAS.forEach(x => { real += (x.presupuesto_total || 0) * avanceRealAcumuladoEnFecha(x.id, fin); plan += (x.presupuesto_total || 0) * avancePlanificadoEnFecha(x, fin); });
    const top = Object.entries(porPartida).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => ({ x: puPor[id], v }));
    const dias = DIARIOS.filter(r => r.fecha >= ini && r.fecha <= fin);
    const persProm = dias.length ? dias.reduce((s, r) => s + (r.personal_propio || 0) + (r.personal_subcontrata || 0), 0) / dias.length : null;
    const rest = (typeof RESTRICCIONES !== "undefined" ? RESTRICCIONES : []);
    const nuevas = rest.filter(r => r.fecha_identificacion && r.fecha_identificacion >= ini && r.fecha_identificacion <= fin).length;
    const levant = rest.filter(r => r.fecha_levantamiento && r.fecha_levantamiento >= ini && r.fecha_levantamiento <= fin).length;
    const abiertas = rest.filter(r => r.estado !== "Levantada").length;
    return { ini, fin, total, prodSemana, realPct: total ? real / total * 100 : 0, planPct: total ? plan / total * 100 : 0, top, dias: dias.length, persProm, nuevas, levant, abiertas };
  }

  function renderSemanal() {
    const fin = $("rsFecha").value || hoyLocalISO();
    const c = calcSemana(fin);
    const des = c.realPct - c.planPct;
    const tile = (l, v, cl) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${cl || ""}" style="font-size:19px;">${v}</div></div>`;
    $("rsTiles").innerHTML =
      tile("Producción de la semana", "S/ " + solesFmt(c.prodSemana)) +
      tile("Avance real acumulado", c.realPct.toFixed(1) + " %") +
      tile("Avance programado", c.planPct.toFixed(1) + " %") +
      tile("Desface", (des >= 0 ? "+" : "") + des.toFixed(1) + " pts", des >= 0 ? "good" : "bad") +
      tile("Reportes diarios", c.dias + " de 7") +
      tile("Personal promedio", c.persProm == null ? "—" : c.persProm.toFixed(0));
    $("rsInfo").innerHTML = `Semana del ${fdmy(c.ini)} al ${fdmy(c.fin)}. Restricciones: ${c.nuevas} nuevas, ${c.levant} levantadas, ${c.abiertas} abiertas.`;
    $("rsTop").querySelector("tbody").innerHTML = c.top.map(t => `<tr><td>${esc(t.x.frente)}</td><td>${esc(t.x.nombre)}</td><td class="num">${solesFmt(t.v)}</td></tr>`).join("") || `<tr><td colspan="3" style="color:var(--text-muted);">No hay avance registrado en esta semana.</td></tr>`;
    const s = SEMANALES.find(x => x.semana_fin === fin);
    $("rsResumen").value = s ? (s.resumen || "") : "";
    $("rsProblemas").value = s ? (s.problemas || "") : "";
    $("rsProximo").value = s ? (s.proximo_plan || "") : "";
    $("rsMsg").textContent = "";
  }

  async function guardarSemanal(e) {
    e.preventDefault();
    const fila = { proyecto_id: pid(), semana_fin: $("rsFecha").value, resumen: $("rsResumen").value.trim() || null, problemas: $("rsProblemas").value.trim() || null, proximo_plan: $("rsProximo").value.trim() || null };
    const { error } = await supabaseClient.from("reportes_semanales").upsert(fila, { onConflict: "proyecto_id,semana_fin" });
    if (error) { $("rsMsg").style.color = "var(--red)"; $("rsMsg").textContent = "No se pudo guardar: " + error.message; return; }
    $("rsMsg").style.color = "var(--green)"; $("rsMsg").textContent = "Guardado.";
    await cargar(true);
  }

  function imprimirSemanal() {
    const fin = $("rsFecha").value; const c = calcSemana(fin);
    const des = c.realPct - c.planPct;
    const cuerpo = `<h1>Reporte semanal de obra</h1><div class="sub">${esc(proyNombre())} — semana del ${fdmy(c.ini)} al ${fdmy(c.fin)}</div>
      <table><tr><th>Producción de la semana</th><td class="num">S/ ${solesFmt(c.prodSemana)}</td><th>Avance real acumulado</th><td class="num">${c.realPct.toFixed(1)} %</td><th>Avance programado</th><td class="num">${c.planPct.toFixed(1)} %</td><th>Desface</th><td class="num">${(des >= 0 ? "+" : "") + des.toFixed(1)} pts</td></tr></table>
      <h2>Resumen de la semana</h2><p>${esc($("rsResumen").value)}</p>
      <h2>Partidas con mayor producción</h2><table><tr><th>Frente</th><th>Partida</th><th class="num">Valorizado (S/)</th></tr>${c.top.map(t => `<tr><td>${esc(t.x.frente)}</td><td>${esc(t.x.nombre)}</td><td class="num">${solesFmt(t.v)}</td></tr>`).join("")}</table>
      <h2>Restricciones</h2><p>${c.nuevas} nuevas, ${c.levant} levantadas, ${c.abiertas} abiertas a la fecha.</p>
      <h2>Problemas y acciones</h2><p>${esc($("rsProblemas").value)}</p><h2>Plan de la próxima semana</h2><p>${esc($("rsProximo").value)}</p>`;
    imprimir("Reporte semanal " + fin, cuerpo);
  }

  // ---------------- CUADERNO DE OBRA ----------------
  function cargoPorRol() { return { admin: "Administrador", planner: "Planner", residente: "Residente de obra" }[CURRENT_PROFILE.rol] || ""; }

  async function renderCuaderno() {
    const cont = $("cuLista");
    cont.innerHTML = ASIENTOS.map(a => `<div class="card" style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>Asiento N° ${a.numero}</b><span style="color:var(--text-muted);font-size:12.5px;">${diaSemana(a.fecha)} ${fdmy(a.fecha)} · ${a.tipo}</span></div><div style="font-size:12.5px;color:var(--text-secondary);margin:2px 0 6px;">${esc(a.autor)}${a.cargo ? " — " + esc(a.cargo) : ""}</div><div style="white-space:pre-wrap;font-size:13.5px;">${esc(a.texto)}</div><div class="cuFotos" data-id="${a.id}" style="margin-top:8px;"></div></div>`).join("")
      || `<p style="color:var(--text-muted);">Aún no hay asientos en el cuaderno.</p>`;
    for (const a of ASIENTOS) { if ((a.fotos || []).length) { const d = cont.querySelector(`.cuFotos[data-id="${a.id}"]`); if (d) FotosObra.mostrar(d, a.fotos); } }
    $("cuSiguiente").textContent = "Siguiente asiento: N° " + ((ASIENTOS[0] ? ASIENTOS[0].numero : 0) + 1);
  }

  async function guardarAsiento(e) {
    e.preventDefault();
    const btn = $("cuGuardar"); btn.disabled = true;
    try {
      $("cuMsg").style.color = "var(--text-muted)"; $("cuMsg").textContent = "Guardando...";
      const fecha = $("cuFecha").value;
      const numero = (ASIENTOS[0] ? ASIENTOS[0].numero : 0) + 1;
      const fotos = fotosPendientes.cuaderno.length ? await FotosObra.subir(fotosPendientes.cuaderno, `${pid()}/cuaderno/${fecha}`) : [];
      const fila = { proyecto_id: pid(), numero, fecha, tipo: $("cuTipo").value, autor: $("cuAutor").value.trim(), cargo: $("cuCargo").value.trim() || null, texto: $("cuTexto").value.trim(), fotos };
      const { error } = await supabaseClient.from("cuaderno_asientos").insert(fila);
      if (error) throw error;
      $("cuTexto").value = ""; limpiarFotos("cuaderno", $("cuFotosSel")); $("cuFotosSel").textContent = "";
      await cargar(true); await renderCuaderno();
      $("cuMsg").style.color = "var(--green)"; $("cuMsg").textContent = "Asiento N° " + numero + " registrado.";
    } catch (err) {
      $("cuMsg").style.color = "var(--red)";
      $("cuMsg").textContent = /duplicate|unique/i.test(err.message || "") ? "Otro usuario registró un asiento al mismo tiempo. Recarga e intenta de nuevo." : "No se pudo guardar: " + (err.message || err);
    } finally { btn.disabled = false; }
  }

  async function imprimirCuaderno() {
    const l = [...ASIENTOS].reverse();
    let html = `<h1>Cuaderno de obra</h1><div class="sub">${esc(proyNombre())}</div>`;
    for (const a of l) html += `<div class="asiento"><b>Asiento N° ${a.numero}</b> — ${diaSemana(a.fecha)} ${fdmy(a.fecha)} — ${a.tipo}<br><i>${esc(a.autor)}${a.cargo ? ", " + esc(a.cargo) : ""}</i><p>${esc(a.texto)}</p>${await fotosHtml(a.fotos)}</div>`;
    imprimir("Cuaderno de obra", html);
  }

  function enlazarFotos(inputId, clave, etiquetaId) {
    $(inputId).addEventListener("change", (e) => {
      fotosPendientes[clave] = fotosPendientes[clave].concat([...e.target.files]);
      $(etiquetaId).textContent = fotosPendientes[clave].length + " foto(s) por subir";
      e.target.value = "";
    });
  }

  // ---------------- registro de vistas ----------------
  registerVista({
    id: "diario", titulo: "Reporte diario",
    html: `<form class="card" id="rdForm"><h2 id="rdTitulo">Reporte diario</h2>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px;">
        <label style="${lab}">Fecha<input type="date" id="rdFecha" required style="${inp}"></label>
        <label style="${lab}">Clima<select id="rdClima" style="${inp}"><option value=""></option><option>Soleado</option><option>Nublado</option><option>Llovizna</option><option>Lluvia</option><option>Viento fuerte</option></select></label>
        <label style="${lab}">Personal propio<input type="number" min="0" id="rdPropio" style="${inp}"></label>
        <label style="${lab}">Personal de subcontratas<input type="number" min="0" id="rdSub" style="${inp}"></label>
        <label style="${lab};grid-column:1/-1;">Equipos y maquinaria<input type="text" id="rdEquipos" style="${inp}" placeholder="Ej. 1 retroexcavadora, 1 mixer, 2 vibradoras"></label>
        <label style="${lab};grid-column:1/-1;">Actividades ejecutadas<textarea id="rdActiv" rows="5" style="${inp}"></textarea></label>
        <label style="${lab};grid-column:1/-1;">Incidencias<textarea id="rdInc" rows="2" style="${inp}"></textarea></label>
        <label style="${lab};grid-column:1/-1;">Observaciones<textarea id="rdObs" rows="2" style="${inp}"></textarea></label>
        <div style="grid-column:1/-1;"><div style="${lab}">Fotos</div>
          <input type="file" id="rdFotosIn" accept="image/*" multiple style="font-size:12.5px;"> <span id="rdFotosSel" style="font-size:12.5px;color:var(--text-muted);"></span>
          <div id="rdFotos" style="margin-top:8px;"></div></div>
        <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button class="btn" type="submit" id="rdGuardar" style="width:auto;">Guardar reporte</button>
          <button class="btn secondary" type="button" id="rdAvances" style="width:auto;">Traer avances de la semana</button>
          <button class="btn secondary" type="button" id="rdPrint" style="width:auto;">Imprimir / PDF</button>
          <span id="rdMsg" style="font-size:12.5px;"></span></div>
      </div></form>
      <div class="card"><h2>Reportes anteriores</h2><div style="overflow-x:auto;"><table class="data-table" id="rdLista"><thead><tr><th>Fecha</th><th>Día</th><th>Clima</th><th class="num">Personal</th><th>Actividades</th><th class="num">Fotos</th></tr></thead><tbody></tbody></table></div></div>`,
    init() {
      $("rdForm").addEventListener("submit", guardarDiario);
      $("rdFecha").addEventListener("change", () => llenarDiario($("rdFecha").value));
      $("rdAvances").addEventListener("click", traerAvances);
      $("rdPrint").addEventListener("click", imprimirDiario);
      enlazarFotos("rdFotosIn", "diario", "rdFotosSel");
      $("rdLista").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-f]"); if (tr) { llenarDiario(tr.dataset.f); window.scrollTo({ top: 0, behavior: "smooth" }); } });
    },
    async onShow() {
      await cargar(); renderDiarios();
      await llenarDiario($("rdFecha").value || hoyLocalISO());
      const ok = puedeEscribirObra(ESCRIBE);
      $("rdGuardar").style.display = ok ? "" : "none"; $("rdFotosIn").style.display = ok ? "" : "none"; $("rdAvances").style.display = ok ? "" : "none";
    },
  });

  registerVista({
    id: "semanal", titulo: "Reporte semanal",
    html: `<div class="card"><h2>Reporte semanal</h2>
      <p class="save-hint">Los indicadores se calculan solos con el avance registrado, los reportes diarios y las restricciones. Tú completas el resumen y el plan de la próxima semana.</p>
      <label style="${lab};max-width:240px;">Semana que termina el<input type="date" id="rsFecha" style="${inp}"></label>
      <p id="rsInfo" class="save-hint" style="margin-top:8px;"></p><div class="stat-row" id="rsTiles"></div>
      <h2 style="margin-top:14px;">Partidas con mayor producción de la semana</h2>
      <div style="overflow-x:auto;"><table class="data-table" id="rsTop"><thead><tr><th>Frente</th><th>Partida</th><th class="num">Valorizado (S/)</th></tr></thead><tbody></tbody></table></div></div>
      <form class="card" id="rsForm"><div style="display:grid;gap:10px;">
        <label style="${lab}">Resumen de la semana<textarea id="rsResumen" rows="4" style="${inp}"></textarea></label>
        <label style="${lab}">Problemas y acciones tomadas<textarea id="rsProblemas" rows="3" style="${inp}"></textarea></label>
        <label style="${lab}">Plan de la próxima semana<textarea id="rsProximo" rows="3" style="${inp}"></textarea></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><button class="btn" type="submit" id="rsGuardar" style="width:auto;">Guardar textos</button><button class="btn secondary" type="button" id="rsPrint" style="width:auto;">Imprimir / PDF</button><span id="rsMsg" style="font-size:12.5px;"></span></div>
      </div></form>`,
    init() {
      $("rsFecha").value = hoyLocalISO();
      $("rsFecha").addEventListener("change", renderSemanal);
      $("rsForm").addEventListener("submit", guardarSemanal);
      $("rsPrint").addEventListener("click", imprimirSemanal);
    },
    async onShow() { await cargar(); renderSemanal(); $("rsGuardar").style.display = puedeEscribirObra(ESCRIBE) ? "" : "none"; },
  });

  registerVista({
    id: "cuaderno", titulo: "Cuaderno de obra",
    html: `<form class="card" id="cuForm"><h2>Nuevo asiento</h2>
      <p class="save-hint">Los asientos no se editan ni se borran: si hay un error, se anota un nuevo asiento que lo corrija. <b id="cuSiguiente"></b></p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
        <label style="${lab}">Fecha<input type="date" id="cuFecha" required style="${inp}"></label>
        <label style="${lab}">Tipo de asiento<select id="cuTipo" style="${inp}"><option>Residente</option><option>Supervisión</option><option>Cliente</option></select></label>
        <label style="${lab}">Autor<input type="text" id="cuAutor" required style="${inp}"></label>
        <label style="${lab}">Cargo<input type="text" id="cuCargo" style="${inp}"></label>
        <label style="${lab};grid-column:1/-1;">Texto del asiento<textarea id="cuTexto" rows="5" required style="${inp}"></textarea></label>
        <div style="grid-column:1/-1;"><input type="file" id="cuFotosIn" accept="image/*" multiple style="font-size:12.5px;"> <span id="cuFotosSel" style="font-size:12.5px;color:var(--text-muted);"></span></div>
        <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><button class="btn" type="submit" id="cuGuardar" style="width:auto;">Registrar asiento</button><button class="btn secondary" type="button" id="cuPrint" style="width:auto;">Imprimir / PDF del cuaderno</button><span id="cuMsg" style="font-size:12.5px;"></span></div>
      </div></form><div id="cuLista"></div>`,
    init() {
      $("cuForm").addEventListener("submit", guardarAsiento);
      $("cuPrint").addEventListener("click", imprimirCuaderno);
      enlazarFotos("cuFotosIn", "cuaderno", "cuFotosSel");
    },
    async onShow() {
      await cargar(); await renderCuaderno();
      $("cuFecha").value = $("cuFecha").value || hoyLocalISO();
      if (!$("cuAutor").value && CURRENT_PROFILE) { $("cuAutor").value = CURRENT_PROFILE.nombre_completo || ""; $("cuCargo").value = cargoPorRol(); }
      const ok = puedeEscribirObra(ESCRIBE);
      $("cuGuardar").style.display = ok ? "" : "none"; $("cuFotosIn").style.display = ok ? "" : "none";
    },
  });

  OBRA_HOOKS.push(() => { cargadoPara = null; });
})();
