# Java 调用解析修复 - 用户手册

## 概述

本次修复解决了 GitNexus 在多目录索引场景下的两个关键问题：
1. Java 跨文件调用被错误标记为 `same-file`
2. common/product 目录中 Method 节点 `content` 属性缺失

修复后，Java 调用图准确性显著提升，知识图谱质量改善。

---

## 适用场景

### 受益场景
本次修复特别适用于以下场景：

✅ **多目录索引**
```bash
npx gitnexus analyze \
  --customization /path/to/customization \
  --common /path/to/common \
  --product /path/to/product \
  --force
```

✅ **Java 项目调用分析**
- 存在同名类（如多个 `CustQuery` 类）
- 使用委托模式（Service → Manager）
- 需要准确的跨文件调用关系

✅ **知识图谱查询**
- 需要查看 Method 源代码（content 属性）
- 依赖准确的 CALLS 边进行影响分析
- 使用 MCP 工具进行代码探索

### 不受影响场景
以下场景修复前后无差异：

- 单目录索引（但修复仍然兼容）
- 非 Java 语言项目（TypeScript, Python 等）
- 没有同名类的 Java 项目

---

## 使用指南

### 1. 重新索引

**为什么需要重新索引？**
- 本次修复只改变索引逻辑，不修改已有数据库
- 必须重新索引才能生成正确的调用关系

**索引命令**:
```bash
# 单目录索引
cd /path/to/your/project
npx gitnexus analyze --force

# 多目录索引（推荐）
npx gitnexus analyze \
  --customization /path/to/customization \
  --common /path/to/common \
  --force
```

**注意事项**:
- `--force` 参数强制重新索引，忽略缓存
- 大型项目索引可能需要 5-30 分钟
- 索引期间建议关闭 MCP 服务器（避免数据库锁定）

---

### 2. 验证修复效果

#### 方法 A: 使用诊断脚本（推荐）

**准备环境**:
```bash
cd /path/to/gitnexus
npm run build  # 确保使用最新代码
```

**运行诊断**:
```bash
# 1. 检查 same-file 边数量
node gitnexus/diagnose-same-file.js

# 2. 检查 Java 解析分布
node gitnexus/diagnose-java-resolution.js

# 3. 检查 Method content 属性
node gitnexus/test-content-fix.js
```

**预期输出**:

**diagnose-same-file.js**:
```
Total same-file Method→Method CALLS edges: ~815

Cross-file same-file edges (WRONG): 0  ← 应该为 0

Pattern analysis:
  recursive: 503  (真正的递归调用)
  other-method: 312
```

**diagnose-java-resolution.js**:
```
Java CALLS edge reasons distribution:
  methodInstance             136,450  (55.5%)  ← 应该增加
  static                      44,322  (18.0%)
  import-resolved             31,511  (12.8%)
  this                        27,844  (11.3%)
  same-file                      815  (0.3%)   ← 应该减少
  super                        1,101  (0.4%)
  classInstance                  679  (0.3%)
```

**test-content-fix.js**:
```
Customization Methods: 100% with content  ✓
Common Methods: 100% with content         ✓ (修复前为 0%)
```

#### 方法 B: 使用 MCP 工具查询

**启动 MCP 服务器**:
```bash
npx gitnexus serve
```

**在 Claude Code 中查询**:
```
检查特定调用关系：

MATCH (caller:Method)-[r:CodeRelation {type: 'CALLS'}]->(callee:Method)
WHERE caller.name = 'queryCustTypeAttr'
  AND caller.filePath CONTAINS 'CustQueryService'
RETURN caller.filePath, callee.filePath, r.reason
```

**预期结果**:
```
caller: .../CustQueryService.java
callee: .../CustQuery.java (profile/cust/bs/)  ← 正确目标
reason: methodInstance  ← 正确 reason（修复前为 same-file）
```

---

### 3. 常见问题排查

#### Q1: 重新索引后仍有跨文件 same-file 边

**可能原因**:
1. 使用了旧版代码索引（未更新到修复版本）
2. 代码中使用了 wildcard import（`import com.example.*;`）
3. import 信息丢失（import-processor 未正常工作）

**排查步骤**:
```bash
# 1. 确认代码版本
git log --oneline -5
# 应该包含 java-call-resolver 相关 commit

# 2. 确认编译版本
ls -l dist/core/ingestion/java-call-resolver.js
# 修改时间应该是最新的

# 3. 重新编译和索引
npm run build
npx gitnexus analyze --force

# 4. 检查 import 信息
# 在 .gitnexus/lbug.db 中查询
MATCH (f:File {name: 'CustQueryService.java'})-[r:CodeRelation {type: 'IMPORTS'}]->(target:File)
RETURN target.filePath
# 应该包含 CustQuery.java
```

#### Q2: common 目录 Method 仍无 content

**可能原因**:
1. 多目录参数传递错误
2. 文件路径格式不匹配

**排查步骤**:
```bash
# 1. 检查索引命令
# 错误示例：
npx gitnexus analyze --customization /path/A --common /path/B
# 但实际索引时只用了 --customization

# 正确做法：确保两个参数都传入
npx gitnexus analyze \
  --customization E:\workspace-iwc\9E-COC\core92-atom \
  --common E:\workspace-iwc\9E-COC\coc92-core \
  --force

# 2. 检查文件路径格式
# 数据库中的 filePath 应该是相对路径，如:
#   customization: src/...
#   common: COC/code/bc/...

# 3. 手动验证文件存在
ls E:\workspace-iwc\9E-COC\coc92-core\COC\code\bc\...
```

#### Q3: 索引时间过长

