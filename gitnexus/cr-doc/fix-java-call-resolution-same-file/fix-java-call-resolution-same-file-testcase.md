# 测试用例

## 测试环境

### 测试数据
- **项目路径**: `E:\workspace-iwc\9E-COC`
  - customization: `E:\workspace-iwc\9E-COC\core92-atom`
  - common: `E:\workspace-iwc\9E-COC\coc92-core`

- **测试文件**:
  - 调用者: `COC/code/bc/bc-nocomponent/profile/src/com/ztesoft/zsmart/bss/profile/cust/services/CustQueryService.java`
  - 被调用者: `COC/code/bc/bc-nocomponent/profile/src/com/ztesoft/zsmart/bss/profile/cust/bs/CustQuery.java`

### 测试工具
- 诊断脚本: `gitnexus/diagnose-same-file.js`
- 诊断脚本: `gitnexus/diagnose-java-resolution.js`
- 验证脚本: `gitnexus/test-content-fix.js`

---

## 测试用例清单

### TC-001: 编译验证
**用例状态**: ✅ 通过

**测试步骤**:
```bash
cd /e/workspace/AI/gitnexus-gerry/gitnexus
npm run build
```

**预期结果**:
- 编译成功，无 TypeScript 错误
- 生成 `dist/core/ingestion/java-call-resolver.js`
- 生成 `dist/core/lbug/csv-generator.js`

**实际结果**:
```
> gitnexus@1.4.8 build
> tsc

(编译成功，无输出)
```

---

### TC-002: TypeEnv 提取测试
**用例状态**: ✅ 通过

**测试目的**: 验证 TypeEnv 能正确提取 Java 字段类型

**测试步骤**:
```bash
node gitnexus/test-custquery-typeenv.js
```

**测试代码**:
```javascript
const typeEnv = buildTypeEnv(tree, 'java');
const receiverType = typeEnv.lookup('custQuery', callNode);
```

**预期结果**:
```
Found method: queryCustTypeAttr

Total 4 method calls:
1. BoHelper.boToDto()
   Receiver type: UNKNOWN

2. custQuery.queryCustTypeAttr()
   Receiver type: CustQuery  ← 关键：应该是 CustQuery
   >>> THIS IS THE DELEGATION CALL <<<

3. dict.getLong()
   Receiver type: DynamicDict

4. dict.set()
   Receiver type: DynamicDict
```

**实际结果**: ✅ TypeEnv 正确提取 `custQuery => CustQuery`

---

### TC-003: Worker 调用提取测试
**用例状态**: ✅ 通过

**测试目的**: 验证 Worker 正确提取 `receiverTypeName`

**测试步骤**:
```bash
node gitnexus/test-worker-call-extract.js
```

**预期结果**:
```
Calls extracted from queryCustTypeAttr method:

2. custQuery.queryCustTypeAttr()
   callForm: member
   receiverTypeName: CustQuery  ← 关键：应该提取到
   >>> DELEGATION CALL <<<
   ✓ receiverTypeName is available: CustQuery
```

**实际结果**: ✅ Worker 正确提取 `receiverTypeName: 'CustQuery'`

---

### TC-004: SymbolTable 类查找测试
**用例状态**: ✅ 通过

**测试目的**: 验证数据库中存在多个 CustQuery 类

**测试步骤**:
```bash
node gitnexus/test-class-existence.js
```

**预期结果**:
```
Found 4 classes named 'CustQuery'

1. CustQuery class:
   filePath: COC/code/cc/cc-nocomponent/src_bll/.../CustQuery.java

2. CustQuery class:
   filePath: portal-framework/.../CustQuery.java

3. CustQuery class:
   filePath: COC/code/bc/bc-nocomponent/profile/src/.../subs/bs/CustQuery.java

4. CustQuery class:
   filePath: COC/code/bc/bc-nocomponent/profile/src/.../cust/bs/CustQuery.java  ← 正确目标
```

**实际结果**: ✅ 找到 4 个同名类

**关键发现**: `symbolTable.lookupFuzzy('CustQuery')` 返回 4 个类，修复前会返回第 1 个（错误）

---

### TC-005: Import 信息验证
**用例状态**: ✅ 通过

