/** §5.1 Web UI 鉴权相关的共享常量（前后端共用）。 */

/** 登录后下发的签名 httpOnly Cookie 名。apps/web 的 proxy.ts 只检查它是否存在。 */
export const SESSION_COOKIE_NAME = "mailqivo_session";

/** Cookie 有效期：7 天（秒） */
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;
