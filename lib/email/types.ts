export type EmailBranding = {
  wordmark: string;
  logoUrl: string | null;
  brandColorHex: string;
  firmName?: string;
};

export type InviteClientEmailProps = {
  branding: EmailBranding;
  clientName: string;
  firmName: string;
  moduleName: string;
  inviteUrl: string;
};

export type TrustedAdvisorEmailProps = {
  branding: EmailBranding;
  advisorName: string;
  role: string;
  clientName: string;
};
