// Atualiza o total de commits nos SVGs e no README usando a API GraphQL do GitHub.
import { readFile, writeFile } from "node:fs/promises";

const LOGIN = process.env.GH_LOGIN ?? "cauandrade123";
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) throw new Error("GH_TOKEN não definido");

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-commit-counter",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);

  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data;
}

// A API só aceita janelas de até um ano, então a soma é feita ano a ano.
async function countCommits() {
  const { user } = await graphql(
    "query ($login: String!) { user(login: $login) { createdAt } }",
    { login: LOGIN },
  );
  if (!user) throw new Error(`Usuário ${LOGIN} não encontrado`);

  const now = new Date();
  const firstYear = new Date(user.createdAt).getUTCFullYear();
  let total = 0;

  for (let year = firstYear; year <= now.getUTCFullYear(); year++) {
    const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    const { user: yearly } = await graphql(
      `query ($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            totalCommitContributions
            restrictedContributionsCount
          }
        }
      }`,
      {
        login: LOGIN,
        from: new Date(Date.UTC(year, 0, 1)).toISOString(),
        to: (end < now ? end : now).toISOString(),
      },
    );
    const c = yearly.contributionsCollection;
    // restricted = contribuições privadas que o token não consegue detalhar.
    total += c.totalCommitContributions + c.restrictedContributionsCount;
  }
  return total;
}

const TARGETS = [
  {
    file: "assets/impact-strip.svg",
    pattern: /(<text[^>]*>)\d+(<\/text>\s*<text[^>]*>COMMITS<\/text>)/,
  },
  {
    file: "assets/stats.svg",
    pattern: /(TOTAL DE COMMITS<\/text>\s*<text[^>]*>)\d+(<\/text>)/,
  },
  { file: "README.md", pattern: /(alt="[^"]*?)\d+( commits,)/ },
];

const total = await countCommits();
if (total <= 0) throw new Error(`Contagem inválida: ${total}`);

// Valida todos os arquivos antes de gravar, para nunca deixar um pela metade.
const updates = await Promise.all(
  TARGETS.map(async ({ file, pattern }) => {
    const before = await readFile(file, "utf8");
    if (!pattern.test(before)) throw new Error(`Contador não encontrado em ${file}`);
    return { file, before, after: before.replace(pattern, `$1${total}$2`) };
  }),
);

for (const { file, before, after } of updates) {
  if (after !== before) await writeFile(file, after);
}

console.log(`Total de commits: ${total}`);
