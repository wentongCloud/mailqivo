"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** TanStack Query Provider：在 (auth) 布局中包住所有业务页面。 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: false }
        }
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
