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
  "SENIOR_MUNICIPAL_ADMIN",
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

export const SPECIFIC_NEED_OPTIONS = [
  "想新装、升级宽带或专线",
  "家里、商铺或办公室网络不好",
  "想装监控、安防、门禁或考勤",
  "想了解全屋智能、智能家庭",
  "需要办公网络、园区网络或Wi-Fi建设",
  "需要云服务、网络安全、算力或AI应用",
  "需要通信工程、线路迁改或机房建设",
  "客户准备装修、搬家、开店或搬办公室",
  "不清楚具体产品，客户希望专业人员看看",
  "其他需求",
] as const;
export type SpecificNeedOption = (typeof SPECIFIC_NEED_OPTIONS)[number];

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
  sortOrder: number;
  coverage?: {
    fieldReporters: number;
    managers: number;
    personalHandlers: number;
    organizationHandlers: number;
  };
}

export interface AdminCapabilities {
  activeRole: "SYSTEM_ADMIN" | "SENIOR_MUNICIPAL_ADMIN" | "DISTRICT_MANAGER";
  districtId: string | null;
  manageableRoles: RoleCode[];
  canManageGlobalUsers: boolean;
  canManageDistricts: boolean;
  canViewPersonnel: boolean;
  canImportPersonnel: boolean;
  canBatchProvisionPersonnel: boolean;
  canManagePersonnelDistrictRules: boolean;
  canManagePositions: boolean;
  canManageRetention: boolean;
  canViewMunicipal: boolean;
}

export interface PersonnelView {
  id: string;
  personnelCode: string;
  name: string;
  personalPhone: string | null;
  workPhone: string | null;
  organizationPath: string | null;
  firstLevelOrganization: string | null;
  secondLevelOrganization: string | null;
  thirdLevelOrganization: string | null;
  positionName: string | null;
  businessLine: string | null;
  positionCategory: string | null;
  standardPosition: string | null;
  positionTags: string | null;
  employmentStatus: string | null;
  personnelType: string | null;
  cooperativeEnterprise: string | null;
  sourceProfile: "FULL_DIRECTORY" | "CONTACT_ONLY";
  recommendedRoles: RoleCode[];
  active: boolean;
  userId: string | null;
  lastSyncedAt: string;
}

export interface PersonnelImportView {
  id: string;
  fileName: string;
  mode: "UPSERT" | "SNAPSHOT";
  status: "PREVIEW" | "APPLIED" | "FAILED";
  sourceProfile: "FULL_DIRECTORY" | "CONTACT_ONLY";
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  deactivatedRows: number;
  skippedRows: number;
  accountsCreated: number;
  accountsLinked: number;
  warnings: string[];
  createdAt: string;
  completedAt: string | null;
}

export interface PersonnelPositionView {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  roles: RoleCode[];
}

export type PersonnelAccountBatchStatus =
  | "PREVIEWED"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "EXPIRED";

export type PersonnelAccountBatchItemStatus =
  | "ELIGIBLE"
  | "CREATED"
  | "SKIPPED_EXISTING"
  | "SKIPPED_INACTIVE"
  | "SKIPPED_NO_PHONE"
  | "SKIPPED_UNMAPPED"
  | "SKIPPED_AMBIGUOUS"
  | "FAILED";

export interface PersonnelDistrictRuleView {
  id: string;
  name: string;
  includeText: string;
  excludeText: string | null;
  priority: number;
  enabled: boolean;
  districtId: string;
  districtName: string;
  updatedAt: string;
}

export interface PersonnelAccountBatchView {
  id: string;
  search: string | null;
  status: PersonnelAccountBatchStatus;
  totalRows: number;
  eligibleRows: number;
  createdRows: number;
  skippedExistingRows: number;
  skippedInactiveRows: number;
  skippedNoPhoneRows: number;
  skippedUnmappedRows: number;
  skippedAmbiguousRows: number;
  failedRows: number;
  progressRows: number;
  districtCounts: Array<{ districtId: string; districtName: string; count: number }>;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
}

export interface PersonnelAccountBatchItemView {
  id: string;
  personnelId: string;
  personnelCode: string;
  name: string;
  sourceProfile: "FULL_DIRECTORY" | "CONTACT_ONLY";
  organizationPath: string | null;
  positionName: string | null;
  districtName: string | null;
  status: PersonnelAccountBatchItemStatus;
  reason: string | null;
  updatedAt: string;
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
  specificNeeds: SpecificNeedOption[];
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
  keyPersonName: string | null;
  note: string | null;
  occurredAt: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
