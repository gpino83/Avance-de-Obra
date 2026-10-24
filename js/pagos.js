// =========================================================
// Control de Obra > Costos > Procuras y subcontratas: una sola pestaña con
// facturas/pagos de materiales y valorizaciones de subcontratas.
// Se carga DESPUÉS de procuras.js y subcontratas.js.
// =========================================================
(function () {
  const partes = (window.PAGOS_PARTES || []).slice().sort((a, b) => a.k === "proc" ? -1 : 1);
  registerVista({
    id: "pagos", titulo: "Valorizaciones",
    html: partes.map(p => `<div class="pagos-bloque">${p.html}</div>`).join(""),
    init(sec) { partes.forEach(p => p.init && p.init(sec)); },
    async onShow() { for (const p of partes) { try { await p.onShow(); } catch (e) { console.error(e); } } },
  });
})();
