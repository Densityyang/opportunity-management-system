import React from "react";
import ReactDOM from "react-dom/client";
import { Refine } from "@refinedev/core";
import routerBindings from "@refinedev/react-router";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter } from "react-router-dom";
import { SessionProvider } from "./auth/session";
import { ApplicationRoutes } from "./routes";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#155eef",
          borderRadius: 10,
          colorBgLayout: "#f5f7fb",
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <SessionProvider>
            <Refine
              routerProvider={routerBindings}
              resources={[
                {
                  name: "opportunities",
                  list: "/opportunities",
                  create: "/report/new",
                  show: "/opportunities/:id",
                },
                {
                  name: "successes",
                  list: "/municipal/successes",
                  show: "/opportunities/:id",
                },
              ]}
              options={{ syncWithLocation: true, warnWhenUnsavedChanges: true }}
            >
              <ApplicationRoutes />
            </Refine>
          </SessionProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
