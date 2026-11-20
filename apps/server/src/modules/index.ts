/**
 * 路由模块注册表。新增模块：在 modules/<name>/routes.ts 导出 FastifyPluginAsync，
 * 然后在下面的数组中追加一项。`/api` 前缀下的路由默认要求登录（见 auth/plugin.ts），
 * 无需登录的 /api 路由在路由选项中写 `config: { public: true }`。
 */
import type { FastifyPluginAsync } from "fastify";
import { assetRoutes } from "./assets/routes.ts";
import { authRoutes } from "./auth/routes.ts";
import { campaignRoutes } from "./campaigns/routes.ts";
import { channelRoutes } from "./channels/routes.ts";
import { contactRoutes } from "./contacts/routes.ts";
import { importRoutes } from "./imports/routes.ts";
import { settingsRoutes } from "./settings/routes.ts";
import { signatureRoutes } from "./signatures/routes.ts";
import { tagRoutes } from "./tags/routes.ts";
import { templateRoutes } from "./templates/routes.ts";
import { systemRoutes } from "./system/routes.ts";
import { replyRoutes } from "./replies/routes.ts";
import { publicRoutes } from "./public/routes.ts";
import { trackingRoutes } from "./public/tracking.ts";
import { webhookRoutes } from "./public/webhooks.ts";

export type RouteModule = {
  prefix: string;
  plugin: FastifyPluginAsync;
};

export const routeModules: RouteModule[] = [
  { prefix: "/api/assets", plugin: assetRoutes },
  { prefix: "/api/auth", plugin: authRoutes },
  { prefix: "/api/campaigns", plugin: campaignRoutes },
  { prefix: "/api/channels", plugin: channelRoutes },
  { prefix: "/api/contacts", plugin: contactRoutes },
  { prefix: "/api/imports", plugin: importRoutes },
  { prefix: "/api/replies", plugin: replyRoutes },
  { prefix: "/api/settings", plugin: settingsRoutes },
  { prefix: "/api/signatures", plugin: signatureRoutes },
  { prefix: "/api/system", plugin: systemRoutes },
  { prefix: "/api/tags", plugin: tagRoutes },
  { prefix: "/api/templates", plugin: templateRoutes },
  { prefix: "/u", plugin: publicRoutes },
  { prefix: "/t", plugin: trackingRoutes },
  { prefix: "/webhooks", plugin: webhookRoutes }
];
