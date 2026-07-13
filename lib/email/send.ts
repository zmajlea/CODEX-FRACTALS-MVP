type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export async function sendTransactionalEmail(
  input: SendEmailInput
): Promise<{ ok: boolean; devLogged?: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.info("[email] RESEND_API_KEY missing — dev log only:", {
      to: input.to,
      subject: input.subject,
    });
    return { ok: true, devLogged: true };
  }

  const from =
    process.env.RESEND_FROM_EMAIL ??
    "Business Continuity Navigator <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[email] Resend error:", res.status, body);
    return { ok: false };
  }

  return { ok: true };
}
