import { t } from "./i18n";
import type { Issue, Repo } from "./model";

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

export async function notifyClosure(repo: Repo, issue: Issue) {
  return notifyIssue(repo, issue, t("Issue stängd"), `${repo.full_name}:${issue.id}:${issue.closed_at}`);
}
export async function notifyTimeout(repo: Repo, issue: Issue) {
  return notifyIssue(repo, issue, t("Timeout för pågående issue"), `timeout:${repo.full_name}:${issue.id}:${issue.startedAt}`);
}
async function notifyIssue(repo: Repo, issue: Issue, description: string, tag: string) {
  if (notificationPermission() !== "granted") return;
  const title = `${repo.name} · ${description}`;
  const options = {
    body: `#${issue.number} ${issue.title}`,
    tag,
    icon: new URL("favicon.svg", document.baseURI).href,
  };
  try {
    const notice = new Notification(title, options);
    notice.onclick = () => {
      const url = new URL(issue.html_url);
      if (url.origin === "https://github.com")
        window.open(url.href, "_blank", "noopener,noreferrer");
      notice.close();
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
      data: { url: issue.html_url },
    });
  }
}
