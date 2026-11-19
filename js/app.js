// CF Master · app do coach (white label: o nome e o logo em destaque são os do box, em config.js).
// Lê o arquivo criptografado `dados` (e `checkins`, quando existir), guarda no IndexedDB
// e mostra a turma da hora. O formato dos dados está em docs/formato-dados.md.
import * as C from "./cripto.js";
import * as A from "./armazenamento.js";
import * as CFG from "./config.js";
import * as M from "./modo.js";

const FORMATO_DADOS = "cfmaster/dados@1";
const FORMATO_CHECKINS = "cfmaster/checkins@1";
// Arquivos gerados pela versão anterior (Periodiza) têm o mesmo conteúdo com outro nome de formato.
const ehDados = (o) => !!o && (o.formato === FORMATO_DADOS || o.formato === "periodiza/dados@1");
const ehCheckins = (o) => !!o && (o.formato === FORMATO_CHECKINS || o.formato === "periodiza/checkins@1");
const DEV = M.DEV;
const DAY = 864e5;
const LB2KG = 0.45359237;
const root = document.getElementById("app");

// ---------- estado ----------
const S = {
  tela: "carregando",        // carregando | login | app | erro
  erro: "",
  dados: null, checkins: null,
  hashDados: null, hashCheckins: null,
  chave: null,               // {salt, iter, chave}
  origem: "rede",            // rede | cache | dev
  offline: false,
  agoraSim: null,            // Date, só no modo de desenvolvimento
  simDaUrl: null,            // texto da simulação quando veio da URL (?data=…&hora=…)
  agoraSalvo: null,          // simulação guardada na tela DEV (ISO), preservada enquanto vale a da URL
  ui: { tab: new URLSearchParams(location.search).get("tab") === "periodo" ? "periodo" : "aula", menu: false, wodAberto: {}, dia: null, off: 0, sel: null, added: {}, onlyAlert: false, q: "", acIdx: 0, showHidden: false, toast: null, win: 4 },
  ultimaConf: { dados: 0, checkins: 0 },
};
let IX = null; // índices montados a partir de S.dados

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const agora = () => S.agoraSim ? new Date(S.agoraSim) : new Date();
const pad = (n) => String(n).padStart(2, "0");
const isoDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deIso = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d, 12); };
const dd = (d) => pad(d.getDate()) + "/" + pad(d.getMonth() + 1);
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaTxt = (s) => { const d = deIso(s); return `${DOW[d.getDay()]} ${dd(d)}`; };
const minutos = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const ageDays = (s) => Math.round((deIso(isoDia(agora())) - deIso(s)) / DAY);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const kg = (lb) => Math.round(lb * LB2KG);
const fmt = (x) => (Math.round(x * 10) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const lbr = (lo, hi) => lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
const kgr = (lo, hi) => kg(lo) === kg(hi) ? `${kg(lo)} kg` : `${kg(lo)}–${kg(hi)} kg`;
const nAl = (n) => `${n} ${n === 1 ? "aluno" : "alunos"}`;
// Descrição do WOD: o texto guarda as quebras de linha como foram escritas. A versão
// compacta junta as linhas com " · " só na hora de mostrar.
const compacto = (t) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).join(" · ");
const descricaoWod = (w) => `<div class="wod-txt">${esc(String(w.descricao || "").replace(/\n{3,}/g, "\n\n").trim())}</div>`;
// **negrito** em textos explicativos que vêm prontos nos dados.
const rico = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const label = (a) => a.apelido ? `${a.nome} (${a.apelido})` : a.nome;
const BASES = { M: "Monoestrutural", G: "Ginástica", W: "Levantamento" };
const ORDER = ["M", "G", "W"];
const ELEM = ["", "único", "duplo", "triplo"];
const structTxt = (st) => `${st.join(" | ")} · ${ELEM[st.length] || ""}`;
const MODN = { F: "Foundation", Sc: "Scale", Rx: "Rx", AD: "Adaptado" };
const NIVEL = { dor: "dor", atencao: "warn", info: "info" };
const SEVRANK = { dor: 0, warn: 1, info: 2, "": 3 };

