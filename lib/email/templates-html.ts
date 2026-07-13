import type { EmailBranding, InviteClientEmailProps, TrustedAdvisorEmailProps } from "@/lib/email/types";

function accent(branding: EmailBranding): string {
  return branding.brandColorHex || "#8A1E1A";
}

function emailShell(branding: EmailBranding, body: string): string {
  const color = accent(branding);
  const logo = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="" height="42" style="display:block;margin-bottom:10px;" />`
    : "";
  const footer = branding.firmName ? ` · ${branding.firmName}` : "";
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#e8e4dc;font-family:Georgia,'Times New Roman',serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8e4dc;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fffdf8;border:1px solid #ded9d1;border-radius:8px;overflow:hidden;">
<tr><td style="padding:22px 28px 18px;border-bottom:3px solid ${color};">
${logo}
<div style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:#1a1a1b;line-height:1.25;">${branding.wordmark}</div>
</td></tr>
<tr><td style="padding:28px;color:#262019;font-size:15px;line-height:1.65;">${body}</td></tr>
<tr><td style="padding:16px 28px 24px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8b8374;letter-spacing:0.06em;">
Sent via Business Continuity Navigator${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function inviteClientEmailHtml(input: InviteClientEmailProps): string {
  const color = accent(input.branding);
  const body = `
<p style="margin:0 0 14px;">Hello ${input.clientName},</p>
<p style="margin:0 0 14px;"><strong>${input.firmName}</strong> has invited you to complete a <strong>${input.moduleName}</strong> continuity record.</p>
<p style="margin:0 0 6px;"><a href="${input.inviteUrl}" style="display:inline-block;margin-top:20px;padding:12px 22px;background:${color};color:#fffdf8;text-decoration:none;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;border-radius:4px;">Open your secure invite</a></p>
<p style="margin:18px 0 0;font-size:13px;color:#564e43;">This link is personal to you. If you did not expect this message, you can ignore it.</p>`;
  return emailShell(input.branding, body);
}

export function trustedAdvisorInviteEmailHtml(input: TrustedAdvisorEmailProps): string {
  const body = `
<p style="margin:0 0 14px;">Hello ${input.advisorName},</p>
<p style="margin:0 0 14px;">You have been added as a trusted advisor (<strong>${input.role}</strong>) on a continuity record for <strong>${input.clientName}</strong>.</p>
<p style="margin:0;font-size:13px;color:#564e43;">No financial details are included in this message. Your firm will guide next steps if the continuity protocol is activated.</p>`;
  return emailShell(input.branding, body);
}
