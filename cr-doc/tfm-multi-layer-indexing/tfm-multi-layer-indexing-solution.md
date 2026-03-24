# TFM Service 调用追踪 - 技术实现方案

## 1. 技术背景

### 1.1 TFM 框架简介

TFM (Transaction Flow Management) 是一个 Java 企业框架，通过 XML 配置文件定义服务调用路由。

**代码模式**：
```java
DynamicDict dict = new DynamicDict();
dict.serviceName = "WSSetVasForDubbo";  // 或 dict.setServiceName("WSSetVasForDubbo")
ServiceFlow.callService(dict, true);
```

**XML 配置** (`tfm_service/WSSetVasForDubbo.xml`)：
```xml
<service>
  <definition>com.ztesoft.zsmart.bss.vas.service.VasService</definition>
  <method_def>setVasForDubbo</method_def>
</service>
```

### 1.2 技术挑战

1. **间接调用**：代码中看不到实际的类和方法
2. **两种模式**：serviceName 可通过方法或字段赋值设置
3. **多层架构**：配置可能分布在多个目录
4. **性能要求**：大型项目可能有数千个 TFM 调用

## 2. 架构设计

### 2.1 整体数据流

```
GitNexus Pipeline
├─ Phase 1-8: File Scanning, Parsing, Imports, Calls
├─ Phase 9: Heritage Processing
├─ Phase 9.5: TFM Service Call Resolution (新增)
│  ├─ 收集 ExtractedTfmCall
│  ├─ 扫描 tfm_service/ 目录
│  ├─ 解析 XML 文件
│  ├─ 符号表查询
│  ├─ 应用层级优先级
│  └─ 生成 CALLS 关系
├─ Phase 10: Community Detection
└─ Phase 11: Process Detection
```

详见 [完整方案文档](./tfm-multi-layer-indexing-solution.md)

---

**文档版本**：1.0
**最后更新**：2026-03-24
