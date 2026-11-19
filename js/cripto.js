// Formato dos arquivos criptografados `dados` e `checkins` (binário, sem extensão).
// Funciona no navegador e no Node 18+. O mesmo formato é gerado por scripts/cfmaster.py.
//
//   bytes 0-3   "CFMS"                       assinatura ("PRDZ" nos arquivos da versão Periodiza, ainda aceita)
//   byte  4     1                            versão do formato
//   byte  5     1                            KDF: 1 = PBKDF2-HMAC-SHA256
//   bytes 6-9   iterações (uint32, big endian)
//   byte  10    tamanho do salt (n)
//   n bytes     salt
//   12 bytes    IV do AES-GCM
//   resto       AES-256-GCM( gzip( JSON UTF-8 ) ), com o cabeçalho inteiro como dado associado
//
// A chave vem da senha do box: PBKDF2(senha, salt, iterações) -> 32 bytes. O salt é fixo
// por box (fica na configuração local do script), então a chave guardada no navegador
// continua valendo para os próximos arquivos. Se o salt mudar, o app pede a senha de novo.

const te = new TextEncoder();
const td = new TextDecoder();
const MAGIC = [0x43, 0x46, 0x4d, 0x53]; // "CFMS"
const MAGIC_ANTIGO = [0x50, 0x52, 0x44, 0x5a]; // "PRDZ": arquivos gerados antes da troca de nome (Periodiza)
const temAssinatura = (b) => b.length >= 4 && [MAGIC, MAGIC_ANTIGO].some((m) => m.every((x, i) => b[i] === x));
export const ehCriptografado = (b) => temAssinatura(b);

function dicaFormato(b) {
  const inicio = td.decode(b.slice(0, 64)).trimStart();
  if (inicio.startsWith("<")) return " O servidor devolveu uma página HTML: confira se o arquivo `dados` está na raiz do site.";
  if (inicio.startsWith("{")) return " Ele parece ser JSON sem criptografia: gere o arquivo `dados` com senha.";
  return "";
}

export class ErroDados extends Error {
  constructor(tipo, msg) { super(msg); this.tipo = tipo; }
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export const gzip = (b) => pipe(b, new CompressionStream("gzip"));
export const gunzip = (b) => pipe(b, new DecompressionStream("gzip"));

export function lerCabecalho(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 30 || !temAssinatura(b)) throw new ErroDados("formato", "O arquivo não está no formato do CF Master." + dicaFormato(b));
  if (b[4] !== 1) throw new ErroDados("formato", `Versão de arquivo ${b[4]} não suportada.`);
  if (b[5] !== 1) throw new ErroDados("formato", "Método de derivação de chave desconhecido.");
  const iter = new DataView(b.buffer, b.byteOffset + 6, 4).getUint32(0);
  const n = b[10];
  const salt = b.slice(11, 11 + n);
  const fimCab = 11 + n;
  return { iter, salt, iv: b.slice(fimCab, fimCab + 12), cabecalho: b.slice(0, fimCab), cifrado: b.slice(fimCab + 12) };
}

export async function derivarChave(senha, salt, iter) {
  const base = await crypto.subtle.importKey("raw", te.encode(senha), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, 256));
}

const aes = (raw, usos) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, usos);

export const mesmoSalt = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

// chave: bytes de derivarChave(). Devolve o objeto JSON.
export async function decriptar(buf, chave) {
  const h = lerCabecalho(buf);
  let claro;
  try {
    claro = await crypto.subtle.decrypt({ name: "AES-GCM", iv: h.iv, additionalData: h.cabecalho }, await aes(chave, ["decrypt"]), h.cifrado);
  } catch {
    throw new ErroDados("senha", "Senha incorreta.");
  }
  return JSON.parse(td.decode(await gunzip(new Uint8Array(claro))));
}

// Para a ferramenta de desenvolvimento e os testes. Em produção quem gera é o cfmaster.py.
export async function encriptar(obj, chave, salt, iter) {
  const cab = new Uint8Array(11 + salt.length);
  cab.set(MAGIC, 0); cab[4] = 1; cab[5] = 1;
  new DataView(cab.buffer).setUint32(6, iter);
  cab[10] = salt.length; cab.set(salt, 11);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const claro = await gzip(te.encode(JSON.stringify(obj)));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: cab }, await aes(chave, ["encrypt"]), claro));
  const out = new Uint8Array(cab.length + 12 + c.length);
  out.set(cab, 0); out.set(iv, cab.length); out.set(c, cab.length + 12);
  return out;
}

export async function resumo(buf) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d.slice(0, 12)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
