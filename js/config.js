// Configuração do box (white label) e de onde o app busca os dados.
// Para outro box: troque BOX, os arquivos em marca/ e icones/ e o manifest.webmanifest.

export const BOX = {
  nome: "CrossFit Rio Preto",
  logo: "marca/logo.png",          // fundo claro: o app mostra numa moldura branca
};
export const PRODUTO = "CF Master"; // nome do app, mostrado só em segundo plano (rodapé e "sobre")

// Onde o app busca os arquivos criptografados. Caminhos relativos à página.
// No GitHub Pages os dois ficam na raiz do site publicado (cf-master-stg ou cf-master-prd).
export const URL_DADOS = "dados";
export const URL_CHECKINS = "checkins";

// Com que frequência o app confere se os arquivos mudaram (com a tela aberta).
export const CONFERIR_DADOS_MIN = 5;
export const CONFERIR_CHECKINS_MIN = 1;   // perto do horário das aulas
export const JANELA_CHECKINS_MIN = 15;    // "perto" = de 15 min antes do início até o fim da aula
