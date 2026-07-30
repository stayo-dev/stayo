import { Role } from "@prisma/client";

export interface UserContext {
  userId: string;
  email: string;
  role: Role;
  studentId?: string | null;
}

export type ApiResponse<T> = {
  data?: T;
  error?: {
    message: string;
    code: string;
  };
};

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
