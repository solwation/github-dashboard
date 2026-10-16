import { computed, readonly, ref, watch } from "vue";

export type LanguagePreference = "auto" | "sv" | "en";
const storageKey = "issueflow-language";
function storedPreference(): LanguagePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "sv" || saved === "en") return saved;
  } catch {
    /* Language selection works without storage. */
  }
  return "auto";
}
const selected = ref<LanguagePreference>(storedPreference());
const browserLanguage = ref(detectBrowserLanguage());
export function detectBrowserLanguage(
  languages?: readonly string[],
): "sv" | "en" {
  const candidates =
    languages ??
    (typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language]);
  for (const value of candidates) {
    const language = value.toLowerCase().split("-")[0];
    if (language === "sv" || language === "en") return language;
  }
  return "en";
}
export const locale = computed(() =>
  (selected.value === "auto" ? browserLanguage.value : selected.value) === "sv"
    ? "sv-SE"
    : "en-GB",
);
export const english: Record<string, string> = {
  "AI-agenter · GitHub-issues": "AI agents · GitHub issues",
  "DINA AGENTER. DITT FLÖDE.": "YOUR AGENTS. YOUR WORKFLOW.",
  "Följ dina AI-agenter.": "Track your AI agents.",
  "Via GitHub-issues.": "Through GitHub issues.",
  "En samlad överblick över vad agenterna planerar, arbetar med och har slutfört i dina repositories. Fungerar även för issues du arbetar med själv.": "One view of what your agents plan, work on and complete across your repositories. Works with issues you handle yourself, too.",

  "Hämtar och sammanställer statistik": "Fetching and preparing statistics",
  "Vi hämtar underlaget från GitHub. Statistiken visas så snart den är klar.": "We are fetching the source data from GitHub. Statistics will appear as soon as they are ready.",
  "Hämtning avslutad för {done} av {total} repositories.": "Fetching finished for {done} of {total} repositories.",
  "Vänta medan underlaget för {name} hämtas.": "Please wait while source data for {name} is fetched.",
  "Uppdaterar statistik. Tidigare värden visas under tiden.": "Refreshing statistics. Previous values remain visible.",
  "Statistiken kunde inte hämtas just nu. Försök igen senare.": "Statistics could not be fetched right now. Try again later.",

  "Skapat i Backlog": "Created in backlog",
  "Nyligen skapat i Backlog. Markera som läst": "Recently created in Backlog. Mark as read",

  "Synka med QR-kod": "Sync with QR code",
  "På den andra enheten: öppna Inställningar och välj Läs QR-kod, eller välj Logga in med QR-kod om du inte är inloggad. Skanna här för att överföra konto, inställningar och vy åt valfritt håll.": "On the other device, open Settings and choose Read QR code, or choose Sign in with QR code if you are signed out. Scan here to transfer your account, settings and view in either direction.",
  "Alla som skannar koden får din tokens GitHub-behörigheter. Visa den bara för dina egna enheter. Koden innehåller din token.": "Anyone who scans this code receives your token's GitHub permissions. Show it only to your own devices. The code contains your token.",
  "QR-kod för konto och inställningar": "QR code for account and settings",
  "Inställningarna ryms inte i en QR-kod, eller koden kunde inte skapas. Inget har tagits bort eller överförts. Prova med färre valda projekt eller kortare filter och labelinställningar.": "The settings do not fit in a QR code, or the code could not be generated. Nothing has been removed or transferred. Try fewer selected projects or shorter filters and label settings.",
  "Notifikationsval följer med, men kamera, ljud och webbläsarens notifikationsbehörighet gäller lokalt. Läsmarkeringar och kvitterade timeoutvarningar stannar på mottagande enhet.": "Notification preferences transfer, but camera, audio and browser notification permissions remain local. Read markers and acknowledged timeout warnings stay on the receiving device.",
  "QR-koden är ogiltig eller har gått ut. Skapa en ny kod på den andra enheten.": "The QR code is invalid or expired. Generate a new code on the other device.",
  "Läs QR-kod": "Read QR code",
  "Visa en QR-kod i Issueflow på den andra enheten och skanna den här. Konto, inställningar och vy överförs utan att du behöver logga ut först.": "Show a QR code in Issueflow on the other device and scan it here. Your account, settings and view transfer without signing out first.",

  "Välj repositories i översikten för att se deras statistik.": "Select repositories in Overview to see their statistics.",

  "{count} aktiva": "{count} active",
  "{count} aktiva projekt. {definition}": "{count} active projects. {definition}",
  "Aktiva projekt har minst ett issue i Backlog eller In progress, eller ett issue stängt under de senaste 30 dagarna. Dolda koordinationsärenden räknas inte. Fritextfilter påverkar inte antalet.": "Active projects have at least one issue in Backlog or In progress, or an issue closed in the last 30 days. Hidden coordination issues are excluded. Text filters do not affect this count.",

  "Ange ett heltal mellan 1 och 10080 minuter.": "Enter a whole number between 1 and 10080 minutes.",
  "Tidsgräns för pågående issues (minuter)": "In progress issue timeout (minutes)",
  "Efter tidsgränsen markeras pågående issues som problematiska. Okänd starttid ger ingen varning. Standard: 30 minuter.": "Issues in progress are flagged after this limit. An unknown start time never triggers a warning. Default: 30 minutes.",
  "Timeout: pågående i {duration}, över gränsen {minutes} min.": "Timeout: in progress for {duration}, exceeding the {minutes} min limit.",
  "Ignorera timeout för #{number}": "Ignore timeout for #{number}",
  "Ignorera timeout": "Ignore timeout",
  "Timeout för {repo} #{number}: {title}": "Timeout for {repo} #{number}: {title}",
  "Timeout för pågående issue": "In progress issue timeout",

  "Issues, etiketter, kommentarer och tid i pågående arbete. Statistik över issueflödet.": "Issues, labels, comments and time in progress. Issue activity statistics.",
  "Commitdetaljer och tillagd eller borttagen kod. Statistik över commits och kodändringar.": "Commit details and added or deleted code. Commit and code change statistics.",
  "Information om sammanslagna pull requests och deras koppling till stängda issues. Statistik över pull requests.": "Merged pull request information and links to closed issues. Pull request statistics.",
  "Statistik": "Statistics",
  "DITT ARBETE I SIFFROR": "YOUR WORK IN NUMBERS",
  "De senaste 30 dagarna, repository för repository.": "The last 30 days, repository by repository.",
  "Uppdatera statistik": "Refresh statistics",
  "Demostatistiken visar fiktiva data.": "Demo statistics use fictional data.",
  "Välj upp till fem repositories för att jämföra.": "Select up to five repositories to compare.",
  "Från datum (UTC)": "From date (UTC)",
  "Till datum (UTC)": "To date (UTC)",
  "Nuvarande label": "Current label",
  "Alla labels": "All labels",
  "Bidragsgivare": "Contributors",
  "Alla bidragsgivare": "All contributors",
  "{count} repositories valda": "{count} repositories selected",
  "Återställ filter": "Reset filters",
  "Hämtar statistik…": "Loading statistics…",
  "Statistiken kunde inte uppdateras helt. Tidigare hämtade värden visas där de finns. Försök igen senare.": "Statistics could not be fully refreshed. Previously collected values are shown where available. Try again later.",
  "Välj ett giltigt datumintervall inom de senaste 30 dagarna.": "Choose a valid date range within the last 30 days.",
  "Kalenderdagar i UTC. Dagens värden är preliminära.": "Calendar days in UTC. Today's values are provisional.",
  "Äldsta underlaget hämtat {time}": "Oldest source collected {time}",
  "Delvis data: markerade värden omfattar det underlag som hann hämtas inom sidans gränser. De är inte fullständiga totalsummor.": "Partial data: marked values cover the records collected within this page's limits. They are not complete totals.",
  "Delvis data": "Partial data",
  "Stängda issues": "Closed issues",
  "Skapade issues": "Created issues",
  "Återöppnade issues": "Reopened issues",
  "Nettoförändring av issues": "Net issue flow",
  "Commits": "Commits",
  "Tillagda rader": "Lines added",
  "Borttagna rader": "Lines deleted",
  "Nettoförändring av kod": "Net line change",
  "Filändringar": "File changes",
  "Öppnade pull requests": "Opened pull requests",
  "Mergade pull requests": "Merged pull requests",
  "Stängda pull requests utan merge": "Pull requests closed without merging",
  "Medianålder vid stängning": "Median age at closure",
  "dagar": "days",
  "Daglig aktivitet": "Daily activity",
  "Mätvärde": "Metric",
  "Jämför repositories": "Compare repositories",
  "{metric} per repository": "{metric} by repository",
  "Commits och kodändringar per författare": "Commits and code changes by author",
  "Författare": "Author",
  "Okänd författare": "Unknown author",
  "Labels på skapade issues": "Labels on created issues",
  "Definitioner och datatäckning": "Definitions and data coverage",
  "Stängda och återöppnade issues räknas från faktiska GitHub-händelser. Samma issue kan stängas flera gånger. Nettoflöde = skapade + återöppnade − stängda; detta är förändringen, inte antalet öppna issues.": "Closed and reopened issues are counted from actual GitHub events. An issue can close more than once. Net flow = created + reopened − closed; this is the change, not the number of open issues.",
  "Labels avser dagens labels, även när äldre händelser filtreras. Bidragsgivare avser skaparen för issues och pull requests, aktören för issue-händelser och författaren för commits. Ett labelfilter döljer kodstatistik eftersom commits inte har issue-labels.": "Labels refer to current labels, including when filtering historical events. Contributors mean the creator for issues and pull requests, the actor for issue events and the author for commits. A label filter hides code statistics because commits do not have issue labels.",
  "Commits följer standardbranchens historik och grupperas efter committer-datum i UTC. Merge-commits räknas som commits men deras diff undantas från kodmåtten för att undvika dubbelräkning. Filändringar är summan av berörda filer per commit, inte unika filer i perioden.": "Commits follow the default branch history and are grouped by committer date in UTC. Merge commits count as commits but their diffs are excluded from code metrics to avoid double counting. File changes sum the files touched in each commit, rather than unique files across the period.",
  "Medianålder vid stängning mäter tiden från skapande till varje stängningshändelse i urvalet, inte aktiv arbetstid. Pull requests räknas separat efter skapande, merge och stängning utan merge.": "Median age at closure measures the time from creation to each closing event in the selection, rather than active work time. Pull requests are counted separately by creation, merge and closure without merging.",
  "Per repository hämtas högst 300 uppdaterade issues, 500 issue-händelser, 300 commits och 300 pull requests. Kodmått omfattar högst 60 vanliga commits och 300 filer per commit. Begränsade källor markeras som delvis data. Underlaget återanvänds i fem minuter; Uppdatera hämtar igen.": "Each repository fetches at most 300 updated issues, 500 issue events, 300 commits and 300 pull requests. Code metrics cover up to 60 non-merge commits and 300 files per commit. Capped sources are marked as partial data. Sources are reused for five minutes; Refresh fetches them again.",
  "Vid jämförelse visas kombinerade mätvärden endast när motsvarande underlag finns för alla valda repositories. Byt till ett enskilt repository för dess egna mätvärden.": "Comparisons show combined metrics only when the corresponding source is available for every selected repository. Select a single repository to see its own metrics.",
  "Ingen statistik att visa": "No statistics to show",
  "Det finns inget tillgängligt statistikunderlag för urvalet.": "No statistics source is available for this selection.",
  "Välj ett repository för att se statistik.": "Select a repository to see statistics.",
  "Dag i diagrammet": "Chart day",
  "Visa dagliga värden": "Show daily values",
  "Datum (UTC)": "Date (UTC)",
  "Publik läsåtkomst": "Public read access",
  "ISSUEFLOW.md är en guide för dig och din AI-assistent. Den beskriver hur status, prioritet och labels på GitHub-issues används i dashboarden. Läs guiden här, eller kopiera hänvisningen till assistenten och följ instruktionerna i ditt projekt.": "ISSUEFLOW.md is a guide for you and your AI assistant. It explains how GitHub issue status, priority and labels are used in the dashboard. Read the guide here, or copy the reference for your assistant and follow the instructions in your project.",
  "Översikt över GitHub-rättigheter": "GitHub permissions overview",
  "Rättighet": "Permission",
  "Funktioner i dashboarden": "Dashboard features",
  "Åtkomst per repository": "Access by repository",
  "+{count} idag": "+{count} today",
  "Inlästa issues i valda repositories som nu är stängda och har senaste stängning idag, i din lokala tidszon. Fritextfilter påverkar inte dagsuppgiften. Detta är inte en komplett historik över stängningar.": "Loaded issues in selected repositories that are currently closed and were last closed today in your local time zone. Text filters do not affect this daily count. This is not a complete history of closure events.",
  "inlästa issues": "loaded issues",
  "Kontrollerar rättigheter…": "Checking permissions…",
  "Uppdatera kontrollen": "Refresh check",
  "Läsrättigheter styr vilka funktioner du kan använda. Saknad åtkomst döljer motsvarande information. Kontrollen ändrar ingenting på GitHub.": "Read permissions determine the features you can use. Unavailable information is hidden when access is missing. This check makes no changes on GitHub.",
  "Kontrollen gäller valda repositories. GitHub visar inte en fullständig lista över tokenens tilldelade rättigheter. Repositoryurval och organisationsregler kan också begränsa åtkomsten.": "This check covers selected repositories. GitHub does not expose a complete list of the token’s assigned permissions. Repository selection and organization rules may also restrict access.",
  "Logga in för att kontrollera GitHub-rättigheter.": "Sign in to check GitHub permissions.",
  "Välj minst ett repository för att kontrollera åtkomsten.": "Select at least one repository to check access.",
  "Läs": "Read",
  "Åtkomst bekräftad": "Access confirmed",
  "Åtkomst saknas": "Access missing",
  "Ej verifierad": "Not verified",
  "{count} saknade GitHub-rättigheter": "{count} missing GitHub permissions",
  "Repositorynamn, beskrivning och grundinformation.": "Repository names, descriptions and basic information.",
  "Issues, etiketter, kommentarer och tid i pågående arbete.": "Issues, labels, comments and time spent in progress.",
  "Commitdetaljer och tillagd eller borttagen kod.": "Commit details and added or deleted code.",
  "Information om sammanslagna pull requests och deras koppling till stängda issues.": "Merged pull request information and links to closed issues.",
  "Bekräftad läsåtkomst till detta privata repository. Detta visar faktisk åtkomst, inte tokenens exakta tilldelning.": "Read access to this private repository is confirmed. This shows effective access, rather than the token’s exact permission assignment.",
  "Publika data kan läsas utan denna tilldelade rättighet. Tokenens rättighet är därför inte verifierad.": "Public data can be read without this assigned permission. The token’s permission is therefore not verified.",
  "GitHub nekar uttryckligen tokenens åtkomst. Kontrollera rättighet, repositoryurval och organisationens regler.": "GitHub explicitly denies access for this token. Check the permission, repository selection and organization rules.",
  "Åtkomsten kan inte verifieras ännu. Nätverksfel, API-gränser och otydliga svar räknas inte som saknade rättigheter.": "Access cannot be verified yet. Network errors, API limits and ambiguous responses do not count as missing permissions.",
  "Ljud kunde inte aktiveras. Klicka eller tryck på en tangent i dashboarden för att försöka igen. Notiser fungerar fortfarande.": "Sound could not be enabled. Click or press a key in the dashboard to try again. Notifications still work.",
  "Notiser på för {repo}. Statusändringar spelar ljud och nya stängningar meddelas medan dashboarden är öppen. Webbläsaren kan fördröja uppdateringar i bakgrunden.": "Notifications enabled for {repo}. Status changes play sounds and new closures are announced while the dashboard is open. The browser may delay background updates.",
  "Filtrera issues i {name}": "Filter issues in {name}",
  "Rensa filtret för {name}": "Clear filter for {name}",
  "Rensa": "Clear",
  "Inga issues i {name} matchar filtren.": "No issues in {name} match the filters.",
  "Inga issues matchar filtren": "No issues match the filters",
  "Visa max work items per kolumn": "Maximum work items shown per column",
  "Ärv global inställning ({count})": "Inherit global setting ({count})",
  "Antal som visas först. Visa fler visar nästa omgång; kolumnens antal omfattar alla work items.": "Number shown initially. Show more reveals the next batch; column totals include all work items.",
  "Lämna tomt för att ärva den globala inställningen ({count}).": "Leave empty to inherit the global setting ({count}).",
  "Ange ett heltal mellan 1 och 100.": "Enter a whole number between 1 and 100.",
  "Logga in för att spara inställningen för ditt konto, eller prova i demoläget.": "Sign in to save this setting for your account, or try it in demo mode.",
  "Ordna {name}": "Reorder {name}",
  "Ordna {name} med piltangenterna upp och ned, eller dra": "Reorder {name} with up and down arrow keys, or drag",
  "Dra för att ordna. Använd upp- och nedpilarna med tangentbordet.": "Drag to reorder. Use the up and down arrow keys on the keyboard.",
  "Flytta {name} upp": "Move {name} up",
  "Flytta {name} ned": "Move {name} down",
  "{name} flyttad till plats {position} av {total}": "{name} moved to position {position} of {total}",
  "Expandera {name}": "Expand {name}",
  "Kollapsa {name}": "Collapse {name}",
  "Sammanfattning för {name}": "Summary for {name}",
  "Okänd stängningstid": "Unknown closure time",
  "1 sekund sedan": "1 second ago",
  "{seconds} sekunder sedan": "{seconds} seconds ago",
  "{minutes} min sedan": "{minutes} min ago",
  "{hours}h {minutes} min sedan": "{hours}h {minutes} min ago",
  "Stängd {time}": "Closed {time}",
  "För commit-information i privata projekt behövs även läsrättighet till Contents och Pull requests.":
    "For commit information in private projects, also grant read access to Contents and Pull requests.",
  "Läs mer": "Read more",
  "Visa mindre": "Show less",
  "{count} kommentarer": "{count} comments",
  Beskrivning: "Description",
  "Ingen beskrivning har lagts till.": "No description has been added.",
  "Slutförd uppgift": "Completed task",
  "Ej slutförd uppgift": "Incomplete task",
  "Kontrollera att tokenen har läsrättighet till Contents och Pull requests för commit-information.":
    "Check that your token has read access to Contents and Pull requests for commit information.",
  " · adaptiv synk": " · adaptive sync",
  "Pågående ärenden kontrolleras var 15:e sekund; projekt synkas mer sällan.":
    "Active issues are checked every 15 seconds; projects are reconciled less frequently.",
  "En ny version av Issueflow finns tillgänglig.":
    "A new version of Issueflow is available.",
  "Uppdaterar automatiskt om {seconds} sekunder.":
    "Updating automatically in {seconds} seconds.",
  "Uppdateringen kunde inte aktiveras. Försök igen.":
    "The update could not be activated. Try again.",
  "Du är offline. Uppdateringen fortsätter när anslutningen är tillbaka.":
    "You are offline. The update will continue when your connection returns.",
  "Det gick inte att kontrollera uppdateringen. Försök igen.":
    "Could not check the update. Try again.",
  "Hämtar stängande commit…": "Loading closing commit…",
  "Mergad PR #{number}": "Merged PR #{number}",
  "Stängande commit": "Closing commit",
  "Ändrade rader": "Changed lines",
  "Ingen stängande commit kopplad": "No closing commit linked",
  "Stängande commit kunde inte hämtas.": "Could not load the closing commit.",
  "Försök igen": "Try again",
  "Senaste ändring: {time}": "Last change: {time}",
  "Ingen registrerad aktivitet": "No recorded activity",
  "Nyligen ändrat": "Recently changed",
  "Backlog: {count}": "Backlog: {count}",
  "Pågående: {count}": "In progress: {count}",
  "Stängda senaste 30 dagarna: {count}": "Closed in the last 30 days: {count}",
  "Stängda senaste 30 dagarna": "Closed in the last 30 days",
  Mobil: "Mobile",
  "Återställer sparad inloggning…": "Restoring saved sign-in…",
  "Issueflow startsida": "Issueflow home",
  Översikt: "Overview",
  "Välj repositories": "Choose repositories",
  "Dina projekt börjar här.": "Your projects start here.",
  "Byggt för ditt flöde": "Built for your workflow",
  "Drivs av GitHub Issues": "Powered by GitHub Issues",
  "GitHub anslutet": "GitHub connected",
  Demoläge: "Demo mode",
  "Ej ansluten": "Not connected",
  "Logga ut": "Sign out",
  "Till inloggning": "Back to sign in",
  "Stäng notismeddelande": "Dismiss notification message",
  "Stäng felmeddelande": "Dismiss error message",
  "MINDRE LETANDE. MER FRAMÅT.": "LESS SEARCHING. MORE PROGRESS.",
  "Alla dina projekt.": "All your projects.",
  "Ett tydligt flöde.": "One clear workflow.",
  "Från första idén till sista fixen. Följ dina GitHub-issues i en samlad vy som anpassar sig efter hur du jobbar.":
    "From the first idea to the final fix. Follow your GitHub issues in one view that adapts to how you work.",
  "Logga in med GitHub": "Sign in with GitHub",
  "Anslut GitHub": "Connect GitHub",
  "Utforska en demo": "Explore a demo",
  "Dina issues hämtas direkt från GitHub. Inga projektdata sparas på en server.":
    "Your issues are fetched directly from GitHub. No project data is stored on a server.",
  "Använd en fine-grained token med läsrättighet till Issues och Metadata för de repositories du vill följa. Tokenen finns bara i minnet tills du lämnar sidan.":
    "Use a fine-grained token with read access to Issues and Metadata for the repositories you want to follow. The token stays in memory until you leave this page.",
  "Ansluter…": "Connecting…",
  "Anslut konto": "Connect account",
  "Skapa en token": "Create a token",
  "Använd en personal access token": "Use a personal access token",
  "Så fungerar dashboarden": "How the dashboard works",
  "Nästa stora idé": "The next big idea",
  "Något bra är på gång": "Something good is underway",
  "Ännu ett steg framåt": "Another step forward",
  "Prioriterat & redo": "Prioritized & ready",
  "✓ Klart för idag": "✓ Done for today",
  "Ditt nästa steg, i rätt ordning.": "Your next step, in the right order.",
  "Följ arbetet medan det händer.": "Follow work as it happens.",
  "Se vad du har åstadkommit.": "See what you have accomplished.",
  "DITT ARBETE, SAMLAT": "YOUR WORK, TOGETHER",
  Projektöversikt: "Project overview",
  "Från backlog till klart. Håll koll på vad som rör sig.":
    "From backlog to done. Keep track of what is moving.",
  "Hämtar…": "Loading…",
  Uppdatera: "Refresh",
  "Du utforskar en demo med fiktiva projekt. Anslut GitHub för att se dina egna.":
    "You are exploring a demo with fictional projects. Connect GitHub to see your own.",
  Sammanfattning: "Summary",
  "i din översikt": "in your overview",
  "Öppna issues": "Open issues",
  "att ta vidare": "to take forward",
  Pågående: "In progress",
  "just nu": "right now",
  Stängda: "Closed",
  "senaste 30 dagarna": "in the last 30 days",
  "Sök issues": "Search issues",
  "Sök issues, labels eller nummer…": "Search issues, labels or numbers…",
  "Dölj koordinationsärenden": "Hide coordination issues",
  "Uppdaterad ": "Updated ",
  "Väntar på data": "Waiting for data",
  " · varje minut": " · every minute",
  "Hämtar ditt flöde": "Loading your workflow",
  "Issues, labels och starttider hämtas från GitHub.":
    "Fetching issues, labels and start times from GitHub.",
  "Ge dina projekt en plats": "Give your projects a home",
  "Välj vilka repositories du vill följa i din översikt.":
    "Choose which repositories to follow in your overview.",
  Privat: "Private",
  "Notiser för ": "Notifications for ",
  "Stäng av notiser om stängda issues":
    "Turn off notifications for closed issues",
  "Slå på notiser om stängda issues": "Turn on notifications for closed issues",
  Notiser: "Notifications",
  på: "on",
  av: "off",
  "Anpassa labels för ": "Customize labels for ",
  "Anpassa labels": "Customize labels",
  "Tidigare data visas om de finns.": "Previous data is shown when available.",
  "Vissa starttider kunde inte hämtas. Tidräknaren visas när historiken är tillgänglig.":
    "Some start times could not be fetched. The timer appears when the history is available.",
  "Svep för Backlog, In progress och Closed →":
    "Swipe for Backlog, In progress and Closed →",
  "Inget pågående arbete": "No work in progress",
  "Inga stängda issues ännu": "No closed issues yet",
  "Backloggen är tom": "The backlog is empty",
  "Visa fler": "Show more",
  "Dina repositories. Ditt arbetssätt.": "Your repositories. Your workflow.",
  "Fiktiva exempeldata": "Fictional sample data",
  "Läsande vy · ändra issues på GitHub":
    "Read-only view · edit issues on GitHub",
  "DIN ÖVERSIKT": "YOUR OVERVIEW",
  Stäng: "Close",
  "En swimlane per projekt. Ditt val sparas på den här enheten.":
    "One swimlane per project. Your selection is saved on this device.",
  "Sök repositories…": "Search repositories…",
  "Sök repositories": "Search repositories",
  "Ingen beskrivning": "No description",
  "Inga repositories matchar sökningen.": "No repositories match your search.",
  " valda": " selected",
  "Visa översikt": "Show overview",
  "· Lämna tomt för automatisk detektering. Ange exakta labelnamn.":
    "· Leave blank for automatic detection. Enter exact label names.",
  "Pågående arbete": "Work in progress",
  "Hög prioritet": "High priority",
  "Medium prioritet": "Medium priority",
  "Låg prioritet": "Low priority",
  Automatiskt: "Automatic",
  "Gäller bara din vy": "Applies only to your view",
  "Spara och hämta igen": "Save and refresh",
  "Högst prioritet först": "Highest priority first",
  "Tid sedan arbetet startade": "Time since work started",
  "Senaste 30 dagarna · nyast först": "Last 30 days · newest first",
  "Något gick fel. Försök igen.": "Something went wrong. Please try again.",
  "Notiser på för {repo}. Nya stängningar meddelas medan dashboarden är öppen, även i en bakgrundsflik. Webbläsaren kan fördröja uppdateringar i bakgrunden.":
    "Notifications on for {repo}. New closures are announced while the dashboard is open, including in a background tab. Your browser may delay background updates.",
  "Den här webbläsaren stöder inte notiser här. Använd en datorwebbläsare med HTTPS.":
    "This browser does not support notifications here. Use a desktop browser with HTTPS.",
  "Notiser är blockerade. Tillåt notiser för den här webbplatsen i webbläsarens inställningar och försök igen.":
    "Notifications are blocked. Allow notifications for this site in your browser settings and try again.",
  "Notiser aktiverades inte. Du kan försöka igen med klockan vid projektet.":
    "Notifications were not enabled. Try again using the bell beside the project.",
  "Webbläsaren kunde inte aktivera notiser. Kontrollera webbplatsens behörigheter.":
    "Your browser could not enable notifications. Check the site permissions.",
  "Notiser kunde inte visas och har stängts av för {repo}. Kontrollera webbläsarens stöd och behörigheter.":
    "Notifications could not be displayed and have been turned off for {repo}. Check browser support and permissions.",
  "Prioritet: ": "Priority: ",
  hög: "high",
  låg: "low",
  Hög: "High",
  Låg: "Low",
  "Arbetslabel satt ": "Work label applied ",
  "Ingen säker starttid kunde hämtas":
    "No reliable start time could be fetched",
  "Starttid okänd": "Start time unknown",
  Stängd: "Closed",
  "Issue stängd": "Issue closed",
  "GitHub-inloggningen avbröts.": "GitHub sign-in was cancelled.",
  "Inloggningen kunde inte verifieras. Försök igen.":
    "Sign-in could not be verified. Please try again.",
  "GitHub-inloggningen misslyckades. Försök igen.":
    "GitHub sign-in failed. Please try again.",
  "Ogiltig API-adress.": "Invalid API address.",
  "Sessionen har gått ut. Logga in igen.":
    "Your session has expired. Sign in again.",
  "Åtkomst nekad eller API-gräns nådd.": "Access denied or API limit reached.",
  " Försök efter {time}.": " Try again after {time}.",
  " Kontrollera tokenens behörigheter.": " Check your token permissions.",
  "GitHub svarade {status}. Kontrollera att du har åtkomst till repot.":
    "GitHub returned {status}. Check that you have access to the repository.",
  Prioritetslabels: "Priority labels",
  Agentflöde: "Agent workflow",
  Standardflöde: "Standard workflow",
  "Installera app": "Install app",
  "Installera Issueflow": "Install Issueflow",
  "I Chrome eller Edge: använd installationsikonen i adressfältet, eller välj":
    "In Chrome or Edge: use the install icon in the address bar, or select",
  "i webbläsarens meny.": "in your browser menu.",
  "På iPhone och iPad: öppna sidan i Safari, tryck":
    "On iPhone and iPad: open the page in Safari, tap",
  Dela: "Share",
  "och välj": "and choose",
  "Lägg till på hemskärmen": "Add to Home Screen",
  ". På Android finns installation i webbläsarens meny.":
    ". On Android, installation is available in the browser menu.",
  "Installationen öppnar dashboarden i ett eget appfönster. GitHub-data kräver internet; appskalet kan öppnas offline.":
    "Installation opens the dashboard in its own app window. GitHub data requires internet; the app shell can open offline.",
  "Alternativen beror på din webbläsare.": "Options depend on your browser.",
  Klart: "Done",
  Inställningar: "Settings",
  Språk: "Language",
  "Automatiskt (webbläsarens språk)": "Automatic (browser language)",
  Svenska: "Swedish",
  Engelska: "English",
  "Språkvalet sparas på den här enheten.":
    "Your language preference is saved on this device.",
  "Öppna på mobilen": "Open on mobile",
  "Sparat projekt- och issueinnehåll raderas också från appens cache.":
    "Saved repository and issue content is also removed from the app cache.",
  "Visar sparad vy från {time}. Hämtar senaste från GitHub när anslutningen fungerar.":
    "Showing a saved view from {time}. Fetching the latest from GitHub when connected.",
  "okänd tid": "an unknown time",
  "Innehållscachen kunde inte sparas. Översikten fungerar, men nästa start kan behöva hämta innehållet igen.":
    "Content could not be cached. The board still works, but the next launch may need to fetch its content again.",
  "Okänd ålder": "Unknown age",
  "Skapad {age}": "Created {age}",
  "Skapad {time}": "Created {time}",
  "Oläst aktivitet": "Unread activity",
  "Nyligen flyttad. Markera som läst": "Recently moved. Mark as read",
  "Flyttad till {column}": "Moved to {column}",
  "Problemrapport": "Problem report",
  "Visa inte igen": "Don't show again",
  "Commit-information saknas för {count} issues.": "Commit information could not be loaded for {count} issues.",
  "Issues visas som vanligt. Commit-information kan saknas på grund av tokenbehörigheter, API-gränser eller nätverksfel. Kontrollera läsrättighet till Contents och Pull requests om problemet kvarstår.":
    "Issues are shown as usual. Commit information may be unavailable because of token permissions, API limits or network errors. Check read access to Contents and Pull requests if the problem persists.",
  "Rapporten gäller kontrollerade issues i den här sessionen. Ny kontroll görs för synliga kort; övriga kontrolleras när de visas.":
    "This report covers issues checked in this session. Retry checks visible cards; others are checked when shown.",
  "Inga rapporterade problem med commit-information i den här sessionen.":
    "No reported commit information problems in this session.",
  "Visa notiser om problem med commit-information": "Show notifications about commit information problems",
  "Problemrapporten finns alltid här även när notisen är dold. Bara ditt notisval sparas på enheten.":
    "The problem report remains available here even when the notification is hidden. Only your notification preference is saved on this device.",
  "Logga in med QR-kod": "Sign in with QR code",
  "I den installerade appen: välj Logga in med QR-kod och skanna här. Använder du mobilens vanliga kamera öppnas länken i webbläsaren istället.":
    "In the installed app, choose Sign in with QR code and scan here. Using your phone’s regular camera opens the link in the browser instead.",
  "Öppna Issueflow på datorn och välj Öppna på mobilen. Rikta kameran mot QR-koden. Du loggas in direkt i den här appen.":
    "Open Issueflow on your computer and choose Open on mobile. Point the camera at the QR code to sign in directly in this app.",
  "Kameraförhandsvisning": "Camera preview",
  "Kamera och bilder läses bara på din enhet. Inloggningen sparas krypterat i appen.":
    "Camera and images are processed only on your device. Your sign-in is stored encrypted in the app.",
  "Kameran pausades när appen lämnades. Starta den igen för att fortsätta.":
    "The camera was paused when you left the app. Start it again to continue.",
  "Starta kameran": "Start camera",
  "Välj QR-bild": "Choose QR image",
  "Väntar på kameran…": "Waiting for camera…",
  "Söker efter QR-kod…": "Looking for QR code…",
  "Läser QR-bild…": "Reading QR image…",
  "QR-koden är ogiltig eller har gått ut. Skapa en ny kod i Issueflow på datorn.":
    "The QR code is invalid or expired. Create a new code in Issueflow on your computer.",
  "Kameran kunde inte läsa QR-koden. Försök igen eller välj en bild.":
    "The camera could not read the QR code. Try again or choose an image.",
  "Kameraskanning stöds inte här. Välj en QR-bild eller ange PAT manuellt.":
    "Camera scanning is not supported here. Choose a QR image or enter your PAT manually.",
  "Kameraåtkomst nekades. Tillåt kameran i appens inställningar eller välj en QR-bild.":
    "Camera access was denied. Allow the camera in the app settings or choose a QR image.",
  "Kameran kunde inte startas. Försök igen eller välj en QR-bild.":
    "The camera could not start. Try again or choose a QR image.",
  "Ingen QR-kod kunde läsas. Välj en tydlig bild på högst 12 MB.":
    "No QR code could be read. Choose a clear image up to 12 MB.",
  "Skanna QR-koden med mobilens kamera för att öppna Issueflow med samma GitHub-token, projekt och labelinställningar.":
    "Scan the QR code with your phone camera to open Issueflow with the same GitHub token, projects and label settings.",
  "Alla som skannar koden får din tokens GitHub-behörigheter. Visa den bara för din egen mobil. Koden innehåller din token.":
    "Anyone who scans the code gets your token’s GitHub permissions. Show it only to your own phone. The code contains your token.",
  "QR-kod för att logga in på mobilen": "QR code to sign in on mobile",
  "Skapar QR-kod…": "Creating QR code…",
  "QR-koden kunde inte skapas. Prova att välja färre projekt eller färre labelinställningar.":
    "Could not create the QR code. Try selecting fewer projects or label settings.",
  "QR-koden har gått ut. Skapa en ny för att fortsätta.":
    "The QR code has expired. Create a new one to continue.",
  "Koden accepteras i {seconds} sekunder till.":
    "The code is accepted for another {seconds} seconds.",
  "Överföringen accepteras i fem minuter. Den är inte engångsbaserad. Att stänga dialogen tar bort koden här, men återkallar inte din GitHub-token eller kopior av länken.":
    "The transfer is accepted for five minutes. It can be used more than once. Closing this dialog removes the code here, but does not revoke your GitHub token or copies of the link.",
  "Skapa ny QR-kod": "Create new QR code",
  "Logga ut?": "Sign out?",
  "Din sparade GitHub-token (PAT) tas bort från den här webbläsaren när du loggar ut. Du behöver ange den igen nästa gång du loggar in.":
    "Your saved GitHub token (PAT) will be removed from this browser when you sign out. You will need to enter it again the next time you sign in.",
  Avbryt: "Cancel",
  "Logga ut och ta bort token": "Sign out and remove token",
  "Webbläsaren stöder inte säker lagring. Använd en modern webbläsare via HTTPS.":
    "This browser does not support secure storage. Use a modern browser over HTTPS.",
  "Säker lagring är blockerad. Stäng andra flikar med Issueflow och försök igen.":
    "Secure storage is blocked. Close other Issueflow tabs and try again.",
  "Den sparade inloggningen kunde inte läsas. Försök igen.":
    "Could not read the saved sign-in. Please try again.",
  "Inloggningen kunde inte sparas säkert i webbläsaren. Försök igen.":
    "Could not save your sign-in securely in the browser. Please try again.",
  "Den sparade inloggningen kunde inte låsas upp. Logga in igen.":
    "Could not unlock the saved sign-in. Sign in again.",
  "Instruktioner för issueflödet": "Issue workflow instructions",
  "Bygginformation": "Build information",
  "Byggd": "Built",
  "Commit": "Commit",
  "Utvecklingsläge": "Development mode",
  "Okänd commit": "Unknown commit",
  "Kommentarer för #{number}": "Comments for #{number}",
  "Stäng kommentarer": "Close comments",
  "Okänd tid": "Unknown time",
  "Kommentarer visas inte i demon. Anslut GitHub för att läsa dina issuediskussioner.":
    "Comments are not shown in the demo. Connect GitHub to read your issue discussions.",
  "Hämtar kommentarer…": "Loading comments…",
  "Kommentarerna kunde inte hämtas. Kontrollera anslutningen och din åtkomst till repot.":
    "Comments could not be loaded. Check your connection and access to the repository.",
  "Inga kommentarer ännu.": "No comments yet.",
  "Raderad användare": "Deleted user",
  "Visa på GitHub": "View on GitHub",
  "Kommentaren saknar text.": "This comment has no text.",
  "Dela den publika guiden med din AI-assistent eller lägg den i ditt projekt. Ingen inloggning krävs.":
    "Share the public guide with your AI assistant or add it to your project. No sign-in is required.",
  "Hänvisning för din AI-assistent": "Reference for your AI assistant",
  "Läs och följ instruktionerna på {url} när du arbetar med issues i det här projektet.":
    "Read and follow the instructions at {url} when working with issues in this project.",
  "Kopiera hänvisning": "Copy reference",
  "Ladda ned ISSUEFLOW.md": "Download ISSUEFLOW.md",
  "Hänvisningen har kopierats.": "The reference has been copied.",
  "Kopiera den markerade hänvisningen manuellt.": "Copy the selected reference manually.",
  "Ny version tillgänglig": "New version available",
  "Översikten ryms inte i den krypterade cachen. Välj färre repositories och försök igen.":
    "The board exceeds the encrypted cache limit. Select fewer repositories and try again.",
  "Webbläsaren kunde inte komprimera översikten. Uppdatera webbläsaren och försök igen.":
    "The browser could not compress the board. Update your browser and try again.",
  "Webbläsarens lagringsutrymme räcker inte till. Frigör utrymme och försök igen.":
    "The browser does not have enough storage space. Free up space and try again.",
  "Webbläsaren kunde inte skriva till den säkra lagringen. Kontrollera webbplatsens lagringsbehörigheter och försök igen.":
    "The browser could not write to secure storage. Check this site's storage permissions and try again.",
  "Uppdaterar om {seconds} sekunder…": "Updating in {seconds} seconds…",
  "Uppdaterar…": "Updating…",
  "Kunde inte uppdatera. Försök igen.": "Could not update. Please try again.",
  "Använd en fine-grained token med läsrättighet till Issues och Metadata för de repositories du vill följa. Tokenen sparas krypterat i webbläsarens databas (IndexedDB) tills du loggar ut.":
    "Use a fine-grained token with read access to Issues and Metadata for the repositories you want to follow. Your token is stored encrypted in your browser database (IndexedDB) until you sign out.",
};
export function t(
  source: string,
  params: Record<string, string | number> = {},
): string {
  const translated =
    locale.value === "sv-SE" ? source : (english[source] ?? source);
  return translated.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}
export function setLanguage(value: LanguagePreference) {
  selected.value = value;
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    /* Remain usable without storage. */
  }
}
watch(
  locale,
  (value) => {
    if (typeof document !== "undefined")
      document.documentElement.lang = value === "sv-SE" ? "sv" : "en";
  },
  { immediate: true, flush: "sync" },
);
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    browserLanguage.value = detectBrowserLanguage();
  });
}
export function useLanguage() {
  return { t, locale, preference: readonly(selected), setLanguage };
}
