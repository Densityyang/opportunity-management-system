import {
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import type {
  AdminCapabilities,
  DistrictView,
  PersonnelAccountBatchItemView,
  PersonnelAccountBatchView,
  PersonnelDistrictRuleView,
} from "@oms/contracts";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, download } from "../api/client";

type Props = {
  capabilities: AdminCapabilities;
  districts: DistrictView[];
  search: string;
};

const statusLabels: Record<string, string> = {
  PREVIEWED: "待确认",
  QUEUED: "排队中",
  RUNNING: "处理中",
  COMPLETED: "已完成",
  PARTIAL: "部分完成",
  FAILED: "失败",
  EXPIRED: "已过期",
};

const itemStatusLabels: Record<string, string> = {
  ELIGIBLE: "待开户",
  CREATED: "已开户",
  SKIPPED_EXISTING: "已有账号，已跳过",
  SKIPPED_INACTIVE: "人员停用，已跳过",
  SKIPPED_NO_PHONE: "无有效手机号，已跳过",
  SKIPPED_UNMAPPED: "未映射区县，已跳过",
  SKIPPED_AMBIGUOUS: "区县映射歧义，已跳过",
  FAILED: "处理失败",
};

export function PersonnelAccountBatchPanel({
  capabilities,
  districts,
  search,
}: Props) {
  const { message } = App.useApp();
  const [batches, setBatches] = useState<PersonnelAccountBatchView[]>([]);
  const [rules, setRules] = useState<PersonnelDistrictRuleView[]>([]);
  const [preview, setPreview] = useState<PersonnelAccountBatchView | null>(null);
  const [detail, setDetail] = useState<PersonnelAccountBatchView | null>(null);
  const [items, setItems] = useState<PersonnelAccountBatchItemView[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemStatus, setItemStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PersonnelDistrictRuleView | null>(null);
  const [ruleForm] = Form.useForm();
  const [exportBatch, setExportBatch] = useState<PersonnelAccountBatchView | null>(null);
  const [exportForm] = Form.useForm();
  const polling = useRef(new Set<string>());

  const loadHistory = async (): Promise<void> => {
    try {
      const [batchRows, ruleRows] = await Promise.all([
        api<PersonnelAccountBatchView[]>("/admin/personnel/account-batches"),
        capabilities.canManagePersonnelDistrictRules
          ? api<PersonnelDistrictRuleView[]>("/admin/personnel-district-rules")
          : Promise.resolve([]),
      ]);
      setBatches(batchRows);
      setRules(ruleRows);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "批量开户记录加载失败");
    }
  };

  useEffect(() => {
    void loadHistory();
  }, [capabilities.canBatchProvisionPersonnel, capabilities.canManagePersonnelDistrictRules]);

  const startPolling = (batchId: string): void => {
    if (polling.current.has(batchId)) return;
    polling.current.add(batchId);
    const poll = async (): Promise<void> => {
      try {
        const row = await api<PersonnelAccountBatchView>(
          `/admin/personnel/account-batches/${batchId}`,
        );
        setBatches((current) => [row, ...current.filter((item) => item.id !== row.id)].slice(0, 50));
        setDetail((current) => (current?.id === row.id ? row : current));
        if (row.status === "QUEUED" || row.status === "RUNNING") {
          window.setTimeout(() => void poll(), 1800);
        } else {
          polling.current.delete(batchId);
          void loadHistory();
        }
      } catch {
        polling.current.delete(batchId);
      }
    };
    void poll();
  };

  const previewBatch = async (): Promise<void> => {
    setLoading(true);
    try {
      const row = await api<PersonnelAccountBatchView>("/admin/personnel/account-batches/preview", {
        method: "POST",
        body: JSON.stringify(search.trim() ? { search: search.trim() } : {}),
      });
      setPreview(row);
      void message.success("预检完成，尚未创建任何账号");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "批量预检失败");
    } finally {
      setLoading(false);
    }
  };

  const executeBatch = async (): Promise<void> => {
    if (!preview) return;
    setLoading(true);
    try {
      const row = await api<PersonnelAccountBatchView>(
        `/admin/personnel/account-batches/${preview.id}/execute`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      setPreview(null);
      setBatches((current) => [row, ...current.filter((item) => item.id !== row.id)]);
      startPolling(row.id);
      void message.success("批量开户任务已提交，账号将在后台逐步创建");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "批量开户提交失败");
    } finally {
      setLoading(false);
    }
  };

  const openItems = async (batch: PersonnelAccountBatchView, status?: string): Promise<void> => {
    setDetail(batch);
    setItemStatus(status);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "100" });
      if (status) params.set("status", status);
      const result = await api<{ items: PersonnelAccountBatchItemView[]; total: number }>(
        `/admin/personnel/account-batches/${batch.id}/items?${params.toString()}`,
      );
      setItems(result.items);
      setItemsTotal(result.total);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "批次明细加载失败");
    }
  };

  const saveRule = async (values: {
    name: string;
    includeText: string;
    excludeText?: string;
    districtId: string;
    priority: number;
    enabled: boolean;
  }): Promise<void> => {
    try {
      const path = editingRule
        ? `/admin/personnel-district-rules/${editingRule.id}`
        : "/admin/personnel-district-rules";
      await api(path, {
        method: editingRule ? "PATCH" : "POST",
        body: JSON.stringify(values),
      });
      setRuleModalOpen(false);
      setEditingRule(null);
      ruleForm.resetFields();
      await loadHistory();
      void message.success("区县映射规则已保存");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "映射规则保存失败");
    }
  };

  const performExport = async (values: { password: string }): Promise<void> => {
    if (!exportBatch) return;
    try {
      const auth = await api<{ token: string }>("/auth/reauth", {
        method: "POST",
        body: JSON.stringify({ password: values.password }),
      });
      const blob = await download(
        `/admin/personnel/account-batches/${exportBatch.id}/export`,
        {},
        auth.token,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `一线上报人批量开户-${exportBatch.id}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportBatch(null);
      exportForm.resetFields();
      void message.success("结果文件已开始下载");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "结果导出失败");
    }
  };

  const districtOptions = useMemo(
    () => districts.map((district) => ({ value: district.id, label: district.name })),
    [districts],
  );

  const batchColumns: ColumnsType<PersonnelAccountBatchView> = [
    {
      title: "创建时间",
      dataIndex: "createdAt",
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
    {
      title: "范围",
      render: (_, row) => row.search || "全部人员",
    },
    {
      title: "状态",
      render: (_, row) => (
        <Tag color={row.status === "COMPLETED" ? "success" : row.status === "PARTIAL" ? "warning" : "processing"}>
          {statusLabels[row.status] ?? row.status}
        </Tag>
      ),
    },
    {
      title: "进度",
      render: (_, row) => `${row.progressRows}/${row.totalRows}（成功 ${row.createdRows}）`,
    },
    {
      title: "异常/跳过",
      render: (_, row) => row.failedRows + row.skippedUnmappedRows + row.skippedAmbiguousRows + row.skippedExistingRows,
    },
    {
      title: "操作",
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => void openItems(row)}>
            明细
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => setExportBatch(row)}>
            导出
          </Button>
          {(row.status === "QUEUED" || row.status === "RUNNING") && (
            <Button size="small" icon={<ReloadOutlined />} onClick={() => startPolling(row.id)}>
              刷新
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const itemColumns: ColumnsType<PersonnelAccountBatchItemView> = [
    { title: "人员编码", dataIndex: "personnelCode" },
    { title: "姓名", dataIndex: "name" },
    { title: "来源", render: (_, row) => (row.sourceProfile === "CONTACT_ONLY" ? "联系人简表" : "完整人员表") },
    { title: "组织", dataIndex: "organizationPath", ellipsis: true },
    { title: "目标区县", dataIndex: "districtName" },
    { title: "结果", render: (_, row) => itemStatusLabels[row.status] ?? row.status },
    { title: "原因", dataIndex: "reason", ellipsis: true },
  ];

  if (!capabilities.canBatchProvisionPersonnel) return null;

  return (
    <>
      <Card
        size="small"
        title="批量开通一线上报人"
        extra={
          <Space>
            <Tag icon={<SafetyOutlined />} color="blue">仅系统管理员</Tag>
              <Button type="primary" loading={loading} onClick={() => void previewBatch()}>
              预检当前搜索结果
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message={`当前范围：${search.trim() || "全部人员"}`}
            description="只处理未开户且有有效手机号的在职人员；已有账号、已有角色和密码均不会修改。新账号仅授予一线上报人·区县，初始密码为手机号后六位。"
          />
          <Table<PersonnelAccountBatchView>
            rowKey="id"
            size="small"
            pagination={false}
            columns={batchColumns}
            dataSource={batches}
            locale={{ emptyText: "暂无批量开户记录" }}
          />
        </Space>
      </Card>

      {capabilities.canManagePersonnelDistrictRules && (
        <Card
          size="small"
          title="组织—区县映射规则"
          extra={
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingRule(null);
                ruleForm.resetFields();
                ruleForm.setFieldsValue({ priority: 100, enabled: true });
                setRuleModalOpen(true);
              }}
            >
              新增规则
            </Button>
          }
        >
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="规则按优先级和关键词长度匹配；规则变更后必须重新预检。联系人简表固定归金牛。"
          />
          <Table<PersonnelDistrictRuleView>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={rules}
            columns={[
              { title: "规则", dataIndex: "name" },
              { title: "包含关键词", dataIndex: "includeText" },
              { title: "排除关键词", dataIndex: "excludeText", render: (value: string | null) => value || "—" },
              { title: "区县", dataIndex: "districtName" },
              { title: "优先级", dataIndex: "priority" },
              { title: "状态", render: (_, row) => (row.enabled ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>) },
              {
                title: "操作",
                render: (_, row) => (
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditingRule(row);
                      ruleForm.setFieldsValue(row);
                      setRuleModalOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        open={Boolean(preview)}
        title="批量开户预检结果"
        okText="确认并提交后台开户"
        cancelText="取消"
        confirmLoading={loading}
        onOk={() => void executeBatch()}
        onCancel={() => setPreview(null)}
        width={680}
      >
        {preview && (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Alert
              type="warning"
              showIcon
              message="提交后将逐人创建账号，已有账号不会被修改；异常人员会保留在结果明细中。"
            />
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="命中人员">{preview.totalRows}</Descriptions.Item>
              <Descriptions.Item label="可开户">{preview.eligibleRows}</Descriptions.Item>
              <Descriptions.Item label="已有账号">{preview.skippedExistingRows}</Descriptions.Item>
              <Descriptions.Item label="停用人员">{preview.skippedInactiveRows}</Descriptions.Item>
              <Descriptions.Item label="无有效手机号">{preview.skippedNoPhoneRows}</Descriptions.Item>
              <Descriptions.Item label="未映射区县">{preview.skippedUnmappedRows}</Descriptions.Item>
              <Descriptions.Item label="映射歧义">{preview.skippedAmbiguousRows}</Descriptions.Item>
              <Descriptions.Item label="区县分布">
                <Space wrap>
                  {preview.districtCounts.map((district) => (
                    <Tag key={district.districtId}>{district.districtName}：{district.count}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
            </Descriptions>
          </Space>
        )}
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={`批量开户明细${detail ? `（${detail.id}）` : ""}`}
        footer={null}
        width={1100}
        onCancel={() => setDetail(null)}
      >
        {detail && (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Space wrap>
              {Object.entries(itemStatusLabels).map(([value, label]) => (
                <Button
                  key={value}
                  size="small"
                  type={itemStatus === value ? "primary" : "default"}
                  onClick={() => void openItems(detail, value)}
                >
                  {label}
                </Button>
              ))}
              <Button size="small" onClick={() => void openItems(detail)}>
                全部
              </Button>
              <Typography.Text type="secondary">共 {itemsTotal} 条</Typography.Text>
            </Space>
            <Table<PersonnelAccountBatchItemView>
              rowKey="id"
              size="small"
              columns={itemColumns}
              dataSource={items}
              pagination={{ pageSize: 100, total: itemsTotal, showSizeChanger: false }}
              scroll={{ x: 980 }}
            />
          </Space>
        )}
      </Modal>

      <Modal
        open={Boolean(ruleModalOpen)}
        title={editingRule ? "编辑映射规则" : "新增映射规则"}
        okText="保存"
        cancelText="取消"
        onOk={() => void ruleForm.submit()}
        onCancel={() => {
          setRuleModalOpen(false);
          setEditingRule(null);
          ruleForm.resetFields();
        }}
      >
        <Form form={ruleForm} layout="vertical" onFinish={(values) => void saveRule(values)}>
          <Form.Item name="name" label="规则名称" rules={[{ required: true }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="includeText" label="包含关键词" rules={[{ required: true }]}>
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item name="excludeText" label="排除关键词">
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item name="districtId" label="目标区县" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={districtOptions} />
          </Form.Item>
          <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
            <InputNumber min={-1000} max={1000} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="enabled" label="状态" rules={[{ required: true }]}>
            <Select options={[{ value: true, label: "启用" }, { value: false, label: "停用" }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(exportBatch)}
        title="重新验证后导出批次结果"
        okText="验证并导出"
        cancelText="取消"
        onOk={() => void exportForm.submit()}
        onCancel={() => {
          setExportBatch(null);
          exportForm.resetFields();
        }}
      >
        <Form form={exportForm} layout="vertical" onFinish={(values) => void performExport(values)}>
          <Form.Item name="password" label="当前登录密码" rules={[{ required: true, message: "请输入当前登录密码" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Typography.Text type="secondary">导出文件只包含掩码手机号和处理结果，不包含密码。</Typography.Text>
        </Form>
      </Modal>
    </>
  );
}
