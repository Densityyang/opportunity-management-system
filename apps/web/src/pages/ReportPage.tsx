import { ArrowLeftOutlined } from "@ant-design/icons";
import type {
  CustomerAttitude,
  CustomerType,
  DistrictView,
  OpportunityDetail,
} from "@oms/contracts";
import {
  CONSENT_TEXT,
  ORGANIZATION_NOTE,
  SPECIFIC_NEED_OPTIONS,
} from "@oms/contracts";
import {
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/session";
import { AudioRecorder } from "../components/AudioRecorder";

interface FormValues {
  customerType: CustomerType;
  districtId: string;
  customerContact: string;
  specificNeeds: string[];
  attitude: CustomerAttitude;
  oneSentenceDescription?: string;
  consentConfirmed: boolean;
}

export function ReportPage() {
  const { opportunityId } = useParams();
  const editing = Boolean(opportunityId);
  const { user } = useSession();
  const [form] = Form.useForm<FormValues>();
  const [districts, setDistricts] = useState<DistrictView[]>([]);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(editing);
  const { message, modal } = App.useApp();
  const navigate = useNavigate();

  useEffect(() => {
    void api<DistrictView[]>("/reference/districts")
      .then(setDistricts)
      .catch((error) => message.error(error.message));
    if (opportunityId) {
      void api<OpportunityDetail>(`/opportunities/${opportunityId}`)
        .then((item) => {
          if (item.state !== "RETURNED_TO_REPORTER")
            throw new Error("该商机当前不能修改重报");
          setVersion(item.version);
          form.setFieldsValue({
            customerType: item.customerType,
            districtId: item.district.id,
            customerContact: item.customerContact,
            specificNeeds: item.specificNeeds,
            attitude: item.attitude,
            oneSentenceDescription: item.oneSentenceDescription ?? undefined,
            consentConfirmed: false,
          });
        })
        .catch((error) => void message.error(error.message))
        .finally(() => setLoading(false));
    }
  }, [opportunityId, form, message]);

  async function submit(values: FormValues): Promise<void> {
    try {
      const item = editing
        ? await api<OpportunityDetail>(
            `/opportunities/${opportunityId}/resubmit`,
            {
              method: "PUT",
              body: JSON.stringify({ ...values, expectedVersion: version }),
            },
          )
        : await api<OpportunityDetail>("/opportunities", {
            method: "POST",
            body: JSON.stringify(values),
          });
      if (audio) {
        const formData = new FormData();
        const extension =
          audio.type.includes("mp4") || audio.type.includes("m4a")
            ? "m4a"
            : "webm";
        formData.append("audio", audio, `recording.${extension}`);
        try {
          await api(`/opportunities/${item.id}/audio`, {
            method: "POST",
            body: formData,
          });
        } catch (error) {
          modal.warning({
            title: "商机已提交，但录音上传失败",
            content:
              error instanceof Error
                ? error.message
                : "可在审核前返回详情重试。",
          });
        }
      }
      void message.success(editing ? "商机已重新提交" : "商机已上报");
      navigate(`/opportunities/${item.id}`, { replace: true });
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "提交失败");
    }
  }

  return (
    <Card className="page-card" loading={loading}>
      <Space>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(-1)}
        />
        <Typography.Title level={2} className="page-title">
          {editing ? "修改并重新提交" : "上报商机"}
        </Typography.Title>
      </Space>
      <Form<FormValues>
        form={form}
        layout="vertical"
        size="large"
        initialValues={{
          customerType: "PERSONAL",
          attitude: "GENERAL",
          consentConfirmed: false,
        }}
        onFinish={(values) => void submit(values)}
        style={{ maxWidth: 760 }}
      >
        <Form.Item label="上报人基础信息（电话号码）">
          <Input value={user?.phone} readOnly />
        </Form.Item>
        <Form.Item
          name="customerType"
          label="客户类型"
          rules={[{ required: true }]}
        >
          <Radio.Group>
            <Radio.Button value="PERSONAL">个人客户</Radio.Button>
            <Radio.Button value="ORGANIZATION">组织客户</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <div className="form-note" style={{ marginTop: -18, marginBottom: 20 }}>
          标注：{ORGANIZATION_NOTE}
        </div>
        <Form.Item
          name="districtId"
          label="商机承载区域（区县）"
          rules={[{ required: true, message: "请选择区县" }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="请选择区县"
            options={districts.map((district) => ({
              value: district.id,
              label: district.name,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="customerContact"
          label="客户联系方式"
          rules={[{ required: true, whitespace: true }, { max: 200 }]}
        >
          <Input maxLength={200} showCount />
        </Form.Item>
        <Form.Item
          name="specificNeeds"
          label="具体需求"
          extra="不需要判断具体产品，选择最接近客户实际情况的选项即可，最多选择两项。"
          rules={[
            {
              validator: (_, value: string[] | undefined) => {
                if (!value?.length)
                  return Promise.reject(new Error("至少选择一项具体需求"));
                if (value.length > 2)
                  return Promise.reject(new Error("最多选择两项"));
                return Promise.resolve();
              },
            },
          ]}
        >
          <Checkbox.Group
            options={SPECIFIC_NEED_OPTIONS.map((value) => ({
              label: value,
              value,
            }))}
            style={{ display: "grid", gap: 10 }}
          />
        </Form.Item>
        <Form.Item
          name="attitude"
          label="客户态度"
          rules={[{ required: true }]}
        >
          <Radio.Group>
            <Radio value="URGENT">紧急</Radio>
            <Radio value="IMPORTANT">重要</Radio>
            <Radio value="GENERAL">一般</Radio>
            <Radio value="POTENTIAL">潜在</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="oneSentenceDescription"
          label="一句话说明（选填）"
          rules={[{ max: 50 }]}
        >
          <Input maxLength={50} showCount />
        </Form.Item>
        <Form.Item label="语音录音（选填）">
          <AudioRecorder value={audio} onChange={setAudio} />
        </Form.Item>
        <Form.Item
          name="consentConfirmed"
          valuePropName="checked"
          rules={[
            {
              validator: (_, value) =>
                value
                  ? Promise.resolve()
                  : Promise.reject(new Error("请确认后再提交")),
            },
          ]}
        >
          <Checkbox className="consent-box">{CONSENT_TEXT}</Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" block>
          {editing ? "重新提交" : "确认上报"}
        </Button>
      </Form>
    </Card>
  );
}
