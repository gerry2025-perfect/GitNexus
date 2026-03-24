# TFM Service 调用追踪 - 使用指南

## 功能概述

GitNexus 现已支持 TFM Service 框架的调用追踪功能。系统能够：

1. 识别 `ServiceFlow.callService(param)` 调用
2. 提取 `param.setServiceName("ServiceName")` 中的服务名
3. 查找对应的 XML 配置文件
4. 解析出实际调用的类和方法
5. 在知识图谱中建立精确的调用关系

## 工作原理

### 步骤 1: 识别调用

代码示例：
```java
DynamicDict parm = new DynamicDict();
parm.setServiceName("QryInternalSaleGoodsByESN{PN}UM");
parm.set("ESN", esn);
parm.set("ORG_ID", arg.getString("ORG_ID"));
ServiceFlow.callService(parm);
```

系统识别：
- 调用点：`ServiceFlow.callService(parm)`
- 服务名定义：`parm.setServiceName("QryInternalSaleGoodsByESN{PN}UM")`

### 步骤 2: 查找 XML 配置

在以下目录查找：
- `<主目录>/tfm_service/QryInternalSaleGoodsByESN{PN}UM.xml`
- `<公共层>/tfm_service/QryInternalSaleGoodsByESN{PN}UM.xml`
- `<产品层>/tfm_service/QryInternalSaleGoodsByESN{PN}UM.xml`

### 步骤 3: 解析 XML

XML 结构示例：
```xml
<data>
  <tfm_service_cat>
    <tfm_service_cat>
      <tfm_service_cat>
        <service>
          <definition>com.example.service.InternalSaleService</definition>
          <method_def>queryByESN</method_def>
        </service>
      </tfm_service_cat>
    </tfm_service_cat>
  </tfm_service_cat>
</data>
```

提取信息：
- **类路径**: `com.example.service.InternalSaleService`
- **方法名**: `queryByESN`（如果不存在或为空，默认 `perform`）

### 步骤 4: 建立调用关系

在知识图谱中创建：
```
[调用者函数] --CALLS--> [InternalSaleService.queryByESN]
  置信度: 0.95
  原因: tfm-service-resolution
```

## 使用方法

### 单目录模式（简单场景）

如果所有代码和配置都在一个目录中：

```bash
cd /path/to/your/project
npx gitnexus analyze
```

### 多目录模式（分层架构）

如果代码分为多个层级（定制层/公共层/产品层）：

**Linux/macOS:**
```bash
# 设置环境变量
export GITNEXUS_TFM_ROOTS="/path/to/common:/path/to/product"

# 索引定制层
cd /path/to/customization
npx gitnexus analyze
```

**Windows:**
```cmd
REM 设置环境变量（使用分号分隔）
set GITNEXUS_TFM_ROOTS=C:\path\to\common;C:\path\to\product

REM 索引定制层
cd C:\path\to\customization
npx gitnexus analyze
```

**永久设置（推荐）:**

创建 `.gitnexus/config.env` 文件：
```bash
# TFM Service 搜索路径
GITNEXUS_TFM_ROOTS=/path/to/common:/path/to/product
```

然后在索引前加载：
```bash
source .gitnexus/config.env
npx gitnexus analyze
```

## 层级关系说明

### 搜索优先级

假设有三个目录：
- `/custom` (定制层)
- `/common` (公共层)
- `/product` (产品层)

**定制层的代码可以调用:**
- 定制层的 TFM Service (`/custom/tfm_service/*.xml`)
- 公共层的 TFM Service (`/common/tfm_service/*.xml`)
- 产品层的 TFM Service (`/product/tfm_service/*.xml`)

**公共层的代码可以调用:**
- 公共层的 TFM Service (`/common/tfm_service/*.xml`)
- 产品层的 TFM Service (`/product/tfm_service/*.xml`)

**产品层的代码只能调用:**
- 产品层的 TFM Service (`/product/tfm_service/*.xml`)

> **注意**: 当前实现会在所有目录中搜索，层级限制需要通过目录结构和命名约定来实现。

### 同名服务处理

如果多个层都有同名的 XML 文件，使用第一个找到的：

```
搜索顺序: /custom -> /common -> /product
```

示例：
- `/custom/tfm_service/QueryUser.xml` ✅ 使用这个
- `/common/tfm_service/QueryUser.xml` ❌ 忽略
- `/product/tfm_service/QueryUser.xml` ❌ 忽略

## 查询和分析

索引完成后，可以使用 MCP 工具查询调用关系：

### 查找 TFM 调用

```javascript
// 使用 context 工具查看某个服务的调用情况
context({
  name: "InternalSaleService",
  repo: "my-project"
})
```

输出示例：
```yaml
symbol:
  uid: "Class:InternalSaleService"
  kind: Class
  filePath: /custom/src/service/InternalSaleService.java

incoming:
  calls:
    - name: "handleQuery"
      confidence: 0.95
      reason: "tfm-service-resolution"
      file: /custom/src/controller/SaleController.java
```

### 影响分析

修改 TFM Service 前，查看影响范围：

```javascript
impact({
  target: "InternalSaleService",
  direction: "upstream",
  repo: "my-project"
})
```

### 执行流程追踪

查看包含此 Service 的执行流程：

```
READ gitnexus://repo/my-project/processes
```

## 调试和故障排查

### 启用详细日志

```bash
NODE_ENV=development npx gitnexus analyze
```

### 常见问题

#### 1. TFM 调用未被识别

**症状**: 索引完成但没有 TFM 调用关系

