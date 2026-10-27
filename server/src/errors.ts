import type { ApiError } from "../../shared/api-types.ts";

// A class rather than a plain Error with properties bolted on, so the error
// middleware can tell a deliberate error from an unexpected one with a real
// runtime check (`instanceof`) instead of trusting a type annotation.
//
// Fields are declared explicitly, not as constructor parameter properties
// (`constructor(readonly status: number)`), because Node runs this file by
// stripping types, which only works for syntax that can simply be erased.
// `erasableSyntaxOnly` in tsconfig.json enforces that.
export class AppError extends Error {
  readonly status: number;
  readonly code: ApiError["code"];

  constructor(status: number, code: ApiError["code"], message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}
