import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { queryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* DevTools only bundled in development — tree-shaken in production builds */}
      <ReactQueryDevtools
        initialIsOpen={false}
        buttonPosition="bottom-left"
      />
    </QueryClientProvider>
  </React.StrictMode>,
);
