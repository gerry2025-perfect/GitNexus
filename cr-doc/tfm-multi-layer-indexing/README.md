# TFM Service 扩展文档索引

## 快速链接

| 文档 | 说明 | 适用场景 |
|------|------|----------|
| **[Multi-Layer Implementation](./TFM-MULTI-LAYER-IMPLEMENTATION.md)** | 多层全量索引实现 | 了解多目录索引原理 |
| **[Implementation Summary](./TFM-Implementation-Summary.md)** | 实现完成总结 | 了解整体功能和改动 |
| **[Usage Guide](./TFM-Service-Usage-Guide.md)** | 完整使用指南 | 日常使用和故障排查 |
| **[Changelist](./TFM-Service-Extension-changelist.md)** | 详细变更记录 | 了解实现细节 |

## 概述

TFM Service 扩展为 GitNexus 添加了 TFM 框架调用追踪功能：

```java
// 代码中的调用
DynamicDict parm = new DynamicDict();
parm.setServiceName("QryInternalSaleGoodsByESN{PN}UM");
ServiceFlow.callService(parm);
```

→ GitNexus 自动识别并解析 →

```xml
<!-- tfm_service/QryInternalSaleGoodsByESN{PN}UM.xml -->
<service>
  <definition>com.example.InternalSaleService</definition>
  <method_def>queryByESN</method_def>
</service>
```

→ 在知识图谱中建立精确的调用关系

## 快速开始

### 1. 单目录模式

```bash
cd /path/to/project
npx gitnexus analyze
```

### 2. 多目录模式（全量索引）

> **重要**：定制层、公共层、产品层**全部建立索引**，所有层的代码进入同一个知识图谱。

**Unix/Linux:**
```bash
export GITNEXUS_EXTRA_ROOTS="/path/to/common:/path/to/product"
cd /path/to/customization
npx gitnexus analyze
```

**Windows:**
```cmd
set GITNEXUS_EXTRA_ROOTS=E:\path\to\common;E:\path\to\product
cd E:\path\to\customization
npx gitnexus analyze
```

**输出示例:**
```
  GitNexus Analyzer

  Indexing 2 directories:
    Primary: E:\workspace\customization
    Layer 1: E:\workspace\common
    Layer 2: E:\workspace\product

  Repository indexed successfully (198.9s)
  246,060 nodes | 705,137 edges | 6895 clusters | 300 flows
```

### 3. 查询结果

```bash
# 查看 TFM 调用关系
npx gitnexus cypher "
  MATCH (c)-[r:CALLS {reason: 'tfm-service-resolution'}]->(t)
  RETURN c.name, t.name
  LIMIT 10
"
```

## 文档结构

```
TFM-Implementation-Summary.md    # 总体概述
├── 功能说明
├── 修改的文件列表
├── 使用方法
├── 数据流图
└── 性能和限制

TFM-Service-Usage-Guide.md       # 使用指南
├── 工作原理详解
├── 单/多目录使用
├── 层级关系说明
├── 查询和分析
├── 调试和故障排查
└── 最佳实践

TFM-Service-Extension-changelist.md  # 变更记录
├── 实现步骤
├── 代码变更
├── 测试说明
└── 技术细节
```

## 核心特性

- ✅ **自动识别**: Java 代码中的 TFM 调用自动识别
- ✅ **XML 解析**: 自动查找和解析 tfm_service 配置
- ✅ **多目录**: 支持定制层/公共层/产品层架构
- ✅ **高置信度**: 生成 0.95 置信度的调用关系
- ✅ **完整集成**: 无缝集成到 GitNexus 管道

## 快速故障排查

| 问题 | 检查项 | 解决方法 |
|------|--------|----------|
| TFM 调用未识别 | Java 文件、标准调用模式 | 查看 [Usage Guide](./TFM-Service-Usage-Guide.md) §调试 |
| XML 文件未找到 | 文件名、目录结构 | 检查环境变量 `GITNEXUS_TFM_ROOTS` |
| 类未解析 | XML 类路径、符号表 | 重新索引 `--force` |
| 方法未解析 | 方法名拼写 | 检查 XML 的 `method_def` 节点 |

## 测试

```bash
cd gitnexus
npm test -- tfm-processor
```

## 获取帮助

1. **使用问题**: 查看 [Usage Guide](./TFM-Service-Usage-Guide.md)
2. **实现细节**: 查看 [Changelist](./TFM-Service-Extension-changelist.md)
3. **整体理解**: 查看 [Summary](./TFM-Implementation-Summary.md)
4. **技术支持**: 提交 GitHub Issue

## 版本信息

- **实现日期**: 2026-03-17
- **GitNexus 版本**: 1.3.11+
- **状态**: ✅ 完成并可用

---

**开始使用？** → [Usage Guide](./TFM-Service-Usage-Guide.md)

**了解实现？** → [Changelist](./TFM-Service-Extension-changelist.md)

**快速概览？** → [Summary](./TFM-Implementation-Summary.md)
