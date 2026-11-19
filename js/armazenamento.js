// Armazenamento local do navegador (IndexedDB), com uma chave-valor simples.
// Guarda: a chave derivada da senha (nunca a senha), os dados decifrados e os check-ins.

const BANCO = "cfmaster";
const LOJA = "kv";
let conexao = null;

function abrir() {
  if (conexao) return conexao;
  conexao = new Promise((ok, erro) => {
    const req = indexedDB.open(BANCO, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(LOJA);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
  return conexao;
}

async function tx(modo, fn) {
  const db = await abrir();
  return new Promise((ok, erro) => {
    const t = db.transaction(LOJA, modo);
    const r = fn(t.objectStore(LOJA));
    t.oncomplete = () => ok(r && r.result);
    t.onerror = () => erro(t.error);
    t.onabort = () => erro(t.error);
  });
}

export async function ler(chave) {
  try { return await tx("readonly", (s) => s.get(chave)); } catch { return undefined; }
}
export const gravarBruto = (chave, valor) => tx("readwrite", (s) => s.put(valor, chave));
export async function apagar(...chaves) {
  try { await tx("readwrite", (s) => chaves.forEach((k) => s.delete(k))); } catch { /* sem armazenamento */ }
}

const cheio = (e) => e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || ""));

// Grava os dados; se o armazenamento encher, apaga as sessões mais antigas e tenta de novo.
export async function gravarDados(chave, registro) {
  let reg = registro;
  for (let tentativa = 0; tentativa < 30; tentativa++) {
    try { await gravarBruto(chave, reg); return reg; }
    catch (e) {
      if (!cheio(e)) throw e;
      const menor = semSessaoMaisAntiga(reg);
      if (!menor) throw e;
      reg = menor;
    }
  }
  return reg;
}

function semSessaoMaisAntiga(reg) {
  const d = reg && reg.obj;
  if (!d || !Array.isArray(d.aulas) || !d.aulas.length) return null;
  const datas = [...new Set([...(d.aulas || []).map((a) => a.data), ...(d.dias || []).map((x) => x.data)])].sort();
  if (datas.length <= 1) return null;
  const velha = datas[0];
  return { ...reg, obj: { ...d, aulas: d.aulas.filter((a) => a.data !== velha), dias: (d.dias || []).filter((x) => x.data !== velha) } };
}
