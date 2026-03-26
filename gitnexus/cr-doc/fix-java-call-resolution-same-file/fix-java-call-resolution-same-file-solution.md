# Java 调用解析 same-file 错误修复方案

## 问题背景

### 问题现象
在多目录索引场景下（`--customization` + `--common`），Java 代码调用解析出现以下问题：

1. **跨文件调用被错误标记为 same-file**
   - 实际情况：`CustQueryService.queryCustTypeAttr()` 调用 `CustQuery.queryCustTypeAttr()`（跨文件）
   - 错误结果：CALLS 边的 reason 为 `same-file`，目标指向同文件中的同名方法
   - 影响范围：1,447 个 Java Method→Method CALLS 边

2. **Method 节点 content 属性缺失**
   - customization 目录：Method 节点有 content 属性 ✓
   - common/product 目录：Method 节点 content 为空 ✗

### 用户场景
```bash
npx gitnexus analyze \
  --customization E:\workspace-iwc\9E-COC\core92-atom \
  --common E:\workspace-iwc\9E-COC\coc92-core \
  --force
```

索引完成后，发现：
- Java 调用图不准确
- 跨文件调用关系丢失
- 知识图谱质量下降

---

## 根因分析

### 问题 1: 跨文件 same-file 边

#### 调用链路分析
```
CustQueryService.java (调用者)
  ├─ 方法: queryCustTypeAttr()
  ├─ 调用: custQuery.queryCustTypeAttr()
  │   ├─ receiverName: custQuery
  │   ├─ receiverTypeName: CustQuery  (TypeEnv 正确提取 ✓)
  │   └─ calledName: queryCustTypeAttr
  │
  └─ 预期目标: CustQuery.java (profile/cust/bs) 中的 queryCustTypeAttr()
     实际目标: CustQueryService.java 中的 queryCustTypeAttr() (错误！)
```

#### 失败路径追踪

**第一步：Java Resolver 尝试解析**
```typescript
// call-processor.ts:1337-1345
const javaCallSite: JavaCallSite = {
  calledName: 'queryCustTypeAttr',
  objectName: 'custQuery',
  objectTypeName: 'CustQuery',  // ✓ TypeEnv 正确提取
  currentFile: 'COC/.../CustQueryService.java',
  enclosingFunctionId: '...',
};

resolveJavaCallTarget(javaCallSite, graph, symbolTable, importMap, null)
```

**第二步：methodInstance (fast path) 执行**
```typescript
// java-call-resolver.ts:283-301
if (!isCapitalized(objectName) && objectTypeName) {
  // objectTypeName = 'CustQuery'
  const result = resolveMethodInstanceByType(
    'queryCustTypeAttr',
    'CustQuery',        // ← 问题关键
    currentFile,
    symbolTable
  );
}
```

**第三步：findClassByTypeName 返回错误类**
```typescript
// java-call-resolver.ts:725-742 (修复前)
const findClassByTypeName = (typeName, currentFile, symbolTable) => {
  const allDefs = symbolTable.lookupFuzzy('CustQuery');
  // 返回结果：4 个同名类
  // [0] cc/sales/bll/CustQuery.java         ← 错误返回！
  // [1] portal/.../CustQuery.java
  // [2] profile/subs/bs/CustQuery.java
  // [3] profile/cust/bs/CustQuery.java      ← 正确目标

  const classDefs = allDefs.filter(def => def.type === 'Class');
  return classDefs[0];  // 返回第一个匹配 (错误！)
};
```

**第四步：在错误类中查找方法失败**
```typescript
// 在 cc/sales/bll/CustQuery.java 中查找 queryCustTypeAttr
const methodDef = symbolTable.findMethodInClass(
  'Class:cc/sales/bll/CustQuery.java:CustQuery',  // ← 错误的类
  'queryCustTypeAttr'
);
// 结果：null (该类中没有这个方法)
```

**第五步：Fallback 到 generic resolver**
```typescript
// call-processor.ts:1357-1370
if (!resolved) {
  resolved = resolveCallTarget(effectiveCall, filePath, ctx);
  // Generic resolver 逻辑：
  // 1. lookupExactAll(currentFile, 'queryCustTypeAttr')
  // 2. 找到同文件中的 queryCustTypeAttr 方法
  // 3. 返回 { tier: 'same-file', confidence: 0.95 }
}
```

**第六步：错误边生成**
```
CALLS {
  from: Method:CustQueryService.java:queryCustTypeAttr
  to: Method:CustQueryService.java:queryCustTypeAttr  ← 错误！应该指向 CustQuery.java
  reason: same-file
  confidence: 0.95
}
```

#### 为什么会有 4 个同名类？