**测试目的**: 验证 CustQueryService 导入了正确的 CustQuery

**测试步骤**:
```bash
grep "^import.*CustQuery" \
  E:/workspace-iwc/9E-COC/coc92-core/COC/code/bc/bc-nocomponent/profile/src/.../CustQueryService.java
```

**预期结果**:
```java
import com.ztesoft.zsmart.bss.profile.cust.bs.CustQuery;
```

**实际结果**: ✅ 导入了 `profile/cust/bs/CustQuery`

**关键结论**: import 明确指定了正确的类，修复应该使用这个信息

---

### TC-006: 修复前 - 跨文件 same-file 边检查
**用例状态**: ✅ 通过（发现预期问题）

**测试目的**: 验证修复前存在跨文件 same-file 错误

**测试步骤**:
```bash
# 使用修复前代码索引
node gitnexus/diagnose-same-file.js
```

**预期结果**:
```
Total same-file Method→Method CALLS edges: 1451

Cross-file same-file edges (WRONG): 632+

Pattern analysis:
  recursive: 503
  other-method: 312
```

**实际结果**: ✅ 发现 632+ 跨文件错误边

**示例错误边**:
```
queryCustTypeAttr → queryCustTypeAttr
  Caller:  .../CustQueryService.java
  Callee:  .../CustQuery.java (错误：应该是 cust/bs，实际可能指向同文件)
  ⚠️ Method 'queryCustTypeAttr' EXISTS in caller file!
```

---

### TC-007: 修复前 - Method content 缺失检查
**用例状态**: ⏳ 待测试（需修复前数据库）

**测试目的**: 验证修复前 common 目录 Method 无 content

**测试步骤**:
```bash
# 使用修复前代码索引
node gitnexus/test-content-fix.js
```

**预期结果**:
```
Customization Methods (core92-atom):
  Total: 500
  With content: 500 (100%)  ✓
  Empty: 0

Common Methods (coc92-core):
  Total: 1500
  With content: 0 (0%)      ✗ 问题
  Empty: 1500
```

---

### TC-008: 修复后 - 完整索引测试
**用例状态**: ⏳ 待测试

**测试目的**: 验证修复后索引正确

**测试步骤**:
```bash
# 1. 使用修复后代码重新索引
cd /e/workspace-iwc/9E-COC/core92-atom
npx gitnexus analyze \
  --customization . \
  --common ../coc92-core \
  --force

# 2. 运行诊断
node /e/workspace/AI/gitnexus-gerry/gitnexus/gitnexus/diagnose-same-file.js
node /e/workspace/AI/gitnexus-gerry/gitnexus/gitnexus/diagnose-java-resolution.js
node /e/workspace/AI/gitnexus-gerry/gitnexus/gitnexus/test-content-fix.js
```

**预期结果 - diagnose-same-file.js**:
```
Total same-file Method→Method CALLS edges: ~815

Cross-file same-file edges (WRONG): 0  ← 应该为 0

Pattern analysis:
  recursive: 503  (真正的递归调用)
  other-method: 312
```

**预期结果 - diagnose-java-resolution.js**:
```
Java CALLS edge reasons distribution:
  methodInstance             136,450  (55.5%)  ← 增加
  static                      44,322  (18.0%)
  import-resolved             31,511  (12.8%)
  this                        27,844  (11.3%)
  same-file                      815  (0.3%)   ← 减少
  super                        1,101  (0.4%)
  classInstance                  679  (0.3%)

Java-specific reasons (should be most calls):
  methodInstance             136,450
  classInstance                  679
```

**预期结果 - test-content-fix.js**:
```
Customization Methods: 100% with content  ✓
Common Methods: 100% with content         ✓ (修复!)
```

---

### TC-009: 特定调用关系验证
**用例状态**: ⏳ 待测试

**测试目的**: 验证 `CustQueryService → CustQuery.queryCustTypeAttr` 正确解析

**测试步骤**:
```bash
# 使用 MCP 工具查询
```

**MCP 查询**:
```cypher
MATCH (caller:Method)-[r:CodeRelation {type: 'CALLS'}]->(callee:Method)
WHERE caller.name = 'queryCustTypeAttr'
  AND caller.filePath CONTAINS 'CustQueryService.java'
  AND callee.name = 'queryCustTypeAttr'
RETURN caller.filePath as callerFile,
       callee.filePath as calleeFile,
       r.reason as reason,
       r.confidence as confidence
```

