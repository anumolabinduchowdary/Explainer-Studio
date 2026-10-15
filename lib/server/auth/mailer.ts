import "server-only";
import nodemailer from "nodemailer";
import { OTP_MINUTES } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { AppError } from "../appError";
import type { EmailSettings } from "./config";

/**
 * Sends the sign-in code by email, through any SMTP service: a Gmail account
 * with an app password, or a sending service such as Resend or Brevo.
 */
export async function sendSignInCode(settings: EmailSettings, to: string, code: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // Port 465 is encrypted from the first byte; other ports switch to encryption (STARTTLS) when offered.
    secure: settings.port === 465,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  const lines = [
    `Your ${APP_NAME} sign-in code is ${code}`,
    "",
    `It works for ${OTP_MINUTES} minutes and can be used once.`,
    "If you did not ask for this code, you can ignore this email. Nobody can sign in without it.",
  ];
  try {
    await transport.sendMail({
      from: settings.from,
      to,
      subject: `${code} is your ${APP_NAME} sign-in code`,
      text: lines.join("\n"),
      html: `<div style="font-family:system-ui,sans-serif;font-size:16px;color:#2b2118">
<p>Your ${APP_NAME} sign-in code is</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0">${code}</p>
<p>${lines[2]}</p>
<p style="color:#6b5e52">${lines[3]}</p>
</div>`,
    });
  } catch {
    // The mail server's own message can repeat the password or the address, so it is not passed on or logged.
    throw new AppError("email_failed", 502);
  } finally {
    transport.close();
  }
}
