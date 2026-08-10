import { ApiResponse } from "../src/lib/api-response";
import { ApiError } from "../src/lib/api-error";

console.log(ApiResponse.error(ApiError.forbidden("Forbidden")));
