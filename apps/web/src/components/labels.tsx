import { Tag } from "antd";
import type {
  CustomerAttitude,
  CustomerType,
  OpportunityState,
  RoleCode,
} from "@oms/contracts";

export const customerTypeLabels: Record<CustomerType, string> = {
  PERSONAL: "个人客户",
  ORGANIZATION: "组织客户",
};
export const attitudeLabels: Record<CustomerAttitude, string> = {
  URGENT: "紧急",
  IMPORTANT: "重要",
  GENERAL: "一般",
  POTENTIAL: "潜在",
};
export const stateLabels: Record<OpportunityState, string> = {
  PENDING_FIRST_REVIEW: "待区县初审",
  RETURNED_TO_REPORTER: "退回上报人",
  HANDLING: "沟通处理中",
  PAUSED: "暂缓处理",
  PENDING_FINAL_REVIEW: "待区县终审",
  RETURNED_TO_HANDLER: "退回承接人",
  CLOSED_SUCCESS: "成功办结",
  CLOSED_FAILURE: "失败办结",
};
export const roleLabels: Record<RoleCode, string> = {
  FIELD_REPORTER: "一线上报人",
  DISTRICT_MANAGER: "区县经理",
  PERSONAL_HANDLER: "个人侧管理员",
  ORGANIZATION_HANDLER: "组织侧管理员",
  MUNICIPAL: "市公司",
  SENIOR_MUNICIPAL_ADMIN: "高级市公司管理员",
  SYSTEM_ADMIN: "系统管理员",
};

export function StateTag({ state }: { state: OpportunityState }) {
  const color =
    state === "CLOSED_SUCCESS"
      ? "success"
      : state === "CLOSED_FAILURE"
        ? "default"
        : state.includes("RETURNED")
          ? "warning"
          : state.includes("PENDING")
            ? "processing"
            : state === "PAUSED"
              ? "gold"
              : "blue";
  return <Tag color={color}>{stateLabels[state]}</Tag>;
}