**Java 包结构允许同名类**
```java
// 文件 1: cc/sales/bll/CustQuery.java
package com.ztesoft.zsmart.bss.cc.sales.bll;
public class CustQuery { ... }

// 文件 2: profile/cust/bs/CustQuery.java
package com.ztesoft.zsmart.bss.profile.cust.bs;
public class CustQuery { ... }
```

**Import 消歧**
```java
// CustQueryService.java
import com.ztesoft.zsmart.bss.profile.cust.bs.CustQuery;  // ← 明确指定

private CustQuery custQuery;  // 编译器知道是哪个 CustQuery
```

**但 findClassByTypeName 没有使用 import 信息！**
```typescript
// 修复前：只用名称查找，返回第一个
const classDefs = symbolTable.lookupFuzzy('CustQuery');
return classDefs[0];  // 没有消歧逻辑
```

---

### 问题 2: Method content 属性缺失

#### 调用链路分析
```
Pipeline → loadGraphToLbug → streamAllCSVsToDisk → FileContentCache

多目录索引：
  roots = ['E:\...\core92-atom', 'E:\...\coc92-core']

修复前：
  FileContentCache(repoPath: string)  // 只接受单个路径
  repoPath = roots[0] = 'core92-atom'  // 只用第一个 root

读取 common 目录文件时：
  filePath = 'COC/code/bc/...'  (相对路径)
  fullPath = join('core92-atom', 'COC/code/bc/...')  // ✗ 错误拼接
  readFile(fullPath)  // 文件不存在 → content 为空
```

#### 为什么 customization 有 content？
```
customization 文件：
  filePath = 'src/...'
  fullPath = join('core92-atom', 'src/...')  // ✓ 正确
  readFile(fullPath)  // 文件存在 → content 正常
```

---

## 解决方案

### 方案 1: 修复 findClassByTypeName 同名类消歧

#### 核心思路
使用 **import 信息** 在多个同名类中选择正确的类。

#### 实现代码
```typescript
// src/core/ingestion/java-call-resolver.ts:725-758
const findClassByTypeName = (
  typeName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap?: ImportMap,  // ← 新增参数
): SymbolDefinition | null => {
  // 1. 优先查找同文件中的类
  const localDef = symbolTable.lookupExactFull(currentFile, typeName);
  if (localDef && (localDef.type === 'Class' || ...)) {
    return localDef;
  }

  // 2. 全局查找
  const allDefs = symbolTable.lookupFuzzy(typeName);
  const classDefs = allDefs.filter(def =>
    def.type === 'Class' || def.type === 'Interface' || def.type === 'Enum'
  );

  if (classDefs.length === 0) return null;
  if (classDefs.length === 1) return classDefs[0];

  // 3. 多个同名类 - 使用 import 消歧
  if (importMap) {
    const importedFiles = importMap.get(currentFile);
    if (importedFiles) {
      const importedDef = classDefs.find(def =>
        importedFiles.has(def.filePath)  // ← 检查是否被 import
      );
      if (importedDef) return importedDef;  // ← 优先返回 import 的类
    }
  }

  // 4. Fallback: 返回第一个（向后兼容）
  return classDefs[0];
};
```

#### 传播修改
更新所有调用 `findClassByTypeName` 的函数签名：

1. **resolveMethodInstanceByType** (快速路径)
```typescript
const resolveMethodInstanceByType = (
  calledName: string,
  typeName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap: ImportMap,  // ← 新增
): JavaResolveResult | null => {
  const classDef = findClassByTypeName(typeName, currentFile, symbolTable, importMap);
  // ...
};
```

2. **resolveMethodInstance** (AST 慢速路径)
```typescript
const resolveMethodInstance = (
  ...
  importMap: ImportMap,  // ← 新增
  astCache: ASTCache,
): JavaResolveResult | null => {
  const classDef = findClassByTypeName(variable.typeName, currentFile, symbolTable, importMap);
  // ...
};
```

3. **resolveClassInstance** (字段调用)
```typescript
const resolveClassInstance = (
  ...
  importMap: ImportMap,  // ← 新增
): JavaResolveResult | null => {
  const classDef = findClassByTypeName(typeName, currentFile, symbolTable, importMap);
  // ...
};
```

4. **resolveSuperCall** (父类调用)
```typescript
const resolveSuperCall = (
  ...
  importMap: ImportMap,  // ← 新增
): JavaResolveResult | null => {
  const parentClass = findClassByTypeName(parentClassName, currentFile, symbolTable, importMap);
  // ...
};
```

5. **resolveJavaCallTarget** (入口函数)
```typescript
// java-call-resolver.ts:285, 307, 328, 375
resolveMethodInstanceByType(..., importMap)
resolveClassInstance(..., importMap)
resolveMethodInstance(..., importMap, astCache)
resolveSuperCall(..., importMap)
```

