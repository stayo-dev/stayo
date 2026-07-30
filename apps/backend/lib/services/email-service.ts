import { Resend } from "resend";
import { eventLog } from "./event-log-service";
import { formatCurrency } from "../format";
import type { HostelPreferences } from "../preferences";
import { frontendUrl } from "../config/domains";

const resend = new Resend(process.env.RESEND_API_KEY);
// No verified sending domain on the StayO Resend account yet — resend.dev's
// sandbox sender works without domain verification but Resend restricts it
// to sending only to the account owner's own email. Update this once a real
// domain is verified at resend.com/domains (see EMAIL_FROM in .env).
const DEFAULT_FROM = "StayO <onboarding@resend.dev>";

function resolveEmailFrom(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_FROM;

  // Resend requires either email@example.com or Name <email@example.com>.
  if (/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(raw) || /^.+<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$/.test(raw)) {
    return raw;
  }

  const domain = raw
    .replace(/^https?:\/\//i, "")
    .replace(/^mailto:/i, "")
    .replace(/\/.*$/, "")
    .trim();

  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return `StayO <noreply@${domain}>`;
  }

  return DEFAULT_FROM;
}

export class EmailService {
  private static normalizeProviderError(error: unknown): string {
    if (!error) return "Unknown email provider error";
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;

    if (typeof error === "object") {
      const err = error as Record<string, unknown>;
      const message = typeof err.message === "string" ? err.message : undefined;
      const name = typeof err.name === "string" ? err.name : undefined;
      const statusCode = typeof err.statusCode === "number" ? String(err.statusCode) : undefined;
      const joined = [statusCode, name, message].filter(Boolean).join(" ");
      if (joined) return joined.trim();
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    }

    return String(error);
  }

  static async sendEmail(to: string, subject: string, html: string, attachments?: any[]) {
    if (!process.env.RESEND_API_KEY) {
      console.warn("RESEND_API_KEY not configured. Email simulation mode.");
      console.log(`--- EMAIL SIMULATION ---\nTo: ${to}\nSubject: ${subject}\nAttachments: ${attachments?.length || 0}\n------------------------`);
      return { sent: false, error: "RESEND_API_KEY missing" };
    }

    try {
      const { data, error } = await resend.emails.send({
        from: resolveEmailFrom(process.env.EMAIL_FROM),
        to: [to],
        subject,
        html,
        attachments,
      });

      if (error) {
        console.error(`Resend error sending to ${to}:`, error);
        return { sent: false, error: this.normalizeProviderError(error) };
      }

      return { sent: true, provider_id: data?.id };
    } catch (e: any) {
      console.error(`Email delivery error for ${to}:`, e);
      return { sent: false, error: this.normalizeProviderError(e) };
    }
  }

