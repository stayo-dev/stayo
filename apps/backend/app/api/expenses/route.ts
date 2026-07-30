import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { expenseService } from "@/lib/services/expense-service";
import { imagekit } from "@/lib/imagekit";
import { safePagination, assertBodySize } from "@/lib/security/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_RECEIPT_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_RECEIPT_SIZE = 4 * 1024 * 1024;

async function parseExpenseCreateBody(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return { body: await req.json(), receiptFile: null as File | null };
  }

  const formData = await req.formData();
  const rawExpense = formData.get("expense_data");
  const body = rawExpense ? JSON.parse(String(rawExpense)) : {};
  const receiptFile = formData.get("receipt_image");
  return {
    body,
    receiptFile: receiptFile instanceof File && receiptFile.size > 0 ? receiptFile : null,
  };
}

async function uploadReceiptImage(file: File, ownerId: string, hostelId: string | undefined) {
  if (!ALLOWED_RECEIPT_MIME.includes(file.type)) {
    throw new Error("VALIDATION: Receipt must be a JPG, PNG, or WEBP image");
  }
  if (file.size > MAX_RECEIPT_SIZE) {
    throw new Error("VALIDATION: Receipt image must be under 4MB");
  }

  const extension = file.name?.split(".").pop() || "jpg";
  const buffer = Buffer.from(await file.arrayBuffer());
  const upload = await imagekit.files.upload({
    file: buffer.toString("base64"),
    fileName: `expense_receipt_${Date.now()}.${extension}`,
    folder: hostelId
      ? `owners/${ownerId}/hostels/${hostelId}/expenses/receipts`
      : `owners/${ownerId}/business-expenses/receipts`,
    useUniqueFileName: true,
    tags: ["expense_receipt", hostelId || "business"],
  });

  if (!upload?.url) throw new Error("UPLOAD_FAILED: Receipt upload failed");
  return upload.url;
}


/**
 * 💸 Expenses Collection
 * Access: Owner/Admin only
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);

    // Mode-based routing for intelligence features
    const mode = req.nextUrl.searchParams.get("mode");
    if (mode === "suggestions") {
      const suggestions = await expenseService.getFrequentExpenses(scope.owner_id);
      return apiResponse({ frequent_expenses: suggestions });
    }
    if (mode === "title_summary") {
      const title = req.nextUrl.searchParams.get("title");
      if (!title) return apiError("Title parameter is required for title_summary mode", "VALIDATION_ERROR", 400);
      const summary = await expenseService.getExpenseTitleSummary(scope.owner_id, title);
      return apiResponse(summary);
    }

    const hostelId = req.nextUrl.searchParams.get("hostelId") || undefined;
    if (hostelId) await requireHostelBelongsToOwner(scope.owner_id, hostelId);
    const categories = req.nextUrl.searchParams.get("categories");
    const { limit, offset } = safePagination(req.nextUrl.searchParams.get("limit"), req.nextUrl.searchParams.get("offset"));

    const recurringParam = req.nextUrl.searchParams.get("recurring");
    const recurring = recurringParam === null || recurringParam === "" ? undefined : recurringParam === "true";

    const amountMinParam = req.nextUrl.searchParams.get("amountMin");
    const amountMaxParam = req.nextUrl.searchParams.get("amountMax");
    const amountMin = amountMinParam !== null && amountMinParam !== "" ? Number(amountMinParam) : undefined;
    const amountMax = amountMaxParam !== null && amountMaxParam !== "" ? Number(amountMaxParam) : undefined;
    if (amountMin !== undefined && !Number.isFinite(amountMin)) {
      return apiError("amountMin must be a valid number", "VALIDATION_ERROR", 400);
    }
    if (amountMax !== undefined && !Number.isFinite(amountMax)) {
      return apiError("amountMax must be a valid number", "VALIDATION_ERROR", 400);
    }

    const expenses = await expenseService.getAllExpenses(scope.owner_id, {
      range: req.nextUrl.searchParams.get("range") || undefined,
      startDate: req.nextUrl.searchParams.get("startDate") || undefined,
      endDate: req.nextUrl.searchParams.get("endDate") || undefined,
      hostelId,
      categories: categories ? categories.split(",").filter(Boolean) : undefined,
      status: req.nextUrl.searchParams.get("status") || undefined,
      sort: req.nextUrl.searchParams.get("sort") || undefined,
      search: req.nextUrl.searchParams.get("search") || undefined,
      recurring,
      amountMin,
      amountMax,
      limit,
      offset,
    });
    return apiResponse(expenses);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch expenses");
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const { body, receiptFile } = await parseExpenseCreateBody(req);

    if (!body.title || !body.amount || !body.date || !body.category) {
      return apiError("Missing required fields: title, amount, date, category", "VALIDATION_ERROR", 400);
    }

    if (body.hostelId) await requireHostelBelongsToOwner(scope.owner_id, body.hostelId);

    const receiptUrl = receiptFile
      ? await uploadReceiptImage(receiptFile, scope.owner_id, body.hostelId)
      : body.receipt_url;

    const expense = await expenseService.createExpense({
      owner_id: scope.owner_id,
      title: body.title,
      amount: Number(body.amount),
      date: body.date,
      category: body.category,
      status: body.status || "paid",
      hostel_id: body.hostelId || null,
      notes: body.notes,
      vendor_name: body.vendor_name,
      payment_method: body.payment_method,
      receipt_url: receiptUrl,
      is_recurring: body.is_recurring,
      recurring_frequency: body.recurring_frequency,
      created_by: session.sub,
      expense_type: body.expense_type,
      expense_scope: body.expense_scope ?? body.expenseScope ?? "BUSINESS",
      // operational_type is intentionally not read from the request body — it is
      // always derived server-side from category (see expenseService.createExpense).
      tags: Array.isArray(body.tags) ? body.tags : [],
      metadata: body.metadata,
    });
    return apiResponse(expense, 201);
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg.startsWith("VALIDATION"))
      return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("UPLOAD_FAILED"))
      return apiError(msg.split(": ")[1] ?? msg, "UPLOAD_FAILED", 502);
    return apiError(msg || "Failed to create expense");
  }
}
