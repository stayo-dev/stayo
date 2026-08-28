/**
 * The resident & guardian command center.
 *
 * Five commands — RENT, PAY, PLAN, RECEIPT, HELP — for two audiences, one of
 * which (guardians) previously had no surface of its own at all: the old code
 * computed `senderRole: "GUARDIAN"` in four places, wrote it to an audit log,
 * and then treated that reader exactly like the resident whose debt it was.
 *
 * Three structural commitments hold this together:
 *
 * 1. **No invisible mode.** Which resident an action concerns arrives in the
 *    interactive payload (`CC:PAY:<tenantId>`) or is unambiguous from the
 *    phone. Nothing is remembered between messages except a guardian's pending
 *    command during the ~5 minutes an OTP is live.
 * 2. **One number.** `RENT` states what is payable, and `PAY` charges exactly
 *    that. The old pair disagreed — `DUES` summed every obligation while `PAY`
 *    linked only the oldest — and showed a guardian two different debts in the
 *    same minute.
 * 3. **Never silence, never a dead end.** Every path replies, and no reply
 *    tells the reader to send a *different* command to get what they asked
 *    for. `resolveResidentOrPromptSelection` used to answer `PAY` with "send
 *    BAL first", which is the single most expensive sentence in a rent-
 *    collection channel.
 */

import { getLogger } from "@/lib/logger";
import { getFrontendUrl } from "@/lib/config/domains";
import { PaymentLinkService } from "@/src/services/payments/payment-link-service";
import { MetaWhatsAppProvider } from "../providers/whatsapp";
import {
  deleteSelectionState,
  getSelectionState,
  setSelectionState,
  type CommandCenterPendingState,
} from "../whatsapp-selection-state";
import type { SenderIdentity } from "../routing/types";
import { COMMANDS, CommandName, resolveCommand } from "./commands";
import {
  actionsFor,
  decodePayload,
  encodePayload,
  helpMessage,
  paymentPicker,
  residentPicker,
  unknownSenderMessage,
  unrecognisedMessage,
} from "./menu";
import {
  buildInstalmentPlan,
  buildReceipt,
  buildRentSummary,
  ensureReceiptDocument,
  findPayment,
  listPayments,
  loadPickerRows,
  loadResidentContext,
  type PaymentSummary,
  type ResidentContext,
} from "./context";
import { formatRentSummary } from "./rent-summary";
import { formatInstalmentPlan } from "./installment-plan";
import {
  formatLastReceipt,
  formatNoPayments,
  formatReceiptDelivery,
  formatReceiptUnavailable,
} from "./receipt";
import {
  challengeMessage,
  extractOtp,
  isGuardianVerified,
  looksLikeOtp,
  sendGuardianChallenge,
  verifiedMessage,
  verifyGuardianCode,
} from "./guardian-access";
import { compose, lines, rupees, shortDate, signature, subjectLine, type Audience } from "./voice";

const logger = getLogger("whatsapp.command-center");

/** Matches the OTP's own 5-minute life, plus a little slack for a slow reply. */
const PENDING_COMMAND_TTL_SECONDS = 8 * 60;

export type CommandCenterResult = {
  handled: boolean;
  command?: CommandName;
  tenantId?: string | null;
  audience?: Audience;
  outcome?: string;
};

const NOT_MINE: CommandCenterResult = { handled: false };

/** What `actionsFor` needs to pick the follow-on buttons. */
type ActionOptions = {
  command: CommandName;
  tenantId: string | null;
  payableNow: number;
  hasPayments: boolean;
};

export class CommandCenterService {
  constructor(private readonly provider = new MetaWhatsAppProvider()) {}

