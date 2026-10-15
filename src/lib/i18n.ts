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
  "Ny version tillgänglig": "New version available",
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
