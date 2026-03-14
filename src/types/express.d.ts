import type { AuthContext } from "../auth/api-keys.js";

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      auth?: AuthContext;
    }
  }
}