  /**
   * Entry point for a typed message. Returns `{ handled: false }` when the
   * text is not a command this center owns, so the router can offer it to the
   * next candidate rather than swallowing it.
   */
  async handleText(phone: string, body: string, identity: SenderIdentity): Promise<CommandCenterResult> {
    // A bare six-digit code is only ever an answer to our own challenge, and
    // only from someone we are actually challenging.
    if (looksLikeOtp(body) && identity.guardianResidents.length > 0) {
      return this.completeGuardianVerification(phone, body, identity);
    }

    const command = resolveCommand(body);
    if (!command) return NOT_MINE;

    return this.dispatch({ phone, identity, command, tenantId: null });
  }

  /** Entry point for a tapped button or list row. */
  async handleInteractive(phone: string, payloadId: string, identity: SenderIdentity): Promise<CommandCenterResult> {
    const decoded = decodePayload(payloadId);
    if (!decoded) return NOT_MINE;

    return this.dispatch({
      phone,
      identity,
      command: decoded.command,
      tenantId: decoded.tenantId,
      ref: decoded.ref,
    });
  }

  // ─── Dispatch ──────────────────────────────────────────────

  private async dispatch(input: {
    phone: string;
    identity: SenderIdentity;
    command: CommandName;
    tenantId: string | null;
    /** Which one — a payment id for `RECEIPT`, when the reader picked it. */
    ref?: string | null;
  }): Promise<CommandCenterResult> {
    const { phone, identity, command } = input;

    // Someone we cannot place at all. Answer with what would make them
    // placeable — including, unlike the copy this replaces, the guardian case.
    if (identity.residents.length === 0) {
      await this.provider.sendTextMessage(phone, unknownSenderMessage());
      return { handled: true, command, outcome: "UNKNOWN_SENDER" };
    }

    // A tapped payload names its resident. Verify it is one of *theirs* before
    // trusting it — payload ids are minted by us, but they travel through the
    // reader's handset and must not become an object reference to anywhere.
    let tenantId = input.tenantId;
    if (tenantId && !identity.tenantIds.includes(tenantId)) {
      logger.warn("command_center.payload_tenant_not_authorised", {
        phone: identity.normalizedPhone,
        tenant_id: tenantId,
      });
      tenantId = null;
    }

    if (!tenantId && identity.residents.length === 1) {
      tenantId = identity.residents[0].tenantId;
    }

    const audience = this.audienceFor(identity, tenantId);

    // The guardian gate sits before resident resolution, so a guardian of two
    // children is verified once rather than once per child.
    if (audience === "GUARDIAN") {
      const verified = await isGuardianVerified(phone);
      if (!verified) {
        return this.challengeGuardian(phone, identity, command, tenantId);
      }
    }

    if (command === COMMANDS.HELP) {
      return this.sendHelp(phone, identity, audience, tenantId);
    }

    // More than one resident and nothing narrowing it down: ask, carrying the
    // command forward so the answer is one tap rather than one tap plus a
    // re-typed word.
    if (!tenantId) {
      return this.promptResidentChoice(phone, identity, command);
    }

    const context = await loadResidentContext(tenantId);
    if (!context) {
      await this.provider.sendTextMessage(
        phone,
        lines(
          "That resident's stay is no longer active, so there is nothing to show.",
          "",
          "If you think this is wrong, please contact the hostel."
        )
      );
      return { handled: true, command, tenantId, outcome: "TENANT_INACTIVE" };
    }

    switch (command) {
      case COMMANDS.RENT:
        return this.sendRent(phone, context, audience);
      case COMMANDS.PAY:
        return this.sendPay(phone, context, audience);
      case COMMANDS.PLAN:
        return this.sendPlan(phone, context, audience);
      case COMMANDS.RECEIPT:
        return this.sendReceipt(phone, context, audience, input.ref || null);
      default:
        return NOT_MINE;
    }
  }

  /**
   * A phone that reaches a resident only through `guardian_phone` is reading
   * as a guardian; one that matched the resident's own number is the resident.
   * Decided per *resident*, because one handset can legitimately be both.
   */
  private audienceFor(identity: SenderIdentity, tenantId: string | null): Audience {
    if (tenantId) {
      const guardianOf = identity.guardianResidents.some((r) => r.tenantId === tenantId);
      return guardianOf ? "GUARDIAN" : "RESIDENT";
    }
    return identity.roles.includes("TENANT") ? "RESIDENT" : "GUARDIAN";
  }

