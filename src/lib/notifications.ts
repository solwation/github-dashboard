import { timeoutDetail } from "./timeouts";
import { t } from "./i18n";
import type { Issue, Repo } from "./model";
import { issueNavigationHash } from "./issue-navigation";

/** Called when the user clicks a page notification; the app shows the issue on its board (#278). */
export type NotificationSelect = (repo: Repo, issue: Issue) => void;

export function notificationPermission():
  NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" || !window.isSecureContext
    ? "unsupported"
    : Notification.permission;
}

export async function requestNotifications(): Promise<
  NotificationPermission | "unsupported"
> {
  const permission = notificationPermission();
  return permission === "default"
    ? Notification.requestPermission()
    : permission;
}

export async function notifyClosure(repo: Repo, issue: Issue, onSelect?: NotificationSelect) {
  return notifyIssue(repo, issue, t("Issue stängd"), `${repo.full_name}:${issue.id}:${issue.closed_at}`, undefined, onSelect);
}
export async function notifyTimeout(repo: Repo, issue: Issue, estimatedMs: number, percent: number, onSelect?: NotificationSelect) {
  return notifyIssue(repo, issue, t("Estimatet för pågående arbete har överskridits"), `timeout:${repo.full_name}:${issue.id}:${issue.startedAt}`, timeoutDetail(issue, estimatedMs, percent, Date.now()), onSelect);
}
async function notifyIssue(repo: Repo, issue: Issue, description: string, tag: string, detail?: string, onSelect?: NotificationSelect) {
  if (notificationPermission() !== "granted") return;
  const title = `${repo.name} · ${description}`;
  const options = {
    body: `#${issue.number} ${issue.title}${detail ? "\n" + detail : ""}`,
    tag,
    icon: new URL("favicon.svg", document.baseURI).href,
  };
  try {
    const notice = new Notification(title, options);
    notice.onclick = () => {
      notice.close();
      if (onSelect) {
        // Bring this dashboard tab forward and show the issue on its board (#278).
        window.focus();
        onSelect(repo, issue);
        return;
      }
      const url = new URL(issue.html_url);
      if (url.origin === "https://github.com")
        window.open(url.href, "_blank", "noopener,noreferrer");
    };
  } catch (error) {
    // Installed/mobile browsers may require service-worker notifications.
    const registration =
      "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistration(
            new URL("./", document.baseURI).href,
          )
        : null;
    if (!registration?.active) throw error;
    await registration.showNotification(title, {
      ...options,
      // The worker focuses this app and opens the issue's board position from the hash (#278).
      data: { app: new URL("./" + issueNavigationHash({ repoId: repo.id, number: issue.number }), document.baseURI).href, url: issue.html_url },
    });
  }
}