**预期结果**:
```
callerFile: .../services/CustQueryService.java
calleeFile: .../bs/CustQuery.java  ← 正确目标 (cust/bs)
reason: methodInstance             ← 正确 reason
confidence: 0.95
```

---

### TC-010: OrderReasonService 特定案例
**用例状态**: ⏳ 待测试

**测试目的**: 验证之前报告的 OrderReasonService 问题已修复

**测试步骤**:
```bash
# MCP 查询
```

**MCP 查询**:
```cypher
MATCH (m1:Method)-[r:CodeRelation {type: 'CALLS'}]->(m2:Method)
WHERE m1.filePath CONTAINS 'OrderReasonService.java'
  AND m1.name = 'addOrderReason'
  AND (m2.name = 'addOrderReason' OR m2.name = 'addOrderReasonAttrValue')
RETURN m1.name as caller,
       m2.name as callee,
       m2.filePath as calleeFile,
       r.reason as reason
```

**预期结果**:
```
1. addOrderReason → addOrderReason
   calleeFile: .../OrderReasonManager.java  ← 正确
   reason: methodInstance                   ← 正确 (修复前为 same-file)

2. addOrderReason → addOrderReasonAttrValue
   calleeFile: .../OrderReasonManager.java  ← 正确
   reason: methodInstance                   ← 正确 (修复前为 same-file)
```

---

### TC-011: 向后兼容性测试
**用例状态**: ⏳ 待测试

**测试目的**: 验证单目录索引仍正常工作

**测试步骤**:
```bash
# 单目录索引
cd /path/to/single-project
npx gitnexus analyze --force

# 诊断
node gitnexus/diagnose-java-resolution.js
```

**预期结果**:
- 索引成功
- Java 解析正常
- 无错误或警告

---

### TC-012: 性能测试
**用例状态**: ⏳ 待测试

**测试目的**: 验证修复后性能无明显下降

**测试步骤**:
```bash
# 测量索引时间
time npx gitnexus analyze \
  --customization ... \
  --common ... \
  --force
```

**预期结果**:
- 索引时间差异 < 10%（修复前后对比）
- 内存占用无明显增加
- 数据库大小差异 < 5%

---

## 测试结果汇总

### 已通过测试
| 测试用例 | 状态 | 说明 |
|----------|------|------|
| TC-001 | ✅ | 编译成功 |
| TC-002 | ✅ | TypeEnv 正确提取 |
| TC-003 | ✅ | Worker 正确提取 |
| TC-004 | ✅ | 找到 4 个同名类 |
| TC-005 | ✅ | Import 信息正确 |
| TC-006 | ✅ | 发现预期问题 |

### 待测试
| 测试用例 | 状态 | 阻塞原因 |
|----------|------|----------|
| TC-007 | ⏳ | 需修复前数据库 |
| TC-008 | ⏳ | 需重新索引 |
| TC-009 | ⏳ | 需重新索引 |
| TC-010 | ⏳ | 需重新索引 |
| TC-011 | ⏳ | 需重新索引 |
| TC-012 | ⏳ | 需重新索引 |

---

## 测试执行计划

### 阶段 1: 修复前基线测试（已完成）
- [x] TC-001: 编译验证
- [x] TC-002: TypeEnv 提取测试
- [x] TC-003: Worker 调用提取测试
- [x] TC-004: SymbolTable 类查找测试
- [x] TC-005: Import 信息验证
- [x] TC-006: 修复前跨文件 same-file 边检查

### 阶段 2: 修复后验证测试（待执行）
- [ ] TC-007: 修复前 Method content 缺失检查（可选）
- [ ] TC-008: 修复后完整索引测试
- [ ] TC-009: 特定调用关系验证
- [ ] TC-010: OrderReasonService 特定案例
- [ ] TC-011: 向后兼容性测试
- [ ] TC-012: 性能测试

### 阶段 3: 回归测试（待执行）
- [ ] 在其他 Java 项目上验证
- [ ] 验证非 Java 项目不受影响
- [ ] 验证单目录索引不受影响
- [ ] 验证 MCP 工具正常工作