  // ─── Commands ──────────────────────────────────────────────

  private async sendRent(phone: string, context: ResidentContext, audience: Audience): Promise<CommandCenterResult> {
    const summary = await buildRentSummary(context);
    const text = formatRentSummary({ ...summary, audience, subject: context.subject });

    await this.reply(phone, text, {
      command: COMMANDS.RENT,
      tenantId: context.tenantId,
      payableNow: summary.payableNow,
      hasPayments: context.financials.items.some((item) => item.paid > 0),
    });

    return { handled: true, command: COMMANDS.RENT, tenantId: context.tenantId, audience };
  }

  /**
   * A link for the **whole** currently-payable amount.
   *
   * The old handler wrote a `payment_link_tokens` row bound to a single
   * obligation, bypassing `PaymentLinkService`, so a guardian shown a ₹24,000
   * total was then offered ₹8,000. A tenant-scoped token prices the account as
   * it stands at payment time and FIFO-allocates across it, which is both the
   * honest number and the one the reader was just quoted.
   */
  private async sendPay(phone: string, context: ResidentContext, audience: Audience): Promise<CommandCenterResult> {
    const payable = context.financials.current_payable_amount;

    if (payable <= 0) {
      const summary = await buildRentSummary(context);
      const text = formatRentSummary({ ...summary, audience, subject: context.subject });
      await this.reply(phone, text, {
        command: COMMANDS.RENT,
        tenantId: context.tenantId,
        payableNow: 0,
        hasPayments: context.financials.items.some((item) => item.paid > 0),
      });
      return { handled: true, command: COMMANDS.PAY, tenantId: context.tenantId, outcome: "NOTHING_DUE" };
    }

    let paymentUrl: string | null = null;
    try {
      const { token } = await PaymentLinkService.getOrCreateToken({ tenantId: context.tenantId });
      paymentUrl = `${getFrontendUrl().replace(/\/+$/, "")}/pay/${token}`;
    } catch (error: any) {
      logger.error("command_center.payment_link_failed", {
        tenant_id: context.tenantId,
        error: error?.message || String(error),
      });
    }

    if (!paymentUrl) {
      // Say what happened and give them a route that does not involve us.
      await this.provider.sendTextMessage(
        phone,
        compose(
          subjectLine(audience, context.subject),
          `${rupees(payable)} is payable, but we could not generate a payment link just now.`,
          "Please try again in a few minutes, or contact the hostel to pay directly.",
          signature(context.subject)
        )
      );
      return { handled: true, command: COMMANDS.PAY, tenantId: context.tenantId, outcome: "LINK_FAILED" };
    }

    const breakdown = context.financials.items
      .filter((item) => item.legacy_status !== "UPCOMING" && item.outstanding > 0)
      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

    const text = compose(
      subjectLine(audience, context.subject),
      `*${rupees(payable)}* payable now.`,
      breakdown.length > 1
        ? `This link covers all ${breakdown.length} pending items.`
        : null,
      lines("Pay securely:", paymentUrl),
      lines(
        "_The link is valid for 7 days and opens the hostel's own payment page._",
        "_A receipt reaches this chat as soon as the payment lands._"
      ),
      signature(context.subject)
    );

    await this.reply(phone, text, {
      command: COMMANDS.PAY,
      tenantId: context.tenantId,
      payableNow: payable,
      hasPayments: context.financials.items.some((item) => item.paid > 0),
    });

    return { handled: true, command: COMMANDS.PAY, tenantId: context.tenantId, audience };
  }

