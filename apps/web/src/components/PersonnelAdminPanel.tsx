import {
  CloudUploadOutlined,
  PlusOutlined,
  SearchOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import type {
  AdminCapabilities,
  DistrictView,
  PageResult,
  PersonnelImportView,
  PersonnelPositionView,
  PersonnelView,
  RoleCode,
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
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { PersonnelAccountBatchPanel } from "./PersonnelAccountBatchPanel";
import { roleLabels } from "./labels";

interface Props {
  capabilities: AdminCapabilities;
  districts: DistrictView[];
}

const DISTRICT_ROLES = new Set<RoleCode>([
  "FIELD_REPORTER",
  "DISTRICT_MANAGER",
  "PERSONAL_HANDLER",
  "ORGANIZATION_HANDLER",
]);

export function PersonnelAdminPanel({ capabilities, districts }: Props) {
  const { message } = App.useApp();
  const [items, setItems] = useState<PersonnelView[]>([]);
  const [total, setTotal] = useState(0);
  const [positions, setPositions] = useState<PersonnelPositionView[]>([]);
  const [imports, setImports] = useState<PersonnelImportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [importMode, setImportMode] = useState<"UPSERT" | "SNAPSHOT">("UPSERT");
  const [provisionManagementAccounts, setProvisionManagementAccounts] =
    useState(false);
  const [systemAdminCount, setSystemAdminCount] = useState(6);
  const [systemAdminPhone, setSystemAdminPhone] = useState("");
  const [preview, setPreview] = useState<PersonnelImportView | null>(null);
  const [importing, setImporting] = useState(false);
  const [positionOpen, setPositionOpen] = useState(false);
  const [editingPosition, setEditingPosition] =
    useState<PersonnelPositionView | null>(null);
  const [accountPerson, setAccountPerson] = useState<PersonnelView | null>(
    null,
  );
  const [positionForm] = Form.useForm();
  const [accountForm] = Form.useForm();
  const accountRoles = Form.useWatch<RoleCode[]>("roles", accountForm) ?? [];

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "30",
      });
      if (search) params.set("search", search);
      const [personnelPage, positionRows, importRows] = await Promise.all([
        api<PageResult<PersonnelView>>(`/admin/personnel?${params.toString()}`),
        api<PersonnelPositionView[]>("/admin/personnel-positions"),
        api<PersonnelImportView[]>("/admin/personnel/imports"),
      ]);
      setItems(personnelPage.items);
      setTotal(personnelPage.total);
      setPositions(positionRows);
      setImports(importRows);
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : "人员数据加载失败",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => void load(), [page, search, capabilities.activeRole]);

  const templateRoles = useMemo(
    () =>
      capabilities.manageableRoles.filter(
        (role) => !["SENIOR_MUNICIPAL_ADMIN", "SYSTEM_ADMIN"].includes(role),
      ),
    [capabilities.manageableRoles],
  );
  const accountRoleOptions = capabilities.manageableRoles.map((role) => ({
    value: role,
    label: roleLabels[role],
  }));
  const needsDistrict = accountRoles.some((role) => DISTRICT_ROLES.has(role));

  async function runImport(dryRun: boolean): Promise<void> {
    if (!file) {
      void message.warning("请先选择 XLSX 文件");
      return;
    }
    if (!dryRun && !preview) {
      void message.warning("请先完成预检，再确认同步");
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", importMode);
      formData.append("dryRun", String(dryRun));
      formData.append(
        "provisionSystemAdminCount",
        String(provisionManagementAccounts ? systemAdminCount : 0),
      );
      if (provisionManagementAccounts && systemAdminPhone.trim())
        formData.append("provisionSystemAdminPhone", systemAdminPhone.trim());
      const result = await api<PersonnelImportView>("/admin/personnel/import", {
        method: "POST",
        body: formData,
      });
      if (dryRun) {
        setPreview(result);
        void message.success("预检完成，尚未写入数据");
      } else {
        setPreview(null);
        setFile(null);
        setFileInputKey((value) => value + 1);
        void message.success("人员和指定管理账号已同步");
        await load();
      }
    } catch (error) {
      void message.error(
        error instanceof Error
          ? error.message
          : dryRun
            ? "预检失败"
            : "同步失败",
      );
    } finally {
      setImporting(false);
    }
  }

  function openCreatePosition(): void {
    setEditingPosition(null);
    positionForm.resetFields();
    positionForm.setFieldsValue({ roles: [] });
    setPositionOpen(true);
  }

  function openEditPosition(row: PersonnelPositionView): void {
    setEditingPosition(row);
    positionForm.setFieldsValue({
      code: row.code,
      name: row.name,
      roles: row.roles,
    });
    setPositionOpen(true);
  }

  async function savePosition(values: {
    code: string;
    name: string;
    roles: RoleCode[];
  }): Promise<void> {
    try {
      await api(
        editingPosition
          ? `/admin/personnel-positions/${editingPosition.id}`
          : "/admin/personnel-positions",
        {
          method: editingPosition ? "PATCH" : "POST",
          body: JSON.stringify(
            editingPosition
              ? { name: values.name, roles: values.roles }
              : values,
          ),
        },
      );
      setPositionOpen(false);
      positionForm.resetFields();
      void message.success("职务与角色模板已保存");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function togglePosition(
    row: PersonnelPositionView,
    enabled: boolean,
  ): Promise<void> {
    try {
      await api(`/admin/personnel-positions/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "更新失败");
    }
  }

  function openAccount(row: PersonnelView): void {
    setAccountPerson(row);
    accountForm.setFieldsValue({
      roles: row.recommendedRoles.filter((role) =>
        capabilities.manageableRoles.includes(role),
      ),
    });
  }

  async function createAccount(values: {
    roles: RoleCode[];
    districtId?: string;
  }): Promise<void> {
    if (!accountPerson) return;
    const grants = values.roles.map((role) =>
      DISTRICT_ROLES.has(role)
        ? { role, districtId: values.districtId }
        : { role },
    );
    try {
      await api(`/admin/personnel/${accountPerson.id}/account`, {
        method: "POST",
        body: JSON.stringify({
          grants,
        }),
      });
      setAccountPerson(null);
      accountForm.resetFields();
      void message.success("账号已关联，所选角色已同步授权");
      await load();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "开通失败");
    }
  }

  const personnelColumns: ColumnsType<PersonnelView> = [
    {
      title: "人员",
      key: "person",
      width: 180,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.name}</Typography.Text>
          <Typography.Text type="secondary">
            {row.sourceProfile === "CONTACT_ONLY"
              ? "联系人简表"
              : row.personnelCode}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "联系方式",
      key: "phones",
      width: 160,
      render: (_, row) => row.personalPhone ?? row.workPhone ?? "—",
    },
    {
      title: "组织 / 职务",
      key: "position",
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>
            {row.organizationPath ?? row.cooperativeEnterprise ?? "—"}
          </span>
          <Typography.Text type="secondary">
            {row.positionName ?? row.standardPosition ?? "未设置职务"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "职务建议角色",
      key: "recommendedRoles",
      render: (_, row) =>
        row.recommendedRoles.length ? (
          <Space wrap>
            {row.recommendedRoles.map((role) => (
              <Tag key={role}>{roleLabels[role]}</Tag>
            ))}
          </Space>
        ) : (
          "—"
        ),
    },
    {
      title: "账号",
      key: "account",
      width: 130,
      render: (_, row) =>
        row.userId && !row.active ? (
          <Tag color="warning">人员停用，账号待复核</Tag>
        ) : row.userId ? (
          <Tag color="success">已关联账号</Tag>
        ) : !row.active ? (
          <Tag>人员已停用</Tag>
        ) : (
          <Button
            size="small"
            type="primary"
            icon={<UserAddOutlined />}
            onClick={() => openAccount(row)}
          >
            开通并授权
          </Button>
        ),
    },
  ];

  const positionColumns: ColumnsType<PersonnelPositionView> = [
    { title: "编码", dataIndex: "code", width: 170 },
    { title: "职务名称", dataIndex: "name", width: 220 },
    {
      title: "建议角色模板",
      key: "roles",
      render: (_, row) => (
        <Space wrap>
          {row.roles.map((role) => (
            <Tag key={role}>{roleLabels[role]}</Tag>
          ))}
          {!row.roles.length && <Tag>不建议角色</Tag>}
        </Space>
      ),
    },
    {
      title: "启用",
      key: "enabled",
      width: 90,
      render: (_, row) => (
        <Switch
          checked={row.enabled}
          onChange={(enabled) => void togglePosition(row, enabled)}
        />
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 90,
      render: (_, row) => (
        <Button size="small" onClick={() => openEditPosition(row)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {capabilities.canImportPersonnel && (
        <Card size="small" title="在线上传与同步人员">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message="支持两类模板"
              description="完整人员表需包含“人员编码、人员姓名”；联系人简表仅需“姓名、联系电话”。管理权限开通必须单独启用并经过预检，避免普通联系人文件意外获得管理员权限。"
            />
            <Space wrap align="end">
              <label>
                <div className="form-note">XLSX 文件</div>
                <input
                  key={fileInputKey}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setPreview(null);
                  }}
                />
              </label>
              <label>
                <div className="form-note">同步模式</div>
                <Select
                  value={importMode}
                  style={{ width: 150 }}
                  options={[
                    { value: "UPSERT", label: "新增或更新" },
                    { value: "SNAPSHOT", label: "同来源快照同步" },
                  ]}
                  onChange={(value) => {
                    setImportMode(value);
                    setPreview(null);
                  }}
                />
              </label>
              <label>
                <div className="form-note">管理岗位账号开通</div>
                <Switch
                  checked={provisionManagementAccounts}
                  checkedChildren="启用"
                  unCheckedChildren="不启用"
                  onChange={(checked) => {
                    setProvisionManagementAccounts(checked);
                    setPreview(null);
                  }}
                />
              </label>
              {provisionManagementAccounts && (
                <>
                  <label>
                    <div className="form-note">简表前 N 位开通系统管理员</div>
                    <InputNumber
                      min={0}
                      max={20}
                      value={systemAdminCount}
                      onChange={(value) => {
                        setSystemAdminCount(value ?? 0);
                        setPreview(null);
                      }}
                    />
                  </label>
                  <label>
                    <div className="form-note">系统管理员手机号（选填）</div>
                    <Input
                      inputMode="tel"
                      maxLength={11}
                      value={systemAdminPhone}
                      style={{ width: 190 }}
                      onChange={(event) => {
                        setSystemAdminPhone(event.target.value);
                        setPreview(null);
                      }}
                    />
                  </label>
                </>
              )}
              <Button
                icon={<CloudUploadOutlined />}
                loading={importing}
                onClick={() => void runImport(true)}
              >
                预检
              </Button>
              <Button
                type="primary"
                disabled={!preview}
                loading={importing}
                onClick={() => void runImport(false)}
              >
                确认同步
              </Button>
            </Space>
            {importMode === "SNAPSHOT" && (
              <Alert
                type="warning"
                showIcon
                message="快照模式会停用同一来源类型中未出现在本文件的人员，但不会自动停用其账号或角色，请在账号与角色页复核。"
              />
            )}
            {provisionManagementAccounts && (
              <Alert
                type="warning"
                showIcon
                message="仅用于“姓名、联系电话”管理岗位简表：前 N 位及指定手机号均开通系统管理员，重复命中只保留一条授权；初始密码为手机号后 6 位。"
              />
            )}
            {preview && <ImportSummary value={preview} title="本次预检结果" />}
          </Space>
        </Card>
      )}

      <Card size="small" title="人员目录">
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="姓名、人员编码、组织、职务或完整手机号"
              value={searchDraft}
              style={{ width: 340 }}
              onChange={(event) => setSearchDraft(event.target.value)}
              onPressEnter={() => {
                setPage(1);
                setSearch(searchDraft.trim());
              }}
            />
            <Button
              type="primary"
              onClick={() => {
                setPage(1);
                setSearch(searchDraft.trim());
              }}
            >
              搜索
            </Button>
          </Space>
          <Table<PersonnelView>
            rowKey="id"
            loading={loading}
            columns={personnelColumns}
            dataSource={items}
            scroll={{ x: 940 }}
            pagination={{
              current: page,
              pageSize: 30,
              total,
              showTotal: (value) => `共 ${value} 人`,
              onChange: setPage,
            }}
          />
        </Space>
      </Card>

      <PersonnelAccountBatchPanel
        capabilities={capabilities}
        districts={districts}
        search={search}
      />

      {capabilities.canManagePositions && (
        <Card
          size="small"
          title="职务与角色建议模板"
          extra={
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreatePosition}
            >
              新增职务
            </Button>
          }
        >
          <Alert
            type="warning"
            showIcon
            message="模板只提供授权建议，不会自动增加、撤销或变更任何人的权限。"
            style={{ marginBottom: 16 }}
          />
          <Table<PersonnelPositionView>
            rowKey="id"
            dataSource={positions}
            columns={positionColumns}
            pagination={false}
            scroll={{ x: 760 }}
          />
        </Card>
      )}

      <Card size="small" title="最近同步记录">
        <Table<PersonnelImportView>
          rowKey="id"
          dataSource={imports}
          pagination={false}
          columns={[
            { title: "文件", dataIndex: "fileName" },
            {
              title: "来源",
              render: (_, row) =>
                row.sourceProfile === "CONTACT_ONLY"
                  ? "联系人简表"
                  : "完整人员表",
            },
            { title: "总行数", dataIndex: "totalRows" },
            {
              title: "结果",
              render: (_, row) =>
                `新增 ${row.createdRows} / 更新 ${row.updatedRows} / 停用 ${row.deactivatedRows}`,
            },
            { title: "新建账号", dataIndex: "accountsCreated" },
            {
              title: "完成时间",
              render: (_, row) =>
                row.completedAt
                  ? new Date(row.completedAt).toLocaleString("zh-CN")
                  : "—",
            },
          ]}
        />
      </Card>

      <Modal
        open={positionOpen}
        title={editingPosition ? "编辑职务模板" : "新增职务模板"}
        okText="保存"
        cancelText="取消"
        onOk={() => positionForm.submit()}
        onCancel={() => {
          setPositionOpen(false);
          setEditingPosition(null);
          positionForm.resetFields();
        }}
        destroyOnClose
      >
        <Form
          form={positionForm}
          layout="vertical"
          onFinish={(values) => void savePosition(values)}
        >
          <Form.Item
            name="code"
            label="职务编码"
            rules={[{ required: true, whitespace: true }, { max: 40 }]}
          >
            <Input disabled={Boolean(editingPosition)} maxLength={40} />
          </Form.Item>
          <Form.Item
            name="name"
            label="职务名称"
            rules={[{ required: true, whitespace: true }, { max: 120 }]}
          >
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="roles" label="建议角色">
            <Select<RoleCode[]>
              mode="multiple"
              options={templateRoles.map((role) => ({
                value: role,
                label: roleLabels[role],
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(accountPerson)}
        title={`为 ${accountPerson?.name ?? "人员"} 开通账号`}
        okText="开通并授权"
        cancelText="取消"
        onOk={() => accountForm.submit()}
        onCancel={() => {
          setAccountPerson(null);
          accountForm.resetFields();
        }}
        destroyOnClose
      >
        <Form
          form={accountForm}
          layout="vertical"
          onFinish={(values) => void createAccount(values)}
        >
          <Form.Item
            name="roles"
            label="首批角色"
            rules={[{ required: true, message: "至少选择一个角色" }]}
            extra="职务模板仅用于预选，提交后才会真正授权。"
          >
            <Select<RoleCode[]> mode="multiple" options={accountRoleOptions} />
          </Form.Item>
          {needsDistrict && (
            <Form.Item
              name="districtId"
              label="区县角色所属区域"
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={districts.map((district) => ({
                  value: district.id,
                  label: district.name,
                }))}
              />
            </Form.Item>
          )}
          <Alert
            type="info"
            showIcon
            message="初始密码自动设置为手机号后六位，首次登录必须修改。"
          />
        </Form>
      </Modal>
    </Space>
  );
}

function ImportSummary({
  value,
  title,
}: {
  value: PersonnelImportView;
  title: string;
}) {
  return (
    <Card size="small" title={title}>
      <Descriptions size="small" column={{ xs: 2, sm: 3, md: 6 }}>
        <Descriptions.Item label="有效行">{value.totalRows}</Descriptions.Item>
        <Descriptions.Item label="新增人员">
          {value.createdRows}
        </Descriptions.Item>
        <Descriptions.Item label="更新人员">
          {value.updatedRows}
        </Descriptions.Item>
        <Descriptions.Item label="预计停用">
          {value.deactivatedRows}
        </Descriptions.Item>
        <Descriptions.Item label="新建账号">
          {value.accountsCreated}
        </Descriptions.Item>
        <Descriptions.Item label="关联账号">
          {value.accountsLinked}
        </Descriptions.Item>
      </Descriptions>
      {value.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`有 ${value.warnings.length} 条提示`}
          description={value.warnings.slice(0, 8).join("；")}
          style={{ marginTop: 12 }}
        />
      )}
    </Card>
  );
}
