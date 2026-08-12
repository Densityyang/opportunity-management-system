import type { RoleCode } from "@oms/contracts";

export interface AuthGrant {
  id: string;
  role: RoleCode;
  districtId: string | null;
  districtName: string | null;
}

export interface AuthIdentity {
  id: string;
  phone: string;
  displayName: string;
  mustChangePassword: boolean;
  grants: AuthGrant[];
  activeGrant: AuthGrant | null;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      identity?: AuthIdentity;
    }
  }
}