  private async sendPlan(phone: string, context: ResidentContext, audience: Audience): Promise<CommandCenterResult> {
    const plan = await buildInstalmentPlan(context);
    const text = formatInstalmentPlan({ ...plan, audience, subject: context.subject });

    await this.reply(phone, text, {
      command: COMMANDS.PLAN,
      tenantId: context.tenantId,
      payableNow: context.financials.current_payable_amount,
      hasPayments: plan.totalPaid > 0,
    });

    return { handled: true, command: COMMANDS.PLAN, tenantId: context.tenantId, audience };
  }

  /**
   * `RECEIPT` — ask which payment, then send that receipt as a PDF.
   *
   * Two things changed here. It used to answer with a receipt *number* and
   * leave the reader to go find the document; the document is now attached, so
   * a guardian gets the thing they can forward to whoever asked them for it.
   * And it used to assume "the last one" — but a resident half a year in has
   * made six payments, and the one they want is rarely the newest.
   *
   * Asking is only worth a turn when there is a real choice: one payment is
   * sent straight away, and none is answered plainly rather than with an empty
   * list.
   */
  private async sendReceipt(
    phone: string,
    context: ResidentContext,
    audience: Audience,
    paymentId: string | null
  ): Promise<CommandCenterResult> {
    if (paymentId) {
      // Scoped to this tenant inside `findPayment`, so a payload that travelled
      // through the reader's handset cannot reach another resident's payment.
      const payment = await findPayment(context.tenantId, paymentId);
      if (!payment) {
        await this.provider.sendTextMessage(
          phone,
          compose(
            subjectLine(audience, context.subject),
            "That payment is no longer on the account.",
            "Send *RECEIPT* to see the payments we can issue a receipt for.",
            signature(context.subject)
          )
        );
        return { handled: true, command: COMMANDS.RECEIPT, tenantId: context.tenantId, outcome: "PAYMENT_NOT_FOUND" };
      }
      return this.deliverReceipt(phone, context, audience, payment);
    }

    const payments = await listPayments(context.tenantId);

    if (payments.length === 0) {
      await this.reply(phone, formatNoPayments({ audience, subject: context.subject }), {
        command: COMMANDS.RECEIPT,
        tenantId: context.tenantId,
        payableNow: context.financials.current_payable_amount,
        hasPayments: false,
      });
      return { handled: true, command: COMMANDS.RECEIPT, tenantId: context.tenantId, outcome: "NO_PAYMENTS" };
    }

    // One payment — asking "which one?" would be a wasted turn.
    if (payments.length === 1) {
      return this.deliverReceipt(phone, context, audience, payments[0]);
    }

    const picker = paymentPicker({
      tenantId: context.tenantId,
      payments: payments.map((payment) => ({
        paymentId: payment.paymentId,
        amount: rupees(payment.amount),
        paidOn: shortDate(payment.paidOn),
        towards: payment.towards,
      })),
    });

    try {
      await this.provider.sendListMessage(
        phone,
        picker.body,
        [{ title: "Payments received", rows: picker.rows }],
        "Choose payment"
      );
    } catch (error: any) {
      // A list is a nicety; three buttons still let them choose the recent ones.
      logger.warn("command_center.payment_picker_list_failed", {
        error: error?.message || String(error),
      });
      await this.provider.sendButtonMessage(
        phone,
        picker.body,
        picker.rows.slice(0, 3).map((row) => ({ id: row.id, title: row.title }))
      );
    }

    return {
      handled: true,
      command: COMMANDS.RECEIPT,
      tenantId: context.tenantId,
      audience,
      outcome: "PAYMENT_PICKER_SENT",
    };
  }

