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

export function notifyClosure(repo: Repo, issue: Issue) {
  if (notificationPermission() !== "granted") return;
  const notice = new Notification(`${repo.name} · Issue stängd`, {
    body: `#${issue.number} ${issue.title}`,
    tag: `${repo.full_name}:${issue.id}:${issue.closed_at}`,
    icon: new URL("favicon.svg", document.baseURI).href,
  });
  notice.onclick = () => {
    // Only open GitHub issue links, even if an unexpected payload reaches us.
    const url = new URL(issue.html_url);
    if (url.origin === "https://github.com")
      window.open(url.href, "_blank", "noopener,noreferrer");
    notice.close();
  };
}
