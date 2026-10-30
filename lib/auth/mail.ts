import 'server-only'

/**
 * Account email belongs to the Next.js auth module, not the PDF processor.
 * Send directly through Brevo's HTTPS API with private runtime credentials.
 * Never import this module into a browser component or launch a send without
 * awaiting it: a serverless request can end before background work finishes.
 *
 * Contract: `{ sent: true }` when the provider accepts the mail; any other outcome is reported,
 * never thrown — the account row is already committed when this runs, and a
 * failed email is a resend, not a lost account. The pending account cannot
 * sign in until verification. Provider acceptance is not inbox delivery.
 */

export type AccountMailPurpose = 'signup_verify' | 'password_reset'

export type SendAccountMailInput = {
  to: string
  purpose: AccountMailPurpose
  ctaUrl: string
  displayName?: string | null
  /** Hours the link stays valid; shown in the email note. */
  expiresInHours: number
  origin: string
}

export type SendAccountMailResult = {
  sent: boolean
  /** Sanitized machine reason; never includes credentials or provider response bodies. */
  reason?: string
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const COPY: Record<AccountMailPurpose, { subject: string; heading: string; label: string }> = {
  signup_verify: {
    subject: 'Confirm your mycloove email',
    heading: 'Confirm your email address',
    label: 'Verify my email',
  },
  password_reset: {
    subject: 'Reset your mycloove password',
    heading: 'Reset your password',
    label: 'Set a new password',
  },
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export async function sendAccountMail(input: SendAccountMailInput): Promise<SendAccountMailResult> {
  const apiKey = process.env.BREVO_API_KEY?.trim()
  const fromEmail = process.env.MAIL_FROM_EMAIL?.trim()
  const fromName = process.env.MAIL_FROM_NAME?.trim() || 'SmilePDF'
  const replyTo = process.env.MAIL_REPLY_TO?.trim()
  if (!apiKey || !fromEmail) return { sent: false, reason: 'mail_not_configured' }
  if (!EMAIL.test(fromEmail) || (replyTo && !EMAIL.test(replyTo))) {
    return { sent: false, reason: 'mail_invalid_config' }
  }
  const copy = COPY[input.purpose]
  if (!copy || !EMAIL.test(input.to) || input.to.length > 254 || input.ctaUrl.length > 2048) {
    return { sent: false, reason: 'mail_invalid_payload' }
  }
  try {
    const url = new URL(input.ctaUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return { sent: false, reason: 'mail_invalid_payload' }
    }
  } catch {
    return { sent: false, reason: 'mail_invalid_payload' }
  }
  const name = input.displayName?.trim()
  const knowsName = Boolean(name)
  const lines =
    input.purpose === 'signup_verify'
      ? [
          'Your mycloove account has been created and is waiting for email verification.',
          ...(knowsName ? [`Nice to meet you, ${name}!`] : []),
          'Verify your email using the link below. You will then return to the login page to sign in.',
        ]
      : [
          'A password reset was requested for your mycloove account.',
          'Use this link to choose a new password. Your old one keeps working until then.',
        ]

  const note = `This link expires after ${Math.round(input.expiresInHours)} hours. If you did not expect this email, you can ignore it — nothing changes on your account.`
  const preheader = input.purpose === 'signup_verify'
    ? 'One tap and your new account is fully confirmed.'
    : 'Your sign-in keeps working until the password changes.'
  const link = escapeHtml(input.ctaUrl)
  // Keep the existing restrained mail layout and fallback link. Inline styles
  // survive inboxes that discard <style> blocks; no external assets are needed.
  const htmlContent = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans Bengali',Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>
<div style="max-width:560px;margin:28px auto;background:#ffffff;border-radius:14px;border:1px solid #e6e8ec;padding:40px 44px;">
<div style="font-size:20px;font-weight:700;color:#1f2430;letter-spacing:.3px;">mycloove</div>
<h1 style="font-size:24px;font-weight:650;color:#1f2430;margin:26px 0 10px;">${escapeHtml(copy.heading)}</h1>
<div style="font-size:15px;line-height:1.65;color:#3d4451;overflow-wrap:anywhere;">${lines.map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`).join('')}
<a href="${link}" style="display:inline-block;background:#4653e6;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 30px;border-radius:10px;">${escapeHtml(copy.label)}</a>
<div style="margin-top:22px;font-size:13px;color:#6b7280;word-break:break-all;">${escapeHtml(copy.label)}: <a href="${link}">${link}</a></div></div>
<div style="margin-top:26px;font-size:12.5px;color:#3d4451;border-top:1px solid #eef0f3;padding-top:16px;">${escapeHtml(note)}</div>
</div></body></html>`
  const textContent = `${copy.heading}\n\n${lines.map((line) => `- ${line}`).join('\n')}\n\n${copy.label}: ${input.ctaUrl}\n\n${note}`

  let response: Response
  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: input.to }],
        subject: copy.subject,
        htmlContent,
        textContent,
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      }),
      cache: 'no-store',
      // Mail delivery may be slow upstream; bounded so a route never hangs on it.
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    console.error('Account mail transport failed', {
      purpose: input.purpose,
      error: error instanceof Error ? error.name : 'unknown',
    })
    return { sent: false, reason: 'mail_transport_error' }
  }

  if (!response.ok) {
    console.error('Brevo account mail rejected', { purpose: input.purpose, status: response.status })
    return { sent: false, reason: `brevo_http_${response.status}` }
  }
  try {
    const body = (await response.json()) as { messageId?: unknown } | null
    if (typeof body?.messageId === 'string' && body.messageId.trim()) return { sent: true }
  } catch {
    // A non-JSON body is still a plain failure.
  }
  console.error('Brevo account mail returned no acceptance receipt', { purpose: input.purpose, status: response.status })
  return { sent: false, reason: 'mail_invalid_response' }
}