const ICON = {
  alert: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6v3.6M8 11.6v.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  swap: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5h10l-3-3M14 11H4l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  ratio: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13h4V4H2zM10 13h4V9h-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  back: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 2v3h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  load: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13h3V8H2zM6.5 13h3V5h-3zM11 13h3V2h-3z" fill="currentColor"/></svg>',
  new: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  star: '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.8 1.9 4 4.3.5-3.2 3 .9 4.3L8 11.4l-3.9 2.2.9-4.3-3.2-3 4.3-.5z" fill="currentColor"/></svg>',
  menu: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  install: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0-3-3m3 3 3-3M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  code: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
// Ícone de cada tipo de alerta (campo `icone` em docs/formato-dados.md).
const ICONE_ALERTA = { alerta: "alert", comparacao: "ratio", retorno: "back", volume: "load", novo: "new", recorde: "star", troca: "swap" };
const REGIAO = { quadril: "Quadril", joelho: "Joelho", lombar: "Lombar", tornozelo: "Tornozelo", aquiles: "Tendão calcâneo", ombro: "Ombro", punho: "Punho", cotovelo: "Cotovelo", cervical: "Cervical" };
const regiaoTxt = (r) => REGIAO[r] || (r ? r[0].toUpperCase() + r.slice(1) : "");
const big = (s) => s.replace(/width="13" height="13"/, 'width="18" height="18"');

// ---------- índices ----------
function indexar(d) {
  const alunos = Object.fromEntries((d.alunos || []).map((a) => [a.id, a]));
  const wods = Object.fromEntries((d.wods || []).map((w) => [w.id, w]));
  const datas = [...new Set([...(d.dias || []).map((x) => x.data), ...(d.aulas || []).map((x) => x.data)])].sort();
  let hor = (d.horarios || []).slice();
  if (!hor.length) hor = [...new Set((d.aulas || []).map((a) => a.turma))].sort().map((t) => ({ turma: t, inicio: t.replace("h", "") .padStart(2, "0") + ":00", fim: t.replace("h", "").padStart(2, "0") + ":50" }));
  hor.sort((a, b) => minutos(a.inicio) - minutos(b.inicio));
  const porNome = {};
  for (const a of d.alunos || []) for (const n of [a.nome, a.apelido, ...(a.nomes_busca || [])]) if (n) (porNome[norm(n)] ||= a.id);
  return { alunos, wods, datas, hor, porNome };
}

const diaDe = (data) => (S.dados.dias || []).find((x) => x.data === data);
const fichaDe = (data, id) => (diaDe(data)?.fichas || {})[id] || {};
const wodsDoDia = (data) => {
  const ids = diaDe(data)?.wods || [...new Set((S.dados.aulas || []).filter((a) => a.data === data).flatMap((a) => a.wods || []))];
  const lista = ids.length ? ids.map((i) => IX.wods[i]).filter(Boolean) : (S.dados.wods || []).filter((w) => w.data === data);
  return lista;
};

// Melhor leitura de check-in para a aula: final > prévia, e a mais recente.
function leituraCheckin(data, turma) {
  const ls = (S.checkins?.aulas || []).filter((a) => a.data === data && a.turma === turma);
  if (!ls.length) return null;
  ls.sort((a, b) => (a.leitura === "final") - (b.leitura === "final") || String(a.lida_em || "").localeCompare(String(b.lida_em || "")));
  return ls[ls.length - 1];
}

// Lista de quem vem: check-in do celular quando houver, senão a lista que veio em `dados`.
function listaDaAula(data, turma) {
  const base = (S.dados.aulas || []).find((a) => a.data === data && a.turma === turma);
  const porId = Object.fromEntries((base?.alunos || []).map((e) => [e.aluno, e]));
  const ck = leituraCheckin(data, turma);
  let itens;
  if (ck) {
    itens = (ck.alunos || []).map((x) => {
      const id = x.aluno || IX.porNome[norm(x.nome)];
      if (id && IX.alunos[id]) return { ...(porId[id] || {}), aluno: id };
      return { semCadastro: true, nome: x.nome };
    });
  } else itens = (base?.alunos || []).filter((e) => IX.alunos[e.aluno]);
  const ja = new Set(itens.map((e) => e.aluno).filter(Boolean));
  const extras = (S.ui.added[data + "|" + turma] || []).filter((id) => !ja.has(id)).map((id) => ({ ...(porId[id] || {}), aluno: id, extra: true }));
  return itens.concat(extras);
}

// ---------- relógio / dia / turma ----------
function diaPadrao() {
  const hoje = isoDia(agora());
  if (IX.datas.includes(hoje)) return hoje;
  return IX.datas.find((d) => d > hoje) || IX.datas[IX.datas.length - 1] || hoje;
}
function autoIndex(data) {
  const n = agora().getHours() * 60 + agora().getMinutes();
  if (data !== isoDia(agora())) return { i: 0, live: false, hoje: false };
  for (let i = 0; i < IX.hor.length; i++) if (n < minutos(IX.hor[i].fim)) return { i, live: n >= minutos(IX.hor[i].inicio), hoje: true };
  return { i: IX.hor.length - 1, live: false, hoje: true, acabou: true };
}
function turmaIdx() {
  const a = autoIndex(S.ui.dia);
  return { ...a, idx: Math.max(0, Math.min(IX.hor.length - 1, a.i + S.ui.off)) };
}
const clockText = () => { const d = agora(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };

// ---------- gráfico de 1RM ----------
function lineChart(pts) {
  const W = 420, H = 170, L = 34, R = 58, T = 14, B = 24;
  const xs = pts.map((p) => p.date.getTime()), ys = pts.map((p) => p.est);
  const x0 = Math.min(...xs), x1 = Math.max(agora().getTime(), Math.max(...xs) + DAY);
  const step = (Math.max(...ys) - Math.min(...ys)) > 60 ? 20 : 10;
  const y0 = Math.floor((Math.min(...ys) - 6) / step) * step, y1 = Math.ceil((Math.max(...ys) + 6) / step) * step;
  const X = (v) => L + (v - x0) / (x1 - x0) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  let g = "";
  for (let v = y0; v <= y1; v += step) g += `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  for (let d = new Date(new Date(x0).getFullYear(), new Date(x0).getMonth() + 1, 1); d.getTime() <= x1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) g += `<text class="ax" x="${X(d.getTime())}" y="${H - 6}" text-anchor="middle">${MES[d.getMonth()]}</text>`;
  let segs = "";
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; segs += `<path class="ln${(a.fs || b.fs) ? " dash" : ""}" d="M${X(a.date.getTime()).toFixed(1)} ${Y(a.est).toFixed(1)}L${X(b.date.getTime()).toFixed(1)} ${Y(b.est).toFixed(1)}"/>`; }
  const path = pts.map((p, i) => (i ? "L" : "M") + X(p.date.getTime()).toFixed(1) + " " + Y(p.est).toFixed(1)).join("");
  const area = path + `L${X(xs[xs.length - 1]).toFixed(1)} ${Y(y0)}L${X(xs[0]).toFixed(1)} ${Y(y0)}Z`;
  const last = pts[pts.length - 1];
  const dots = pts.map((p, i) => `<circle class="pt${p.fs ? " est" : ""}" r="${i === pts.length - 1 ? 5 : 3.6}" cx="${X(p.date.getTime())}" cy="${Y(p.est)}"><title>${dd(p.date)}: ${esc(p.desc || "")} → ${p.fs ? "≈ " : ""}${fmt(Math.round(p.est))} lb (${kg(p.est)} kg)</title></circle>`).join("");
  const lx = X(last.date.getTime()) + 8, ly = Y(last.est);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="1RM de ${Math.round(pts[0].est)} a ${Math.round(last.est)} lb">${g}<path class="ar" d="${area}"/>${segs}${dots}<text class="lb" x="${lx}" y="${ly + 1}">${last.fs ? "≈" : ""}${Math.round(last.est)} lb</text><text class="lbk" x="${lx}" y="${ly + 13}">${kg(last.est)} kg</text></svg>`;
}

// ---------- M | G | W ----------
function balance(blocks) {
  const res = ORDER.map((b) => { const hit = blocks.filter((x) => x.st.includes(b)); return { b, c: hit.length, last: hit.length ? hit[hit.length - 1].date : null }; });
  const tot = res.reduce((a, x) => a + x.c, 0) || 1;
  res.forEach((x) => { x.p = x.c / tot; x.status = x.p < .22 ? "pouco" : x.p > .45 ? "muito" : "equilibrado"; x.since = x.last ? ageDays(isoDia(x.last)) : null; });
  const least = res.slice().sort((a, b) => a.c - b.c || (b.since ?? 999) - (a.since ?? 999))[0];
  return { res, least, tot };
}
function mgwTiles(bal) {
  return `<div class="mgw">${bal.res.map((x) => `<div class="mgw-t${x.status === "pouco" ? " low" : ""}">
    <div class="L"><b>${x.b}</b><span>${BASES[x.b]}</span></div>
    <div class="ct tnum">${x.c} ${x.c === 1 ? "bloco" : "blocos"} · ${Math.round(x.p * 100)}%</div>
    <div class="sh"><span style="width:${Math.round(x.p * 100)}%"></span></div>
    <div class="st">${x.status}</div>
    <div class="ls">${x.last ? `último: ${dd(x.last)} (há ${x.since} d)` : "nenhum no período"}</div></div>`).join("")}</div>`;
}

// ---------- telas ----------
function kind() { return window.innerWidth >= 900 ? "tablet" : "phone"; }

function render() {
  const focusQ = document.activeElement && document.activeElement.id === "q";
  const caret = focusQ ? document.activeElement.selectionStart : null;
  if (S.tela === "carregando") root.innerHTML = `<div class="login"><p>Carregando…</p></div>`;
  else if (S.tela === "login") root.innerHTML = loginView();
  else if (S.tela === "erro") root.innerHTML = `<div class="login"><form>${marcaLogin()}<p>${esc(S.erro)}</p><button type="button" class="dev-link" data-act="recarregar">Tentar de novo</button>${DEV ? `<button type="button" class="dev-link" data-act="dev">Carregar arquivo (desenvolvimento)</button>` : ""}${rodapeLogin()}</form></div>`;
  else root.innerHTML = S.ui.tab === "aula" ? aulaView() : periodoView();
  if (S.ui.menu && root.firstElementChild) root.firstElementChild.insertAdjacentHTML("beforeend", menuView());
  if (S.ui.toast && root.firstElementChild) root.firstElementChild.insertAdjacentHTML("beforeend", `<div class="toast" role="status">${esc(S.ui.toast)}</div>`);
  if (focusQ) { const i = root.querySelector("#q"); if (i) { i.focus(); i.setSelectionRange(caret, caret); } }
}

// ---------- marca do box (white label) ----------
const nomeBox = () => CFG.BOX.nome || S.dados?.box?.nome || "Box";
// O logo também é a entrada escondida do modo DEV: 5 toques seguidos (ver toqueLogo).
const logoBox = (cls) => CFG.BOX.logo ? `<span class="logo ${cls || ""}" data-act="logo"><img src="${esc(CFG.BOX.logo)}" alt="" width="40" height="40"></span>` : "";
const marcaLogin = () => `<div class="login-marca">${logoBox("grande")}<h1>${esc(nomeBox())}</h1></div>`;
const rodapeLogin = () => `<div class="login-rodape">${esc(CFG.PRODUTO)}${DEV ? ` · <b>modo DEV</b> · <button type="button" class="dev-link mini" data-act="modo">voltar ao modo produção</button>` : ""}</div>`;

function loginView() {
  return `<div class="login"><form id="login" autocomplete="on">
    ${marcaLogin()}
    <p>Digite a senha do box para abrir os dados das turmas. Ela fica guardada neste aparelho.</p>
    <label>Senha do box<input type="password" name="senha" autocomplete="current-password" required></label>
    <div class="erro" role="alert">${esc(S.erro)}</div>
    <button type="submit">Entrar</button>
    ${DEV ? `<button type="button" class="dev-link" data-act="dev">Carregar arquivo (desenvolvimento)</button>` : ""}
    ${rodapeLogin()}
  </form></div>`;
}

function topo(k) {
  const tabs = `<div class="tabs" role="tablist"><button role="tab" data-tab="aula" aria-selected="${S.ui.tab === "aula"}">Aula</button><button role="tab" data-tab="periodo" aria-selected="${S.ui.tab === "periodo"}">Período</button></div>`;
  const brand = `<span class="brand">${logoBox()}<span class="brand-n">${esc(nomeBox())}</span></span>`;
  const meta = `<span class="meta">${S.offline ? `<span class="offline" title="Sem conexão: mostrando a última cópia guardada">offline</span>` : ""}<span class="tnum">${clockText()}</span>${DEV ? `<button class="ico-btn dev" data-act="dev" aria-label="Ferramentas de desenvolvimento">DEV</button>` : ""}<button class="ico-btn menu-btn" data-act="menu" aria-label="Menu" aria-expanded="${S.ui.menu}">${ICON.menu}</button></span>`;
  return k === "tablet"
    ? `<div class="brandrow">${brand}${tabs}${meta}</div>`
    : `<div class="brandrow">${brand}${meta}</div>${tabs}`;
}

// Menu: instalar, modo DEV/produção, sair.
function menuView() {
  const inst = PWA.instalado ? `<div class="mi-nota">App instalado neste aparelho.</div>`
    : PWA.prompt ? `<button class="mi" data-act="instalar">${ICON.install}<span>Instalar o app<small>Abre em tela cheia, com ícone na tela inicial e sem internet</small></span></button>`
    : PWA.ios ? `<div class="mi-nota">${ICON.install}<span>Para instalar no iPhone ou iPad: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</span></div>`
    : `<div class="mi-nota">${ICON.install}<span>Para instalar, use o menu do navegador e escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</span></div>`;
  return `<div class="scrim menu-scrim" data-act="menu"></div><div class="menu" role="menu" aria-label="Menu">
    <div class="menu-h">${logoBox()}<div><b>${esc(nomeBox())}</b><small>${esc(CFG.PRODUTO)} · modo ${DEV ? "DEV" : "produção"}</small></div></div>
    ${inst}
    ${DEV ? `<button class="mi" data-act="modo">${ICON.code}<span>Voltar ao modo produção<small>Usa só os dados publicados</small></span></button>` : ""}
    ${PWA.atualizacao ? `<button class="mi" data-act="atualizar-app">${ICON.back}<span>Atualizar o app<small>Há uma versão nova publicada</small></span></button>` : ""}
    <button class="mi perigo" data-act="sair">${ICON.x}<span>Sair<small>Apaga a senha e os dados deste aparelho</small></span></button>
  </div>`;
}

function aulaView() {
  const k = kind();
  if (!IX.hor.length) return `<div class="app ${k}"><div class="topbar">${topo(k)}</div><div class="empty">Os dados não têm turmas.</div></div>`;
  const T = turmaIdx(); const tk = IX.hor[T.idx].turma; const dia = S.ui.dia;
  let tag = "", tagc = "";
  if (T.hoje && S.ui.off === 0 && !T.acabou) tag = T.live ? "Agora" : "Próxima";
  else if (T.hoje && S.ui.off !== 0) { tag = S.ui.off < 0 ? "Anterior" : "Seguinte"; tagc = " other"; }
  const items = listaDaAula(dia, tk).map((e) => {
    const a = e.aluno ? IX.alunos[e.aluno] : null;
    const fi = a ? fichaDe(dia, a.id) : {};
    const fl = (fi.alertas || []).map((x) => ({ lv: NIVEL[x.nivel] || "info", ic: ICONE_ALERTA[x.icone] || "alert", t: textoCurto(x), o: x }));
    if (e.extra && a) fl.push({ lv: "info", ic: "swap", t: `Costuma vir às ${a.turma_habitual || "?"}` });
    const sv = fl.some((x) => x.lv === "dor") ? "dor" : fl.some((x) => x.lv === "warn") ? "warn" : fl.length ? "info" : "";
    return { e, a, fi, fl, sv, id: a ? a.id : "nc:" + e.nome, nome: a ? label(a) : e.nome };
  });
  items.sort((p, q) => SEVRANK[p.sv] - SEVRANK[q.sv] || p.nome.localeCompare(q.nome, "pt"));
  const isAttn = (x) => x.sv === "dor" || x.sv === "warn";
  const nAlert = items.filter(isAttn).length;
  const shown = S.ui.onlyAlert ? items.filter(isAttn) : items;
  if (k === "tablet" && (!S.ui.sel || !items.some((x) => x.id === S.ui.sel)) && items.length) S.ui.sel = items[0].id;
  const attn = shown.filter(isAttn), rest = shown.filter((x) => !isAttn(x));
  let list = "";
  if (attn.length) list += `<div class="sect attn">${ICON.alert} Atenção hoje · ${nAl(attn.length)}</div>` + attn.map(card).join("");
  if (rest.length) list += `<div class="sect">Turma · ${nAl(rest.length)}</div>` + rest.map(card).join("");
  if (!items.length) list = `<div class="sect">Nenhum aluno na lista desta turma</div>`;
  else if (!shown.length) list = `<div class="sect">Nenhum aluno com alerta nesta turma</div>`;
  const ws = wodsDoDia(dia);
  if (ws.length) list += `<div class="today"><div class="k">Treino do dia</div>${ws.map((w) => `<div class="row">${w.estrutura?.length ? `<span class="struct">${structTxt(w.estrutura)}</span>` : ""}<span class="t">${esc([w.formato, w.titulo].filter(Boolean).join(" · "))}</span></div>${descricaoWod(w)}`).join("")}</div>`;
  list += `<div class="rodape">Dados gerados em ${esc(fmtGerado(S.dados.gerado_em))}${S.origem === "dev" ? " · arquivo local (desenvolvimento)" : ""}</div>`;
  const iDia = IX.datas.indexOf(dia);
  const top = `<div class="topbar">${topo(k)}
    <div class="sess">
      <button class="arrow" data-act="prev" aria-label="Turma anterior" ${T.idx === 0 ? "disabled" : ""}>${ICON.left}</button>
      <div class="sess-mid"><div><span class="sess-hour tnum">${esc(tk)}</span>${tag ? `<span class="sess-tag${tagc}">${tag}</span>` : ""}</div>
        <div class="sess-sub"><span class="dia"><button data-act="dia-" aria-label="Dia anterior" ${iDia <= 0 ? "disabled" : ""}>${ICON.left}</button><span class="tnum">${diaTxt(dia)}</span><button data-act="dia+" aria-label="Próximo dia" ${iDia < 0 || iDia >= IX.datas.length - 1 ? "disabled" : ""}>${ICON.right}</button></span> · ${nAl(items.length)}${T.hoje && S.ui.off !== 0 ? ` · <button class="backnow" data-act="now">voltar para a turma atual</button>` : ""}${!T.hoje ? ` · <button class="backnow" data-act="hoje">ir para hoje</button>` : ""}</div></div>
      <button class="arrow" data-act="next" aria-label="Próxima turma" ${T.idx === IX.hor.length - 1 ? "disabled" : ""}>${ICON.right}</button>
    </div>
    <div class="tools">
      <div class="search">${ICON.search}<input id="q" type="text" autocomplete="off" placeholder="Adicionar aluno (nome ou apelido)…" aria-label="Adicionar aluno à turma" value="${esc(S.ui.q)}" role="combobox" aria-expanded="${S.ui.q ? "true" : "false"}">${S.ui.q ? acList(dia, tk) : ""}</div>
      <button class="filt" data-act="filt" aria-pressed="${S.ui.onlyAlert}" aria-label="Mostrar só quem pede atenção">${ICON.alert} ${nAlert}</button>
    </div>
  </div>`;
  const cnt = (m) => items.filter((x) => x.e.modalidade === m).length;
  const sum = `<div class="summary">${["Rx", "Sc", "F", "AD"].map((m) => `<span><b>${cnt(m)}</b> ${MODN[m]}</span>`).join("·")}</div>`;
  const selItem = items.find((x) => x.id === S.ui.sel);
  let html = `<div class="app ${k}">${top}<div class="body"><div class="listwrap">${sum}<div class="grid">${list}</div></div>`;
  if (k === "tablet") html += `<aside class="side" aria-label="Detalhe do aluno">${selItem ? detail(selItem, false) : `<div class="empty">Toque num aluno para ver os detalhes.</div>`}</aside>`;
  html += `</div>`;
  if (k === "phone" && selItem) html += `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-label="${esc(selItem.nome)}"><div class="grab"></div>${detail(selItem, true)}</div>`;
  return html + `</div>`;
}

// Texto da etiqueta no cartão. Alerta de uma região do corpo: "Região: curto" (ou texto).
// Os outros: `curto`, ou só o título.
function textoCurto(x) {
  if (x.regiao) { const tit = x.titulo || regiaoTxt(x.regiao), corpo = x.curto || x.texto; return corpo ? `${tit}: ${corpo}` : tit; }
  return x.curto || x.titulo || x.texto || "";
}

function fmtGerado(s) {
  if (!s) return "?";
  const d = new Date(s);
  return isNaN(d) ? s : `${dd(d)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function srcChip(c) {
  if (c.origem === "antigo") return `<span class="src velho">Antigo${c.dias_registro ? ` · ${c.dias_registro} dias` : ""}</span>`;
  return c.origem === "estimado" ? `<span class="src est">Estimado</span>` : `<span class="src bruto">Registrado</span>`;
}

function card(x) {
  const e = x.e, c = x.fi.carga;
  let load = "", meta = "";
  if (e.resultado) {
    const r = e.resultado;
    load = `<span class="res-big tnum">${esc(r.valor ?? r.texto)}</span><span class="res-k">${esc(r.unidade || "resultado")}</span>`;
  } else if (c && c.faixa_lb) {
    const est = c.origem === "estimado";
    load = `<div class="c-lb"><span class="c-big tnum${est ? " est" : ""}">${est ? "≈" : ""}${lbr(c.faixa_lb[0], c.faixa_lb[1])}</span><span class="c-unit">lb</span></div><span class="c-kg tnum">${kgr(c.faixa_lb[0], c.faixa_lb[1])}</span>`;
    meta = `<div class="c-meta tnum">${srcChip(c)}${c.resumo ? `<span>${esc(c.resumo)}</span>` : ""}</div>`;
  } else if (c && c.sem_dado) {
    load = `<span class="c-alt">${esc(c.curto || "Sem dado de carga")}</span>`;
  }
  const fl = x.fl.slice(0, 2).map((f) => `<span class="flag ${f.lv}">${ICON[f.ic]}${esc(f.t)}</span>`).join("");
  const mod = e.modalidade ? `<span class="mod ${esc(e.modalidade)}" title="Modalidade nesta aula: ${esc(MODN[e.modalidade] || e.modalidade)}">${esc(e.modalidade)}</span>` : "";
  return `<button class="card ${x.sv ? "s-" + x.sv : ""}" data-id="${esc(x.id)}" aria-current="${S.ui.sel === x.id}">
    <div class="c-head"><div class="c-top"><span class="c-name">${esc(x.nome)}</span>${mod}${e.extra ? `<span class="extra-tag">fora do horário</span>` : ""}${e.semCadastro ? `<span class="semcad">sem cadastro</span>` : ""}</div>${load ? `<div class="c-load">${load}</div>` : ""}</div>
    ${fl ? `<div class="flags">${fl}</div>` : ""}${meta}
  </button>`;
}

function acList(dia, tk) {
  const inTurma = new Set(listaDaAula(dia, tk).map((e) => e.aluno).filter(Boolean));
  const q = norm(S.ui.q);
  const names = (a) => [a.nome, a.apelido, ...(a.nomes_busca || [])].filter(Boolean);
  const res = Object.values(IX.alunos).filter((a) => !inTurma.has(a.id) && names(a).some((n) => norm(n).startsWith(q) || norm(n).includes(" " + q))).slice(0, 6);
  if (!res.length) return `<div class="ac"><div class="none">Nenhum aluno com esse nome ou apelido no cadastro.</div></div>`;
  S.ui.acIdx = Math.min(S.ui.acIdx, res.length - 1);
  return `<div class="ac" role="listbox">${res.map((a, i) => {
    const hit = (a.nomes_busca || []).find((n) => norm(n).startsWith(q) && !norm(label(a)).includes(q));
    return `<button role="option" data-add="${esc(a.id)}" aria-selected="${i === S.ui.acIdx}"><span class="n">${esc(label(a))}${hit ? ` <span class="h">também: ${esc(hit)}</span>` : ""}</span><span class="h">${a.turma_habitual ? "costuma " + esc(a.turma_habitual) : ""}</span></button>`;
  }).join("")}</div>`;
}

// ---------- gráficos menores do detalhe ----------
function spark(vals) {
  const W = 96, H = 28, mn = Math.min(...vals) - 3, mx = Math.max(...vals) + 3;
  const X = (i) => 2 + i / (vals.length - 1) * (W - 6), Y = (v) => H - 2 - (v - mn) / (mx - mn) * (H - 4);
  const d = vals.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join("");
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="spark" d="${d}"/><circle class="spark-end" r="2.8" cx="${X(vals.length - 1)}" cy="${Y(vals[vals.length - 1])}"/></svg>`;
}
function delta(vals, rotulo) {
  const ref = vals[Math.max(0, vals.length - 4)];
  const d = Math.round(vals[vals.length - 1] - ref); const c = d > 1 ? "up" : d < -1 ? "down" : "flat";
  return `<span class="dl ${c}">${d > 0 ? "+" : ""}${d} ${esc(rotulo || "em 3 meses")}</span>`;
}
// Faixa de comparação entre dois movimentos (ex.: front squat ÷ back squat).
function ratioChart(cp) {
  const pts = cp.pontos || [], [elo, ehi] = cp.esperado || [0, 0];
  // A escala cobre os pontos e a faixa esperada (que pode passar de 100%, ex.: jerk × push press).
  const vals = pts.map((p) => p.razao).concat(elo ? [elo, ehi] : []);
  const lo = Math.min(.5, Math.floor((Math.min(...vals) - .05) * 10) / 10), hi = Math.max(1, Math.ceil((Math.max(...vals) + .05) * 10) / 10);
  const W = 320, H = 58, L = 10, R = 10;
  const X = (v) => L + (v - lo) / (hi - lo) * (W - L - R);
  let g = elo ? `<rect class="band" x="${X(elo)}" y="10" width="${X(ehi) - X(elo)}" height="24" rx="3"/><text class="ax" x="${X((elo + ehi) / 2)}" y="7" text-anchor="middle">esperado</text>` : "";
  for (let v = Math.ceil(lo * 10) / 10; v <= hi + 1e-9; v += .1) g += `<line class="tk" x1="${X(v)}" x2="${X(v)}" y1="34" y2="38"/><text class="ax" x="${X(v)}" y="50" text-anchor="middle">${Math.round(v * 100)}%</text>`;
  pts.forEach((p, i) => {
    const last = i === pts.length - 1;
    g += `<circle class="p${last ? " last" : ""}" cx="${X(p.razao)}" cy="22" r="${last ? 6 : 4.5}"><title>${dd(deIso(p.data))}: ${Math.round(p.razao * 100)}%</title></circle>`;
    if (last) g += `<text class="pl" x="${X(p.razao)}" y="7" text-anchor="middle">${Math.round(p.razao * 100)}% · ${dd(deIso(p.data))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cp.titulo || "Comparação")}: ${pts.map((p) => Math.round(p.razao * 100) + "%").join(", ")}">${g}</svg>`;
}

function alertaHtml(o) {
  const lv = NIVEL[o.nivel] || "info";
  const ic = ICONE_ALERTA[o.icone] || "alert";
  const ag = o.registrado_em ? ageDays(o.registrado_em) : null;
  const tit = o.titulo || regiaoTxt(o.regiao);
  const cp = o.comparacao;
  // Região do corpo: "Região: texto" no título. Os outros: título e, abaixo, o texto.
  const juntar = o.regiao || !o.titulo;
  let h = `<div class="alert ${lv}${cp ? " ratio" : ""}">${big(ICON[ic])}<div style="flex:1;min-width:0"><div class="a-t">${esc(juntar ? [tit, o.texto].filter(Boolean).join(": ") : tit)}</div>${!juntar && o.texto ? `<div class="a-s">${rico(o.texto)}</div>` : ""}`;
  if (cp) {
    if (cp.texto) h += `<div class="a-s">${rico(cp.texto)}</div>`;
    if ((cp.pontos || []).length) h += `<div class="ratio-c">${ratioChart(cp)}</div>`;
    if (cp.leitura) h += `<div class="a-l">${rico(cp.leitura)}</div>`;
    if (cp.relacionada) h += `<div class="a-l">Observação que pode estar relacionada: ${esc(cp.relacionada)}</div>`;
  }
  if (o.conduta) h += `<div class="a-s">Conduta sugerida: ${esc(o.conduta)}</div>`;
  if ((o.passos || []).length) h += `<ul>${o.passos.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
  if (o.registrado_em) h += `<div class="a-d">Registrado em ${dd(deIso(o.registrado_em))} (há ${ag} ${ag === 1 ? "dia" : "dias"})${ag > 45 ? " · <b>confirmar se ainda vale</b>" : ""}</div>`;
  return h + `</div></div>`;
}

function detail(x, isSheet) {
  const close = isSheet ? `<button class="d-close" data-act="close" aria-label="Fechar">${ICON.x}</button>` : "";
  if (!x.a) {
    return `<div class="detail"><div class="d-head"><div><div class="d-name">${esc(x.nome)}</div><div class="d-nick">Nome lido no check-in, sem cadastro correspondente.</div></div>${close}</div>
      <div class="nada">Inclua o nome na aba alunos da planilha DB para ligar este check-in a um aluno.</div></div>`;
  }
  const a = x.a, e = x.e, fi = x.fi, r = a.resumo || {};
  const v = (val, f) => val == null || val === "" ? "—" : f ? f(val) : esc(val);
  const turmas = [a.turma_habitual, ...(a.turmas_alternativas || [])].filter(Boolean);
  let h = `<div class="detail"><div class="d-head"><div><div class="d-name">${esc(a.nome)}</div>${a.apelido ? `<div class="d-nick">Apelido: <b>${esc(a.apelido)}</b></div>` : ""}</div>${close}</div>
    <dl class="dinfo">
      <div><dt>Turma habitual</dt><dd>${turmas.length ? esc(turmas.join(" e ")) : "—"}</dd></div>
      ${(a.dias_habituais || []).length ? `<div><dt>Dias habituais</dt><dd>${esc(a.dias_habituais.join(", "))}</dd></div>` : ""}
      <div><dt>Nesta aula</dt><dd>${e.modalidade ? esc(MODN[e.modalidade] || e.modalidade) : "—"}</dd></div>
      <div><dt>Frequência média</dt><dd class="tnum">${v(r.media_semanal, (n) => fmt(n) + " aulas/semana")}</dd></div>
      <div><dt>Últimos 30 dias</dt><dd class="tnum">${v(r.aulas_30d, (n) => `${n} ${n === 1 ? "aula" : "aulas"}`)}</dd></div>
      <div><dt>Última aula</dt><dd class="tnum">${v(r.ultima_aula, (s) => { const g = ageDays(s); return `${dd(deIso(s))} (${g === 0 ? "hoje" : `há ${g} ${g === 1 ? "dia" : "dias"}`})`; })}</dd></div>
      <div><dt>Aluno desde</dt><dd class="tnum">${v(r.aluno_desde, (s) => deIso(s).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", ""))}</dd></div>
    </dl>`;
  // Alertas do dia, na ordem de gravidade
  const alertas = (fi.alertas || []).slice().sort((p, q) => SEVRANK[NIVEL[p.nivel] || "info"] - SEVRANK[NIVEL[q.nivel] || "info"]);
  for (const o of alertas) h += alertaHtml(o);
  if (x.e.extra) h += `<div class="alert info">${big(ICON.swap)}<div><div class="a-t">Costuma vir às ${esc(a.turma_habitual || "?")}</div></div></div>`;

  // Carga sugerida para o treino do dia
  const c = fi.carga;
  if (c && c.faixa_lb) {
    const est = c.origem === "estimado";
    h += `<div class="hero${est ? " est" : ""}"><div class="k">${esc([c.movimento, c.prescricao].filter(Boolean).join(" · "))} ${srcChip(c)}</div><div class="v tnum">${est ? "≈" : ""}${lbr(c.faixa_lb[0], c.faixa_lb[1])}<small>lb</small></div><div class="kg tnum">${kgr(c.faixa_lb[0], c.faixa_lb[1])}</div>${c.explicacao ? `<div class="why">${rico(c.explicacao)}</div>` : ""}</div>`;
  } else if (c && c.sem_dado) {
    h += `<div class="hero"><div class="k">${esc([c.movimento, c.prescricao].filter(Boolean).join(" · "))}</div><div class="v" style="font-size:26px">${esc(c.curto || "Sem dado de carga")}</div>${c.explicacao ? `<div class="why">${rico(c.explicacao)}</div>` : ""}</div>`;
  }

  // Gráfico de 1RM
  const hc = (a.historico_carga || []).map((p) => ({ date: deIso(p.data), est: p.rm1_lb, fs: !!p.estimado, desc: p.descricao })).filter((p) => p.est > 0).sort((p, q) => p.date - q.date);
  if (hc.length >= 2) {
    const mov = a.historico_carga_movimento || (c && c.movimento) || "1RM";
    const lg = a.historico_carga_legenda || {};
    h += `<div class="chart"><div class="blk-h">${esc(mov)} · 1RM (lb)</div>${lineChart(hc)}<div class="legend">${hc.some((p) => !p.fs) ? `<span><i></i>${esc(lg.registrado || "registrado")}</span>` : ""}${hc.some((p) => p.fs) ? `<span><i class="o"></i>${esc(lg.estimado || "estimado de exercício parecido")}</span>` : ""}</div></div>`;
  }

  // Força por grupo muscular (só em dia com levantamento)
  const diaTemW = wodsDoDia(S.ui.dia).some((w) => (w.estrutura || []).includes("W"));
  const idx = (a.indices_forca || []).filter((m) => (m.serie || []).length >= 2);
  if (idx.length && diaTemW) {
    h += `<div><div class="blk-h">Força por grupo muscular · índice do modelo</div><div class="metrics">${idx.map((m) => `<div class="metric"><div><div class="mn">${esc(m.nome)}</div>${m.exemplos ? `<div class="ms">${esc(m.exemplos)}</div>` : ""}</div>${spark(m.serie)}<div><span class="mv tnum">${Math.round(m.serie[m.serie.length - 1])}</span>${delta(m.serie, m.variacao_rotulo)}</div></div>`).join("")}</div></div>`;
  }

  // Bases treinadas (o que o aluno executou) e prescrito × executado
  const blocos = (a.blocos || []).map((b) => ({ ...b, date: deIso(b.data), w: IX.wods[b.wod] })).sort((p, q) => p.date - q.date);
  const b30 = blocos.filter((b) => { const g = ageDays(b.data); return g >= 0 && g <= 30; });
  if (b30.length) {
    const bal = balance(b30.map((b) => ({ date: b.date, st: b.estrutura || b.w?.estrutura || [] })));
    h += `<div><div class="blk-h">Bases treinadas · últimos 30 dias · o que o aluno executou</div>${mgwTiles(bal)}
      <div class="mgw-sum">Menos presente: <b>${bal.least.b} · ${BASES[bal.least.b]}</b>${bal.least.last ? `, última vez há ${bal.least.since} dias` : ", nenhum bloco no período"}.</div></div>`;
  }
  const ult = blocos.filter((b) => ageDays(b.data) >= 0).slice(-4).reverse();
  if (ult.length) {
    h += `<div><div class="blk-h">Últimos blocos · prescrito × executado</div><div class="px">${ult.map((b) => {
      const pre = b.w?.estrutura || b.estrutura_prescrita || [], exe = b.estrutura || pre;
      const baseChg = pre.join() !== exe.join();
      const trocas = b.trocas || [];
      const swTxt = trocas.map((t) => `${t.de} → ${t.para}${t.motivo ? ` (${t.motivo})` : ""}`).join(", ");
      const tipo = baseChg ? "Mudou a base: " : b.tipo_troca === "padrao" ? "Mesma base, outro padrão: " : "Troca de exercício: ";
      return `<div class="px-r${baseChg ? " chg" : ""}"><div class="dt tnum">${dd(b.date)}</div><div><div class="tt">${esc(b.w ? [b.w.formato, b.w.titulo].filter(Boolean).join(" · ") : b.titulo || b.wod || "Treino")}</div>
        <div class="ln">${pre.length ? `Prescrito <span class="struct lite">${structTxt(pre)}</span> ` : ""}${exe.length ? `Executado <span class="struct${baseChg ? " chg" : ""}">${structTxt(exe)}</span>` : ""}${b.modalidade ? ` · ${esc(b.modalidade)}` : ""}${b.resultado ? ` · ${esc(b.resultado)}` : ""}</div>
        ${trocas.length ? `<div class="sw${baseChg ? "" : " lite"}">${tipo}${esc(swTxt)}</div>` : ""}</div></div>`;
    }).join("")}</div></div>`;
  }

  // Último treino parecido
  const p = fi.parecido;
  if (p) {
    const w = IX.wods[p.wod];
    const st = p.estrutura || w?.estrutura || [];
    h += `<div class="sim"><div class="blk-h">Último treino parecido${st.length ? " · " + structTxt(st) : ""}</div><div class="r tnum">${esc(p.titulo || (w ? w.titulo : ""))}${p.resumo ? ` · ${esc(p.resumo)}` : ""}</div><div class="m">${dd(deIso(p.data))}${w?.formato ? ` · ${esc(w.formato)}` : ""}${p.modalidade ? ` · feito como <b>${esc(MODN[p.modalidade] || p.modalidade)}</b>` : ""}${p.detalhe ? ` · ${esc(p.detalhe)}` : ""}</div></div>`;
  }

  // Últimos resultados na lousa
  const res = (S.dados.aulas || []).flatMap((au) => (au.alunos || []).filter((y) => y.aluno === a.id && y.resultado).map((y) => ({ au, y }))).sort((p, q) => q.au.data.localeCompare(p.au.data)).slice(0, 6);
  if (res.length) {
    h += `<div><div class="blk-h">Últimos resultados</div><div class="reslist">${res.map(({ au, y }) => {
      const w = (au.wods || diaDe(au.data)?.wods || []).map((i) => IX.wods[i]).filter(Boolean)[0] || wodsDoDia(au.data)[0];
      return `<div class="r"><div class="dt tnum">${dd(deIso(au.data))}</div><div><div class="tt">${esc(w ? w.titulo : "WOD")}</div><div class="nada">${esc(au.turma)}${w?.estrutura?.length ? " · " + structTxt(w.estrutura) : ""}${y.modalidade ? ` · <b>${esc(y.modalidade)}</b>` : ""}</div></div><div class="v tnum">${esc(y.resultado.texto ?? y.resultado.valor)}</div></div>`;
    }).join("")}</div></div>`;
  }

  // Observações que não viraram alerta hoje (resolvidas ou de outra região)
  const mostradas = new Set((fi.alertas || []).map((o) => norm(o.texto)));
  const ocultas = (a.observacoes || []).filter((o) => !mostradas.has(norm(o.texto)));
  if (ocultas.length) {
    const regs = [...new Set(ocultas.map((o) => o.titulo || regiaoTxt(o.regiao)).filter(Boolean))];
    h += `<div class="hidden-obs">${ocultas.length} ${ocultas.length > 1 ? "observações ocultas" : "observação oculta"} por não envolver o treino de hoje${regs.length ? ` (${esc(regs.join(", "))})` : ""}. <button data-act="hid">${S.ui.showHidden ? "esconder" : "mostrar"}</button>
      ${S.ui.showHidden ? `<ul>${ocultas.map((o) => { const t = o.titulo || regiaoTxt(o.regiao); return `<li>${esc(t ? t + ": " : "")}${esc(o.texto)}${o.registrado_em ? ` (${dd(deIso(o.registrado_em))}${o.resolvida ? ", resolvida" : ""})` : ""}</li>`; }).join("")}</ul>` : ""}</div>`;
  }
  return h + `</div>`;
}

function periodoView() {
  const k = kind();
  const fim = deIso(isoDia(agora())).getTime() + DAY;
  const start = fim - S.ui.win * 7 * DAY;
  const ws = (S.dados.wods || []).map((w) => ({ ...w, date: deIso(w.data), st: w.estrutura || [] })).filter((w) => w.date.getTime() > start && w.date.getTime() < fim).sort((a, b) => a.date - b.date);
  const top = `<div class="topbar">${topo(k)}</div>`;
  const chips = `<div class="chips" role="group" aria-label="Período"><button data-win="2" aria-pressed="${S.ui.win === 2}">2 semanas</button><button data-win="4" aria-pressed="${S.ui.win === 4}">4 semanas</button><button data-win="52" aria-pressed="${S.ui.win === 52}">Tudo</button></div>`;
  if (!ws.length) return `<div class="app ${k}">${top}<div class="per"><div class="per-head"><div><div class="per-title">Bases da programação</div><div class="per-sub">Nenhum WOD neste período nos dados carregados.</div></div>${chips}</div></div></div>`;
  const days = new Set(ws.map((w) => w.data)).size;
  const bal = balance(ws.map((w) => ({ date: w.date, st: w.st })));
  const el = [1, 2, 3].map((n) => ws.filter((w) => w.st.length === n).length);
  const head = `<div class="per-head"><div><div class="per-title">Bases da programação</div><div class="per-sub">${dd(ws[0].date)} a ${dd(ws[ws.length - 1].date)} · ${ws.length} ${ws.length === 1 ? "bloco" : "blocos"} em ${days} ${days === 1 ? "dia" : "dias"}</div></div>${chips}</div>`;
  const mgw = `<div class="panel"><div class="blk-h">M | G | W no período</div>${mgwTiles(bal)}
    <div class="mgw-sum">Menos presente: <b>${bal.least.b} · ${BASES[bal.least.b]}</b>${bal.least.last ? `, último bloco em ${dd(bal.least.last)} (há ${bal.least.since} dias)` : ""}. Estrutura dos blocos: <b>${el[0]}</b> de elemento único, <b>${el[1]}</b> duplos e <b>${el[2]}</b> triplos.</div></div>`;
  const catalogo = S.dados.padroes || null;
  const pats = ORDER.map((b) => {
    // Com o catálogo `padroes` nos dados, mostra também os padrões que não apareceram.
    const nomes = [...new Set([...(catalogo?.[b] || []), ...ws.flatMap((w) => (w.movimentos || []).filter((m) => m.base === b).map((m) => m.padrao)).filter(Boolean)])];
    const rows = nomes.map((n) => { const hit = ws.filter((w) => (w.movimentos || []).some((m) => m.base === b && m.padrao === n)); return { n, c: hit.length, last: hit.length ? hit[hit.length - 1].date : null }; });
    const max = Math.max(...rows.map((r) => r.c), 1);
    return `<div><div class="pat-h"><b>${b}</b><span>${BASES[b]}</span></div>${rows.length ? rows.map((r) => `<div class="bar${catalogo && r.c <= 1 ? " low" : ""}"><span class="lab">${esc(r.n)}</span><span class="n tnum">${r.c}</span><span class="trk"><span class="fil" style="width:${r.c / max * 100}%"></span></span><span class="ls">${r.last ? `último em ${dd(r.last)}` : "nenhum no período"}</span></div>`).join("") : `<div class="nada">nenhum no período</div>`}</div>`;
  }).join("");
  const pat = `<div class="panel"><div class="blk-h">Padrões de movimento por base · blocos com o padrão</div><div class="pat">${pats}</div>${catalogo ? `<div class="bar-note">Laranja: padrão com 1 bloco ou nenhum no período. Um bloco conta em todos os padrões que tem.</div>` : ""}</div>`;
  const list = `<div class="panel"><div class="blk-h">Blocos do período · ${ws.length}</div><div class="wodlist">${ws.slice().reverse().map((w) => `<div class="wl"><div class="dt tnum">${dd(w.date)}<small>${DOW[w.date.getDay()]}</small></div><div><div class="tt">${esc(w.titulo)}${w.formato ? `<small>${esc(w.formato)}</small>` : ""}</div>${S.ui.wodAberto[w.id] ? descricaoWod(w) : `<div class="dd">${esc(compacto(w.descricao))}</div>`}${String(w.descricao || "").includes("\n") ? `<button class="mais" data-wod="${esc(w.id)}" aria-expanded="${!!S.ui.wodAberto[w.id]}">${S.ui.wodAberto[w.id] ? "compactar" : "ver como foi escrito"}</button>` : ""}<div class="cc">${w.st.length ? `<span class="struct">${structTxt(w.st)}</span>` : ""}${(w.movimentos || []).map((m) => `<span class="mv">${esc(m.nome)}</span>`).join("")}</div></div></div>`).join("")}</div></div>`;
  return `<div class="app ${k}">${top}<div class="per">${head}${mgw}${pat}${list}</div></div>`;
}

// ---------- eventos ----------
// Entrada escondida do modo DEV: 5 toques no logo em até 3 segundos.
// A partir do 3º toque o app avisa quantos faltam.
const TOQUES_DEV = 5;
let toquesLogo = [];
function toqueLogo() {
  if (DEV) return;
  const t = Date.now();
  toquesLogo = toquesLogo.filter((x) => t - x < 3000).concat(t);
  const faltam = TOQUES_DEV - toquesLogo.length;
  if (faltam <= 0) { toquesLogo = []; M.trocar("dev"); return; }
  if (toquesLogo.length >= 3) toast(`Mais ${faltam} ${faltam === 1 ? "toque" : "toques"} para o modo DEV`);
}

let toastTimer = null;
function toast(t) { S.ui.toast = t; render(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.ui.toast = null; render(); }, 2400); }

root.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act],[data-id],[data-add],[data-tab],[data-win],[data-wod]"); if (!t || !root.contains(t)) return;
  if (t.dataset.tab) { S.ui.tab = t.dataset.tab; S.ui.q = ""; render(); return; }
  if (t.dataset.win) { S.ui.win = Number(t.dataset.win); render(); return; }
  if (t.dataset.add) { addStudent(t.dataset.add); return; }
  if (t.dataset.id) { S.ui.sel = t.dataset.id; S.ui.showHidden = false; render(); return; }
  const a = t.dataset.act, u = S.ui;
  if (a === "dev") { S.ui.menu = false; render(); abrirDev(); return; }
  if (a === "sair") { S.ui.menu = false; render(); sair(); return; }
  if (a === "menu") { S.ui.menu = !S.ui.menu; render(); return; }
  if (a === "modo") { M.trocar(DEV ? "producao" : "dev"); return; }
  if (a === "logo") { toqueLogo(); return; }
  if (a === "instalar") { instalar(); return; }
  if (a === "atualizar-app") { atualizarApp(); return; }
  if (t.dataset.wod) { S.ui.wodAberto[t.dataset.wod] = !S.ui.wodAberto[t.dataset.wod]; render(); return; }
  if (a === "recarregar") { location.reload(); return; }
  if (a === "prev") { u.off--; u.sel = null; u.q = ""; }
  else if (a === "next") { u.off++; u.sel = null; u.q = ""; }
  else if (a === "now") { u.off = 0; u.sel = null; }
  else if (a === "hoje") { u.dia = diaPadrao(); u.off = 0; u.sel = null; }
  else if (a === "dia-" || a === "dia+") { const i = IX.datas.indexOf(u.dia) + (a === "dia+" ? 1 : -1); if (IX.datas[i]) { u.dia = IX.datas[i]; u.sel = null; } }
  else if (a === "filt") u.onlyAlert = !u.onlyAlert;
  else if (a === "close") u.sel = null;
  else if (a === "hid") u.showHidden = !u.showHidden;
  render();
});
function addStudent(id) {
  const tk = IX.hor[turmaIdx().idx].turma; const key = S.ui.dia + "|" + tk;
  (S.ui.added[key] ||= []).push(id);
  S.ui.q = ""; S.ui.acIdx = 0; S.ui.sel = id;
  toast(`${label(IX.alunos[id])} adicionado à turma das ${tk}`);
}
root.addEventListener("input", (e) => { if (e.target.id === "q") { S.ui.q = e.target.value; S.ui.acIdx = 0; render(); } });
root.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.ui.menu) { S.ui.menu = false; render(); return; }
  if (e.target.id !== "q") return;
  const opts = root.querySelectorAll("[data-add]");
  if (e.key === "ArrowDown" && opts.length) { e.preventDefault(); S.ui.acIdx = (S.ui.acIdx + 1) % opts.length; render(); }
  else if (e.key === "ArrowUp" && opts.length) { e.preventDefault(); S.ui.acIdx = (S.ui.acIdx - 1 + opts.length) % opts.length; render(); }
  else if (e.key === "Enter" && opts.length) { e.preventDefault(); addStudent(opts[S.ui.acIdx].dataset.add); }
  else if (e.key === "Escape") { S.ui.q = ""; render(); }
});
root.addEventListener("submit", async (e) => {
  if (e.target.id !== "login") return;
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Abrindo…";
  try { await entrar(e.target.senha.value); }
  catch (err) { S.erro = err.message || String(err); render(); }
});
let sx = null;
root.addEventListener("touchstart", (e) => { if (e.target.closest(".sess")) sx = e.touches[0].clientX; }, { passive: true });
root.addEventListener("touchend", (e) => {
  if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
  if (Math.abs(dx) > 50) { const T = turmaIdx(); if (dx < 0 && T.idx < IX.hor.length - 1) S.ui.off++; else if (dx > 0 && T.idx > 0) S.ui.off--; S.ui.sel = null; render(); }
});
let ultimoKind = kind();
window.addEventListener("resize", () => { if (kind() !== ultimoKind) { ultimoKind = kind(); render(); } });

// ---------- dados: rede, cache, senha ----------
async function baixar(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} ao buscar ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

function usarDados(obj, origem) {
  if (!ehDados(obj)) throw new C.ErroDados("formato", `Esperava ${FORMATO_DADOS}, veio ${obj && obj.formato}.`);
  const primeira = !S.dados;
  S.dados = obj; S.origem = origem; IX = indexar(obj);
  if (primeira || !IX.datas.includes(S.ui.dia)) { S.ui.dia = diaPadrao(); S.ui.off = 0; }
  S.tela = "app";
}
function usarCheckins(obj) {
  if (ehCheckins(obj)) S.checkins = obj;
}

async function entrar(senha) {
  let buf;
  try { buf = await baixar(CFG.URL_DADOS); }
  catch { throw new Error("Sem conexão para baixar os dados. Tente de novo com internet."); }
  if (!buf) throw new Error("Ainda não há arquivo de dados publicado.");
  const h = C.lerCabecalho(buf);
  const chave = await C.derivarChave(senha, h.salt, h.iter);
  const obj = await C.decriptar(buf, chave); // lança "Senha incorreta."
  S.chave = { salt: h.salt, iter: h.iter, chave };
  await A.gravarBruto("chave", S.chave).catch(() => {});
  S.hashDados = await C.resumo(buf);
  S.erro = "";
  usarDados(obj, "rede");
  await A.gravarDados("dados", { hash: S.hashDados, recebido_em: new Date().toISOString(), obj }).catch(() => {});
  render();
  conferirCheckins(true);
}

// Confere se o arquivo mudou; se mudou, decifra, guarda e mostra.
async function conferirDados() {
  if (!S.chave || S.origem === "dev") return;
  S.ultimaConf.dados = Date.now();
  let buf;
  try { buf = await baixar(CFG.URL_DADOS); S.offline = false; }
  catch { S.offline = true; render(); return; }
  if (!buf) return;
  const hash = await C.resumo(buf);
  if (hash === S.hashDados) { render(); return; }
  const h = C.lerCabecalho(buf);
  if (!C.mesmoSalt(h.salt, S.chave.salt) || h.iter !== S.chave.iter) {
    // A senha do box foi trocada: pede de novo.
    await A.apagar("chave"); S.chave = null; S.erro = "A senha do box mudou. Digite a nova senha.";
    S.tela = "login"; render(); return;
  }
  try {
    const obj = await C.decriptar(buf, S.chave.chave);
    const tinha = !!S.dados;
    usarDados(obj, "rede"); S.hashDados = hash;
    await A.gravarDados("dados", { hash, recebido_em: new Date().toISOString(), obj }).catch(() => {});
    if (tinha) toast("Dados atualizados"); else render();
  } catch (e) {
    if (e.tipo === "senha") { await A.apagar("chave"); S.chave = null; S.erro = "A senha do box mudou. Digite a nova senha."; S.tela = "login"; render(); }
  }
}

async function conferirCheckins(forcar) {
  if (!S.chave || S.origem === "dev") return;
  S.ultimaConf.checkins = Date.now();
  let buf;
  try { buf = await baixar(CFG.URL_CHECKINS); } catch { return; }
  if (!buf) return;
  const hash = await C.resumo(buf);
  if (hash === S.hashCheckins && !forcar) return;
  try {
    const h = C.lerCabecalho(buf);
    if (!C.mesmoSalt(h.salt, S.chave.salt)) return;
    const obj = await C.decriptar(buf, S.chave.chave);
    usarCheckins(obj); S.hashCheckins = hash;
    await A.gravarBruto("checkins", { hash, recebido_em: new Date().toISOString(), obj }).catch(() => {});
    if (S.tela === "app") render();
  } catch { /* arquivo de check-ins inválido: segue com a lista de `dados` */ }
}

function pertoDeAula() {
  if (!IX) return false;
  const n = agora().getHours() * 60 + agora().getMinutes();
  return IX.hor.some((h) => n >= minutos(h.inicio) - CFG.JANELA_CHECKINS_MIN && n <= minutos(h.fim));
}

setInterval(() => {
  if (document.hidden) return;
  const t = Date.now();
  if (t - S.ultimaConf.dados >= CFG.CONFERIR_DADOS_MIN * 60e3) conferirDados();
  const passoCk = (pertoDeAula() ? CFG.CONFERIR_CHECKINS_MIN : CFG.CONFERIR_DADOS_MIN) * 60e3;
  if (t - S.ultimaConf.checkins >= passoCk) conferirCheckins();
  if (S.tela === "app" && !(document.activeElement && document.activeElement.id === "q")) render(); // relógio e turma atual
}, 30e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { conferirDados(); conferirCheckins(); } });

async function sair() {
  if (!confirm("Sair apaga a senha e os dados guardados neste aparelho. Continuar?")) return;
  await A.apagar("chave", "dados", "checkins", "dev");
  location.reload();
}

async function iniciar() {
  render();
  simularPelaUrl();
  if (DEV) {
    const dev = await A.ler("dev");
    if (dev && dev.dados) {
      S.agoraSalvo = dev.agora || null;
      if (dev.agora && !S.simDaUrl) S.agoraSim = new Date(dev.agora); // a da URL tem precedência
      usarDados(dev.dados, "dev"); usarCheckins(dev.checkins);
      render(); return;
    }
  }
  S.chave = await A.ler("chave");
  const cache = await A.ler("dados");
  const ck = await A.ler("checkins");
  if (S.chave && cache && cache.obj) {
    try {
      usarDados(cache.obj, "cache"); S.hashDados = cache.hash;
      if (ck && ck.obj) { usarCheckins(ck.obj); S.hashCheckins = ck.hash; }
      render();
    } catch { /* cópia local inválida: segue para a rede */ }
    conferirDados(); conferirCheckins();
    return;
  }
  if (S.chave) {
    await conferirDados();
    if (!S.dados) { S.tela = S.chave ? "erro" : "login"; S.erro = "Não foi possível baixar os dados e não há cópia neste aparelho."; render(); }
    else conferirCheckins();
    return;
  }
  S.tela = "login"; render();
}

// ---------- ferramentas de desenvolvimento ----------
// Aparecem só em localhost ou com ?dev na URL. Permitem carregar um dados.json (ou o
// arquivo criptografado) do computador, simular data e hora e gerar um arquivo `dados`.
// Data simulada: "AAAA-MM-DD HH:mm", hora de 0 a 23, no fuso do aparelho.
const fmtSim = (d) => `${isoDia(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
function lerSim(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, da, h, mi] = m.slice(1).map(Number);
  const d = new Date(y, mo - 1, da, h, mi);
  // recusa datas que o Date "corrige" (31/02, 25:00…)
  return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da && d.getHours() === h && d.getMinutes() === mi ? d : null;
}

// Simulação pela URL, ao abrir o app (só no modo DEV, como a da tela DEV):
//   ?data=2026-11-03&hora=6:10   ?data=2026-11-03&hora=6   ?data=2026-11-03 (hora atual do relógio)
//   ?data=2026-11-03%2006:10     (o formato da tela DEV também vale em `data`)
// `hora` aceita 6, 06, 6:10, 06:10, 6h e 6h10. Vale só neste carregamento e tem precedência
// sobre a simulação guardada na tela DEV, que não é apagada. Valor inválido: ignora e avisa.
const PARAMS_SIM = ["data", "hora"];
function lerSimUrl(data, hora) {
  data = (data || "").trim(); hora = (hora || "").trim();
  if (!data) return null;
  if (/[ T]\d/.test(data)) return hora ? null : lerSim(data);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  let h, mi;
  if (hora) {
    const m = /^(\d{1,2})(?:[:hH](\d{2})?)?$/.exec(hora);
    if (!m) return null;
    h = Number(m[1]); mi = Number(m[2] || 0);
  } else { const r = new Date(); h = r.getHours(); mi = r.getMinutes(); }
  return lerSim(`${data} ${pad(h)}:${pad(mi)}`);
}
function simularPelaUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has("data") && !q.has("hora")) return;
  const txt = PARAMS_SIM.filter((p) => q.has(p)).map((p) => `${p}=${q.get(p)}`).join("&");
  if (!DEV) { toast("Simular data e hora pela URL só vale no modo DEV (acrescente ?dev)"); return; }
  const d = lerSimUrl(q.get("data"), q.get("hora"));
  if (!d) { toast(`Simulação ignorada: "${txt}" inválido. Use data=AAAA-MM-DD e hora=HH:mm`); return; }
  S.agoraSim = d; S.simDaUrl = txt;
  if (IX) { S.ui.dia = diaPadrao(); S.ui.off = 0; }
}
// Tira data/hora da URL quando a simulação é trocada na tela DEV (senão volta ao recarregar).
function esquecerSimUrl() {
  if (!S.simDaUrl) return;
  S.simDaUrl = null;
  const u = new URL(location.href);
  for (const p of PARAMS_SIM) u.searchParams.delete(p);
  history.replaceState(history.state, "", u.toString());
}

function abrirDev() {
  const el = document.createElement("div");
  el.className = "devp";
  const simVal = S.agoraSim ? fmtSim(S.agoraSim) : "";
  el.innerHTML = `<div class="box" role="dialog" aria-label="Ferramentas de desenvolvimento">
    <h2>Desenvolvimento <span>·</span></h2>
    <p>Origem atual: <b>${S.dados ? ({ rede: "arquivo publicado", cache: "cópia local", dev: "arquivo carregado aqui" }[S.origem]) : "nenhum dado"}</b>${S.dados ? ` · gerado em ${esc(fmtGerado(S.dados.gerado_em))} · ${(S.dados.aulas || []).length} aulas, ${(S.dados.alunos || []).length} alunos` : ""}${S.checkins ? ` · check-ins de ${esc(fmtGerado(S.checkins.gerado_em))}` : ""}</p>
    <fieldset><legend>Carregar arquivo</legend>
      <p>Aceita <code>dados.json</code>, <code>checkins.json</code> ou os arquivos criptografados <code>dados</code> e <code>checkins</code>. Fica guardado neste navegador até você voltar aos dados publicados.</p>
      <input type="file" id="dv-arq" accept=".json,application/json,application/octet-stream,*/*" multiple>
      <input type="password" id="dv-senha" placeholder="Senha (só para arquivo criptografado)">
    </fieldset>
    <fieldset><legend>Simular data e hora</legend>
      ${S.simDaUrl ? `<p class="dv-url"><b>Definida pela URL</b> (<code>?${esc(S.simDaUrl)}</code>) e não guardada${S.agoraSalvo ? `; a guardada aqui continua ${esc(fmtSim(new Date(S.agoraSalvo)))}` : ""}. Aplicar ou Relógio real troca e tira da URL.</p>` : ""}
      <div class="row"><input type="text" id="dv-agora" value="${simVal}" placeholder="AAAA-MM-DD HH:mm" autocomplete="off" spellcheck="false" pattern="\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}" aria-describedby="dv-agora-h" size="16"></div><p id="dv-agora-h">Formato <code>AAAA-MM-DD HH:mm</code>, hora de 0 a 23. Exemplo: <code>2026-11-03 06:10</code>.</p><div class="row"><button class="btn" id="dv-agora-ok">Aplicar</button><button class="btn" id="dv-agora-x">Relógio real</button></div>
    </fieldset>
    <fieldset><legend>Gerar arquivo criptografado</legend>
      <p>Cifra os dados carregados com uma senha, no mesmo formato do <code>cfmaster.py</code>, e baixa o arquivo <code>dados</code>. Útil para testar a tela de senha.</p>
      <div class="row"><input type="password" id="dv-gsenha" placeholder="Senha"><button class="btn" id="dv-gerar" ${S.dados ? "" : "disabled"}>Gerar e baixar</button></div>
    </fieldset>
    <div class="msg" id="dv-msg" role="status"></div>
    <div class="row"><button class="btn" id="dv-limpar">Voltar aos dados publicados</button><button class="btn" id="dv-fechar" style="margin-left:auto">Fechar</button></div>
  </div>`;
  document.body.appendChild(el);
  const $ = (id) => el.querySelector("#" + id);
  const msg = (t) => { $("dv-msg").textContent = t; };
  const fechar = () => el.remove();
  el.addEventListener("click", (e) => { if (e.target === el) fechar(); });
  $("dv-fechar").onclick = fechar;
  // Enquanto vale a simulação da URL, guarda a que já estava guardada (a da URL não fica).
  const salvarDev = () => {
    const agora = S.simDaUrl ? S.agoraSalvo : (S.agoraSim ? S.agoraSim.toISOString() : null);
    S.agoraSalvo = agora;
    return A.gravarBruto("dev", { dados: S.dados, checkins: S.checkins, agora }).catch(() => {});
  };
  $("dv-arq").onchange = async (e) => {
    try {
      const nomes = [];
      for (const f of e.target.files) {
        const buf = new Uint8Array(await f.arrayBuffer());
        let obj;
        if (C.ehCriptografado(buf)) {
          const h = C.lerCabecalho(buf);
          const s = $("dv-senha").value;
          const chave = s ? await C.derivarChave(s, h.salt, h.iter) : (S.chave && C.mesmoSalt(h.salt, S.chave.salt) ? S.chave.chave : null);
          if (!chave) throw new Error(`${f.name}: digite a senha para abrir o arquivo criptografado.`);
          obj = await C.decriptar(buf, chave);
        } else obj = JSON.parse(new TextDecoder().decode(buf));
        if (ehDados(obj)) { S.dados = null; usarDados(obj, "dev"); }
        else if (ehCheckins(obj)) { if (!S.dados) throw new Error("Carregue os dados antes dos check-ins."); usarCheckins(obj); S.origem = "dev"; }
        else throw new Error(`${f.name}: formato "${obj.formato}" desconhecido.`);
        nomes.push(f.name);
      }
      await salvarDev();
      S.ui.sel = null; render();
      msg(`Carregado: ${nomes.join(", ")}`);
    } catch (err) { msg(err.message || String(err)); }
  };
  $("dv-agora-ok").onclick = async () => {
    const v = $("dv-agora").value.trim(); if (!v) return;
    const d = lerSim(v);
    if (!d) { msg(`"${v}" não está no formato AAAA-MM-DD HH:mm (ex.: 2026-11-03 06:10).`); return; }
    S.agoraSim = d; esquecerSimUrl(); if (IX) { S.ui.dia = diaPadrao(); S.ui.off = 0; }
    if (S.origem === "dev") await salvarDev();
    el.querySelector(".dv-url")?.remove();
    render(); msg(`Simulando ${fmtSim(d)}`);
  };
  $("dv-agora-x").onclick = async () => { S.agoraSim = null; esquecerSimUrl(); el.querySelector(".dv-url")?.remove(); if (IX) { S.ui.dia = diaPadrao(); S.ui.off = 0; } if (S.origem === "dev") await salvarDev(); render(); msg("Usando o relógio do aparelho"); };
  $("dv-gerar").onclick = async () => {
    const s = $("dv-gsenha").value; if (!s) { msg("Digite uma senha."); return; }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const chave = await C.derivarChave(s, salt, 310000);
    const out = await C.encriptar(S.dados, chave, salt, 310000);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([out], { type: "application/octet-stream" }));
    a.download = "dados"; a.click(); URL.revokeObjectURL(a.href);
    msg(`Arquivo dados gerado (${out.length} bytes).`);
  };
  $("dv-limpar").onclick = async () => { await A.apagar("dev"); location.reload(); };
}

// ---------- PWA: instalação, funcionamento offline e atualização ----------
const PWA = {
  prompt: null,
  instalado: matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
  ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  atualizacao: null,   // service worker novo esperando
};
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); PWA.prompt = e; if (S.ui.menu) render(); });
window.addEventListener("appinstalled", () => { PWA.prompt = null; PWA.instalado = true; toast("App instalado"); });
async function instalar() {
  if (!PWA.prompt) return;
  PWA.prompt.prompt();
  const r = await PWA.prompt.userChoice.catch(() => null);
  PWA.prompt = null; S.ui.menu = false;
  if (r && r.outcome === "accepted") PWA.instalado = true;
  render();
}
function atualizarApp() {
  if (PWA.atualizacao) PWA.atualizacao.postMessage("pular-espera");
  else location.reload();
}
if ("serviceWorker" in navigator && (location.protocol === "https:" || M.LOCAL)) {
  let recarregando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!recarregando && PWA.atualizacao) { recarregando = true; location.reload(); } });
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      const avisar = (w) => { PWA.atualizacao = w; if (S.tela === "app") toast("Versão nova do app: abra o menu e toque em Atualizar"); };
      if (reg.waiting && navigator.serviceWorker.controller) avisar(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) avisar(w); });
      });
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    } catch { /* sem service worker: o app funciona, só não abre offline */ }
  });
}

iniciar();
