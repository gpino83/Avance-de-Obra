// =========================================================
// Fotos y archivos en Supabase Storage (bucket privado "obra")
// =========================================================
const FotosObra = {
  cache: {},
  // reduce la foto a 1600 px y la comprime para que suba rápido desde el celular
  async comprimir(file) {
    if (!file.type.startsWith("image/")) return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.8));
      return blob || file;
    } catch (e) { return file; }
  },
  uid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); },
  async subir(files, carpeta) {
    const rutas = [];
    for (const f of files) {
      const blob = await this.comprimir(f);
      const ext = blob.type === "image/jpeg" ? "jpg" : (f.name.split(".").pop() || "bin");
      const ruta = `${carpeta}/${this.uid()}.${ext}`;
      const { error } = await supabaseClient.storage.from("obra").upload(ruta, blob, { contentType: blob.type || f.type, upsert: false });
      if (error) throw error;
      rutas.push(ruta);
    }
    return rutas;
  },
  async subirArchivo(file, carpeta) {
    const limpio = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
    const ruta = `${carpeta}/${this.uid().slice(0, 8)}_${limpio}`;
    const { error } = await supabaseClient.storage.from("obra").upload(ruta, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw error;
    return ruta;
  },
  async url(ruta, descargarComo) {
    const k = ruta + "|" + (descargarComo || "");
    const hit = this.cache[k];
    if (hit && hit.exp > Date.now()) return hit.url;
    const { data, error } = await supabaseClient.storage.from("obra").createSignedUrl(ruta, 3600, descargarComo ? { download: descargarComo } : undefined);
    if (error) return null;
    this.cache[k] = { url: data.signedUrl, exp: Date.now() + 3000 * 1000 };
    return data.signedUrl;
  },
  // dibuja miniaturas dentro de un contenedor
  async mostrar(contenedor, rutas) {
    contenedor.innerHTML = "";
    for (const r of rutas || []) {
      const u = await this.url(r);
      if (!u) continue;
      const a = document.createElement("a");
      a.href = u; a.target = "_blank"; a.rel = "noopener";
      a.innerHTML = `<img src="${u}" alt="foto" style="height:64px;width:auto;border-radius:6px;border:1px solid var(--border);margin:0 6px 6px 0;">`;
      contenedor.appendChild(a);
    }
  },
};