  /** Render-or-reuse the PDF, attach it, and say what it is. */
  private async deliverReceipt(
    phone: string,
    context: ResidentContext,
    audience: Audience,
    payment: PaymentSummary
  ): Promise<CommandCenterResult> {
    const record = {
      amount: payment.amount,
      paidOn: payment.paidOn,
      towards: payment.towards,
      reference: payment.receiptNumber,
      receiptUrl: null,
      method: payment.method,
    };

    const document = await ensureReceiptDocument(payment.paymentId);

    if (!document) {
      await this.reply(
        phone,
        formatReceiptUnavailable({ audience, subject: context.subject, payment: record }),
        {
          command: COMMANDS.RECEIPT,
          tenantId: context.tenantId,
          payableNow: context.financials.current_payable_amount,
          hasPayments: true,
        }
      );
      return {
        handled: true,
        command: COMMANDS.RECEIPT,
        tenantId: context.tenantId,
        outcome: "RECEIPT_UNAVAILABLE",
      };
    }

    const caption = formatReceiptDelivery({
      audience,
      subject: context.subject,
      payment: record,
      receiptNumber: document.receiptNumber,
    });

    try {
      // The caption rides on the document itself, so the PDF and the words
      // describing it arrive as one message rather than two.
      await this.provider.sendDocumentMessage(phone, document.url, document.filename, caption);
    } catch (error: any) {
      logger.error("command_center.receipt_document_send_failed", {
        payment_id: payment.paymentId,
        error: error?.message || String(error),
      });
      // The receipt exists and we know its URL — hand that over rather than
      // failing outright.
      await this.provider.sendTextMessage(
        phone,
        compose(caption, lines("Download it here:", document.url))
      );
    }

    await this.sendActions(phone, {
      command: COMMANDS.RECEIPT,
      tenantId: context.tenantId,
      payableNow: context.financials.current_payable_amount,
      hasPayments: true,
    });

    return {
      handled: true,
      command: COMMANDS.RECEIPT,
      tenantId: context.tenantId,
      audience,
      outcome: "RECEIPT_SENT",
    };
  }

  private async sendHelp(
    phone: string,
    identity: SenderIdentity,
    audience: Audience,
    tenantId: string | null
  ): Promise<CommandCenterResult> {
    const context = tenantId ? await loadResidentContext(tenantId) : null;

    const text = helpMessage({
      audience,
      subject: context?.subject || null,
      residentNames: identity.residents.map((resident) => resident.name || "Resident"),
    });

    await this.reply(phone, text, {
      command: COMMANDS.HELP,
      tenantId,
      payableNow: context?.financials.current_payable_amount ?? 0,
      hasPayments: true,
    });

    return { handled: true, command: COMMANDS.HELP, tenantId, audience };
  }

  // ─── Resident choice ───────────────────────────────────────

  private async promptResidentChoice(
    phone: string,
    identity: SenderIdentity,
    command: CommandName
  ): Promise<CommandCenterResult> {
    const rows = await loadPickerRows(identity.residents.map((resident) => resident.tenantId));

    if (rows.length === 0) {
      await this.provider.sendTextMessage(phone, unknownSenderMessage());
      return { handled: true, command, outcome: "NO_LIVE_RESIDENTS" };
    }

    if (rows.length === 1) {
      return this.dispatch({ phone, identity, command, tenantId: rows[0].tenantId });
    }

    const picker = residentPicker({ command, residents: rows });

    try {
      await this.provider.sendListMessage(
        phone,
        picker.body,
        [{ title: "Residents", rows: picker.rows }],
        "Choose resident"
      );
    } catch (error: any) {
      // A list message is a nicety; being unable to send one must not leave the
      // reader with nothing. Fall back to buttons, which take up to three.
      logger.warn("command_center.picker_list_failed", { error: error?.message || String(error) });
      await this.provider.sendButtonMessage(
        phone,
        picker.body,
        picker.rows.slice(0, 3).map((row) => ({ id: row.id, title: row.title }))
      );
    }

    return { handled: true, command, outcome: "PICKER_SENT" };
  }

  // ─── Guardian verification ─────────────────────────────────

