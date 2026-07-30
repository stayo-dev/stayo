import { NextResponse } from "next/server";

export function apiError(message: string, code = "ERROR", status = 500, details?: any) {
  return NextResponse.json(
    { 
      success: false,
      error: { 
        message, 
        code,
        ...(details && { details })
      } 
    }, 
    { status }
  );
}

export function apiResponse(data: any, status = 200) {
  return NextResponse.json({
    success: true,
    ...(typeof data === 'object' && !Array.isArray(data) ? data : { data })
  }, { status });
}
