// =========================================================
// Control de Obra > Costos > Subcontratas: valorizaciones de subcontratistas.
// Los contratos (paquetes de tipo Subcontrata) se adjudican en Procura; aquí se miden y valorizan.
// Se carga DESPUÉS de costos.js.
// =========================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s);
  const ESCRIBE = ["admin", "planner", "residente"];
  const CIERRA = ["admin", "planner"];
  const ADJ = ["Adjudicado", "Orden / Contrato", "Cerrado"];
  const fmt2 = (n) => Number(n).toLocaleString("es-PE", { maximumFractionDigits: 2 });
  const inp = "padding:7px 10px; border-radius:8px; border:1px solid var(--border); font:inherit;";
  const lbl = "font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;";
  const mini = "width:auto;padding:3px 8px;font-size:11.5px;";
  let PAQ = [], VALS = [], cargadoPara = null, SEL = null, EDIT = null, LG_OK = true;

  async function cargar(forzar) {
    const pid = (typeof PROYECTO_ACTUAL_ID !== "undefined" && PROYECTO_ACTUAL_ID) || ($("proyectoSelectDash") && $("proyectoSelectDash").value);
    if (!pid) return false;
    if (!forzar && cargadoPara === pid) return true;
    const [pk, vs] = await Promise.all([
      supabaseClient.from("lg_paquetes").select("*").eq("proyecto_id", pid).eq("tipo", "Subcontrata"),
      supabaseClient.from("lg_sub_vals").select("*").eq("proyecto_id", pid).order("numero"),
    ]);
    LG_OK = !pk.error && !vs.error;
    PAQ = (pk.data || []).filter(p => ADJ.includes(p.estado)).sort((a, b) => a.numero - b.numero);
    VALS = vs.data || [];
    cargadoPara = pid; SEL = null;
    return true;
  }

  const valsDe = (id) => VALS.filter(v => v.paquete_id === id).sort((a, b) => a.numero - b.numero);
  const neto = (v) => v.tipo === "Valorización" ? Number(v.monto_bruto) - Number(v.amort_adelanto) - Number(v.retencion) - Number(v.otros_descuentos) : Number(v.monto_bruto);
  function resumen(p) {
    const vs = valsDe(p.id), vv = vs.filter(v => v.tipo === "Valorización"), lib = vs.filter(v => v.tipo !== "Valorización");
    const contrato = Number(p.monto_comprometido) || 0;
    const bruto = vv.reduce((s, v) => s + Number(v.monto_bruto), 0);
    const ret = vv.reduce((s, v) => s + Number(v.retencion), 0) - lib.reduce((s, v) => s + Number(v.monto_bruto), 0);
    const pagado = vs.filter(v => v.estado === "Pagada").reduce((s, v) => s + neto(v), 0);
    const porPagar = vs.filter(v => v.estado !== "Pagada").reduce((s, v) => s + neto(v), 0);
    return { contrato, bruto, saldo: contrato - bruto, pct: contrato ? bruto / contrato * 100 : 0, ret, pagado, porPagar, vs };
  }
  const agotado = (r) => r.contrato > 0 && r.bruto >= r.contrato * 0.995 && r.porPagar < 0.5;

  function renderResumen() {
    const tb = $("scResumen").querySelector("tbody");
    if (!LG_OK) { tb.innerHTML = `<tr><td colspan="12" style="color:var(--text-muted);">Ejecuta primero logistica.sql y logistica_extra.sql (y subcontratas.sql) en Supabase.</td></tr>`; return; }
    const tot = PAQ.reduce((a, p) => { const r = resumen(p); a.c += r.contrato; a.v += r.bruto; a.pp += r.porPagar; a.pg += r.pagado; return a; }, { c: 0, v: 0, pp: 0, pg: 0 });
    const tile = (l, v) => `<div class="stat-tile"><div class="label">${l}</div><div class="value">${v}</div></div>`;
    $("scTiles").innerHTML = tile("Subcontratas adjudicadas", PAQ.length) + tile("Contratado (S/)", solesFmt(tot.c)) + tile("Valorizado (S/)", solesFmt(tot.v)) + tile("Pagado neto (S/)", solesFmt(tot.pg)) + tile("Por pagar (S/)", solesFmt(tot.pp));
    tb.innerHTML = PAQ.map(p => {
      const r = resumen(p);
      let al = "";
      if (r.saldo < -0.5) al = `<span class="badge late">Excede el contrato en S/ ${solesFmt(-r.saldo)}</span>`;
      else if (p.estado === "Cerrado") al = r.ret > 0.5 ? `<span class="badge warn">Retención por devolver</span>` : `<span class="badge ok">Cerrada</span>`;
      else if (agotado(r)) al = `<span class="badge warn">Listo para cerrar</span>`;
      return `<tr><td>${p.numero}</td><td>${esc(p.nombre)}</td><td>${esc(p.proveedor)}</td><td class="num">${solesFmt(r.contrato)}</td><td class="num">${solesFmt(r.bruto)}</td><td class="num">${r.pct.toFixed(1)} %</td><td class="num">${solesFmt(r.saldo)}</td><td class="num">${solesFmt(r.ret)}</td><td class="num">${solesFmt(r.pagado)}</td><td class="num">${solesFmt(r.porPagar)}</td><td>${al}</td><td><button class="btn secondary" style="${mini}" data-sc="${p.id}">Valorizaciones (${r.vs.length})</button></td></tr>`;
    }).join("") || `<tr><td colspan="12" style="color:var(--text-muted);">No hay subcontratas adjudicadas. Se adjudican en el módulo Procura (paquete de tipo Subcontrata).</td></tr>`;
  }

  function abrir(id) {
    SEL = PAQ.find(p => p.id === id); if (!SEL) return;
    $("scCard").style.display = ""; $("scForm").style.display = "none";
    $("scTitulo").textContent = `Valorizaciones — N° ${SEL.numero} ${SEL.nombre}`;
    renderDetalle();
    $("scCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderDetalle() {
    if (!SEL) return;
    SEL = PAQ.find(p => p.id === SEL.id) || SEL;
    const r = resumen(SEL), esc_ = puedeEscribirObra(ESCRIBE);
    $("scRef").textContent = `Proveedor: ${SEL.proveedor || "—"} · Contrato S/ ${solesFmt(r.contrato)} · Adelanto ${SEL.adelanto_pct ?? 0} % · Retención ${SEL.retencion_pct ?? 5} % · Saldo por valorizar S/ ${solesFmt(r.saldo)}`;
    $("scTabla").querySelector("tbody").innerHTML = r.vs.map(v => {
      const n = neto(v), lib = v.tipo !== "Valorización", igv = lib ? 0 : n * 0.18;
      return `<tr><td>${v.numero}</td><td>${lib ? "Liberación de retención" : "Valorización"}</td><td>${esc(v.periodo)}</td><td>${esc(v.descripcion)}</td><td class="num">${solesFmt(v.monto_bruto)}</td><td class="num">${lib ? "" : solesFmt(v.amort_adelanto)}</td><td class="num">${lib ? "" : solesFmt(v.retencion)}</td><td class="num">${lib ? "" : solesFmt(v.otros_descuentos)}</td><td class="num" style="font-weight:600;">${solesFmt(n)}</td><td class="num">${lib ? "" : solesFmt(igv)}</td><td class="num">${solesFmt(n + igv)}</td><td><span class="badge ${v.estado === "Pagada" ? "ok" : v.estado === "Aprobada" ? "warn" : "late"}">${v.estado}</span></td><td>${esc(v.factura)}</td><td>${fdmy(v.fecha_pago)}</td><td style="white-space:nowrap;">${esc_ ? `<button class="btn secondary" style="${mini}" data-ed="${v.id}">Editar</button> ` : ""}${CIERRA.includes(CURRENT_PROFILE.rol) ? `<button class="btn secondary" style="${mini}" data-del="${v.id}">Borrar</button>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="15" style="color:var(--text-muted);">Aún no hay valorizaciones.</td></tr>`;
    $("scNueva").style.display = esc_ ? "" : "none";
    $("scCerrarSub").style.display = CIERRA.includes(CURRENT_PROFILE.rol) && SEL.estado !== "Cerrado" && agotado(r) ? "" : "none";
  }

  function ajustarTipo() {
    const lib = $("sfTipo").value !== "Valorización";
    document.querySelectorAll(".sf-desc").forEach(e => e.style.display = lib ? "none" : "");
    $("sfBrutoL").textContent = lib ? "Monto de retención liberado (S/)" : "Monto bruto valorizado (S/)";
    netoTxt();
  }
  function netoTxt() {
    const b = Number($("sfBruto").value) || 0;
    if ($("sfTipo").value !== "Valorización") { $("sfNeto").textContent = `A pagar: S/ ${fmt2(b)}`; return; }
    const n = b - (Number($("sfAmort").value) || 0) - (Number($("sfRet").value) || 0) - (Number($("sfOtros").value) || 0);
    $("sfNeto").textContent = `Neto: S/ ${fmt2(n)} · IGV 18 % (referencial): S/ ${fmt2(n * 0.18)} · Total: S/ ${fmt2(n * 1.18)}`;
  }
  function sugerir() {
    if (EDIT || $("sfTipo").value !== "Valorización") return;
    const b = Number($("sfBruto").value) || 0;
    $("sfAmort").value = b ? (b * (Number(SEL.adelanto_pct) || 0) / 100).toFixed(2) : "";
    $("sfRet").value = b ? (b * (Number(SEL.retencion_pct) ?? 5) / 100).toFixed(2) : "";
    netoTxt();
  }

  function abrirForm(v) {
    EDIT = v || null;
    $("sfTitulo").textContent = v ? `Editar valorización N° ${v.numero}` : "Nueva valorización";
    $("scForm").reset();
    $("sfTipo").value = v ? v.tipo : "Valorización";
    $("sfPeriodo").value = v ? (v.periodo || "") : hoyLocalISO().slice(0, 7);
    $("sfDesc").value = v ? (v.descripcion || "") : "";
    $("sfBruto").value = v ? v.monto_bruto : "";
    $("sfAmort").value = v ? v.amort_adelanto : ""; $("sfRet").value = v ? v.retencion : ""; $("sfOtros").value = v ? v.otros_descuentos : "";
    $("sfEstado").value = v ? v.estado : "Presentada";
    $("sfFactura").value = v ? (v.factura || "") : "";
    $("sfFPres").value = v ? (v.fecha_presentacion || "") : hoyLocalISO();
    $("sfFPago").value = v ? (v.fecha_pago || "") : "";
    $("sfObs").value = v ? (v.observaciones || "") : "";
    $("sfMsg").textContent = "";
    $("scForm").style.display = ""; ajustarTipo();
    $("scForm").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function guardar(e) {
    e.preventDefault();
    const lib = $("sfTipo").value !== "Valorización", t = (id) => $(id).value.trim() || null;
    const fila = {
      proyecto_id: SEL.proyecto_id, paquete_id: SEL.id, tipo: $("sfTipo").value, periodo: t("sfPeriodo"), descripcion: t("sfDesc"),
      monto_bruto: Number($("sfBruto").value) || 0,
      amort_adelanto: lib ? 0 : (Number($("sfAmort").value) || 0), retencion: lib ? 0 : (Number($("sfRet").value) || 0), otros_descuentos: lib ? 0 : (Number($("sfOtros").value) || 0),
      estado: $("sfEstado").value, factura: t("sfFactura"), fecha_presentacion: t("sfFPres"),
      fecha_pago: t("sfFPago") || ($("sfEstado").value === "Pagada" ? hoyLocalISO() : null), observaciones: t("sfObs"),
    };
    if (fila.amort_adelanto + fila.retencion + fila.otros_descuentos > fila.monto_bruto) { $("sfMsg").textContent = "Los descuentos no pueden superar el monto bruto."; return; }
    if (!lib && !EDIT) {
      const r = resumen(SEL);
      if (fila.monto_bruto > r.saldo + 0.5 && !confirm(`Esta valorización (S/ ${solesFmt(fila.monto_bruto)}) supera el saldo del contrato (S/ ${solesFmt(r.saldo)}). ¿Registrar de todos modos? Considera un adicional de subcontrata.`)) return;
    }
    let error;
    if (EDIT) ({ error } = await supabaseClient.from("lg_sub_vals").update(fila).eq("id", EDIT.id));
    else { fila.numero = valsDe(SEL.id).reduce((m, v) => Math.max(m, v.numero), 0) + 1; ({ error } = await supabaseClient.from("lg_sub_vals").insert(fila)); }
    if (error) { $("sfMsg").textContent = "No se pudo guardar: " + error.message; return; }
    const id = SEL.id; await cargar(true); renderResumen(); abrir(id);
  }

  async function cerrarSub() {
    const r = resumen(SEL);
    const aviso = r.ret > 0.5 ? `\n\nAún hay S/ ${solesFmt(r.ret)} retenidos como fondo de garantía; registra su liberación cuando corresponda.` : "";
    if (!confirm(`¿Cerrar la subcontrata "${SEL.nombre}"? El contrato está valorizado y pagado.${aviso}`)) return;
    const { error } = await supabaseClient.from("lg_paquetes").update({ estado: "Cerrado", fecha_cierre: hoyLocalISO() }).eq("id", SEL.id);
    if (error) { alert(error.message); return; }
    const id = SEL.id; await cargar(true); renderResumen(); abrir(id);
  }

  registerVista({
    id: "subcontratas", titulo: "Subcontratas",
    html: `<div class="stat-row" id="scTiles"></div>
      <div class="card"><h2>Estado de cuenta por subcontrata</h2>
        <p class="save-hint">Los contratos se adjudican en Procura. Aquí se valoriza el avance de cada subcontratista. Neto = valorización − adelanto amortizado − retención − otros descuentos.</p>
        <div style="overflow-x:auto;"><table class="data-table" id="scResumen"><thead><tr><th>N°</th><th>Subcontrata</th><th>Proveedor</th><th class="num">Contrato (S/)</th><th class="num">Valorizado (S/)</th><th class="num">% avance</th><th class="num">Saldo (S/)</th><th class="num">Retenido (S/)</th><th class="num">Pagado neto (S/)</th><th class="num">Por pagar (S/)</th><th>Alerta</th><th></th></tr></thead><tbody></tbody></table></div></div>
      <div class="card" id="scCard" style="display:none;">
        <h2 id="scTitulo"></h2><p class="save-hint" id="scRef"></p>
        <div style="overflow-x:auto;"><table class="data-table" id="scTabla"><thead><tr><th>N°</th><th>Tipo</th><th>Periodo</th><th>Descripción</th><th class="num">Bruto</th><th class="num">(−) Adelanto</th><th class="num">(−) Retención</th><th class="num">(−) Otros</th><th class="num">Neto</th><th class="num">IGV 18 %</th><th class="num">Total</th><th>Estado</th><th>Factura</th><th>Pago</th><th></th></tr></thead><tbody></tbody></table></div>
        <form id="scForm" style="margin-top:14px; display:none;">
          <h3 id="sfTitulo" style="font-size:14px; margin:0 0 8px;"></h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px;">
            <label style="${lbl}">Tipo<select id="sfTipo" style="${inp}"><option>Valorización</option><option>Liberación de retención</option></select></label>
            <label style="${lbl}">Periodo<input type="month" id="sfPeriodo" style="${inp}"></label>
            <label style="${lbl}grid-column:1/-1;">Descripción / partidas valorizadas<input type="text" id="sfDesc" style="${inp}"></label>
            <label style="${lbl}"><span id="sfBrutoL">Monto bruto valorizado (S/)</span><input type="number" id="sfBruto" step="0.01" min="0" required style="${inp}"></label>
            <label class="sf-desc" style="${lbl}">Adelanto amortizado (S/)<input type="number" id="sfAmort" step="0.01" min="0" style="${inp}"></label>
            <label class="sf-desc" style="${lbl}">Retención / fondo de garantía (S/)<input type="number" id="sfRet" step="0.01" min="0" style="${inp}"></label>
            <label class="sf-desc" style="${lbl}">Otros descuentos (S/)<input type="number" id="sfOtros" step="0.01" min="0" style="${inp}"></label>
            <label style="${lbl}">Estado<select id="sfEstado" style="${inp}"><option>Presentada</option><option>Aprobada</option><option>Pagada</option></select></label>
            <label style="${lbl}">N° de factura<input type="text" id="sfFactura" style="${inp}"></label>
            <label style="${lbl}">Fecha de presentación<input type="date" id="sfFPres" style="${inp}"></label>
            <label style="${lbl}">Fecha de pago<input type="date" id="sfFPago" style="${inp}"></label>
            <label style="${lbl}grid-column:1/-1;">Observaciones<input type="text" id="sfObs" style="${inp}"></label>
          </div>
          <p id="sfNeto" style="font-size:13px; font-weight:600; margin:8px 0;"></p>
          <div style="display:flex; gap:8px;"><button type="submit" class="btn" style="width:auto;">Guardar</button><button type="button" class="btn secondary" id="sfCancelar" style="width:auto;">Cancelar</button></div>
          <div id="sfMsg" style="color:var(--red); font-size:12.5px;"></div>
        </form>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
          <button class="btn" type="button" id="scNueva" style="width:auto;">+ Nueva valorización</button>
          <button class="btn secondary" type="button" id="scCerrarSub" style="width:auto; display:none;">Cerrar subcontrata</button>
          <button class="btn secondary" type="button" id="scCSV" style="width:auto;">Exportar (CSV)</button>
          <button class="btn secondary" type="button" id="scCerrar" style="width:auto;">Cerrar panel</button>
        </div></div>`,
    init() {
      $("scResumen").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.sc) abrir(b.dataset.sc); });
      $("scNueva").addEventListener("click", () => abrirForm(null));
      $("sfCancelar").addEventListener("click", () => $("scForm").style.display = "none");
      $("scCerrar").addEventListener("click", () => { SEL = null; $("scCard").style.display = "none"; });
      $("scCerrarSub").addEventListener("click", cerrarSub);
      $("scForm").addEventListener("submit", guardar);
      $("sfTipo").addEventListener("change", ajustarTipo);
      $("sfBruto").addEventListener("input", () => { sugerir(); netoTxt(); });
      ["sfAmort", "sfRet", "sfOtros"].forEach(id => $(id).addEventListener("input", netoTxt));
      $("scTabla").addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.ed) abrirForm(VALS.find(v => v.id === b.dataset.ed));
        if (b.dataset.del && confirm("¿Borrar esta valorización?")) {
          const id = SEL.id;
          const { error } = await supabaseClient.from("lg_sub_vals").delete().eq("id", b.dataset.del);
          if (error) alert(error.message); else { await cargar(true); renderResumen(); abrir(id); }
        }
      });
      $("scCSV").addEventListener("click", () => {
        if (!SEL) return;
        descargarCSV(`valorizaciones_subcontrata_${SEL.numero}.csv`, ["N°", "Tipo", "Periodo", "Descripción", "Bruto", "Adelanto", "Retención", "Otros", "Neto", "Estado", "Factura", "Fecha de pago"],
          valsDe(SEL.id).map(v => [v.numero, v.tipo, v.periodo, v.descripcion, v.monto_bruto, v.amort_adelanto, v.retencion, v.otros_descuentos, neto(v), v.estado, v.factura, fdmy(v.fecha_pago)]));
      });
    },
    async onShow() { await cargar(); renderResumen(); },
  });

  OBRA_HOOKS.push(() => { cargadoPara = null; SEL = null; const c = $("scCard"); if (c) c.style.display = "none"; });
})();