#### 消歧效果示例
```typescript
// 调用前
findClassByTypeName('CustQuery', 'CustQueryService.java', symbolTable)
// 返回: Class:cc/sales/bll/CustQuery.java:CustQuery (错误)

// 调用后
findClassByTypeName('CustQuery', 'CustQueryService.java', symbolTable, importMap)
// importMap.get('CustQueryService.java') 包含:
//   'COC/code/bc/bc-nocomponent/profile/src/.../cust/bs/CustQuery.java'
// 返回: Class:profile/cust/bs/CustQuery.java:CustQuery (正确！)
```

---

### 方案 2: 修复 FileContentCache 多 root 支持

#### 核心思路
`FileContentCache` 支持多个 root 路径，循环尝试直到找到文件。

#### 实现代码
```typescript
// src/core/lbug/csv-generator.ts:64-111
class FileContentCache {
  private cache = new Map<string, string>();
  private accessOrder: string[] = [];
  private maxSize: number;
  private roots: string[];  // ← 改为数组

  constructor(repoPath: string | string[], maxSize: number = 3000) {
    this.roots = Array.isArray(repoPath) ? repoPath : [repoPath];  // ← 支持数组
    this.maxSize = maxSize;
  }

  async get(relativePath: string): Promise<string> {
    if (!relativePath) return '';

    // 检查缓存
    const cached = this.cache.get(relativePath);
    if (cached !== undefined) {
      // LRU promotion
      const idx = this.accessOrder.indexOf(relativePath);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
        this.accessOrder.push(relativePath);
      }
      return cached;
    }

    // 循环尝试所有 root 路径
    for (const root of this.roots) {
      try {
        const fullPath = path.join(root, relativePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        this.set(relativePath, content);
        return content;  // ← 找到文件，立即返回
      } catch {
        continue;  // ← 尝试下一个 root
      }
    }

    // 所有 root 都失败 → 文件不存在
    this.set(relativePath, '');
    return '';
  }

  // ...
}
```

#### 函数签名更新

1. **streamAllCSVsToDisk**
```typescript
// src/core/lbug/csv-generator.ts:212
export const streamAllCSVsToDisk = async (
  graph: KnowledgeGraph,
  repoPath: string | string[],  // ← 支持数组
  csvDir: string,
): Promise<StreamedCSVResult> => {
  const contentCache = new FileContentCache(repoPath);  // ← 传入数组
  // ...
};
```

2. **loadGraphToLbug**
```typescript
// src/core/lbug/lbug-adapter.ts:177
export const loadGraphToLbug = async (
  graph: KnowledgeGraph,
  repoPath: string | string[],  // ← 支持数组
  storagePath: string,
  onProgress?: LbugProgressCallback
) => {
  const csvResult = await streamAllCSVsToDisk(graph, repoPath, csvDir);
  // ...
};
```

3. **analyze.ts 调用**
```typescript
// src/cli/analyze.ts:302
const lbugResult = await loadGraphToLbug(
  pipelineResult.graph,
  roots.length > 1 ? roots : repoPath,  // ← 传入完整 roots 数组
  storagePath,
  (msg) => { ... }
);
```

#### 文件查找流程
```
文件: COC/code/bc/.../CustQuery.java
roots: ['core92-atom', 'coc92-core']

尝试 1:
  fullPath = 'core92-atom/COC/code/bc/.../CustQuery.java'
  readFile → 失败 (文件不存在)

尝试 2:
  fullPath = 'coc92-core/COC/code/bc/.../CustQuery.java'
  readFile → 成功 (文件存在)
  返回 content
```

---

## 技术细节

### TypeEnv 工作原理
TypeEnv 在 Worker 解析阶段提取变量类型：

```javascript
// parsing-processor.ts → Worker
const typeEnv = buildTypeEnv(tree, 'java');

// Java field_declaration 节点
private CustQuery custQuery;
         ^^^^^^^^^ ^^^^^^^^^^^
         type      name

// TypeEnv 提取结果
typeEnv.env.get('') = Map {
  'custQuery' => 'CustQuery'
}
```

### ImportMap 构建
ImportMap 在 import-processor 阶段构建：

```typescript
// import-processor.ts
const importMap = new Map<string, Set<string>>();

// 解析 import 语句
import com.ztesoft.zsmart.bss.profile.cust.bs.CustQuery;
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

// 转换为文件路径
'COC/code/bc/bc-nocomponent/profile/src/com/ztesoft/zsmart/bss/profile/cust/bs/CustQuery.java'

// 存储到 ImportMap
importMap.set('CustQueryService.java', Set {
  'COC/code/.../CustQuery.java'
});
```