**原因**:
- 修复后多次尝试文件读取（循环所有 root）

**优化建议**:
```bash
# 1. 减少 root 数量（只索引需要的目录）
npx gitnexus analyze --customization /path/to/main

# 2. 使用 .gitignore 排除不需要的文件
# 在项目根目录添加 .gitnexusignore
echo "test/" >> .gitnexusignore
echo "node_modules/" >> .gitnexusignore

# 3. 使用增量索引（非 --force）
# 首次索引后，后续使用
npx gitnexus analyze  # 不加 --force
```

---

### 4. 集成到工作流

#### 持续集成（CI）
```yaml
# .github/workflows/index.yml
name: GitNexus Index
on:
  push:
    branches: [main]

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install GitNexus
        run: npm install -g gitnexus

      - name: Index codebase
        run: |
          npx gitnexus analyze \
            --customization ./src \
            --common ./lib \
            --force

      - name: Validate index
        run: node scripts/validate-gitnexus.js
```

#### Pre-commit Hook
```bash
# .git/hooks/pre-commit
#!/bin/bash

# 检查是否有 Java 文件变更
if git diff --cached --name-only | grep -q "\.java$"; then
  echo "Java files changed, re-indexing..."
  npx gitnexus analyze --force > /dev/null 2>&1
fi
```

#### VS Code Task
```json
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "GitNexus: Re-index",
      "type": "shell",
      "command": "npx gitnexus analyze --force",
      "problemMatcher": [],
      "group": {
        "kind": "build",
        "isDefault": false
      }
    },
    {
      "label": "GitNexus: Validate",
      "type": "shell",
      "command": "node gitnexus/diagnose-java-resolution.js",
      "problemMatcher": []
    }
  ]
}
```

---

## 高级用法

### 自定义诊断脚本

**创建自定义验证脚本**:
```javascript
// scripts/validate-my-project.js
import { initLbug, executeQuery, closeLbug } from 'gitnexus/dist/core/lbug/lbug-adapter.js';

const dbPath = '.gitnexus/lbug';
await initLbug(dbPath);

// 检查特定类的调用关系
const result = await executeQuery(`
  MATCH (caller:Method)-[r:CodeRelation {type: 'CALLS'}]->(callee:Method)
  WHERE caller.filePath CONTAINS 'MyService.java'
    AND r.reason = 'same-file'
    AND caller.filePath <> callee.filePath
  RETURN COUNT(*) as wrong_edges
`);

if (result[0].wrong_edges > 0) {
  console.error(`Found ${result[0].wrong_edges} wrong same-file edges!`);
  process.exit(1);
}

console.log('✓ All same-file edges are correct');
await closeLbug();
```

**运行**:
```bash
node scripts/validate-my-project.js
```

### 性能监控

**索引性能分析**:
```bash
# 启用详细日志
GITNEXUS_DEBUG=1 npx gitnexus analyze --force 2>&1 | tee index.log

# 分析耗时
grep "elapsed" index.log | sort -k2 -n
```

**查询性能监控**:
```javascript
// 使用 EXPLAIN 分析查询
const result = await executeQuery(`
  EXPLAIN
  MATCH (m:Method {name: 'queryCustTypeAttr'})-[r:CALLS]->(target)
  RETURN target.name
`);
```

---

## 迁移指南

### 从旧版索引迁移

**步骤 1: 备份现有索引**
```bash
cp -r .gitnexus .gitnexus.backup
```

**步骤 2: 清理旧索引**
```bash
rm -rf .gitnexus
```

**步骤 3: 使用新版本索引**
```bash
# 确保使用最新版本
npm install -g gitnexus@latest

# 重新索引
npx gitnexus analyze --force
```

**步骤 4: 验证新索引**
```bash
node gitnexus/diagnose-java-resolution.js
```

**步骤 5: 如果有问题，恢复备份**
```bash
rm -rf .gitnexus
mv .gitnexus.backup .gitnexus
```

---

## 最佳实践

### 1. 索引策略
- ✅ 定期重新索引（每周一次）
- ✅ 代码大改后立即重新索引
- ✅ 使用 `--force` 确保完整索引
- ✅ 排除测试代码和生成代码

### 2. 验证策略
- ✅ 索引后运行诊断脚本
- ✅ 检查关键模块的调用关系
- ✅ 验证 content 属性完整性
- ✅ 监控 same-file 边数量

### 3. 性能优化
- ✅ 使用增量索引（非首次）
- ✅ 排除不必要的目录
- ✅ 考虑使用 SSD 存储索引文件
- ✅ 关闭不需要的 MCP 服务器

### 4. 问题排查
- ✅ 保存索引日志
- ✅ 对比修复前后差异
- ✅ 使用诊断脚本定位问题
- ✅ 查询数据库验证数据

---

## 技术支持

### 问题反馈
如遇到问题，请提供以下信息：

1. **环境信息**
   ```bash
   node --version
   npx gitnexus --version
   ```

2. **索引命令**
   ```bash
   # 你使用的完整命令
   npx gitnexus analyze ...
   ```

3. **诊断输出**
   ```bash
   node gitnexus/diagnose-same-file.js > diagnostic.log
   ```

4. **错误日志**
   ```bash
   # 索引时的错误输出
   ```

### 相关文档
- [技术方案](./fix-java-call-resolution-same-file-solution.md)
- [变更清单](./fix-java-call-resolution-same-file-changelist.md)
- [测试用例](./fix-java-call-resolution-same-file-testcase.md)

### 参考资源
- GitNexus 官方文档: https://docs.gitnexus.com
- GitHub Issue: https://github.com/your-org/gitnexus/issues
- MCP 工具使用: `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`
