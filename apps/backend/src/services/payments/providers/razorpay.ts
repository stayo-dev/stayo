import axios from "axios";
import { PaymentProvider, CreateIntentResult, WebhookVerificationResult, FetchStatusResult } from "../provider-base";

export class RazorpayProvider extends PaymentProvider {
  private get auth() {
    return {
      auth: {
        username: this.config.key_id,
        password: this.config.key_secret,
      },
    };
  }

  private get baseUrl() {
    return this.config.base_url || "https://api.razorpay.com";
  }

  async createIntent(data: any): Promise<CreateIntentResult> {
    const payload = {
      amount: Math.round(data.amount * 100), // Razorpay amount in paise
      currency: this.config.currency || "INR",
      receipt: data.merchant_txn_id,
      notes: {
        merchant_txn_id: data.merchant_txn_id,
        flow_type: this.config.flow_type || "",
        hostel_id: this.config.hostelId || "",
        tenant_name: data.tenant_name || "",
        tenant_email: data.tenant_email || "",
        tenant_phone: data.tenant_phone || "",
        tenant_id: data.metadata?.tenant_id || data.tenant_id || "",
      },
    };

    const response = await axios.post(`${this.baseUrl}/v1/orders`, payload, this.auth);
    const resData = response.data;

    return {
      provider: "RAZORPAY",
      merchant_txn_id: data.merchant_txn_id,
      checkout_url: null,
      upi_intent_url: null,
      qr_payload: null,
      expires_at: null,
      gateway_txn_id: resData.id,
      provider_order_id: resData.id,
      provider_transaction_id: null,
      provider_reference_id: resData.id,
      raw_response: {
        ...resData,
        // Expose public key_id to the client so Checkout SDK can load it
        key_id: this.config.key_id,
      },
    };
  }

  async verifyWebhook(headers: any, body: any): Promise<WebhookVerificationResult> {
    const signature = headers["x-razorpay-signature"];

    // NOTE: HMAC signature verification is performed once at the route level
    // against the original raw bytes. We do NOT re-verify here because
    // JSON.stringify(JSON.parse(rawBody)) is not byte-equivalent to rawBody,
    // causing HMAC mismatches. This method only parses and extracts fields.

    const data = typeof body === "string" || Buffer.isBuffer(body)
      ? JSON.parse(body.toString())
      : body;

    const pl = data.payload || {};
    const order = pl.order?.entity || {};
    const payment = pl.payment?.entity || {};

    const statusMap: any = {
      paid: "SUCCESS",
      captured: "SUCCESS",
      failed: "FAILED",
    };

    const rawStatus = order.status || payment.status || "created";
    const status = statusMap[String(rawStatus).toLowerCase()] || "PENDING";

    const tenantId = order.notes?.tenant_id || payment.notes?.tenant_id || data.notes?.tenant_id || null;

    return {
      merchant_txn_id: order.receipt || payment.notes?.merchant_txn_id || payment.notes?.merchant_transaction_id || data.notes?.merchant_txn_id,
      gateway_txn_id: payment.id || order.id,
      provider_transaction_id: payment.id || null,
      provider_order_id: order.id || payment.order_id || null,
      provider_reference_id: payment.id || order.id || null,
      status: status,
      amount: (payment.amount || order.amount) / 100,
      provider_state: rawStatus,
      verification_state: signature ? "SIGNED" : "UNVERIFIED",
      raw_event: data,
      tenant_id: tenantId,
    };
  }

  async fetchStatus(merchant_txn_id: string, gateway_txn_id?: string): Promise<FetchStatusResult> {
    if (!gateway_txn_id) {
      throw new Error("Gateway ID (Order ID or Payment ID) required");
    }

    let orderId = gateway_txn_id;
    let paymentId: string | null = null;

    if (gateway_txn_id.startsWith("pay_")) {
      const payResponse = await axios.get(`${this.baseUrl}/v1/payments/${gateway_txn_id}`, this.auth);
      const payData = payResponse.data;
      paymentId = payData.id;
      orderId = payData.order_id;
    }

    const orderResponse = await axios.get(`${this.baseUrl}/v1/orders/${orderId}`, this.auth);
    const orderData = orderResponse.data;

    if (orderData.receipt !== merchant_txn_id) {
      throw new Error(`SECURITY_ERROR: Fetched Razorpay order receipt ${orderData.receipt} does not match expected merchant_txn_id ${merchant_txn_id}`);
    }

    const paymentsResponse = await axios.get(`${this.baseUrl}/v1/orders/${orderId}/payments`, this.auth);
    const paymentsData = paymentsResponse.data;

    const paymentList = paymentsData.items || [];
    const successfulPayment = paymentList.find((p: any) => p.status === "captured" || p.status === "authorized");
    const latestPayment = successfulPayment || paymentList[0];

    if (latestPayment) {
      paymentId = latestPayment.id;
    }

    const statusMap: any = {
      paid: "SUCCESS",
      created: "PENDING",
      attempted: "PENDING",
    };

    const rawStatus = orderData.status;
    let canonicalStatus = statusMap[String(rawStatus).toLowerCase()] || "PENDING";

    if (canonicalStatus !== "SUCCESS" && latestPayment?.status === "captured") {
      canonicalStatus = "SUCCESS";
    }

    const tenantId = orderData.notes?.tenant_id || latestPayment?.notes?.tenant_id || null;

    return {
      status: canonicalStatus,
      gateway_txn_id: orderId,
      provider_order_id: orderId,
      provider_transaction_id: paymentId,
      provider_reference_id: paymentId || orderId,
      provider_state: rawStatus,
      verification_state: "UNVERIFIED",
      raw_status: {
        order: orderData,
        payments: paymentsData,
      },
      tenant_id: tenantId,
    };
  }
}