**检查清单**:
- ✓ 代码是 Java 文件 (`.java`)
- ✓ 使用了 `ServiceFlow.callService(param)` 标准调用
- ✓ 在调用前设置了 `param.setServiceName("...")`
- ✓ 服务名和 XML 文件名匹配

**调试命令**:
```bash
# 查看是否提取到 TFM 调用
grep "\[TFM\]" analyze.log
```

#### 2. XML 文件未找到

**症状**: 日志显示 `XML not found for service: XXX`

**解决方法**:
1. 检查文件名是否完全匹配（区分大小写）
2. 检查 tfm_service 目录是否存在
3. 验证环境变量设置是否正确

```bash
# 检查 XML 文件
find /path/to/project -name "*.xml" -path "*/tfm_service/*"
```

#### 3. 类或方法未找到

**症状**: 日志显示 `Class not found in symbol table: XXX`

**原因**: XML 中指定的类在代码库中不存在或未被索引

**解决方法**:
1. 检查类路径是否正确
2. 确保类所在的 Java 文件已被索引
3. 重新运行分析: `npx gitnexus analyze --force`

#### 4. 方法名解析失败

**症状**: 日志显示 `Method XXX not found in class YYY`

**检查**:
- XML 中的 `method_def` 节点值是否正确
- 方法在类中是否存在
- 方法名拼写是否一致

**默认行为**: 如果 `method_def` 为空，自动使用 `perform` 方法

### 验证结果

使用 Cypher 查询验证 TFM 关系：

```bash
npx gitnexus cypher "
  MATCH (caller)-[r:CALLS {reason: 'tfm-service-resolution'}]->(target)
  RETURN caller.name, target.name, r.confidence
  LIMIT 10
"
```

## 性能考虑

### 索引时间

- **小项目** (< 1000 文件): +5-10 秒
- **中型项目** (1000-5000 文件): +20-40 秒
- **大型项目** (> 5000 文件): +1-2 分钟

### 内存使用

TFM 处理增加的内存使用：
- XML 解析: ~10-50 MB
- 符号查找: 可忽略

## 最佳实践

1. **命名规范**: 保持 XML 文件名和服务名一致
2. **目录结构**: 将 tfm_service 放在项目根目录下
3. **定期重索引**: 修改 XML 后重新运行 analyze
4. **使用版本控制**: 不要忽略 .gitnexus 目录，建议提交到 git

## 示例项目结构

```
project/
├── customization/
│   ├── src/
│   │   └── com/example/
│   │       └── CustomController.java  # 调用 TFM Service
│   └── tfm_service/
│       └── CustomQuery.xml
├── common/
│   ├── src/
│   │   └── com/example/common/
│   │       └── CommonService.java
│   └── tfm_service/
│       └── CommonQuery.xml
└── product/
    ├── src/
    │   └── com/example/product/
    │       └── ProductService.java
    └── tfm_service/
        └── BaseQuery.xml
```

索引命令：
```bash
export GITNEXUS_TFM_ROOTS="$(pwd)/common:$(pwd)/product"
cd customization
npx gitnexus analyze
```

## 集成到 CI/CD

### GitHub Actions 示例

```yaml
name: Code Intelligence

on: [push, pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Index codebase
        env:
          GITNEXUS_TFM_ROOTS: ${{ github.workspace }}/common:${{ github.workspace }}/product
        run: |
          cd customization
          npx gitnexus analyze

      - name: Analyze impact
        run: |
          npx gitnexus cypher "
            MATCH (c)-[r:CALLS {reason: 'tfm-service-resolution'}]->(t)
            RETURN count(r) as tfm_calls
          "
```

## 常见用例

### 用例 1: 查找所有 TFM Service 调用者

```javascript
query({
  query: "ServiceFlow.callService",
  repo: "my-project"
})
```

### 用例 2: 追踪特定服务的调用链

```javascript
cypher({
  query: `
    MATCH path = (entry)-[:CALLS*]->(service:Method)
    WHERE service.name = 'queryByESN'
    AND service.filePath CONTAINS 'InternalSaleService'
    RETURN path
    LIMIT 5
  `,
  repo: "my-project"
})
```

### 用例 3: 找出未被调用的 TFM Service

```bash
# 1. 列出所有 XML 文件
find tfm_service -name "*.xml" -exec basename {} .xml \;

# 2. 查询已解析的服务
npx gitnexus cypher "
  MATCH ()-[r:CALLS {reason: 'tfm-service-resolution'}]->()
  RETURN DISTINCT r.serviceName
"

# 3. 对比找出未使用的
```

## 技术细节

### XML 路径解析

当前实现使用固定路径：
```javascript
data.tfm_service_cat.tfm_service_cat.tfm_service_cat.service.definition
data.tfm_service_cat.tfm_service_cat.tfm_service_cat.service.method_def
```

如果您的 XML 结构不同，需要修改 `tfm-call-processor.ts` 文件。

### 置信度评分

- **TFM Service 调用**: 0.95（高置信度）
- **原因**: `tfm-service-resolution`

这表示这是通过 XML 配置解析得到的精确调用关系。

### 限制

1. **语言支持**: 仅支持 Java
2. **调用模式**: 仅识别 `ServiceFlow.callService()`
3. **XML 格式**: 假设特定的 XML 结构
4. **变量追踪**: 仅在同一文件内追踪变量

## 获取帮助

- GitHub Issues: https://github.com/abhigyanpatwari/GitNexus/issues
- 查看变更记录: `TFM-Service-Extension-changelist.md`
- 技术文档: `ARCHITECTURE.md`
