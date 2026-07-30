import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard utility for merging tailwind classes (client & server safe)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Clean and validate phone numbers
 */
export function formatPhoneNumber(phone: string) {
  const cleaned = phone.replace(/\D/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

/**
 * Sleep utility for development/retry logic
 */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deep clone for objects
 */
export const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));
