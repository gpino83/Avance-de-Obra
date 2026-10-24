// =========================================================
// Control de Obra > Documentos: documentos con revisiones y consultas (RFI)
// Se carga DESPUÉS de app.js, fotos.js y grupos.js.
// =========================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s);
  const ESCRIBE = ["admin", "planner", "residente"];
  const BORRA = ["admin", "planner"];
  const inp = "padding:7px 10px; border-radius:8px; border:1px solid var(--border); font:inherit; width:100%;";
  const lab = "font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;";
  const mini = "width:auto;padding:3px 8px;font-size:11.5px;";
  const pid = () => (typeof PROYECTO_ACTUAL_ID !== "undefined" && PROYECTO_ACTUAL_ID) || ($("proyectoSelectDash") && $("proyectoSelectDash").value);
  const dias = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
  const TIPOS = ["Plano", "Especificación", "Carta", "Acta", "Informe", "Contrato", "Otro"];

  let DOCS = [], RFIS = [], cargadoPara = null, docEdit = null, docNuevaRev = null, rfiEdit = null, rfiFotos = [];

  async function cargar(forzar) {
    const p = pid(); if (!p) return false;
    if (!forzar && cargadoPara === p) return true;
    const [d, r] = await Promise.all([
      supabaseClient.from("documentos").select("*").eq("proyecto_id", p).order("codigo").order("created_at", { ascending: false }),
      supabaseClient.from("rfi").select("*").eq("proyecto_id", p).order("numero", { ascending: false }),
    ]);
    DOCS = d.data || []; RFIS = r.data || [];
    cargadoPara = p;
    return true;
  }

  // ---------------- DOCUMENTOS ----------------
  function docsFiltrados() {
    const ft = $("dcFTipo").value, fe = $("dcFEstado").value, q = $("dcBuscar").value.trim().toLowerCase();
    return DOCS.filter(d => (!ft || d.tipo === ft) && (fe === "todos" || (fe === "vigentes" ? d.estado !== "Obsoleto" : d.estado === fe)) &&
      (!q || [d.codigo, d.titulo, d.disciplina, d.emisor].join(" ").toLowerCase().includes(q)));
  }

  function renderDocs() {
    $("dcTabla").querySelector("tbody").innerHTML = docsFiltrados().map(d => {
      const cls = d.estado === "Vigente" ? "ok" : d.estado === "En revisión" ? "warn" : "";
      const archivo = d.archivo_path ? `<button class="btn secondary" style="${mini}" data-open="${d.id}">Abrir</button>` : (d.enlace ? `<a href="${esc(d.enlace)}" target="_blank" rel="noopener" style="font-size:12px;">Enlace</a>` : "");
      return `<tr><td><b>${esc(d.codigo)}</b></td><td style="min-width:200px;">${esc(d.titulo)}</td><td>${d.tipo}</td><td>${esc(d.disciplina)}</td><td>${esc(d.revision)}</td><td><span class="badge ${cls}">${d.estado}</span></td><td>${fdmy(d.fecha)}</td><td>${esc(d.emisor)}</td><td>${archivo}</td><td style="white-space:nowrap;">${puedeEscribirObra(ESCRIBE) ? `<button class="btn secondary" style="${mini}" data-rev="${d.id}">Nueva revisión</button> <button class="btn secondary" style="${mini}" data-ed="${d.id}">Editar</button> ` : ""}${puedeEscribirObra(BORRA) ? `<button class="btn secondary" style="${mini}" data-del="${d.id}">Borrar</button>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="10" style="color:var(--text-muted);">No hay documentos con este filtro.</td></tr>`;
  }

  function abrirDoc(d, nuevaRev) {
    docEdit = nuevaRev ? null : (d || null);
    docNuevaRev = nuevaRev ? d : null;
    $("dcFormTitulo").textContent = nuevaRev ? `Nueva revisión de ${d.codigo}` : (d ? "Editar documento" : "Nuevo documento");
    const base = d || {};
    $("dfCodigo").value = base.codigo || "";
    $("dfTipo").value = base.tipo || "Plano";
    $("dfTitulo").value = base.titulo || "";
    $("dfDisc").value = base.disciplina || "";
    $("dfRev").value = nuevaRev ? siguienteRev(base.revision) : (base.revision || "");
    $("dfEstado").value = nuevaRev ? "Vigente" : (base.estado || "Vigente");
    $("dfFecha").value = nuevaRev ? hoyLocalISO() : (base.fecha || hoyLocalISO());
    $("dfEmisor").value = base.emisor || "";
    $("dfEnlace").value = nuevaRev ? "" : (base.enlace || "");
    $("dfObs").value = nuevaRev ? "" : (base.observaciones || "");
    $("dfArchivo").value = "";
    $("dfCodigo").readOnly = !!nuevaRev;
    $("dcMsg").textContent = "";
    $("dcForm").style.display = "";
    $("dcForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function siguienteRev(r) {
    if (r == null || r === "") return "A";
    if (/^\d+$/.test(r)) return String(Number(r) + 1);
    if (/^[A-Y]$/i.test(r)) return String.fromCharCode(r.toUpperCase().charCodeAt(0) + 1);
    return r + "'";
  }

  async function guardarDoc(e) {
    e.preventDefault();
    const btn = $("dcGuardar"); btn.disabled = true;
    try {
      $("dcMsg").style.color = "var(--text-muted)"; $("dcMsg").textContent = "Guardando...";
      const t = (id) => $(id).value.trim() || null;
      const f = $("dfArchivo").files[0];
      if (f && f.size > 50 * 1024 * 1024) throw new Error("El archivo supera los 50 MB.");
      const fila = { proyecto_id: pid(), codigo: $("dfCodigo").value.trim(), tipo: $("dfTipo").value, titulo: $("dfTitulo").value.trim(), disciplina: t("dfDisc"), revision: t("dfRev"), estado: $("dfEstado").value, fecha: t("dfFecha"), emisor: t("dfEmisor"), enlace: t("dfEnlace"), observaciones: t("dfObs") };
      if (f) { fila.archivo_path = await FotosObra.subirArchivo(f, `${pid()}/documentos`); fila.archivo_nombre = f.name; }
      if (docEdit) {
        const { error } = await supabaseClient.from("documentos").update(fila).eq("id", docEdit.id);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from("documentos").insert(fila);
        if (error) throw error;
        if (docNuevaRev || DOCS.some(d => d.codigo === fila.codigo && d.estado !== "Obsoleto")) {
          // las revisiones anteriores del mismo código pasan a Obsoleto
          const { data: nuevo } = await supabaseClient.from("documentos").select("id").eq("proyecto_id", pid()).eq("codigo", fila.codigo).order("created_at", { ascending: false }).limit(1);
          const idNuevo = nuevo && nuevo[0] ? nuevo[0].id : null;
          if (idNuevo && fila.estado === "Vigente") await supabaseClient.from("documentos").update({ estado: "Obsoleto" }).eq("proyecto_id", pid()).eq("codigo", fila.codigo).neq("id", idNuevo).neq("estado", "Obsoleto");
        }
      }
      $("dcForm").style.display = "none";
      await cargar(true); renderDocs();
    } catch (err) {
      $("dcMsg").style.color = "var(--red)"; $("dcMsg").textContent = "No se pudo guardar: " + (err.message || err);
    } finally { btn.disabled = false; }
  }

  // ---------------- RFI ----------------
  function alertaRfi(r) {
    if (r.estado !== "Abierta" || !r.fecha_requerida) return null;
    const d = dias(hoyLocalISO(), r.fecha_requerida);
    if (d < 0) return { c: "late", t: `Vencida hace ${-d} d` };
    if (d <= 3) return { c: "warn", t: d === 0 ? "Vence hoy" : `Vence en ${d} d` };
    return null;
  }

  function renderRfi() {
    const ab = RFIS.filter(r => r.estado === "Abierta");
    const venc = ab.filter(r => alertaRfi(r) && alertaRfi(r).c === "late");
    const resp = RFIS.filter(r => r.fecha_respuesta && r.fecha_envio).map(r => dias(r.fecha_envio, r.fecha_respuesta));
    const prom = resp.length ? Math.round(resp.reduce((s, v) => s + v, 0) / resp.length) : null;
    const tile = (l, v, c) => `<div class="stat-tile"><div class="label">${l}</div><div class="value ${c || ""}" style="font-size:19px;">${v}</div></div>`;
    $("rfTiles").innerHTML = tile("Consultas", RFIS.length) + tile("Abiertas", ab.length) + tile("Vencidas", venc.length, venc.length ? "bad" : "good") +
      tile("Tiempo prom. de respuesta", prom == null ? "—" : prom + " d") +
      tile("Impacto en plazo (días)", RFIS.reduce((s, r) => s + (r.impacto_plazo_dias || 0), 0)) +
      tile("Impacto en costo (S/)", solesFmt(RFIS.reduce((s, r) => s + Number(r.impacto_costo || 0), 0)));
    const fe = $("rfFEstado").value;
    const l = RFIS.filter(r => fe === "todas" || r.estado === fe);
    $("rfTabla").querySelector("tbody").innerHTML = l.map(r => {
      const a = alertaRfi(r);
      const cls = r.estado === "Cerrada" ? "ok" : r.estado === "Respondida" ? "warn" : "late";
      return `<tr><td>RFI-${String(r.numero).padStart(3, "0")}</td><td style="min-width:200px;">${esc(r.asunto)}</td><td>${esc(r.frente)}</td><td>${esc(r.dirigido_a)}</td><td>${fdmy(r.fecha_envio)}</td><td>${fdmy(r.fecha_requerida)}</td><td><span class="badge ${cls}">${r.estado}</span></td><td>${a ? `<span class="badge ${a.c}">${a.t}</span>` : ""}</td><td>${fdmy(r.fecha_respuesta)}</td><td style="white-space:nowrap;">${puedeEscribirObra(ESCRIBE) ? `<button class="btn secondary" style="${mini}" data-ed="${r.id}">Ver / editar</button> ` : ""}${puedeEscribirObra(BORRA) ? `<button class="btn secondary" style="${mini}" data-del="${r.id}">Borrar</button>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="10" style="color:var(--text-muted);">No hay consultas.</td></tr>`;
  }

  async function abrirRfi(r) {
    rfiEdit = r || null; rfiFotos = [];
    $("rfFormTitulo").textContent = r ? `RFI-${String(r.numero).padStart(3, "0")}` : "Nueva consulta";
    $("rffFrente").innerHTML = `<option value="">— sin frente —</option>` + [...new Set(PARTIDAS.map(x => x.frente))].map(f => `<option>${esc(f)}</option>`).join("");
    $("rffAsunto").value = r ? r.asunto : "";
    $("rffDesc").value = r ? (r.descripcion || "") : "";
    $("rffFrente").value = r ? (r.frente || "") : "";
    $("rffSolic").value = r ? (r.solicitante || "") : (CURRENT_PROFILE ? CURRENT_PROFILE.nombre_completo : "");
    $("rffDirigido").value = r ? (r.dirigido_a || "") : "";
    $("rffEnvio").value = r ? (r.fecha_envio || "") : hoyLocalISO();
    $("rffReq").value = r ? (r.fecha_requerida || "") : "";
    $("rffEstado").value = r ? r.estado : "Abierta";
    $("rffResp").value = r ? (r.respuesta || "") : "";
    $("rffFResp").value = r ? (r.fecha_respuesta || "") : "";
    $("rffPlazo").value = r && r.impacto_plazo_dias != null ? r.impacto_plazo_dias : "";
    $("rffCosto").value = r && r.impacto_costo != null ? r.impacto_costo : "";
    $("rffFotosSel").textContent = "";
    $("rffFotos").innerHTML = "";
    if (r && r.fotos && r.fotos.length) await FotosObra.mostrar($("rffFotos"), r.fotos);
    $("rfMsg").textContent = "";
    $("rfForm").style.display = "";
    $("rfForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function guardarRfi(e) {
    e.preventDefault();
    const btn = $("rfGuardar"); btn.disabled = true;
    try {
      $("rfMsg").style.color = "var(--text-muted)"; $("rfMsg").textContent = "Guardando...";
      const t = (id) => $(id).value.trim() || null;
      const n = (id) => $(id).value === "" ? null : Number($(id).value);
      let fotos = rfiEdit ? (rfiEdit.fotos || []) : [];
      if (rfiFotos.length) fotos = fotos.concat(await FotosObra.subir(rfiFotos, `${pid()}/rfi`));
      const estado = $("rffEstado").value;
      const fila = { proyecto_id: pid(), asunto: $("rffAsunto").value.trim(), descripcion: t("rffDesc"), frente: t("rffFrente"), solicitante: t("rffSolic"), dirigido_a: t("rffDirigido"), fecha_envio: t("rffEnvio"), fecha_requerida: t("rffReq"), estado, respuesta: t("rffResp"),
        fecha_respuesta: t("rffFResp") || (estado !== "Abierta" ? hoyLocalISO() : null), impacto_plazo_dias: n("rffPlazo"), impacto_costo: n("rffCosto"), fotos };
      const q = rfiEdit ? supabaseClient.from("rfi").update(fila).eq("id", rfiEdit.id) : supabaseClient.from("rfi").insert(fila);
      const { error } = await q;
      if (error) throw error;
      $("rfForm").style.display = "none";
      await cargar(true); renderRfi();
    } catch (err) {
      $("rfMsg").style.color = "var(--red)"; $("rfMsg").textContent = "No se pudo guardar: " + (err.message || err);
    } finally { btn.disabled = false; }
  }

  // ---------------- registro de vistas ----------------
  registerVista({
    id: "documentos", titulo: "Documentos",
    html: `<form class="card" id="dcForm" style="display:none;"><h2 id="dcFormTitulo">Nuevo documento</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
        <label style="${lab}">Código<input type="text" id="dfCodigo" required style="${inp}" placeholder="Ej. E-01, CAR-023"></label>
        <label style="${lab}">Tipo<select id="dfTipo" style="${inp}">${TIPOS.map(t => `<option>${t}</option>`).join("")}</select></label>
        <label style="${lab};grid-column:span 2;">Título<input type="text" id="dfTitulo" required style="${inp}"></label>
        <label style="${lab}">Disciplina<input type="text" id="dfDisc" style="${inp}" placeholder="Arquitectura, Estructuras..."></label>
        <label style="${lab}">Revisión<input type="text" id="dfRev" style="${inp}" placeholder="A, B, 0, 1..."></label>
        <label style="${lab}">Estado<select id="dfEstado" style="${inp}"><option>Vigente</option><option>En revisión</option><option>Obsoleto</option></select></label>
        <label style="${lab}">Fecha<input type="date" id="dfFecha" style="${inp}"></label>
        <label style="${lab}">Emisor<input type="text" id="dfEmisor" style="${inp}"></label>
        <label style="${lab};grid-column:span 2;">Archivo (hasta 50 MB)<input type="file" id="dfArchivo" style="${inp}"></label>
        <label style="${lab};grid-column:1/-1;">Enlace externo (opcional)<input type="url" id="dfEnlace" style="${inp}" placeholder="https://..."></label>
        <label style="${lab};grid-column:1/-1;">Observaciones<input type="text" id="dfObs" style="${inp}"></label>
        <div style="grid-column:1/-1;display:flex;gap:8px;"><button class="btn" type="submit" id="dcGuardar" style="width:auto;">Guardar</button><button class="btn secondary" type="button" id="dcCancelar" style="width:auto;">Cancelar</button></div>
      </div><div id="dcMsg" style="font-size:12.5px;margin-top:6px;"></div></form>
      <div class="card"><h2>Documentos del proyecto</h2>
        <p class="save-hint">Al subir una nueva revisión de un código, las anteriores pasan solas a Obsoleto. Por defecto solo se ven los vigentes.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px;">
          <button class="btn" type="button" id="dcNuevo" style="width:auto;">+ Nuevo documento</button>
          <select id="dcFTipo" style="${inp};width:auto;"><option value="">Todos los tipos</option>${TIPOS.map(t => `<option>${t}</option>`).join("")}</select>
          <select id="dcFEstado" style="${inp};width:auto;"><option value="vigentes">Vigentes y en revisión</option><option value="todos">Todos (con historial)</option><option>Obsoleto</option></select>
          <input type="text" id="dcBuscar" placeholder="Buscar..." style="${inp};flex:1;min-width:160px;width:auto;">
          <button class="btn secondary" type="button" id="dcCSV" style="width:auto;">Exportar lista (CSV)</button></div>
        <div style="overflow-x:auto;"><table class="data-table" id="dcTabla"><thead><tr><th>Código</th><th>Título</th><th>Tipo</th><th>Disciplina</th><th>Rev.</th><th>Estado</th><th>Fecha</th><th>Emisor</th><th>Archivo</th><th></th></tr></thead><tbody></tbody></table></div></div>`,
    init() {
      $("dcNuevo").addEventListener("click", () => abrirDoc(null, false));
      $("dcCancelar").addEventListener("click", () => $("dcForm").style.display = "none");
      $("dcForm").addEventListener("submit", guardarDoc);
      ["dcFTipo", "dcFEstado"].forEach(id => $(id).addEventListener("change", renderDocs));
      $("dcBuscar").addEventListener("input", renderDocs);
      $("dcCSV").addEventListener("click", () => descargarCSV("documentos.csv", ["Código", "Título", "Tipo", "Disciplina", "Revisión", "Estado", "Fecha", "Emisor", "Archivo", "Observaciones"],
        docsFiltrados().map(d => [d.codigo, d.titulo, d.tipo, d.disciplina, d.revision, d.estado, fdmy(d.fecha), d.emisor, d.archivo_nombre || d.enlace, d.observaciones])));
      $("dcTabla").addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.open) { const d = DOCS.find(x => x.id === b.dataset.open); const u = await FotosObra.url(d.archivo_path, d.archivo_nombre || true); if (u) window.open(u, "_blank"); else alert("No se pudo abrir el archivo."); }
        if (b.dataset.rev) abrirDoc(DOCS.find(x => x.id === b.dataset.rev), true);
        if (b.dataset.ed) abrirDoc(DOCS.find(x => x.id === b.dataset.ed), false);
        if (b.dataset.del && confirm("¿Borrar este documento?")) {
          const { error } = await supabaseClient.from("documentos").delete().eq("id", b.dataset.del);
          if (error) alert(error.message); else { await cargar(true); renderDocs(); }
        }
      });
    },
    async onShow() { await cargar(); renderDocs(); $("dcNuevo").style.display = puedeEscribirObra(ESCRIBE) ? "" : "none"; },
  });

  registerVista({
    id: "rfi", titulo: "Consultas (RFI)",
    html: `<div class="stat-row" id="rfTiles"></div>
      <form class="card" id="rfForm" style="display:none;"><h2 id="rfFormTitulo">Nueva consulta</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
        <label style="${lab};grid-column:1/-1;">Asunto<input type="text" id="rffAsunto" required style="${inp}"></label>
        <label style="${lab};grid-column:1/-1;">Descripción de la consulta<textarea id="rffDesc" rows="3" style="${inp}"></textarea></label>
        <label style="${lab}">Frente<select id="rffFrente" style="${inp}"></select></label>
        <label style="${lab}">Solicitante<input type="text" id="rffSolic" style="${inp}"></label>
        <label style="${lab}">Dirigido a<input type="text" id="rffDirigido" style="${inp}" placeholder="Proyectista, supervisión..."></label>
        <label style="${lab}">Fecha de envío<input type="date" id="rffEnvio" style="${inp}"></label>
        <label style="${lab}">Respuesta requerida el<input type="date" id="rffReq" style="${inp}"></label>
        <label style="${lab}">Estado<select id="rffEstado" style="${inp}"><option>Abierta</option><option>Respondida</option><option>Cerrada</option></select></label>
        <label style="${lab};grid-column:1/-1;">Respuesta<textarea id="rffResp" rows="3" style="${inp}"></textarea></label>
        <label style="${lab}">Fecha de respuesta<input type="date" id="rffFResp" style="${inp}"></label>
        <label style="${lab}">Impacto en plazo (días)<input type="number" step="1" id="rffPlazo" style="${inp}"></label>
        <label style="${lab}">Impacto en costo (S/)<input type="number" step="0.01" id="rffCosto" style="${inp}"></label>
        <div style="grid-column:1/-1;"><input type="file" id="rffFotosIn" accept="image/*" multiple style="font-size:12.5px;"> <span id="rffFotosSel" style="font-size:12.5px;color:var(--text-muted);"></span><div id="rffFotos" style="margin-top:8px;"></div></div>
        <div style="grid-column:1/-1;display:flex;gap:8px;"><button class="btn" type="submit" id="rfGuardar" style="width:auto;">Guardar</button><button class="btn secondary" type="button" id="rfCancelar" style="width:auto;">Cancelar</button></div>
      </div><div id="rfMsg" style="font-size:12.5px;margin-top:6px;"></div></form>
      <div class="card"><h2>Consultas al proyectista y a la supervisión</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px;">
          <button class="btn" type="button" id="rfNueva" style="width:auto;">+ Nueva consulta</button>
          <select id="rfFEstado" style="${inp};width:auto;"><option value="todas">Todas</option><option>Abierta</option><option>Respondida</option><option>Cerrada</option></select>
          <button class="btn secondary" type="button" id="rfCSV" style="width:auto;">Exportar a Excel (CSV)</button></div>
        <div style="overflow-x:auto;"><table class="data-table" id="rfTabla"><thead><tr><th>N°</th><th>Asunto</th><th>Frente</th><th>Dirigido a</th><th>Envío</th><th>Requerida</th><th>Estado</th><th>Alerta</th><th>Respuesta</th><th></th></tr></thead><tbody></tbody></table></div></div>`,
    init() {
      $("rfNueva").addEventListener("click", () => abrirRfi(null));
      $("rfCancelar").addEventListener("click", () => $("rfForm").style.display = "none");
      $("rfForm").addEventListener("submit", guardarRfi);
      $("rfFEstado").addEventListener("change", renderRfi);
      $("rffFotosIn").addEventListener("change", (e) => { rfiFotos = rfiFotos.concat([...e.target.files]); $("rffFotosSel").textContent = rfiFotos.length + " foto(s) por subir"; e.target.value = ""; });
      $("rfTabla").addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.ed) abrirRfi(RFIS.find(x => x.id === b.dataset.ed));
        if (b.dataset.del && confirm("¿Borrar esta consulta?")) {
          const { error } = await supabaseClient.from("rfi").delete().eq("id", b.dataset.del);
          if (error) alert(error.message); else { await cargar(true); renderRfi(); }
        }
      });
      $("rfCSV").addEventListener("click", () => descargarCSV("consultas_rfi.csv", ["N°", "Asunto", "Descripción", "Frente", "Solicitante", "Dirigido a", "Envío", "Requerida", "Estado", "Respuesta", "Fecha respuesta", "Plazo (d)", "Costo (S/)"],
        RFIS.map(r => ["RFI-" + String(r.numero).padStart(3, "0"), r.asunto, r.descripcion, r.frente, r.solicitante, r.dirigido_a, fdmy(r.fecha_envio), fdmy(r.fecha_requerida), r.estado, r.respuesta, fdmy(r.fecha_respuesta), r.impacto_plazo_dias, r.impacto_costo])));
    },
    async onShow() { await cargar(); renderRfi(); $("rfNueva").style.display = puedeEscribirObra(ESCRIBE) ? "" : "none"; },
  });

  OBRA_HOOKS.push(() => { cargadoPara = null; });
})();
