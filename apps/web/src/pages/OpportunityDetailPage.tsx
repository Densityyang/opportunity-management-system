import {
  ArrowLeftOutlined,
  CheckOutlined,
  EditOutlined,
  PauseOutlined,
  RedoOutlined,
  RetweetOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type { OpportunityDetail, WorkflowTimelineItem } from "@oms/contracts";
import {
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Timeline,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, transition } from "../api/client";
import { useSession } from "../auth/session";
import { AudioRecorder } from "../components/AudioRecorder";
import { ProtectedAudio } from "../components/ProtectedAudio";
import {
  attitudeLabels,
  customerTypeLabels,
  roleLabels,
  StateTag,
  stateLabels,
} from "../components/labels";

type Action =
  | "firstReturn"
  | "reassign"
  | "pause"
  | "success"
  | "failure"
  | "finalReturn"
  | null;
interface HandlerOption {
  id: string;
  userName: string;
}

const eventLabels: Record<string, string> = {
  SUBMITTED: "一线上报",
  REPORTER_RESUBMIT: "修改后重新提交",
  FIRST_APPROVE: "区县初审通过",
  FIRST_RETURN: "区县初审退回",
  REASSIGN: "调整承接人",
  HANDLER_PAUSE: "暂缓处理",
  HANDLER_RESUME: "提前恢复处理",
  AUTO_RESUME: "到期自动恢复",
  SUBMIT_SUCCESS: "提交成功结果",
  SUBMIT_FAILURE: "提交失败结果",
  FINAL_RETURN: "终审退回",
  FINAL_APPROVE_SUCCESS: "成功办结",
  FINAL_APPROVE_FAILURE: "失败办结",
};

export function OpportunityDetailPage() {
  const { opportunityId = "" } = useParams();
  const { activeGrant } = useSession();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [item, setItem] = useState<OpportunityDetail | null>(null);
  const [timeline, setTimeline] = useState<WorkflowTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [handlers, setHandlers] = useState<HandlerOption[]>([]);
  const [actionForm] = Form.useForm();
  const [newAudio, setNewAudio] = useState<Blob | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      if (activeGrant?.role === "MUNICIPAL") {
        const combined = await api<
          OpportunityDetail & { timeline: WorkflowTimelineItem[] }
        >(`/municipal/successes/${opportunityId}`);
        setItem(combined);
        setTimeline(combined.timeline);
      } else {
        const [detail, events] = await Promise.all([
          api<OpportunityDetail>(`/opportunities/${opportunityId}`),
          api<WorkflowTimelineItem[]>(
            `/opportunities/${opportunityId}/timeline`,
          ),
        ]);
        setItem(detail);
        setTimeline(events);
      }
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => void load(), [opportunityId, activeGrant?.id]);

  async function run(
    path: string,
    body: Record<string, unknown> = {},
  ): Promise<void> {
    if (!item) return;
    try {
      await transition(path, { expectedVersion: item.version, ...body });
      void message.success("操作已完成");
      setAction(null);
      actionForm.resetFields();
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  async function confirmApprove(kind: "first" | "final") {
    modal.confirm({
      title: kind === "first" ? "确认初审通过并分派？" : "确认终审通过并办结？",
      content:
        kind === "first"
          ? "系统将按区县和客户类型分派默认承接人。"
          : "办结后成功商机名称将冻结。",
      onOk: () =>
        run(`/opportunities/${opportunityId}/reviews/${kind}/approve`),
    });
  }

  async function openReassign(): Promise<void> {
    if (!item) return;
    try {
      setHandlers(
        await api<HandlerOption[]>(
          `/reference/handlers?districtId=${item.district.id}&customerType=${item.customerType}`,
        ),
      );
      setAction("reassign");
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "承接人加载失败",
      );
    }
  }

  async function submitAction(values: {
    reason?: string;
    handlerGrantId?: string;
    nextProcessingAt?: Dayjs;
    successOpportunityName?: string;
    failureReason?: string;
  }) {
    const paths: Record<Exclude<Action, null>, string> = {
      firstReturn: "reviews/first/return",
      reassign: "assignments/reassign",
      pause: "pause",
      success: "results/success",
      failure: "results/failure",
      finalReturn: "reviews/final/return",
    };
    if (!action) return;
    const body: Record<string, unknown> = {};
    if (values.reason) body.reason = values.reason;
    if (values.handlerGrantId) body.handlerGrantId = values.handlerGrantId;
    if (values.nextProcessingAt)
      body.nextProcessingAt = values.nextProcessingAt.toISOString();
    if (values.successOpportunityName)
      body.successOpportunityName = values.successOpportunityName;
    if (values.failureReason) body.failureReason = values.failureReason;
    await run(`/opportunities/${opportunityId}/${paths[action]}`, body);
  }

  async function uploadAudio(): Promise<void> {
    if (!newAudio) return;
    const formData = new FormData();
    formData.append(
      "audio",
      newAudio,
      newAudio.type.includes("mp4") ? "recording.m4a" : "recording.webm",
    );
    try {
      await api(`/opportunities/${opportunityId}/audio`, {
        method: "POST",
        body: formData,
      });
      setNewAudio(null);
      void message.success("录音已保存");
      await load();
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "录音上传失败",
      );
    }
  }

  async function removeAudio(): Promise<void> {
    try {
      await api(`/opportunities/${opportunityId}/audio`, { method: "DELETE" });
      void message.success("录音已删除");
      await load();
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "录音删除失败",
      );
    }
  }

  if (loading)
    return (
      <div className="center-screen">
        <Spin size="large" />
      </div>
    );
  if (!item)
    return (
      <Card>
        <Typography.Text>未找到商机或无权查看。</Typography.Text>
      </Card>
    );
  const role = activeGrant?.role;
  const canAttachAudio =
    role === "FIELD_REPORTER" &&
    ["PENDING_FIRST_REVIEW", "RETURNED_TO_REPORTER"].includes(item.state);
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card className="page-card">
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Space>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(-1)}
            />
            <div>
              <Typography.Title level={2} className="page-title">
                {item.serialNumber}
              </Typography.Title>
              <StateTag state={item.state} />
            </div>
          </Space>
          <Typography.Text type="secondary">
            版本 {item.version}
          </Typography.Text>
        </Space>
        <Divider />
        <div className="detail-grid">
          <Field label="上报人电话" value={item.reporterPhone} />
          <Field
            label="客户类型"
            value={customerTypeLabels[item.customerType]}
          />
          <Field label="商机承载区域（区县）" value={item.district.name} />
          <Field label="客户态度" value={attitudeLabels[item.attitude]} />
          <Field label="客户联系方式" value={item.customerContact} />
          <Field
            label="一句话说明"
            value={item.oneSentenceDescription ?? "—"}
          />
          <div className="detail-field" style={{ gridColumn: "1 / -1" }}>
            <Field label="具体需求" value={item.specificNeed} />
          </div>
          {item.successOpportunityName && (
            <div className="detail-field" style={{ gridColumn: "1 / -1" }}>
              <Field
                label="成功商机名称"
                value={item.successOpportunityName}
                hint="公司 DICT 系统项目名称"
              />
            </div>
          )}
          {item.failureReason && (
            <div className="detail-field" style={{ gridColumn: "1 / -1" }}>
              <Field label="失败原因" value={item.failureReason} />
            </div>
          )}
          {item.pausedUntil && (
            <Field
              label="下次处理时间"
              value={new Date(item.pausedUntil).toLocaleString("zh-CN")}
            />
          )}
          <Field
            label="授权确认时间"
            value={new Date(item.consentAt).toLocaleString("zh-CN")}
          />
          {item.currentSlaDeadline && (
            <Field
              label="当前审批时限"
              value={`${new Date(item.currentSlaDeadline).toLocaleString("zh-CN")}${item.currentSlaOverdue ? "（已超时）" : ""}`}
            />
          )}
        </div>
        {item.audio && !item.audio.deletedAt && (
          <>
            <Divider orientation="left">语音录音</Divider>
            <ProtectedAudio opportunityId={item.id} />
            {canAttachAudio && (
              <Button
                danger
                style={{ marginLeft: 12 }}
                onClick={() => void removeAudio()}
              >
                删除录音
              </Button>
            )}
          </>
        )}
        {canAttachAudio && (!item.audio || item.audio.deletedAt) && (
          <>
            <Divider orientation="left">补充语音录音（选填）</Divider>
            <AudioRecorder value={newAudio} onChange={setNewAudio} />
            {newAudio && (
              <Button
                type="primary"
                style={{ marginTop: 12 }}
                onClick={() => void uploadAudio()}
              >
                保存录音
              </Button>
            )}
          </>
        )}
      </Card>

      <Card title="流转记录" className="page-card">
        <Timeline
          items={timeline.map((event) => ({
            color: event.toState.startsWith("CLOSED")
              ? "green"
              : event.toState.includes("RETURNED")
                ? "orange"
                : "blue",
            children: (
              <div>
                <Typography.Text strong>
                  {eventLabels[event.eventType] ?? event.eventType}
                </Typography.Text>
                <div>
                  {event.actorName ?? "系统"}
                  {event.actorRole ? ` · ${roleLabels[event.actorRole]}` : ""}
                </div>
                {event.note && (
                  <Typography.Paragraph style={{ margin: "4px 0" }}>
                    {event.note}
                  </Typography.Paragraph>
                )}
                <Typography.Text type="secondary">
                  {new Date(event.occurredAt).toLocaleString("zh-CN")} ·{" "}
                  {stateLabels[event.toState]}
                </Typography.Text>
              </div>
            ),
          }))}
        />
      </Card>

      <ActionBar
        item={item}
        role={role}
        onFirstApprove={() => void confirmApprove("first")}
        onFirstReturn={() => setAction("firstReturn")}
        onReassign={() => void openReassign()}
        onPause={() => setAction("pause")}
        onResume={() => void run(`/opportunities/${opportunityId}/resume`)}
        onSuccess={() => setAction("success")}
        onFailure={() => setAction("failure")}
        onFinalApprove={() => void confirmApprove("final")}
        onFinalReturn={() => setAction("finalReturn")}
        onEdit={() => navigate(`/report/${opportunityId}/edit`)}
      />

      <Modal
        open={Boolean(action)}
        title={actionTitle(action)}
        okText="确认提交"
        cancelText="取消"
        onCancel={() => {
          setAction(null);
          actionForm.resetFields();
        }}
        onOk={() => actionForm.submit()}
        destroyOnClose
      >
        <Form
          form={actionForm}
          layout="vertical"
          onFinish={(values) => void submitAction(values)}
        >
          {(action === "firstReturn" || action === "finalReturn") && (
            <Form.Item
              name="reason"
              label="退回原因"
              rules={[{ required: true, whitespace: true }, { max: 500 }]}
            >
              <Input.TextArea rows={4} maxLength={500} showCount />
            </Form.Item>
          )}
          {action === "reassign" && (
            <>
              <Form.Item
                name="handlerGrantId"
                label="新承接人"
                rules={[{ required: true }]}
              >
                <Select
                  options={handlers.map((handler) => ({
                    value: handler.id,
                    label: handler.userName,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="reason"
                label="改派原因"
                rules={[{ required: true, whitespace: true }, { max: 500 }]}
              >
                <Input.TextArea rows={3} maxLength={500} showCount />
              </Form.Item>
            </>
          )}
          {action === "pause" && (
            <Form.Item
              name="nextProcessingAt"
              label="下次处理时间"
              rules={[{ required: true }]}
            >
              <DatePicker
                showTime
                style={{ width: "100%" }}
                disabledDate={(date) => date.endOf("day") < dayjs()}
              />
            </Form.Item>
          )}
          {action === "success" && (
            <Form.Item
              name="successOpportunityName"
              label="成功商机名称"
              extra="请填写公司DICT系统项目名称"
              rules={[{ required: true, whitespace: true }, { max: 200 }]}
            >
              <Input maxLength={200} showCount />
            </Form.Item>
          )}
          {action === "failure" && (
            <Form.Item
              name="failureReason"
              label="失败原因"
              rules={[{ required: true, whitespace: true }, { max: 500 }]}
            >
              <Input.TextArea rows={4} maxLength={500} showCount />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Space>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="detail-field">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value}</div>
      {hint && <div className="form-note">{hint}</div>}
    </div>
  );
}

function ActionBar(props: {
  item: OpportunityDetail;
  role?: string;
  onFirstApprove(): void;
  onFirstReturn(): void;
  onReassign(): void;
  onPause(): void;
  onResume(): void;
  onSuccess(): void;
  onFailure(): void;
  onFinalApprove(): void;
  onFinalReturn(): void;
  onEdit(): void;
}) {
  const { item, role } = props;
  const buttons: React.ReactNode[] = [];
  if (role === "FIELD_REPORTER" && item.state === "RETURNED_TO_REPORTER")
    buttons.push(
      <Button
        key="edit"
        type="primary"
        icon={<EditOutlined />}
        onClick={props.onEdit}
      >
        修改并重新提交
      </Button>,
    );
  if (role === "DISTRICT_MANAGER" && item.state === "PENDING_FIRST_REVIEW")
    buttons.push(
      <Button
        key="approve"
        type="primary"
        icon={<CheckOutlined />}
        onClick={props.onFirstApprove}
      >
        初审通过
      </Button>,
      <Button
        key="return"
        icon={<StopOutlined />}
        onClick={props.onFirstReturn}
      >
        退回修改
      </Button>,
    );
  if (
    role === "DISTRICT_MANAGER" &&
    ["HANDLING", "PAUSED"].includes(item.state)
  )
    buttons.push(
      <Button
        key="reassign"
        icon={<RetweetOutlined />}
        onClick={props.onReassign}
      >
        调整承接人
      </Button>,
    );
  if (role === "DISTRICT_MANAGER" && item.state === "PENDING_FINAL_REVIEW")
    buttons.push(
      <Button
        key="finalApprove"
        type="primary"
        icon={<CheckOutlined />}
        onClick={props.onFinalApprove}
      >
        终审通过并办结
      </Button>,
      <Button key="finalReturn" onClick={props.onFinalReturn}>
        退回承接人
      </Button>,
    );
  if (["PERSONAL_HANDLER", "ORGANIZATION_HANDLER"].includes(role ?? "")) {
    if (item.state === "HANDLING")
      buttons.push(
        <Button key="pause" icon={<PauseOutlined />} onClick={props.onPause}>
          暂缓
        </Button>,
      );
    if (item.state === "PAUSED")
      buttons.push(
        <Button key="resume" icon={<RedoOutlined />} onClick={props.onResume}>
          提前恢复
        </Button>,
      );
    if (["HANDLING", "RETURNED_TO_HANDLER"].includes(item.state))
      buttons.push(
        <Button key="success" type="primary" onClick={props.onSuccess}>
          成功
        </Button>,
        <Button key="failure" danger onClick={props.onFailure}>
          失败
        </Button>,
      );
  }
  return buttons.length ? (
    <div className="action-bar">
      <Space wrap>{buttons}</Space>
    </div>
  ) : null;
}

function actionTitle(action: Action): string {
  return (
    (
      {
        firstReturn: "退回上报人",
        reassign: "调整承接人",
        pause: "暂缓处理",
        success: "填报成功商机",
        failure: "填报失败结果",
        finalReturn: "退回承接人",
      } as Record<string, string>
    )[action ?? ""] ?? ""
  );
}
