import { z } from "zod";

export const PaymentInitiateSchema = z.object({
  obligation_id: z.string().uuid(),
  amount: z.number().positive(),
  method: z.string().default("UPI"),
});

export const ExpenseCreateSchema = z.object({
  title: z.string().min(3),
  amount: z.number().positive(),
  category: z.string(),
  date: z.string().transform((val) => new Date(val)),
});

export * from "./queries";
