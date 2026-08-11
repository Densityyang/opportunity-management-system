import type { CurrentUserView, RoleGrantView } from "@oms/contracts";
import { App, Spin } from "antd";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, getActiveGrantId, setActiveGrantId } from "../api/client";

interface SessionContextValue {
  user: CurrentUserView | null;
  activeGrant: RoleGrantView | null;
  loading: boolean;
  login(phone: string, password: string): Promise<CurrentUserView>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  selectGrant(grantId: string): void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<CurrentUserView | null>(null);
  const [loading, setLoading] = useState(true);

  const acceptUser = useCallback((next: CurrentUserView | null) => {
    setUser(next);
    if (!next) {
      setActiveGrantId(null);
      return;
    }
    const saved = getActiveGrantId();
    if (!saved || !next.grants.some((grant) => grant.id === saved))
      setActiveGrantId(next.grants[0]?.id ?? null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      acceptUser(await api<CurrentUserView>("/auth/me"));
    } catch {
      acceptUser(null);
    } finally {
      setLoading(false);
    }
  }, [acceptUser]);

  useEffect(() => void refresh(), [refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      activeGrant:
        user?.grants.find((grant) => grant.id === getActiveGrantId()) ?? null,
      loading,
      async login(phone, password) {
        const next = await api<CurrentUserView>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ phone, password }),
        });
        acceptUser(next);
        return next;
      },
      async logout() {
        await api("/auth/logout", { method: "POST" });
        acceptUser(null);
      },
      refresh,
      selectGrant(grantId) {
        setActiveGrantId(grantId);
        setUser((current) => (current ? { ...current } : null));
      },
    }),
    [user, loading, refresh, acceptUser],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

export function RequireSession({ children }: PropsWithChildren) {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading)
    return (
      <div className="center-screen">
        <Spin size="large" />
      </div>
    );
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== "/change-password")
    return <Navigate to="/change-password" replace />;
  return children;
}
