export const CUSTOMER_TYPES = ["PERSONAL", "ORGANIZATION"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_ATTITUDES = [
  "URGENT",
  "IMPORTANT",
  "GENERAL",
  "POTENTIAL",
] as const;
export type CustomerAttitude = (typeof CUSTOMER_ATTITUDES)[number];

export const ROLE_CODES = [
  "FIELD_REPORTER",
  "DISTRICT_MANAGER",
  "PERSONAL_HANDLER",
  "ORGANIZATION_HANDLER",
  "MUNICIPAL",
  "SYSTEM_ADMIN",
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const OPPORTUNITY_STATES = [
  "PENDING_FIRST_REVIEW",
  "RETURNED_TO_REPORTER",
  "HANDLING",
  "PAUSED",
  "PENDING_FINAL_REVIEW",
  "RETURNED_TO_HANDLER",
  "CLOSED_SUCCESS",
  "CLOSED_FAILURE",
] as const;
export type OpportunityState = (typeof OPPORTUNITY_STATES)[number];

export const CONSENT_TEXT =
  "请确认客户已同意用于本次需求咨询。请勿填写客户身份证、银行卡、家庭成员等无关信息。";
export const ORGANIZATION_NOTE =
  "组织客户包含企业客户、政府及公共事业客户、个体工商户等";
export const SUCCESS_NAME_HINT = "请填写公司DICT系统项目名称";

export interface RoleGrantView {
  id: string;
  role: RoleCode;
  districtId: string | null;
  districtName: string | null;
}

export interface CurrentUserView {
  id: string;
  phone: string;
  displayName: string;
  mustChangePassword: boolean;
  grants: RoleGrantView[];
}

export interface DistrictView {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
}

export interface OpportunitySummary {
  id: string;
  serialNumber: string;
  state: OpportunityState;
  version: number;
  customerType: CustomerType;
  attitude: CustomerAttitude;
  district: DistrictView;
  oneSentenceDescription: string | null;
  successOpportunityName: string | null;
  submittedAt: string;
  updatedAt: string;
  currentSlaDeadline: string | null;
  currentSlaOverdue: boolean;
}

export interface OpportunityDetail extends OpportunitySummary {
  reporterPhone: string;
  customerContact: string;
  specificNeed: string;
  consentAt: string;
  failureReason: string | null;
  pausedUntil: string | null;
  audio: {
    id: string;
    mimeType: string;
    durationMs: number;
    deletedAt: string | null;
  } | null;
}

export interface WorkflowTimelineItem {
  id: string;
  eventType: string;
  fromState: OpportunityState | null;
  toState: OpportunityState;
  actorName: string | null;
  actorRole: RoleCode | null;
  note: string | null;
  occurredAt: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