  private async challengeGuardian(
    phone: string,
    identity: SenderIdentity,
    command: CommandName,
    tenantId: string | null
  ): Promise<CommandCenterResult> {
    const result = await sendGuardianChallenge(phone);

    if (result.status !== "SENT") {
      await this.provider.sendTextMessage(phone, result.message);
      return { handled: true, command, outcome: `CHALLENGE_${result.status}` };
    }

    // Remember only what they asked for, so the code they type next completes
    // the original request instead of dumping them back at a menu.
    const pending: Omit<CommandCenterPendingState, "createdAt" | "expiresAt"> = {
      phone,
      action: "COMMAND_CENTER_PENDING",
      command,
      tenantId,
    };
    await setSelectionState(phone, pending, PENDING_COMMAND_TTL_SECONDS);

    await this.provider.sendTextMessage(
      phone,
      challengeMessage(identity.guardianResidents.map((resident) => resident.name || "the resident"))
    );

    logger.info("command_center.guardian_challenged", {
      phone: identity.normalizedPhone,
      command,
      resident_count: identity.guardianResidents.length,
    });

    return { handled: true, command, outcome: "GUARDIAN_CHALLENGED" };
  }

  private async completeGuardianVerification(
    phone: string,
    body: string,
    identity: SenderIdentity
  ): Promise<CommandCenterResult> {
    const otp = extractOtp(body);
    if (!otp) return NOT_MINE;

    const result = await verifyGuardianCode(phone, otp);

    if (result.status === "REJECTED") {
      await this.provider.sendTextMessage(phone, result.message);
      return { handled: true, outcome: "GUARDIAN_CODE_REJECTED" };
    }

    await this.provider.sendTextMessage(phone, verifiedMessage());

    const state = await getSelectionState(phone);
    const pending =
      state && state.action === "COMMAND_CENTER_PENDING" ? (state as CommandCenterPendingState) : null;
    if (pending) await deleteSelectionState(phone);

    // Replay what they originally asked for. A verification that ends at a
    // menu makes the reader repeat themselves to get back where they were.
    return this.dispatch({
      phone,
      identity,
      command: (pending?.command as CommandName) || COMMANDS.RENT,
      tenantId: pending?.tenantId || null,
    });
  }

  // ─── Sending ───────────────────────────────────────────────

  /**
   * Body first, then the actions. Two messages rather than one because
   * WhatsApp caps an interactive message's body at 1024 characters, well below
   * what an instalment plan needs — and truncating the answer to fit the
   * buttons would be the wrong trade.
   */
  private async reply(
    phone: string,
    text: string,
    options: ActionOptions
  ): Promise<void> {
    await this.provider.sendTextMessage(phone, text);
    await this.sendActions(phone, options);
  }

  /**
   * The follow-on actions, on their own.
   *
   * Separate from `reply` because the receipt path sends a *document* rather
   * than text and still owes the reader somewhere to go next.
   */
  private async sendActions(phone: string, options: ActionOptions): Promise<void> {
    const buttons = actionsFor(options);
    if (buttons.length === 0) return;

    try {
      await this.provider.sendButtonMessage(phone, "Anything else?", buttons);
    } catch (error: any) {
      // The answer already landed. Buttons are a convenience, and failing to
      // attach them is not worth failing the command over.
      logger.warn("command_center.actions_failed", {
        command: options.command,
        error: error?.message || String(error),
      });
    }
  }

  /** The reply when nothing matched — exported so the router's fallback shares this voice. */
  async sendUnrecognised(phone: string, identity: SenderIdentity): Promise<void> {
    const audience = this.audienceFor(identity, identity.tenantId);
    const context = identity.tenantId ? await loadResidentContext(identity.tenantId) : null;

    await this.provider.sendTextMessage(
      phone,
      unrecognisedMessage({ audience, subject: context?.subject || null })
    );

    const buttons = [
      { id: encodePayload(COMMANDS.RENT, identity.tenantId), title: "What's due" },
      { id: encodePayload(COMMANDS.PLAN, identity.tenantId), title: "Instalments" },
      { id: encodePayload(COMMANDS.HELP, identity.tenantId), title: "Help" },
    ];

    try {
      await this.provider.sendButtonMessage(phone, "Or tap one of these:", buttons);
    } catch {
      // Text already sent — nothing further is owed.
    }
  }
}

export const commandCenterService = new CommandCenterService();
