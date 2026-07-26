/* ------------------------------------------------------------------ */
/*  Pool de nomes para bots e gerador de nickname do jogador           */
/* ------------------------------------------------------------------ */

export const NICKNAME_MAX_LENGTH = 32;

export const PLAYER_NAMES = [
  // Lara Croft + atores americanos famosos
  "Lara Croft",
  "Tom Hanks",
  "Leonardo DiCaprio",
  "Brad Pitt",
  "Johnny Depp",
  "Robert Downey Jr.",
  "Chris Evans",
  "Chris Hemsworth",
  "Chris Pratt",
  "Ryan Reynolds",
  "Ryan Gosling",
  "Keanu Reeves",
  "Denzel Washington",
  "Morgan Freeman",

  // League of Legends
  "Ahri",
  "Yasuo",
  "Lux",
  "Garen",
  "Teemo",
  "Jinx",
  "Vi",
  "Caitlyn",
  "Ashe",
  "Zed",
  "Lee Sin",
  "Thresh",
  "Darius",
  "Riven",
  "Ezreal",
  "Katarina",
  "Morgana",
  "Kayle",
  "Veigar",
  "Braum",

  // Chaves
  "Chaves",
  "Seu Madruga",
  "Dona Florinda",
  "Quico",
  "Chiquinha",
  "Professor Girafales",
  "Seu Barriga",
  "Nhonho",
  "Dona Clotilde",
  "Jaiminho",
  "Popis",
  "Godinez",

  // Corinthians 2015
  "Cássio",
  "Fagner",
  "Felipe",
  "Gil",
  "Uendel",
  "Ralf",
  "Elias",
  "Renato Augusto",
  "Jadson",
  "Malcom",
  "Vagner Love",
  "Danilo",
  "Luciano",
  "Tite",

  // Eu, a Patroa e as Crianças
  "Michael Kyle",
  "Jay Kyle",
  "Junior Kyle",
  "Claire Kyle",
  "Kady Kyle",
  "Franklin",
  "Tony",
  "Vanessa Scott",
  "Bobby Shaw",
  "Jasmine",

  // Eleições brasileiras
  "Lula",
  "Jair Bolsonaro",
  "Dilma Rousseff",
  "Fernando Haddad",
  "Aécio Neves",
  "Marina Silva",
  "Ciro Gomes",
  "Geraldo Alckmin",
  "José Serra",
  "Michel Temer",
  "Fernando Henrique Cardoso",
  "Collor",
  "Enéas",
  "Eduardo Leite",
  "Romeu Zema",

  // Televisão brasileira
  "Ratinho",
  "Gugu Liberato",
  "Silvio Santos",
  "Faustão",
  "Luciano Huck",
  "Xuxa",
  "Ana Maria Braga",
  "Celso Portiolli",
  "Carlos Alberto de Nóbrega",
  "Datena",
  "Sonia Abrão",
  "Hebe Camargo",
  "Eliana",
  "Sabrina Sato",
  "Rodrigo Faro",
] as const;

/**
 * Sorteia `count` nomes únicos, evitando os de `exclude`.
 * `rand(n)` deve retornar um inteiro em `[0, n)`.
 */
export function pickUniquePlayerNames(
  count: number,
  exclude: ReadonlySet<string> = new Set(),
  rand: (maxExclusive: number) => number = (n) => Math.floor(Math.random() * n),
): string[] {
  const available: string[] = PLAYER_NAMES.filter((n) => !exclude.has(n));
  const result: string[] = [];

  for (let i = 0; i < count; i++) {
    if (available.length === 0) {
      const fallback = PLAYER_NAMES[rand(PLAYER_NAMES.length)];
      if (fallback !== undefined) result.push(fallback);
      continue;
    }
    const idx = rand(available.length);
    const picked = available.splice(idx, 1)[0];
    if (picked !== undefined) result.push(picked);
  }

  return result;
}

/** Sorteia um nome, evitando os de `exclude` (ex.: nickname atual). */
export function pickRandomPlayerName(
  exclude: ReadonlySet<string> = new Set(),
  rand: (maxExclusive: number) => number = (n) => Math.floor(Math.random() * n),
): string {
  const [name] = pickUniquePlayerNames(1, exclude, rand);
  return name ?? PLAYER_NAMES[0];
}
