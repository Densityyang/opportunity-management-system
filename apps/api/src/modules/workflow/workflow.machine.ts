import { createMachine, getNextSnapshot } from "xstate";
import type { OpportunityState } from "../../generated/prisma/enums";

export type WorkflowEventType =
  | "FIRST_APPROVE"
  | "FIRST_RETURN"
  | "REPORTER_RESUBMIT"
  | "REASSIGN"
  | "HANDLER_PAUSE"
  | "HANDLER_RESUME"
  | "AUTO_RESUME"
  | "SUBMIT_SUCCESS"
  | "SUBMIT_FAILURE"
  | "FINAL_RETURN"
  | "FINAL_APPROVE_SUCCESS"
  | "FINAL_APPROVE_FAILURE";

export const workflowMachine = createMachine({
  id: "opportunity",
  initial: "PENDING_FIRST_REVIEW",
  states: {
    PENDING_FIRST_REVIEW: {
      on: {
        FIRST_APPROVE: "HANDLING",
        FIRST_RETURN: "RETURNED_TO_REPORTER",
      },
    },
    RETURNED_TO_REPORTER: {
      on: { REPORTER_RESUBMIT: "PENDING_FIRST_REVIEW" },
    },
    HANDLING: {
      on: {
        REASSIGN: { target: "HANDLING", reenter: false },
        HANDLER_PAUSE: "PAUSED",
        SUBMIT_SUCCESS: "PENDING_FINAL_REVIEW",
        SUBMIT_FAILURE: "PENDING_FINAL_REVIEW",
      },
    },
    PAUSED: {
      on: {
        REASSIGN: { target: "PAUSED", reenter: false },
        HANDLER_RESUME: "HANDLING",
        AUTO_RESUME: "HANDLING",
      },
    },
    PENDING_FINAL_REVIEW: {
      on: {
        FINAL_RETURN: "RETURNED_TO_HANDLER",
        FINAL_APPROVE_SUCCESS: "CLOSED_SUCCESS",
        FINAL_APPROVE_FAILURE: "CLOSED_FAILURE",
      },
    },
    RETURNED_TO_HANDLER: {
      on: {
        SUBMIT_SUCCESS: "PENDING_FINAL_REVIEW",
        SUBMIT_FAILURE: "PENDING_FINAL_REVIEW",
      },
    },
    CLOSED_SUCCESS: { type: "final" },
    CLOSED_FAILURE: { type: "final" },
  },
});

export function getNextWorkflowState(
  current: OpportunityState,
  eventType: WorkflowEventType,
): OpportunityState | null {
  const snapshot = workflowMachine.resolveState({
    value: current,
    context: {},
  });
  const event = { type: eventType } as { type: WorkflowEventType };
  if (!snapshot.can(event)) return null;
  return getNextSnapshot(workflowMachine, snapshot, event)
    .value as OpportunityState;
}
