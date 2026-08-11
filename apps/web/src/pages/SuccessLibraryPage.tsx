import { DownloadOutlined, SearchOutlined } from "@ant-design/icons";
import type {
  CustomerAttitude,
  CustomerType,
  DistrictView,
} from "@oms/contracts";
import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, download } from "../api/client";
import { attitudeLabels, customerTypeLabels } from "../components/labels";

interface SuccessItem {
  id: string;
  serialNumber: string;
  successOpportunityName: string;
  district: { id: string; name: string };
  customerType: CustomerType;
  attitude: CustomerAttitude;
  customerContact: string;
  closedAt: string;
}
interface SuccessPage {
  items: SuccessItem[];
  page: number;
  pageSize: number;
  total: number;
}
interface Filters {
  districtId?: string;
  customerType?: CustomerType;
  attitude?: CustomerAttitude;
  successOpportunityName?: string;
  customerContact?: string;
  closedRange?: [Dayjs, Dayjs];
}

export function SuccessLibraryPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<Filters>();
  const [data, setData] = useState<SuccessPage>({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
  const [districts, setDistricts] = useState<DistrictView[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportType, setExportType] = useState<"successes" | "workflow" | null>(
    null,
  );
  const [passwordForm] = Form.useForm<{ password: string }>();

  function queryBody(): Record<string, string> {
    const values = form.getFieldsValue();
    return {
      ...(values.districtId ? { districtId: values.districtId } : {}),
      ...(values.customerType ? { customerType: values.customerType } : {}),
      ...(values.attitude ? { attitude: values.attitude } : {}),
      ...(values.successOpportunityName?.trim()
        ? { successOpportunityName: values.successOpportunityName.trim() }
        : {}),
      ...(values.customerContact?.trim()
        ? { customerContact: values.customerContact.trim() }
        : {}),
      ...(values.closedRange
        ? {
            closedFrom: values.closedRange[0].startOf("day").toISOString(),
            closedTo: values.closedRange[1].endOf("day").toISOString(),
          }
        : {}),
    };
  }

  async function load(page = 1): Promise<void> {
    setLoading(true);
    const params = new URLSearchParams({
      ...queryBody(),
      page: String(page),
      pageSize: "20",
    });
    try {
      setData(await api<SuccessPage>(`/municipal/successes?${params}`));
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void api<DistrictView[]>("/reference/districts").then(setDistricts);
    void load();
  }, []);

  async function performExport(values: { password: string }): Promise<void> {
    if (!exportType) return;
    try {
      const auth = await api<{ token: string }>("/auth/reauth", {
        method: "POST",
        body: JSON.stringify({ password: values.password }),
      });
      const body =
        exportType === "successes"
          ? queryBody()
          : (() => {
              const current = queryBody();
              return {
                ...(current.districtId
                  ? { districtId: current.districtId }
                  : {}),
              };
            })();
      const blob = await download(
        `/municipal/exports/${exportType}`,
        body,
        auth.token,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${exportType === "successes" ? "成功商机" : "流转节点明细"}-${Date.now()}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportType(null);
      passwordForm.resetFields();
      void message.success("导出已开始下载");
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "导出失败");
    }
  }

  const columns: ColumnsType<SuccessItem> = [
    {
      title: "成功商机名称",
      dataIndex: "successOpportunityName",
      width: 260,
      render: (value: string, row) => (
        <Button
          type="link"
          onClick={() => navigate(`/opportunities/${row.id}`)}
        >
          {value}
        </Button>
      ),
    },
    { title: "商机编号", dataIndex: "serialNumber", width: 190 },
    { title: "区县", dataIndex: ["district", "name"], width: 110 },
    {
      title: "客户类型",
      dataIndex: "customerType",
      width: 110,
      render: (value: CustomerType) => customerTypeLabels[value],
    },
    {
      title: "客户态度",
      dataIndex: "attitude",
      width: 100,
      render: (value: CustomerAttitude) => attitudeLabels[value],
    },
    { title: "客户联系方式", dataIndex: "customerContact", width: 220 },
    {
      title: "办结时间",
      dataIndex: "closedAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
  ];
  return (
    <Card className="page-card">
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <div>
            <Typography.Title level={2} className="page-title">
              成功商机库
            </Typography.Title>
            <Typography.Text type="secondary">
              全市已成功办结商机，只读查看
            </Typography.Text>
          </div>
          <Space wrap>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => setExportType("successes")}
            >
              导出当前成功商机
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => setExportType("workflow")}
            >
              导出节点明细
            </Button>
          </Space>
        </Space>
        <Form
          form={form}
          layout="inline"
          onFinish={() => void load(1)}
          style={{ rowGap: 12 }}
        >
          <Form.Item name="successOpportunityName">
            <Input placeholder="成功商机名称（至少2字）" allowClear />
          </Form.Item>
          <Form.Item name="districtId">
            <Select
              placeholder="全部区县"
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: 140 }}
              options={districts.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="customerType">
            <Select
              placeholder="客户类型"
              allowClear
              style={{ width: 130 }}
              options={[
                { value: "PERSONAL", label: "个人客户" },
                { value: "ORGANIZATION", label: "组织客户" },
              ]}
            />
          </Form.Item>
          <Form.Item name="attitude">
            <Select
              placeholder="客户态度"
              allowClear
              style={{ width: 120 }}
              options={Object.entries(attitudeLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
          <Form.Item name="customerContact">
            <Input placeholder="客户联系方式（精确）" allowClear />
          </Form.Item>
          <Form.Item name="closedRange">
            <DatePicker.RangePicker />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
            查询
          </Button>
        </Form>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data.items}
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{
            current: data.page,
            pageSize: data.pageSize,
            total: data.total,
            showSizeChanger: false,
            onChange: (page) => void load(page),
          }}
        />
      </Space>
      <Modal
        open={Boolean(exportType)}
        title="导出前重新验证密码"
        okText="验证并导出"
        onCancel={() => {
          setExportType(null);
          passwordForm.resetFields();
        }}
        onOk={() => passwordForm.submit()}
      >
        <Typography.Paragraph type="secondary">
          导出包含完整联系方式。授权 5 分钟内有效且只能使用一次，操作会被审计。
        </Typography.Paragraph>
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={(values) => void performExport(values)}
        >
          <Form.Item
            name="password"
            label="当前密码"
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
