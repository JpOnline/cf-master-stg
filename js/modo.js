// Modo de uso: "producao" ou "dev".
//
// - No computador (localhost) o padrão é DEV; publicado, o padrão é produção.
// - Dá para trocar nos dois lugares, pelo menu do app ou pela URL (?dev ou ?producao).
//   A escolha fica guardada neste navegador até trocar de novo.
//
// Em DEV aparecem as ferramentas de desenvolvimento (carregar dados.json do computador,
// simular data e hora, também pela URL com ?data=…&hora=…, gerar o arquivo criptografado).
// Em produção o app usa só os arquivos publicados e o relógio do aparelho.

const CHAVE = "cfmaster.modo";
export const LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || location.hostname.endsWith(".local");
export const PADRAO = LOCAL ? "dev" : "producao";

function lerGuardado() {
  try { return localStorage.getItem(CHAVE); } catch { return null; }
}
function guardar(m) {
  try {
    if (m === PADRAO) localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, m);
  } catch { /* navegação privada: vale só nesta visita */ }
}

function inicial() {
  const q = new URLSearchParams(location.search);
  if (q.has("dev")) { guardar("dev"); return "dev"; }
  if (q.has("producao") || q.has("prod")) { guardar("producao"); return "producao"; }
  const g = lerGuardado();
  return g === "dev" || g === "producao" ? g : PADRAO;
}

export const MODO = inicial();
export const DEV = MODO === "dev";

// Troca o modo e recarrega o app sem o parâmetro da URL.
export function trocar(m) {
  guardar(m);
  const u = new URL(location.href);
  for (const p of ["dev", "producao", "prod"]) u.searchParams.delete(p);
  location.replace(u.toString());
}