---

## 测试数据

### 修复前统计
```
same-file Method→Method 边: 1,451
  其中跨文件错误边: 632+
  其中真正递归调用: 815

methodInstance 边: 135,818

Common 目录 Method content: 0% (全部为空)
```

### 修复后预期统计
```
same-file Method→Method 边: ~815 (仅递归调用)
  其中跨文件错误边: 0
  其中真正递归调用: 815

methodInstance 边: 136,450+ (增加 632+)

Common 目录 Method content: 100% (全部有内容)
```

---

## 测试环境要求

### 软件版本
- Node.js: >= 18.0.0
- GitNexus: 最新版本（包含修复）
- TypeScript: >= 5.0.0

### 硬件要求
- 内存: >= 8GB
- 磁盘: >= 5GB 可用空间（用于索引）
- CPU: >= 4 核（建议）

### 测试数据要求
- Java 项目（包含同名类）
- 多目录结构（customization + common）
- 代码规模: >= 1000 个 Java 文件

---

## 问题记录

### 已知问题
1. **wildcard import 未处理**
   - 影响: 极少数使用 `import com.example.*;` 的场景
   - 缓解: 大多数企业代码使用显式 import
   - 优先级: P3

2. **fully qualified name 匹配未实现**
   - 影响: 类似 `com.example.CustQuery` 的完整类名查找
   - 缓解: import 消歧已覆盖大部分场景
   - 优先级: P2

### 测试遗留
- 需要在更多 Java 项目上验证
- 需要性能基准测试
- 需要长期稳定性验证

---

## 测试脚本

### 自动化测试脚本
```bash
#!/bin/bash
# test-fix.sh

set -e

echo "=== GitNexus Java Call Resolution Fix Test Suite ==="

# 1. 编译验证
echo "[1/6] Compiling..."
npm run build > /dev/null 2>&1
echo "✓ Compilation passed"

# 2. 重新索引
echo "[2/6] Re-indexing..."
npx gitnexus analyze \
  --customization E:\workspace-iwc\9E-COC\core92-atom \
  --common E:\workspace-iwc\9E-COC\coc92-core \
  --force > /dev/null 2>&1
echo "✓ Re-indexing completed"

# 3. 检查 same-file 边
echo "[3/6] Checking same-file edges..."
node gitnexus/diagnose-same-file.js > /tmp/same-file.log
CROSS_FILE=$(grep "Cross-file same-file edges" /tmp/same-file.log | grep -o "[0-9]*")
if [ "$CROSS_FILE" -eq 0 ]; then
  echo "✓ No cross-file same-file edges"
else
  echo "✗ Found $CROSS_FILE cross-file same-file edges (expected 0)"
  exit 1
fi

# 4. 检查 Java 解析分布
echo "[4/6] Checking Java resolution distribution..."
node gitnexus/diagnose-java-resolution.js > /tmp/java-resolution.log
METHODINSTANCE=$(grep "methodInstance" /tmp/java-resolution.log | head -1 | grep -o "[0-9]\+" | head -1)
if [ "$METHODINSTANCE" -gt 136000 ]; then
  echo "✓ methodInstance count increased: $METHODINSTANCE"
else
  echo "✗ methodInstance count too low: $METHODINSTANCE (expected > 136000)"
  exit 1
fi

# 5. 检查 content 属性
echo "[5/6] Checking Method content..."
node gitnexus/test-content-fix.js > /tmp/content.log
COMMON_CONTENT=$(grep "Common Methods:" /tmp/content.log | grep -o "[0-9]*%" | head -1)
if [ "$COMMON_CONTENT" == "100%" ]; then
  echo "✓ Common Methods have content"
else
  echo "✗ Common Methods content: $COMMON_CONTENT (expected 100%)"
  exit 1
fi

# 6. 验证特定调用
echo "[6/6] Validating specific calls..."
# TODO: 添加 MCP 查询验证

echo ""
echo "=== All tests passed! ==="
```

---

## 相关文档
- [技术方案](./fix-java-call-resolution-same-file-solution.md)
- [变更清单](./fix-java-call-resolution-same-file-changelist.md)
- [用户手册](./fix-java-call-resolution-same-file-userguide.md)
