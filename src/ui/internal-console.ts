import type { AuditLogEntry, ReviewItem } from "../domain/types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderInternalConsole(input: { reviews: ReviewItem[]; audits: AuditLogEntry[] }): string {
  const reviews = input.reviews
    .map(
      (item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.candidate.title)}</td><td>${escapeHtml(item.candidate.content)}</td></tr>`
    )
    .join("");

  const audits = input.audits
    .map(
      (item) => `<tr><td>${escapeHtml(item.createdAt)}</td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.resourceType)}</td><td>${escapeHtml(item.resourceId)}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>CognusNet Internal Console</title>
    <style>
      body { font-family: ui-sans-serif, sans-serif; background: #f7f3eb; color: #181714; padding: 24px; }
      section { background: #fffdf9; border: 1px solid #ddd3c4; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 10px; border-bottom: 1px solid #ece4d8; text-align: left; vertical-align: top; }
      th { text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em; color: #6d675d; }
    </style>
  </head>
  <body>
    <h1>CognusNet Internal Console</h1>
    <section>
      <h2>Pending Review</h2>
      <table>
        <thead><tr><th>ID</th><th>Reason</th><th>Title</th><th>Content</th></tr></thead>
        <tbody>${reviews || "<tr><td colspan='4'>No pending review items</td></tr>"}</tbody>
      </table>
    </section>
    <section>
      <h2>Audit Log</h2>
      <table>
        <thead><tr><th>Created</th><th>Action</th><th>Type</th><th>Resource</th></tr></thead>
        <tbody>${audits || "<tr><td colspan='4'>No audit entries</td></tr>"}</tbody>
      </table>
    </section>
  </body>
</html>`;
}