  static async sendInvitation(data: {
    toEmail: string;
    tenantName: string;
    ownerName: string;
    hostelName: string;
    roomNumber: string;
    roomRent: number;
    activationLink: string;
    advanceDeposit?: number;
    maintenanceCharge?: number;
    maintenanceType?: string;
    joiningDate?: Date;
    roommates?: string[];
    prefs?: Partial<HostelPreferences>;
  }) {
    const fmt = (n: number) => formatCurrency(n, data.prefs);
    const maintLabel = data.maintenanceType === "ONE_TIME" ? "One-time" : "Monthly";
    const joiningStr = data.joiningDate
      ? data.joiningDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
      : "To be confirmed";
    const roommateStr = data.roommates?.length
      ? data.roommates.join(", ")
      : "You'll be the first!";

    // Build financial breakdown rows
    let financialRows = `
      <tr><td style="padding:8px 0;color:#64748b">Monthly Rent</td><td style="padding:8px 0;text-align:right;font-weight:600">${fmt(data.roomRent)}</td></tr>`;
    if (data.advanceDeposit && data.advanceDeposit > 0) {
      financialRows += `
      <tr><td style="padding:8px 0;color:#64748b">Security Deposit</td><td style="padding:8px 0;text-align:right;font-weight:600">${fmt(data.advanceDeposit)}<br/><span style="font-weight:normal;font-size:11px;color:#94a3b8">Due on joining</span></td></tr>`;
    }
    if (data.maintenanceCharge && data.maintenanceCharge > 0) {
      financialRows += `
      <tr><td style="padding:8px 0;color:#64748b">Maintenance (${maintLabel})</td><td style="padding:8px 0;text-align:right;font-weight:600">${fmt(data.maintenanceCharge)}</td></tr>`;
    }

    const subject = `You're invited to join ${data.hostelName}`;
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 24px;color:#fff;">
          <h1 style="margin:0;font-size:22px;">Welcome to ${data.hostelName}</h1>
          <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">Your new home is ready</p>
        </div>

        <div style="padding:24px;color:#1e293b;line-height:1.6;">
          <p>Hello <strong>${data.tenantName}</strong>,</p>
          <p><strong>${data.ownerName}</strong> has invited you to join. Here are your details:</p>

          <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:20px 0;border:1px solid #e2e8f0;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:8px 0;color:#64748b">Room</td><td style="padding:8px 0;text-align:right;font-weight:600">${data.roomNumber}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b">Roommates</td><td style="padding:8px 0;text-align:right;font-size:13px">${roommateStr}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b">Joining Date</td><td style="padding:8px 0;text-align:right;font-weight:600">${joiningStr}</td></tr>
              <tr><td colspan="2" style="border-top:1px solid #e2e8f0;padding:0;height:8px"></td></tr>
              ${financialRows}
            </table>
          </div>

          <div style="text-align:center;margin:28px 0;">
            <a href="${data.activationLink}" target="_blank" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 32px;text-decoration:none;border-radius:10px;font-weight:700;font-size:16px;">
              Activate Your Account
            </a>
          </div>

          <p style="font-size:12px;color:#94a3b8;text-align:center;">This link expires in 48 hours. Contact your hostel owner if you need assistance.</p>
        </div>
      </div>
    `;
    return this.sendEmail(data.toEmail, subject, html);
  }

  /** Owner-lead activation link (owner-acquisition funnel, phase 2) — WhatsApp fallback. */
  static async sendOwnerActivation(data: {
    toEmail: string;
    ownerName: string;
    hostelName: string;
    activationLink: string;
  }) {
    const subject = `You're approved — activate your StayO account for ${data.hostelName}`;
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 24px;color:#fff;">
          <h1 style="margin:0;font-size:22px;">You're approved!</h1>
          <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">Let's get ${data.hostelName} set up on StayO</p>
        </div>

        <div style="padding:24px;color:#1e293b;line-height:1.6;">
          <p>Hello <strong>${data.ownerName}</strong>,</p>
          <p>Your hostel listing request has been reviewed and approved. Click below to finish setting up your StayO account and dashboard for <strong>${data.hostelName}</strong>.</p>

          <div style="text-align:center;margin:28px 0;">
            <a href="${data.activationLink}" target="_blank" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 32px;text-decoration:none;border-radius:10px;font-weight:700;font-size:16px;">
              Activate Your Account
            </a>
          </div>

          <p style="font-size:12px;color:#94a3b8;text-align:center;">This link is single-use and expires in 7 days. Contact StayO support if you need a new one.</p>
        </div>
      </div>
    `;
    return this.sendEmail(data.toEmail, subject, html);
  }

  static async sendReceipt(data: {
    toEmail: string;
    name: string;
    amount: number;
    rentMonth: string;
    reference: string;
    pdfBuffer?: Buffer;
    prefs?: Partial<HostelPreferences>;
  }) {
    const formattedAmount = formatCurrency(data.amount, data.prefs);
    const subject = `Payment Receipt - ${data.rentMonth}`;
    const html = `
      <div style="font-family: sans-serif;">
        <h3>Rent Payment Received</h3>
        <p>Hi ${data.name},</p>
        <p>We've received your payment of ${formattedAmount} for the month of ${data.rentMonth}.</p>
        <p><strong>Reference:</strong> ${data.reference}</p>
        ${data.pdfBuffer ? '<p>Please find your payment receipt attached to this email.</p>' : ''}
      </div>
    `;
    
    const attachments = data.pdfBuffer ? [{
      filename: `Receipt_${data.rentMonth.replace(/ /g, '_')}.pdf`,
      content: data.pdfBuffer
    }] : undefined;
    
    return this.sendEmail(data.toEmail, subject, html, attachments);
  }
  static renderReminderPreview(data: {
    name: string;
    amount: number;
    rentMonth: string;
    dueDate: string;
    type: "DUE_SOON" | "WARNING" | "FINAL_NOTICE" | "LATE_FEE_ADDED";
    prefs?: Partial<HostelPreferences>;
  }) {
    const formattedAmount = formatCurrency(data.amount, data.prefs);
    let subject = "";
    let title = "";
    let message = "";
    let color = "#6366f1"; // Indigo default

    switch (data.type) {
      case "DUE_SOON":
        subject = `Rent Payment Reminder - ${data.rentMonth}`;
        title = "Gentle Rent Reminder";
        message = `This is a friendly reminder that your rent of <strong>${formattedAmount}</strong> for ${data.rentMonth} is due soon. kindly ignore if already paid.`;
        break;
      case "WARNING":
        subject = `Overdue Payment Notice - ${data.rentMonth}`;
        title = "Payment Overdue";
        message = `Your rent payment of <strong>${formattedAmount}</strong> for ${data.rentMonth} is now past its due date (${data.dueDate}). Please settle this to avoid late fees.`;
        color = "#f59e0b"; // Amber
        break;
      case "FINAL_NOTICE":
        subject = `URGENT: Final Rent Notice - ${data.rentMonth}`;
        title = "Final Payment Notice";
        message = `URGENT: Your rent of <strong>${formattedAmount}</strong> for ${data.rentMonth} is significantly overdue. Please pay immediately to avoid service deactivation or additional penalties.`;
        color = "#ef4444"; // Red
        break;
      case "LATE_FEE_ADDED":
        subject = `Late Fee Applied - ${data.rentMonth}`;
        title = "Late Fee Added";
        message = `A late fee has been applied to your account for the month of ${data.rentMonth} as the payment is past the grace period.`;
        color = "#7c3aed"; // Violet
        break;
    }

    const html = `
      <div style="font-family: sans-serif; max-width: 500px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin: 0 auto; text-align: left;">
        <div style="background: ${color}; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">${title}</h2>
        </div>
        <div style="padding: 24px; color: #1e293b; line-height: 1.5;">
          <p>Hi <strong>${data.name}</strong>,</p>
          <p>${message}</p>
          <div style="margin: 20px 0; padding: 16px; background: #f8fafc; border-radius: 8px; border-left: 4px solid ${color};">
            <p style="margin: 0; font-size: 14px; color: #64748b;">Amount Due</p>
            <p style="margin: 4px 0 0; font-size: 24px; font-weight: bold; color: #0f172a;">${formattedAmount}</p>
            <p style="margin: 12px 0 0; font-size: 14px; color: #64748b;">Due Date: ${data.dueDate}</p>
          </div>
          <p style="font-size: 14px; color: #64748b; margin-top: 24px; margin-bottom: 24px;">
            You can pay directly via the tenant dashboard or using the hostel UPI ID.
          </p>
          <div style="text-align: center; margin-top: 10px; margin-bottom: 10px;">
            <a href="#" style="display: inline-block; padding: 12px 24px; background-color: ${color}; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
              Pay Now
            </a>
          </div>
        </div>
        <div style="background: #f1f5f9; padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">
          This is an automated notification from your Hostel Management System.
        </div>
      </div>
    `;

    return { subject, html };
  }

  static async sendReminderBatch(data: {
    toEmail: string;
    name: string;
    amount: number;
    rentMonth: string;
    dueDate: string;
    type: "DUE_SOON" | "WARNING" | "FINAL_NOTICE" | "LATE_FEE_ADDED";
    prefs?: Partial<HostelPreferences>;
  }) {
    const formattedAmount = formatCurrency(data.amount, data.prefs);
    let subject = "";
    let title = "";
    let message = "";
    let color = "#6366f1"; // Indigo default

    switch (data.type) {
      case "DUE_SOON":
        subject = `Rent Payment Reminder - ${data.rentMonth}`;
        title = "Gentle Rent Reminder";
        message = `This is a friendly reminder that your rent of <strong>${formattedAmount}</strong> for ${data.rentMonth} is due soon. kindly ignore if already paid.`;
        break;
      case "WARNING":
        subject = `Overdue Payment Notice - ${data.rentMonth}`;
        title = "Payment Overdue";
        message = `Your rent payment of <strong>${formattedAmount}</strong> for ${data.rentMonth} is now past its due date (${data.dueDate}). Please settle this to avoid late fees.`;
        color = "#f59e0b"; // Amber
        break;
      case "FINAL_NOTICE":
        subject = `URGENT: Final Rent Notice - ${data.rentMonth}`;
        title = "Final Payment Notice";
        message = `URGENT: Your rent of <strong>${formattedAmount}</strong> for ${data.rentMonth} is significantly overdue. Please pay immediately to avoid service deactivation or additional penalties.`;
        color = "#ef4444"; // Red
        break;
      case "LATE_FEE_ADDED":
        subject = `Late Fee Applied - ${data.rentMonth}`;
        title = "Late Fee Added";
        message = `A late fee has been applied to your account for the month of ${data.rentMonth} as the payment is past the grace period.`;
        color = "#7c3aed"; // Violet
        break;
    }

    const html = `
      <div style="font-family: sans-serif; max-width: 500px; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: ${color}; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">${title}</h2>
        </div>
        <div style="padding: 24px; color: #1e293b; line-height: 1.5;">
          <p>Hi <strong>${data.name}</strong>,</p>
          <p>${message}</p>
          <div style="margin: 20px 0; padding: 16px; background: #f8fafc; border-radius: 8px; border-left: 4px solid ${color};">
            <p style="margin: 0; font-size: 14px; color: #64748b;">Amount Due</p>
            <p style="margin: 4px 0 0; font-size: 24px; font-weight: bold; color: #0f172a;">${formattedAmount}</p>
            <p style="margin: 12px 0 0; font-size: 14px; color: #64748b;">Due Date: ${data.dueDate}</p>
          </div>
          <p style="font-size: 14px; color: #64748b; margin-top: 24px; margin-bottom: 24px;">
            You can pay directly via the tenant dashboard or using the hostel UPI ID.
          </p>
          <div style="text-align: center; margin-top: 10px; margin-bottom: 10px;">
            <a href="${frontendUrl("/login")}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: ${color}; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
              Pay Now
            </a>
          </div>
        </div>
        <div style="background: #f1f5f9; padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">
          This is an automated notification from your Hostel Management System.
        </div>
      </div>
    `;

    const result = await this.sendEmail(data.toEmail, subject, html);
    
    // Write explicit audit log for email delivery attempt
    await eventLog.log("EMAIL_SENT", null, {
      template: data.type,
      tenant: data.name,
      email: data.toEmail,
      success: result.sent
    });

    return result;
  }
}
