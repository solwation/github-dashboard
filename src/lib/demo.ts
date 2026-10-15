import type { Lane } from "./model";
// Fictional public demo. Never copy private repository data into a Pages build.
export function demo(): Lane[] {
  const now = Date.now();
  return ["design-system", "weekend-project", "personal-website"].map(
    (name, r) => ({
      repo: {
        id: r + 1,
        name,
        full_name: `demo/${name}`,
        private: false,
        html_url: "https://github.com",
        description: [
          "Komponenter som håller ihop helheten.",
          "Små idéer som blir till något större.",
          "En egen plats på internet.",
        ][r]!,
        owner: { login: "demo" },
        language: ["TypeScript", "Vue", "CSS"][r],
      },
      labels: [
        { name: "priority: high", color: "d73a4a" },
        { name: "in-progress", color: "147d69" },
      ],
      issues: Array.from({ length: [8, 5, 4][r]! }, (_, i) => ({
        id: r * 100 + i,
        number: 120 - r * 20 - i,
        title: [
          [
            "Förbättra navigering med tangentbord",
            "Samla färger i gemensamma designtokens",
            "Bygg en sökbar komponentöversikt",
            "Dokumentera knapparnas olika tillstånd",
            "Lägg till stöd för mörkt tema",
            "Justera avstånd på mindre skärmar",
            "Förenkla formulärvalidering",
            "Uppdatera komponentbiblioteket",
          ],
          [
            "Gör startsidan lite mer personlig",
            "Lägg till filtrering efter kategori",
            "Spara favoriter mellan besök",
            "Förbättra laddningstiden",
            "Skapa första prototypen",
          ],
          [
            "Uppdatera projektöversikten",
            "Finjustera mobilnavigationen",
            "Lägg till en kontaktsida",
            "Publicera den nya startsidan",
          ],
        ][r]![i]!,
        html_url: "https://github.com",
        state: i >= [4, 3, 2][r]! ? "closed" : "open",
        created_at: new Date(now - (i + 1) * 86400000).toISOString(),
        updated_at: new Date(now - i * 3600000).toISOString(),
        closed_at:
          i >= [4, 3, 2][r]! ? new Date(now - i * 3600000).toISOString() : null,
        labels: [
          {
            name: `priority: ${i === 0 ? "high" : i === 1 ? "medium" : "low"}`,
            color: "ededed",
          },
          ...(i === 1 ? [{ name: "in-progress", color: "147d69" }] : []),
          {
            name: i % 2 ? "enhancement" : "bug",
            color: i % 2 ? "a2eeef" : "d73a4a",
          },
        ],
        assignees: [],
        startedAt:
          i === 1 ? new Date(now - (r + 1) * 3850000).toISOString() : null,
      })),
    }),
  );
}
