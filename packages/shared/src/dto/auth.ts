import { z } from "zod";

/** POST /api/auth/login 的请求体 */
export const LoginBody = z.object({
  password: z.string().min(1)
});
export type LoginBody = z.infer<typeof LoginBody>;
