import type { CSSProperties, ReactNode } from "react";
import type {
  EmailBranding,
  InviteClientEmailProps,
  TrustedAdvisorEmailProps,
} from "@/lib/email/types";

function accent(branding: EmailBranding): string {
  return branding.brandColorHex || "#8A1E1A";
}

function buttonStyle(branding: EmailBranding): CSSProperties {
  const color = accent(branding);
  return {
    display: "inline-block",
    marginTop: 20,
    padding: "12px 22px",
    background: color,
    color: "#fffdf8",
    textDecoration: "none",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    borderRadius: 4,
  };
}

export function EmailShell({
  branding,
  children,
}: {
  branding: EmailBranding;
  children: React.ReactNode;
}) {
  const color = accent(branding);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          background: "#e8e4dc",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ background: "#e8e4dc", padding: "32px 16px" }}
        >
          <tbody>
            <tr>
              <td align="center">
                <table
                  role="presentation"
                  width="600"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: 600,
                    width: "100%",
                    background: "#fffdf8",
                    border: "1px solid #ded9d1",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          padding: "22px 28px 18px",
                          borderBottom: `3px solid ${color}`,
                        }}
                      >
                        {branding.logoUrl ? (
                          <img
                            src={branding.logoUrl}
                            alt=""
                            height={42}
                            style={{ display: "block", marginBottom: 10 }}
                          />
                        ) : null}
                        <div
                          style={{
                            fontFamily: "Georgia, serif",
                            fontSize: 20,
                            fontWeight: 600,
                            color: "#1a1a1b",
                            lineHeight: 1.25,
                          }}
                        >
                          {branding.wordmark}
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          padding: "28px",
                          color: "#262019",
                          fontSize: 15,
                          lineHeight: 1.65,
                        }}
                      >
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          padding: "16px 28px 24px",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10,
                          color: "#8b8374",
                          letterSpacing: "0.06em",
                        }}
                      >
                        Sent via Business Continuity Navigator
                        {branding.firmName ? ` · ${branding.firmName}` : ""}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

export function InviteClientEmail({
  branding,
  clientName,
  firmName,
  moduleName,
  inviteUrl,
}: InviteClientEmailProps) {
  return (
    <EmailShell branding={branding}>
      <p style={{ margin: "0 0 14px" }}>Hello {clientName},</p>
      <p style={{ margin: "0 0 14px" }}>
        <strong>{firmName}</strong> has invited you to complete a{" "}
        <strong>{moduleName}</strong> continuity record.
      </p>
      <p style={{ margin: "0 0 6px" }}>
        <a href={inviteUrl} style={buttonStyle(branding)}>
          Open your secure invite
        </a>
      </p>
      <p style={{ margin: "18px 0 0", fontSize: 13, color: "#564e43" }}>
        This link is personal to you. If you did not expect this message, you can
        ignore it.
      </p>
    </EmailShell>
  );
}

export function TrustedAdvisorInviteEmail({
  branding,
  advisorName,
  role,
  clientName,
}: TrustedAdvisorEmailProps) {
  return (
    <EmailShell branding={branding}>
      <p style={{ margin: "0 0 14px" }}>Hello {advisorName},</p>
      <p style={{ margin: "0 0 14px" }}>
        You have been added as a trusted advisor (<strong>{role}</strong>) on a
        continuity record for <strong>{clientName}</strong>.
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "#564e43" }}>
        No financial details are included in this message. Your firm will guide
        next steps if the continuity protocol is activated.
      </p>
    </EmailShell>
  );
}