### 分辨率优先级
```
1. Same-file lookup (confidence: 1.0)
2. Import-scoped lookup (confidence: 0.9)
   ↓ Java resolver 在此处使用 importMap 消歧
3. Global lookup (confidence: 0.5)
```

---

## 影响范围

### 修改文件清单
1. **src/core/lbug/csv-generator.ts** (content 修复)
   - `FileContentCache` 类构造函数
   - `get` 方法循环逻辑
   - `streamAllCSVsToDisk` 函数签名

2. **src/core/lbug/lbug-adapter.ts** (content 修复)
   - `loadGraphToLbug` 函数签名

3. **src/cli/analyze.ts** (content 修复)
   - `loadGraphToLbug` 调用传参

4. **src/core/ingestion/java-call-resolver.ts** (same-file 修复)
   - `findClassByTypeName` 函数签名 + 消歧逻辑
   - `resolveMethodInstanceByType` 函数签名
   - `resolveMethodInstance` 函数签名
   - `resolveClassInstance` 函数签名
   - `resolveSuperCall` 函数签名
   - `resolveJavaCallTarget` 中的 5 处调用更新

### 向后兼容性
✅ **完全向后兼容**

1. **单目录索引**：`repoPath: string` → 自动转为 `[repoPath]`
2. **importMap 可选**：`importMap?: ImportMap` → 不传则使用原有逻辑
3. **Fallback 保留**：找不到 import 时仍返回第一个匹配

### 性能影响
- **FileContentCache**: 多次 `readFile` 尝试，但有 LRU 缓存，影响可忽略
- **findClassByTypeName**: 增加 `importMap.get()` + `Set.has()` 查询，O(1) 操作，影响可忽略

---

## 测试验证

### 验证步骤
1. 编译项目：`npm run build`
2. 重新索引（使用修复后代码）
3. 运行诊断脚本验证修复效果

### 预期结果
**修复前**:
```
same-file Method→Method 边: 1,447
  其中跨文件错误边: 632+
methodInstance 边: 135,818
```

**修复后**:
```
same-file Method→Method 边: ~815 (仅真正的同文件递归调用)
  其中跨文件错误边: 0
methodInstance 边: 136,450+ (增加 632+)
```

### 诊断命令
```bash
# 检查 same-file 边
node gitnexus/diagnose-same-file.js

# 检查 Java 解析分布
node gitnexus/diagnose-java-resolution.js

# 检查 content 属性
node gitnexus/test-content-fix.js
```

---

## 遗留问题

### 已知限制
1. **Qualified Name Import 未处理**
   ```java
   // 当前未支持的场景
   import com.example.*;  // wildcard import
   CustQuery query = ...;  // 无法确定具体类
   ```
   **影响**：极少数使用 wildcard import 的场景可能仍有歧义
   **缓解**：大多数企业代码使用显式 import

2. **动态类型语言无 import**
   - Python, JavaScript, Ruby 等语言的 import 语义不同
   - 当前修复仅针对 Java/Kotlin 等强类型语言

3. **性能优化空间**
   - `findClassByTypeName` 可以缓存 import 查找结果
   - 当前每次调用都查询 importMap

### 后续优化方向
1. 支持 Java wildcard import 解析
2. 使用 fully qualified name 匹配（如 `com.example.CustQuery`）
3. 添加缓存层减少 importMap 查询次数
4. 扩展到其他强类型语言（Kotlin, C#, C++）

---

## 参考资料

### 相关代码文件
- `src/core/ingestion/type-env.ts` - TypeEnv 构建逻辑
- `src/core/ingestion/import-processor.ts` - ImportMap 构建逻辑
- `src/core/ingestion/symbol-table.ts` - SymbolTable 查找逻辑
- `src/core/ingestion/resolution-context.ts` - 三层解析逻辑
- `src/core/ingestion/call-processor.ts` - 调用解析入口

### 相关 Git Commit
- `e862bee` - TFM 开发历史文档
- `f1b13f6` - TFM 功能文档更新
- `c42544e` - TFM 服务索引完成
- `755d50d` - TFM XML 递归扫描修复

### 测试数据位置
- 测试文件: `E:\workspace-iwc\9E-COC\coc92-core\COC\code\bc\bc-nocomponent\profile\src\com\ztesoft\zsmart\bss\profile\cust\services\CustQueryService.java`
- 目标文件: `E:\workspace-iwc\9E-COC\coc92-core\COC\code\bc\bc-nocomponent\profile\src\com\ztesoft\zsmart\bss\profile\cust\bs\CustQuery.java`
