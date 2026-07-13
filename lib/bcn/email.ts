/** @deprecated Import from @/lib/email/* */
export { sendTransactionalEmail } from "@/lib/email/send";
export {
  inviteClientEmailHtml as clientInviteEmailHtml,
  trustedAdvisorInviteEmailHtml,
} from "@/lib/email/templates-html";
export { emailBrandingFromTenant, emailBrandingFromTokens } from "@/lib/email/branding";
