import path from "node:path";
import type { NextConfig } from "next";
import { config } from "dotenv";
import createNextIntlPlugin from "next-intl/plugin";

// 环境变量统一放在仓库根目录的 .env（§2.1）
config({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });
config({ quiet: true });

// 仅 apps/web 使用：开发时 rewrites 的目标地址。生产环境由反向代理按同样规则分流（§11.1）。
const serverInternalUrl = (process.env.SERVER_INTERNAL_URL || "http://localhost:18091").replace(
  /\/+$/,
  ""
);

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // 套件原有的 assetPrefix（指向套件作者的 CDN）已按 §11.1 删除。
  transpilePackages: ["@mailqivo/shared"],
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost"
      },
      {
        protocol: "https",
        hostname: "**"
      }
    ]
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${serverInternalUrl}/api/:path*` },
      { source: "/t/:path*", destination: `${serverInternalUrl}/t/:path*` },
      { source: "/u/:path*", destination: `${serverInternalUrl}/u/:path*` },
      { source: "/webhooks/:path*", destination: `${serverInternalUrl}/webhooks/:path*` },
      { source: "/mcp", destination: `${serverInternalUrl}/mcp` },
      { source: "/healthz", destination: `${serverInternalUrl}/healthz` }
    ];
  }
};

export default withNextIntl(nextConfig);
