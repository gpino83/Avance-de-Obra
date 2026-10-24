// =========================================================
// Control de Obra > Costos > Procuras: facturas y pagos de materiales.
// Los paquetes se adjudican en Procura; aquí se registra lo facturado y pagado.
// Se carga DESPUÉS de subcontratas.js.
// =========================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s);
  const ESCRIBE = ["admin", "planner", "residente"];
  const BORRA = ["admin", "planner"];
  const ADJ = ["Adjudicado", "Orden / Contrato", "Cerrado"];
  const inp = "padding:7px 10px; border-radius:8px; border:1px solid var(--border); font:inherit;";
  const mini = "width:auto;padding:3px 8px;font-size:11.5px;";
  let PAQ = [], PAGOS = [], cargadoPara = null, SEL = null, LG_OK = true;

  async function cargar(forzar) {
    const pid = (typeof PROYECTO_ACTUAL_ID !== "undefined" && PROYECTO_ACTUAL_ID) || ($("proyectoSelectDash") && $("proyectoSelectDash").value);
    if (!pid) return false;
    if (!forzar && cargadoPara === pid) return true;
    const [pk, pg] = await Promise.all([
      supabaseClient.from("lg_paquetes").select("*").eq("proyecto_id", pid).eq("tipo", "Material"),
      supabaseClient.from("lg_pagos").select("*").eq("proyecto_id", pid).order("fecha_factura"),
    ]);
    LG_OK = !pk.error && !pg.error;
    PAQ = (pk.data || []).filter(p => ADJ.includes(p.estado)).sort((a, b) => a.numero - b.numero);
    PAGOS = pg.data || [];
    cargadoPara = pid; SEL = null;
    return true;
  }

  const de = (id) => PAGOS.filter(x => x.paquete_id === id);
  function resumen(p) {
    const l = de(p.id), comp = Number(p.monto_comprometido) || 0;
    const fact = l.reduce((s, x) => s + Number(x.monto), 0);
    const pag = l.filter(x => x.estado === "Pagada").reduce((s, x) => s + Number(x.monto), 0);
    const hoy = hoyLocalISO();
    const venc = l.filter(x => x.estado !== "Pagada" && x.fecha_vencimiento && x.fecha_vencimiento < hoy).length;
    return { comp, fact, pag, por: fact - pag, sin: comp * 1.18 - fact, venc, n: l.length };
  }

  function renderResumen() {
    const tb = $("prResumen").querySelector("tbody");
    if (!LG_OK) { tb.innerHTML = `<tr><td colspan="10" style="color:var(--text-muted);">Ejecuta logistica_pagos.sql y pagos_obra.sql en Supabase.</td></tr>`; return; }
    const rs = PAQ.map(resumen);
    const tile = (l, v, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}">${v}</div></div>`;
    const venc = rs.reduce((s, r) => s + r.venc, 0);
    $("prTiles").innerHTML = tile("Procuras adjudicadas", PAQ.length) + tile("Facturado (S/)", solesFmt(rs.reduce((s, r) => s + r.fact, 0))) + tile("Pagado (S/)", solesFmt(rs.reduce((s, r) => s + r.pag, 0))) +
      tile("Por pagar (S/)", solesFmt(rs.reduce((s, r) => s + r.por, 0))) + tile("Facturas vencidas", venc, venc ? "bad" : "");
    tb.innerHTML = PAQ.map(p => {
      const r = resumen(p);
      const al = r.venc ? `<span class="badge late">${r.venc} vencida(s)</span>` : (r.sin < -1 ? `<span class="badge warn">Facturado sobre lo comprometido</span>` : "");
      return `<tr><td>${p.numero}</td><td>${esc(p.nombre)}</td><td>${esc(p.proveedor)}</td><td class="num">${solesFmt(r.comp)}</td><td class="num">${solesFmt(r.fact)}</td><td class="num">${solesFmt(r.pag)}</td><td class="num" style="font-weight:600;">${solesFmt(r.por)}</td><td class="num">${solesFmt(Math.max(0, r.sin))}</td><td>${al}</td><td><button class="btn secondary" style="${mini}" data-pr="${p.id}">Facturas (${r.n})</button></td></tr>`;
    }).join("") || `<tr><td colspan="10" style="color:var(--text-muted);">No hay procuras adjudicadas. Se adjudican en el módulo Procura (paquete de tipo Material).</td></tr>`;
  }

  function abrir(id) {
    SEL = PAQ.find(p => p.id === id); if (!SEL) return;
    $("prCard").style.display = ""; $("prMsg").textContent = "";
    $("pfFecha").value = hoyLocalISO();
    $("prForm").style.display = puedeEscribirObra(ESCRIBE) ? "" : "none";
    renderDet();
    $("prCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function renderDet() {
    $("prTitulo").textContent = `Facturas — N° ${SEL.numero} ${SEL.nombre} (comprometido S/ ${solesFmt(SEL.monto_comprometido)} sin IGV)`;
    const hoy = hoyLocalISO();
    $("prDet").querySelector("tbody").innerHTML = de(SEL.id).map(x => {
      const venc = x.estado !== "Pagada" && x.fecha_vencimiento && x.fecha_vencimiento < hoy;
      return `<tr><td>${esc(x.factura)}</td><td>${fdmy(x.fecha_factura)}</td><td class="num">${solesFmt(x.monto)}</td><td>${fdmy(x.fecha_vencimiento)} ${venc ? '<span class="badge late">Vencida</span>' : ""}</td><td><span class="badge ${x.estado === "Pagada" ? "ok" : "warn"}">${x.estado}</span></td><td>${fdmy(x.fecha_pago)}</td><td>${esc(x.observaciones)}</td><td style="white-space:nowrap;">${puedeEscribirObra(ESCRIBE) && x.estado !== "Pagada" ? `<button class="btn secondary" style="${mini}" data-pagar="${x.id}">Marcar pagada</button> ` : ""}${puedeEscribirObra(BORRA) ? `<button class="btn secondary" style="${mini}" data-del="${x.id}">Borrar</button>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="8" style="color:var(--text-muted);">Aún no hay facturas registradas.</td></tr>`;
  }

  async function agregar(e) {
    e.preventDefault();
    const t = (id) => $(id).value.trim() || null;
    const fila = { proyecto_id: SEL.proyecto_id, paquete_id: SEL.id, factura: t("pfFact"), fecha_factura: t("pfFecha"), monto: Number($("pfMonto").value) || 0, fecha_vencimiento: t("pfVenc"), observaciones: t("pfObs") };
    const { error } = await supabaseClient.from("lg_pagos").insert(fila);
    if (error) { $("prMsg").textContent = "No se pudo guardar: " + error.message; return; }
    const id = SEL.id; $("prForm").reset(); await cargar(true); renderResumen(); abrir(id);
  }

  (window.PAGOS_PARTES = window.PAGOS_PARTES || []).push({
    k: "proc",
    html: `<div class="stat-row" id="prTiles"></div>
      <div class="card"><h2>Facturas y pagos de materiales</h2>
        <p class="save-hint">Los paquetes se adjudican en Procura. Aquí se registra lo facturado y pagado a cada proveedor. Comprometido va sin IGV; facturado y pagado incluyen IGV (18 %).</p>
        <div style="overflow-x:auto;"><table class="data-table" id="prResumen"><thead><tr><th>N°</th><th>Material</th><th>Proveedor</th><th class="num">Comprometido (S/)</th><th class="num">Facturado (S/)</th><th class="num">Pagado (S/)</th><th class="num">Por pagar (S/)</th><th class="num">Sin facturar (S/)</th><th>Alerta</th><th></th></tr></thead><tbody></tbody></table></div>
        <div style="margin-top:10px;"><button class="btn secondary" type="button" id="prCSV" style="width:auto;">Exportar (CSV)</button></div></div>
      <div class="card" id="prCard" style="display:none;">
        <h2 id="prTitulo"></h2>
        <div style="overflow-x:auto;"><table class="data-table" id="prDet"><thead><tr><th>Factura</th><th>Fecha</th><th class="num">Monto (S/)</th><th>Vencimiento</th><th>Estado</th><th>Fecha de pago</th><th>Obs.</th><th></th></tr></thead><tbody></tbody></table></div>
        <form id="prForm" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:12px;">
          <input type="text" id="pfFact" placeholder="N° de factura" style="${inp} width:140px;">
          <input type="date" id="pfFecha" title="Fecha de factura" style="${inp}">
          <input type="number" id="pfMonto" placeholder="Monto total (S/)" step="0.01" min="0" required style="${inp} width:150px;">
          <input type="date" id="pfVenc" title="Vencimiento" style="${inp}">
          <input type="text" id="pfObs" placeholder="Observaciones" style="${inp} flex:1; min-width:140px;">
          <button type="submit" class="btn" style="width:auto;">Agregar factura</button>
          <button type="button" class="btn secondary" id="prCerrar" style="width:auto;">Cerrar</button>
        </form>
        <div id="prMsg" style="color:var(--red); font-size:12.5px;"></div></div>`,
    init() {
      $("prResumen").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.pr) abrir(b.dataset.pr); });
      $("prForm").addEventListener("submit", agregar);
      $("prCerrar").addEventListener("click", () => { SEL = null; $("prCard").style.display = "none"; });
      $("prDet").addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b) return;
        const id = SEL.id;
        if (b.dataset.pagar) {
          const { error } = await supabaseClient.from("lg_pagos").update({ estado: "Pagada", fecha_pago: hoyLocalISO() }).eq("id", b.dataset.pagar);
          if (error) alert(error.message); else { await cargar(true); renderResumen(); abrir(id); }
        }
        if (b.dataset.del && confirm("¿Borrar esta factura?")) {
          const { error } = await supabaseClient.from("lg_pagos").delete().eq("id", b.dataset.del);
          if (error) alert(error.message); else { await cargar(true); renderResumen(); abrir(id); }
        }
      });
      $("prCSV").addEventListener("click", () => descargarCSV("procuras_pagos.csv", ["N°", "Material", "Proveedor", "Comprometido", "Facturado", "Pagado", "Por pagar", "Sin facturar"],
        PAQ.map(p => { const r = resumen(p); return [p.numero, p.nombre, p.proveedor, r.comp, r.fact, r.pag, r.por, Math.max(0, r.sin)]; })));
    },
    async onShow() { await cargar(); renderResumen(); },
  });

  OBRA_HOOKS.push(() => { cargadoPara = null; SEL = null; const c = $("prCard"); if (c) c.style.display = "none"; });
})();
