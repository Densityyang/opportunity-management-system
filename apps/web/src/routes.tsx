import { Alert } from "antd";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireSession, useSession } from "./auth/session";
import { AppLayout } from "./layouts/AppLayout";
import { AdminPage } from "./pages/AdminPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OpportunityDetailPage } from "./pages/OpportunityDetailPage";
import { OpportunityListPage } from "./pages/OpportunityListPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ReportPage } from "./pages/ReportPage";
import { SuccessLibraryPage } from "./pages/SuccessLibraryPage";

export function ApplicationRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/change-password"
        element={
          <RequireSession>
            <ChangePasswordPage />
          </RequireSession>
        }
      />
      <Route path="/privacy" element={<PrivacyRoute />} />
      <Route
        path="/*"
        element={
          <RequireSession>
            <AppLayout>
              <Routes>
                <Route index element={<HomeRedirect />} />
                <Route
                  path="report/new"
                  element={
                    <RolePage roles={["FIELD_REPORTER"]}>
                      <ReportPage />
                    </RolePage>
                  }
                />
                <Route
                  path="report/:opportunityId/edit"
                  element={
                    <RolePage roles={["FIELD_REPORTER"]}>
                      <ReportPage />
                    </RolePage>
                  }
                />
                <Route
                  path="opportunities"
                  element={
                    <RolePage
                      roles={[
                        "FIELD_REPORTER",
                        "DISTRICT_MANAGER",
                        "PERSONAL_HANDLER",
                        "ORGANIZATION_HANDLER",
                      ]}
                    >
                      <OpportunityListPage />
                    </RolePage>
                  }
                />
                <Route
                  path="opportunities/:opportunityId"
                  element={<OpportunityDetailPage />}
                />
                <Route
                  path="municipal/successes"
                  element={
                    <RolePage roles={["MUNICIPAL", "SENIOR_MUNICIPAL_ADMIN"]}>
                      <SuccessLibraryPage />
                    </RolePage>
                  }
                />
                <Route
                  path="admin"
                  element={
                    <RolePage
                      roles={[
                        "SYSTEM_ADMIN",
                        "SENIOR_MUNICIPAL_ADMIN",
                        "DISTRICT_MANAGER",
                      ]}
                    >
                      <AdminPage />
                    </RolePage>
                  }
                />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppLayout>
          </RequireSession>
        }
      />
    </Routes>
  );
}

function HomeRedirect() {
  const { activeGrant } = useSession();
  if (!activeGrant)
    return (
      <Alert
        type="warning"
        showIcon
        message="当前账号没有有效角色，请联系系统管理员配置。"
      />
    );
  if (activeGrant.role === "MUNICIPAL")
    return <Navigate to="/municipal/successes" replace />;
  if (["SYSTEM_ADMIN", "SENIOR_MUNICIPAL_ADMIN"].includes(activeGrant.role))
    return <Navigate to="/admin" replace />;
  if (activeGrant.role === "FIELD_REPORTER")
    return <Navigate to="/report/new" replace />;
  return <Navigate to="/opportunities" replace />;
}

function RolePage({
  roles,
  children,
}: {
  roles: string[];
  children: React.ReactNode;
}) {
  const { activeGrant } = useSession();
  return activeGrant && roles.includes(activeGrant.role) ? (
    children
  ) : (
    <Alert type="error" showIcon message="当前角色无权访问该页面" />
  );
}

function PrivacyRoute() {
  const { user } = useSession();
  return user ? (
    <RequireSession>
      <AppLayout>
        <PrivacyPage />
      </AppLayout>
    </RequireSession>
  ) : (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <PrivacyPage />
    </div>
  );
}
