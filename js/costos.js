// =========================================================
// Control de Obra > Costos: Valorización al cliente, Costos (comprometido vs. presupuesto)
// y Adicionales y cambios. Se carga DESPUÉS de app.js.
// =========================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s);
  const ESCRIBE = ["admin", "planner"];
  const IGV = 0.18;
  const ESTADOS_VAL = ["Por presentar", "Presentada", "Aprobada", "Facturada", "Cobrada"];
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const etiqueta = (k) => MESES[Number(k.slice(5)) - 1] + "-" + k.slice(2, 4);
  const estiloInput = "padding:7px 10px; border-radius:8px; border:1px solid var(--border); font:inherit;";

  let VAL = [], ADI = [], PAQ = [], LG_OK = true;
  let cargadoPara = null, periodoSel = null, adiEdit = null;

  async function cargarDatos(forzar) {
    const pid = (typeof PROYECTO_ACTUAL_ID !== "undefined" && PROYECTO_ACTUAL_ID) || ($("proyectoSelectDash") && $("proyectoSelectDash").value);
    if (!pid) return false;
    if (!forzar && cargadoPara === pid) return true;
    const [v, a] = await Promise.all([
      supabaseClient.from("val_cliente").select("*").eq("proyecto_id", pid),
      supabaseClient.from("adicionales").select("*").eq("proyecto_id", pid).order("numero"),
    ]);
    VAL = v.data || []; ADI = a.data || [];
    const lg = await supabaseClient.from("lg_paquetes").select("frente,estado,presupuesto_ref,monto_comprometido,tipo,nombre").eq("proyecto_id", pid);
    LG_OK = !lg.error; PAQ = lg.data || [];
    cargadoPara = pid;
    return true;
  }

  // ---------------- cálculo de la valorización mensual ----------------
  function calcMensual() {
    if (!PARTIDAS.length) return null;
    const p = fcLeerParams();
    const ini = PARTIDAS.reduce((m, x) => (!m || x.fecha_inicio_base < m) ? x.fecha_inicio_base : m, null);
    const fin = PARTIDAS.reduce((m, x) => (!m || x.fecha_fin_base > m) ? x.fecha_fin_base : m, null);
    const meses = fcMeses(ini.slice(0, 7), fin.slice(0, 7));
    const directo = PARTIDAS.reduce((s, x) => s + (x.presupuesto_total || 0), 0);
    const nObra = meses.length;
    const cuota = directo * (p.gg + p.util) / 100 / nObra;
    const puPor = {}; PARTIDAS.forEach(x => puPor[x.id] = Number(x.precio_unitario) || 0);
    const real = {}; AVANCES.forEach(a => { const k = a.semana_fin.slice(0, 7); real[k] = (real[k] || 0) + Number(a.metrado_ejecutado) * (puPor[a.partida_id] || 0); });
    const prog = meses.map(() => 0);
    PARTIDAS.forEach(x => {
      const pres = x.presupuesto_total || 0; if (!pres) return;
      let a = 0;
      meses.forEach((k, i) => { const c = avancePlanificadoEnFecha(x, fcFinMes(k)); prog[i] += (c - a) * pres; a = c; });
    });
    const hoyK = hoyLocalISO().slice(0, 7);
    let acum = 0;
    const filas = meses.map((k, i) => {
      const futuro = k > hoyK && !real[k];
      const prod = futuro ? prog[i] : (real[k] || 0);
      const bruta = prod + cuota;
      const amort = bruta * p.adelanto / 100, ret = bruta * p.retencion / 100;
      const neta = bruta - amort - ret, igv = neta * IGV, total = neta + igv;
      acum += prod;
      const reg = VAL.find(v => v.periodo === k);
      return { k, n: i + 1, prog: prog[i], real: real[k] || 0, futuro, prod, cuota, bruta, amort, ret, neta, igv, total, acum, reg };
    });
    return { filas, p, directo, nObra, cuota };
  }

  function detallePeriodo(k) {
    const filas = [];
    PARTIDAS.forEach(x => {
      const av = AVANCES.filter(a => a.partida_id === x.id);
      const ant = av.filter(a => a.semana_fin.slice(0, 7) < k).reduce((s, a) => s + Number(a.metrado_ejecutado), 0);
      const per = av.filter(a => a.semana_fin.slice(0, 7) === k).reduce((s, a) => s + Number(a.metrado_ejecutado), 0);
      if (!per) return;
      const pu = Number(x.precio_unitario) || 0;
      filas.push({ x, ant, per, acum: ant + per, pct: x.metrado_total ? (ant + per) / x.metrado_total : 0, pu, monto: per * pu });
    });
    return filas;
  }

  // ---------------- VALORIZACIÓN ----------------
  function renderValorizacion() {
    const cont = $("valTabla");
    if (!cont) return;
    const r = calcMensual();
    if (!r) { cont.innerHTML = `<tr><td style="color:var(--text-muted);">Selecciona un proyecto con partidas.</td></tr>`; $("valTiles").innerHTML = ""; $("valDetalle").style.display = "none"; return; }
    const sum = (f) => r.filas.filter(x => !x.futuro).reduce((s, x) => s + f(x), 0);
    const montoDe = (x) => x.reg && x.reg.monto_facturado != null ? Number(x.reg.monto_facturado) : x.total;
    const porEstado = (set) => r.filas.filter(x => x.reg && set.includes(x.reg.estado)).reduce((s, x) => s + montoDe(x), 0);
    const tile = (l, v, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}" style="font-size:19px;">${v}</div></div>`;
    $("valTiles").innerHTML =
      tile("Producción real acumulada", "S/ " + solesFmt(sum(x => x.real))) +
      tile("Valorizaciones presentadas", "S/ " + solesFmt(porEstado(["Presentada", "Aprobada", "Facturada", "Cobrada"]))) +
      tile("Facturado", "S/ " + solesFmt(porEstado(["Facturada", "Cobrada"]))) +
      tile("Cobrado", "S/ " + solesFmt(porEstado(["Cobrada"])), "good") +
      tile("Por cobrar", "S/ " + solesFmt(porEstado(["Facturada"])), porEstado(["Facturada"]) > 0 ? "bad" : "");
    const tot = (f) => r.filas.reduce((s, x) => s + f(x), 0);
    cont.innerHTML = `<thead><tr><th>N°</th><th>Mes</th><th class="num">Prod. programada</th><th class="num">Prod. real</th><th class="num">GG + utilidad</th><th class="num">Val. bruta</th><th class="num">(−) Adelanto</th><th class="num">(−) Retención</th><th class="num">Val. neta</th><th class="num">IGV 18 %</th><th class="num">Total a facturar</th><th>Estado</th></tr></thead><tbody>` +
      r.filas.map(x => `<tr data-per="${x.k}" style="cursor:pointer; ${x.futuro ? "color:var(--text-muted); font-style:italic;" : ""} ${x.k === periodoSel ? "background:#eef4fc;" : ""}"><td>${x.n}</td><td>${etiqueta(x.k)}</td><td class="num">${solesFmt(x.prog)}</td><td class="num">${x.futuro ? "" : solesFmt(x.real)}</td><td class="num">${solesFmt(x.cuota)}</td><td class="num">${solesFmt(x.bruta)}</td><td class="num">${solesFmt(x.amort)}</td><td class="num">${solesFmt(x.ret)}</td><td class="num">${solesFmt(x.neta)}</td><td class="num">${solesFmt(x.igv)}</td><td class="num"><b>${solesFmt(x.total)}</b></td><td>${x.futuro ? "" : `<span class="badge ${x.reg ? (x.reg.estado === "Cobrada" ? "ok" : x.reg.estado === "Por presentar" ? "late" : "warn") : "late"}">${x.reg ? x.reg.estado : "Por presentar"}</span>`}</td></tr>`).join("") +
      `</tbody><tfoot><tr style="font-weight:700;"><td></td><td>Total</td><td class="num">${solesFmt(tot(x => x.prog))}</td><td class="num">${solesFmt(sum(x => x.real))}</td><td class="num">${solesFmt(tot(x => x.cuota))}</td><td class="num">${solesFmt(tot(x => x.bruta))}</td><td class="num">${solesFmt(tot(x => x.amort))}</td><td class="num">${solesFmt(tot(x => x.ret))}</td><td class="num">${solesFmt(tot(x => x.neta))}</td><td class="num">${solesFmt(tot(x => x.igv))}</td><td class="num">${solesFmt(tot(x => x.total))}</td><td></td></tr></tfoot>`;
    $("valNota").textContent = `Gastos generales (${r.p.gg} %) y utilidad (${r.p.util} %) como cuota fija mensual sobre el directo en ${r.nObra} meses de obra; adelanto ${r.p.adelanto} % y retención ${r.p.retencion} %. Estos porcentajes se editan en la pestaña Flujo de Caja. Los meses en cursiva son proyección con la programación.`;
    cont.querySelectorAll("tr[data-per]").forEach(tr => tr.addEventListener("click", () => { periodoSel = tr.dataset.per; renderValorizacion(); renderDetalle(r); }));
    if (periodoSel) renderDetalle(r); else $("valDetalle").style.display = "none";
  }

  function renderDetalle(r) {
    const f = r.filas.find(x => x.k === periodoSel);
    if (!f) { $("valDetalle").style.display = "none"; return; }
    $("valDetalle").style.display = "";
    $("valDetTitulo").textContent = `Valorización N° ${f.n} — ${etiqueta(f.k)}`;
    const det = detallePeriodo(f.k);
    const porFrente = {};
    det.forEach(d => { (porFrente[d.x.frente] = porFrente[d.x.frente] || []).push(d); });
    let html = "";
    Object.keys(porFrente).forEach(fr => {
      const sub = porFrente[fr].reduce((s, d) => s + d.monto, 0);
      html += `<tr style="background:#f6f7fa; font-weight:600;"><td colspan="8">${esc(fr)}</td><td class="num">${solesFmt(sub)}</td></tr>`;
      porFrente[fr].forEach(d => {
        html += `<tr><td>${esc(d.x.nombre)}</td><td>${esc(d.x.unidad)}</td><td class="num">${d.ant.toLocaleString("es-PE", { maximumFractionDigits: 2 })}</td><td class="num">${d.per.toLocaleString("es-PE", { maximumFractionDigits: 2 })}</td><td class="num">${d.acum.toLocaleString("es-PE", { maximumFractionDigits: 2 })}</td><td class="num">${(d.pct * 100).toFixed(1)} %</td><td class="num">${d.x.metrado_total.toLocaleString("es-PE", { maximumFractionDigits: 2 })}</td><td class="num">${d.pu.toLocaleString("es-PE", { maximumFractionDigits: 2 })}</td><td class="num">${solesFmt(d.monto)}</td></tr>`;
      });
    });
    $("valDetTabla").querySelector("tbody").innerHTML = html || `<tr><td colspan="9" style="color:var(--text-muted);">No hay avance registrado en este mes.</td></tr>`;
    const reg = f.reg || {};
    $("vfEstado").value = reg.estado || "Por presentar";
    $("vfFactura").value = reg.numero_factura || "";
    $("vfFPres").value = reg.fecha_presentacion || "";
    $("vfFCobro").value = reg.fecha_cobro || "";
    $("vfMonto").value = reg.monto_facturado != null ? reg.monto_facturado : "";
    $("vfObs").value = reg.observaciones || "";
    $("valForm").style.display = puedeEscribirObra(ESCRIBE) ? "" : "none";
    $("valMsg").textContent = "";
  }

  async function guardarEstadoVal(e) {
    e.preventDefault();
    const pid = cargadoPara;
    const v = (id) => $(id).value.trim() || null;
    const fila = { proyecto_id: pid, periodo: periodoSel, estado: $("vfEstado").value, numero_factura: v("vfFactura"), fecha_presentacion: v("vfFPres"), fecha_cobro: v("vfFCobro"), monto_facturado: v("vfMonto") == null ? null : Number(v("vfMonto")), observaciones: v("vfObs") };
    const { error } = await supabaseClient.from("val_cliente").upsert(fila, { onConflict: "proyecto_id,periodo" });
    if (error) { $("valMsg").style.color = "var(--red)"; $("valMsg").textContent = "No se pudo guardar: " + error.message; return; }
    $("valMsg").style.color = "var(--green)"; $("valMsg").textContent = "Guardado.";
    await cargarDatos(true); renderValorizacion();
  }

  function exportarVal() {
    const f = periodoSel; if (!f) return;
    const det = detallePeriodo(f);
    descargarCSV(`valorizacion_${f}.csv`, ["Frente", "Partida", "Unidad", "Metrado anterior", "Metrado del mes", "Metrado acumulado", "% acumulado", "Metrado contratado", "P.U. (S/)", "Valorizado del mes (S/)"],
      det.map(d => [d.x.frente, d.x.nombre, d.x.unidad, d.ant, d.per, d.acum, (d.pct * 100).toFixed(1), d.x.metrado_total, d.pu, d.monto.toFixed(2)]));
  }

  // ---------------- COSTOS ----------------
  const signo = (a) => a.tipo === "Deductivo" ? -1 : a.tipo === "Adicional" ? 1 : 0;
  function adicionalNeto() { return ADI.filter(a => a.estado === "Aprobado").reduce((s, a) => s + signo(a) * Number(a.monto || 0), 0); }

  function renderCostos() {
    if (!$("cosTabla")) return;
    if (!PARTIDAS.length) { $("cosTiles").innerHTML = ""; $("cosTabla").querySelector("tbody").innerHTML = ""; $("cosAviso").textContent = "Selecciona un proyecto con partidas."; return; }
    const directo = PARTIDAS.reduce((s, x) => s + (x.presupuesto_total || 0), 0);
    const adj = PAQ.filter(p => ["Adjudicado", "Orden / Contrato", "Cerrado"].includes(p.estado));
    const comp = adj.reduce((s, p) => s + (Number(p.monto_comprometido) || 0), 0);
    const pref = adj.reduce((s, p) => s + (Number(p.presupuesto_ref) || 0), 0);
    const ahorro = pref - comp;
    const adicNeto = adicionalNeto();
    const tile = (l, v, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}" style="font-size:19px;">${v}</div></div>`;
    $("cosAviso").textContent = LG_OK ? "El comprometido sale de los paquetes adjudicados en el módulo Logística." : "No se pudo leer Logística: tu usuario no tiene acceso o falta correr logistica.sql. Se muestran solo presupuesto y adicionales.";
    $("cosTiles").innerHTML =
      tile("Presupuesto directo contractual", "S/ " + solesFmt(directo)) +
      tile("Adicionales y deductivos aprobados", (adicNeto >= 0 ? "+ " : "− ") + "S/ " + solesFmt(Math.abs(adicNeto))) +
      tile("Presupuesto vigente", "S/ " + solesFmt(directo + adicNeto)) +
      tile("Comprometido en Logística", "S/ " + solesFmt(comp)) +
      tile("Ahorro / sobrecosto adjudicado", (ahorro >= 0 ? "+ " : "− ") + "S/ " + solesFmt(Math.abs(ahorro)), ahorro >= 0 ? "good" : "bad") +
      tile("% del presupuesto adjudicado", directo ? (pref / directo * 100).toFixed(1) + " %" : "—");
    const frentes = [...new Set(PARTIDAS.map(x => x.frente))];
    const extra = [...new Set(adj.map(p => p.frente).filter(f => f && !frentes.includes(f)))];
    const filas = [...frentes, ...extra].map(f => {
      const ppto = PARTIDAS.filter(x => x.frente === f).reduce((s, x) => s + (x.presupuesto_total || 0), 0);
      const l = adj.filter(p => p.frente === f);
      const rf = l.reduce((s, p) => s + (Number(p.presupuesto_ref) || 0), 0), cc = l.reduce((s, p) => s + (Number(p.monto_comprometido) || 0), 0);
      return { f, ppto, rf, cc, d: rf - cc, n: l.length };
    });
    $("cosTabla").querySelector("tbody").innerHTML = filas.map(x => `<tr><td>${esc(x.f)}</td><td class="num">${solesFmt(x.ppto)}</td><td class="num">${x.n}</td><td class="num">${solesFmt(x.rf)}</td><td class="num">${solesFmt(x.cc)}</td><td class="num" style="color:${x.d < 0 ? "var(--red)" : "inherit"};">${x.n ? (x.d < 0 ? "−" : "") + solesFmt(Math.abs(x.d)) : ""}</td><td><div style="height:9px;border-radius:5px;background:#e9e8e2;overflow:hidden;min-width:90px;"><i style="display:block;height:100%;width:${x.ppto ? Math.min(100, x.rf / x.ppto * 100) : 0}%;background:var(--blue);"></i></div></td></tr>`).join("");
  }

  // ---------------- ADICIONALES ----------------
  const ESTADOS_ADI = ["Identificado", "Cotizado", "Presentado", "Aprobado", "Rechazado"];
  const codAdi = (a) => (a.tipo === "Deductivo" ? "DE-" : a.tipo === "Adicional" ? "AD-" : "CM-") + String(a.numero).padStart(3, "0");

  function renderAdicionales() {
    if (!$("adiTabla")) return;
    const apr = ADI.filter(a => a.estado === "Aprobado");
    const pend = ADI.filter(a => ["Identificado", "Cotizado", "Presentado"].includes(a.estado));
    const directo = PARTIDAS.reduce((s, x) => s + (x.presupuesto_total || 0), 0);
    const net = adicionalNeto();
    const pendM = pend.reduce((s, a) => s + signo(a) * Number(a.monto || 0), 0);
    const tile = (l, v, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}" style="font-size:19px;">${v}</div></div>`;
    $("adiTiles").innerHTML =
      tile("Aprobados (neto)", (net >= 0 ? "+ " : "− ") + "S/ " + solesFmt(Math.abs(net))) +
      tile("% sobre el contrato", directo ? (net / directo * 100).toFixed(1) + " %" : "—") +
      tile("Plazo aprobado", apr.reduce((s, a) => s + (a.plazo_dias || 0), 0) + " días") +
      tile("En trámite (neto)", (pendM >= 0 ? "+ " : "− ") + "S/ " + solesFmt(Math.abs(pendM)), pend.length ? "bad" : "") +
      tile("Rechazados", ADI.filter(a => a.estado === "Rechazado").length);
    const fe = $("adiFEstado").value;
    const l = ADI.filter(a => fe === "todos" || (fe === "tramite" ? ["Identificado", "Cotizado", "Presentado"].includes(a.estado) : a.estado === fe));
    $("adiTabla").querySelector("tbody").innerHTML = l.map(a => {
      const cls = a.estado === "Aprobado" ? "ok" : a.estado === "Rechazado" ? "" : "warn";
      const rev = a.revision_id ? (REVISIONES.find(r => r.id === a.revision_id) || {}).nombre : "";
      return `<tr><td>${codAdi(a)}</td><td>${a.tipo}</td><td style="min-width:220px;">${esc(a.descripcion)}</td><td>${esc(a.frente)}</td><td class="num">${a.tipo === "Deductivo" ? "−" : ""}${solesFmt(a.monto)}</td><td class="num">${a.plazo_dias || 0}</td><td><span class="badge ${cls}">${a.estado}</span></td><td>${fdmy(a.fecha_presentacion)}</td><td>${fdmy(a.fecha_aprobacion)}</td><td>${esc(a.referencia)}</td><td>${esc(rev || "")}</td><td style="white-space:nowrap;">${puedeEscribirObra(ESCRIBE) ? `<button class="btn secondary" style="width:auto;padding:3px 8px;font-size:11.5px;" data-ed="${a.id}">Editar</button> <button class="btn secondary" style="width:auto;padding:3px 8px;font-size:11.5px;" data-del="${a.id}">Borrar</button>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="12" style="color:var(--text-muted);">No hay registros.</td></tr>`;
  }

  function abrirAdi(a) {
    adiEdit = a || null;
    $("adiFormTitulo").textContent = a ? "Editar " + codAdi(a) : "Nuevo adicional o cambio";
    $("afFrente").innerHTML = `<option value="">— sin frente —</option>` + [...new Set(PARTIDAS.map(x => x.frente))].map(f => `<option>${esc(f)}</option>`).join("");
    $("afRev").innerHTML = `<option value="">— ninguna —</option>` + (REVISIONES || []).map(r => `<option value="${r.id}">${esc(r.nombre)}</option>`).join("");
    $("afTipo").value = a ? a.tipo : "Adicional";
    $("afDesc").value = a ? a.descripcion : "";
    $("afFrente").value = a ? (a.frente || "") : "";
    $("afMonto").value = a ? a.monto : "";
    $("afPlazo").value = a ? a.plazo_dias : 0;
    $("afEstado").value = a ? a.estado : "Identificado";
    $("afFId").value = a ? (a.fecha_identificacion || "") : hoyLocalISO();
    $("afFPres").value = a ? (a.fecha_presentacion || "") : "";
    $("afFApr").value = a ? (a.fecha_aprobacion || "") : "";
    $("afRef").value = a ? (a.referencia || "") : "";
    $("afResp").value = a ? (a.responsable || "") : "";
    $("afRev").value = a ? (a.revision_id || "") : "";
    $("afObs").value = a ? (a.observaciones || "") : "";
    $("adiMsg").textContent = "";
    $("adiForm").style.display = "";
    $("adiForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function guardarAdi(e) {
    e.preventDefault();
    const t = (id) => $(id).value.trim() || null;
    const estado = $("afEstado").value;
    const fila = { proyecto_id: cargadoPara, tipo: $("afTipo").value, descripcion: $("afDesc").value.trim(), frente: t("afFrente"), monto: Number($("afMonto").value || 0), plazo_dias: parseInt($("afPlazo").value || "0", 10),
      estado, fecha_identificacion: t("afFId"), fecha_presentacion: t("afFPres") || (estado === "Presentado" ? hoyLocalISO() : null), fecha_aprobacion: t("afFApr") || (estado === "Aprobado" ? hoyLocalISO() : null),
      referencia: t("afRef"), responsable: t("afResp"), revision_id: t("afRev"), observaciones: t("afObs") };
    const q = adiEdit ? supabaseClient.from("adicionales").update(fila).eq("id", adiEdit.id) : supabaseClient.from("adicionales").insert(fila);
    const { error } = await q;
    if (error) { $("adiMsg").textContent = "No se pudo guardar: " + error.message; return; }
    $("adiForm").style.display = "none";
    await cargarDatos(true); renderAdicionales(); renderCostos();
  }

  // ---------------- registro de vistas ----------------
  const TH = (cols) => cols.map(c => `<th${c[1] ? ` class="num"` : ""}>${c[0]}</th>`).join("");

  registerVista({
    id: "valorizacion", titulo: "Valorización",
    html: `<div class="card"><h2>Valorización mensual al cliente</h2>
      <p class="save-hint" id="valNota"></p>
      <div class="stat-row" id="valTiles"></div>
      <div style="overflow-x:auto;"><table class="data-table" id="valTabla"></table></div>
      <p class="save-hint" style="margin-top:8px;">Haz clic en un mes para ver el detalle de metrados valorizados y registrar su estado (presentada, facturada, cobrada).</p></div>
      <div class="card" id="valDetalle" style="display:none;">
        <h2 id="valDetTitulo"></h2>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin:6px 0 10px;"><button class="btn secondary" type="button" id="valCSV" style="width:auto;">Exportar metrados a Excel (CSV)</button></div>
        <div style="overflow-x:auto;"><table class="data-table" id="valDetTabla"><thead><tr><th>Partida</th><th>Und</th><th class="num">Metrado anterior</th><th class="num">Metrado del mes</th><th class="num">Metrado acumulado</th><th class="num">% acum.</th><th class="num">Metrado contratado</th><th class="num">P.U. (S/)</th><th class="num">Valorizado (S/)</th></tr></thead><tbody></tbody></table></div>
        <form id="valForm" style="margin-top:14px; display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px;">
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Estado<select id="vfEstado" style="${estiloInput}">${ESTADOS_VAL.map(e => `<option>${e}</option>`).join("")}</select></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">N° de factura<input type="text" id="vfFactura" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Fecha de presentación<input type="date" id="vfFPres" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Fecha de cobro<input type="date" id="vfFCobro" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Monto facturado (S/), si difiere<input type="number" step="0.01" id="vfMonto" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;grid-column:1/-1;">Observaciones<input type="text" id="vfObs" style="${estiloInput}"></label>
          <div style="grid-column:1/-1;"><button class="btn" type="submit" style="width:auto;">Guardar estado</button> <span id="valMsg" style="font-size:12.5px;margin-left:8px;"></span></div>
        </form></div>`,
    init() {
      $("valForm").addEventListener("submit", guardarEstadoVal);
      $("valCSV").addEventListener("click", exportarVal);
    },
    async onShow() { await cargarDatos(); renderValorizacion(); },
  });

  registerVista({
    id: "costos", titulo: "Costos",
    html: `<div class="card"><h2>Presupuesto vs. comprometido</h2><p class="save-hint" id="cosAviso"></p><div class="stat-row" id="cosTiles"></div></div>
      <div class="card"><h2>Por frente</h2><div style="overflow-x:auto;"><table class="data-table" id="cosTabla"><thead><tr><th>Frente</th><th class="num">Presupuesto (S/)</th><th class="num">Paquetes adjudicados</th><th class="num">Presupuesto de lo adjudicado</th><th class="num">Comprometido (S/)</th><th class="num">Ahorro / sobrecosto</th><th>Adjudicado del frente</th></tr></thead><tbody></tbody></table></div></div>`,
    async onShow() { await cargarDatos(); renderCostos(); },
  });

  registerVista({
    id: "adicionales", titulo: "Adicionales y cambios",
    html: `<div class="stat-row" id="adiTiles"></div>
      <form class="card" id="adiForm" style="display:none;">
        <h2 id="adiFormTitulo">Nuevo adicional o cambio</h2>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px;">
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Tipo<select id="afTipo" style="${estiloInput}"><option>Adicional</option><option>Deductivo</option><option>Cambio sin costo</option></select></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;grid-column:span 2;">Descripción<input type="text" id="afDesc" required style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Frente<select id="afFrente" style="${estiloInput}"></select></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Monto (S/, sin signo)<input type="number" step="0.01" min="0" id="afMonto" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Plazo (días)<input type="number" step="1" id="afPlazo" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Estado<select id="afEstado" style="${estiloInput}">${ESTADOS_ADI.map(e => `<option>${e}</option>`).join("")}</select></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Fecha de identificación<input type="date" id="afFId" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Fecha de presentación<input type="date" id="afFPres" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Fecha de aprobación<input type="date" id="afFApr" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Referencia (carta, orden de cambio)<input type="text" id="afRef" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Responsable<input type="text" id="afResp" style="${estiloInput}"></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;">Línea base asociada<select id="afRev" style="${estiloInput}"></select></label>
          <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;grid-column:1/-1;">Observaciones<input type="text" id="afObs" style="${estiloInput}"></label>
          <div style="grid-column:1/-1;display:flex;gap:8px;"><button class="btn" type="submit" style="width:auto;">Guardar</button><button class="btn secondary" type="button" id="adiCancelar" style="width:auto;">Cancelar</button></div>
        </div>
        <div id="adiMsg" style="color:var(--red);font-size:12.5px;margin-top:6px;"></div>
      </form>
      <div class="card"><h2>Adicionales, deductivos y cambios</h2>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 12px;">
          <button class="btn" type="button" id="adiNuevo" style="width:auto;">+ Nuevo</button>
          <select id="adiFEstado" style="${estiloInput}"><option value="todos">Todos</option><option value="tramite">En trámite</option><option>Aprobado</option><option>Rechazado</option></select>
          <button class="btn secondary" type="button" id="adiCSV" style="width:auto;">Exportar a Excel (CSV)</button></div>
        <div style="overflow-x:auto;"><table class="data-table" id="adiTabla"><thead><tr><th>Código</th><th>Tipo</th><th>Descripción</th><th>Frente</th><th class="num">Monto (S/)</th><th class="num">Plazo (d)</th><th>Estado</th><th>Presentado</th><th>Aprobado</th><th>Referencia</th><th>Línea base</th><th></th></tr></thead><tbody></tbody></table></div></div>`,
    init() {
      $("adiNuevo").addEventListener("click", () => abrirAdi(null));
      if (!puedeEscribirObra(ESCRIBE)) { /* se oculta al mostrar */ }
      $("adiCancelar").addEventListener("click", () => $("adiForm").style.display = "none");
      $("adiForm").addEventListener("submit", guardarAdi);
      $("adiFEstado").addEventListener("change", renderAdicionales);
      $("adiTabla").addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.ed) abrirAdi(ADI.find(a => a.id === b.dataset.ed));
        if (b.dataset.del && confirm("¿Borrar este registro?")) {
          const { error } = await supabaseClient.from("adicionales").delete().eq("id", b.dataset.del);
          if (error) alert(error.message); else { await cargarDatos(true); renderAdicionales(); renderCostos(); }
        }
      });
      $("adiCSV").addEventListener("click", () => descargarCSV("adicionales_y_cambios.csv",
        ["Código", "Tipo", "Descripción", "Frente", "Monto (S/)", "Plazo (días)", "Estado", "Identificación", "Presentación", "Aprobación", "Referencia", "Responsable", "Observaciones"],
        ADI.map(a => [codAdi(a), a.tipo, a.descripcion, a.frente, signo(a) * Number(a.monto || 0), a.plazo_dias, a.estado, fdmy(a.fecha_identificacion), fdmy(a.fecha_presentacion), fdmy(a.fecha_aprobacion), a.referencia, a.responsable, a.observaciones])));
    },
    async onShow() {
      await cargarDatos(); renderAdicionales();
      $("adiNuevo").style.display = puedeEscribirObra(ESCRIBE) ? "" : "none";
    },
  });

  // al cambiar de proyecto se recargan los datos la próxima vez que se abra cada pestaña
  OBRA_HOOKS.push(() => { cargadoPara = null; periodoSel = null; });
})();
