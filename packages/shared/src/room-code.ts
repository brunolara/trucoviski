/* ------------------------------------------------------------------ */
/*  Código de sala: duas palavras pt-BR (estilo LocalSend)             */
/* ------------------------------------------------------------------ */

/** Substantivos e adjetivos pt-BR, minúsculos, sem acento e sem hífen. */
export const SUBSTANTIVOS = [
  "morango",
  "abacaxi",
  "pandeiro",
  "violao",
  "cafe",
  "feijao",
  "pao",
  "queijo",
  "bolo",
  "suco",
  "gato",
  "cachorro",
  "papagaio",
  "tucano",
  "capivara",
  "tamandua",
  "onca",
  "arara",
  "jacare",
  "peixe",
  "chapeu",
  "chinelo",
  "tambor",
  "flauta",
  "berimbau",
  "cuia",
  "fogao",
  "panela",
  "prato",
  "copo",
  "mesa",
  "cadeira",
  "janela",
  "porta",
  "telhado",
  "quintal",
  "varanda",
  "jardim",
  "camarao",
  "milho",
  "mandioca",
  "banana",
  "goiaba",
  "manga",
  "caju",
  "pitanga",
  "samba",
  "forro",
  "frevo",
  "baiao",
  "pipoca",
  "coxinha",
  "pastel",
  "tapioca",
  "beiju",
  "canjica",
  "pamonha",
  "cuscuz",
  "brigadeiro",
  "acaraje",
] as const;

export const ADJETIVOS = [
  "exemplar",
  "veloz",
  "tranquilo",
  "esperto",
  "valente",
  "calmo",
  "alegre",
  "serio",
  "bravo",
  "manso",
  "dourado",
  "prateado",
  "vermelho",
  "amarelo",
  "azul",
  "verde",
  "roxo",
  "branco",
  "preto",
  "cinza",
  "grande",
  "pequeno",
  "alto",
  "baixo",
  "largo",
  "fino",
  "grosso",
  "macio",
  "firme",
  "leve",
  "rapido",
  "lento",
  "forte",
  "fraco",
  "novo",
  "velho",
  "fresco",
  "quente",
  "frio",
  "doce",
  "salgado",
  "azedo",
  "amargo",
  "suave",
  "ruidoso",
  "silencioso",
  "claro",
  "escuro",
  "limpo",
  "redondo",
  "quadrado",
  "liso",
  "brilhante",
  "opaco",
  "solto",
  "preso",
  "livre",
  "ocupado",
  "quieto",
  "miudo",
] as const;

/** "morango-exemplar". `rand(n)` devolve inteiro em [0, n). */
export function generateRoomCode(
  rand: (maxExclusive: number) => number = (n) => Math.floor(Math.random() * n),
): string {
  const noun = SUBSTANTIVOS[rand(SUBSTANTIVOS.length)] ?? SUBSTANTIVOS[0];
  const adj = ADJETIVOS[rand(ADJETIVOS.length)] ?? ADJETIVOS[0];
  return `${noun}-${adj}`;
}

/** "morango-exemplar" → "morango exemplar" (exibição). */
export function formatRoomCode(code: string): string {
  return code.replaceAll("-", " ");
}

/** "  Morangô Exemplar " → "morango-exemplar" (entrada do usuário e URL). */
export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
