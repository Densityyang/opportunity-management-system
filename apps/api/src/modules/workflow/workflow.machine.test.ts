import assert from "node:assert/strict";
import test from "node:test";
import { getNextWorkflowState } from "./workflow.machine";

test("first review follows the 24-hour review path", () => {
  assert.equal(
    getNextWorkflowState("PENDING_FIRST_REVIEW", "FIRST_APPROVE"),
    "HANDLING",
  );
  assert.equal(
    getNextWorkflowState("PENDING_FIRST_REVIEW", "FIRST_RETURN"),
    "RETURNED_TO_REPORTER",
  );
});

test("handler outcomes return to the final review node", () => {
  assert.equal(
    getNextWorkflowState("HANDLING", "SUBMIT_SUCCESS"),
    "PENDING_FINAL_REVIEW",
  );
  assert.equal(
    getNextWorkflowState("HANDLING", "SUBMIT_FAILURE"),
    "PENDING_FINAL_REVIEW",
  );
  assert.equal(
    getNextWorkflowState("PENDING_FINAL_REVIEW", "FINAL_APPROVE_SUCCESS"),
    "CLOSED_SUCCESS",
  );
  assert.equal(
    getNextWorkflowState("PENDING_FINAL_REVIEW", "FINAL_APPROVE_FAILURE"),
    "CLOSED_FAILURE",
  );
});

test("terminal states and invalid transitions are rejected", () => {
  assert.equal(getNextWorkflowState("CLOSED_SUCCESS", "FIRST_APPROVE"), null);
  assert.equal(
    getNextWorkflowState("PENDING_FIRST_REVIEW", "FINAL_APPROVE_SUCCESS"),
    null,
  );
});
