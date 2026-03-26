# 变更清单

## 修改文件

### 1. src/core/lbug/csv-generator.ts
**变更类型**: 功能增强 + Bug 修复

**变更内容**:
- **FileContentCache 类** (行 64-111)
  - 修改 `repoPath: string` → `roots: string[]`
  - 构造函数支持 `string | string[]` 参数
  - `get()` 方法改为循环尝试所有 root 路径
  - 找到文件后立即返回，失败则继续下一个 root

- **streamAllCSVsToDisk 函数** (行 212)
  - 修改参数 `repoPath: string` → `repoPath: string | string[]`
  - 文档注释更新，说明多 root 支持

**修改前**:
```typescript
class FileContentCache {
  private repoPath: string;

  constructor(repoPath: string, maxSize: number = 3000) {
    this.repoPath = repoPath;
    this.maxSize = maxSize;
  }

  async get(relativePath: string): Promise<string> {
    try {
      const fullPath = path.join(this.repoPath, relativePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      this.set(relativePath, content);
      return content;
    } catch {
      this.set(relativePath, '');
      return '';
    }
  }
}
```

**修改后**:
```typescript
class FileContentCache {
  private roots: string[];

  constructor(repoPath: string | string[], maxSize: number = 3000) {
    this.roots = Array.isArray(repoPath) ? repoPath : [repoPath];
    this.maxSize = maxSize;
  }

  async get(relativePath: string): Promise<string> {
    // 检查缓存逻辑不变...

    // 循环尝试所有 root
    for (const root of this.roots) {
      try {
        const fullPath = path.join(root, relativePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        this.set(relativePath, content);
        return content;
      } catch {
        continue;  // 尝试下一个 root
      }
    }

    // 所有 root 都失败
    this.set(relativePath, '');
    return '';
  }
}
```

**影响范围**:
- 多目录索引时能正确读取所有目录的文件内容
- 单目录索引向后兼容（自动转为单元素数组）

---

### 2. src/core/lbug/lbug-adapter.ts
**变更类型**: 接口变更

**变更内容**:
- **loadGraphToLbug 函数** (行 177-182)
  - 修改参数 `repoPath: string` → `repoPath: string | string[]`
  - 直接传递给 `streamAllCSVsToDisk`，无需其他逻辑修改

**修改前**:
```typescript
export const loadGraphToLbug = async (
  graph: KnowledgeGraph,
  repoPath: string,
  storagePath: string,
  onProgress?: LbugProgressCallback
) => {
  // ...
  const csvResult = await streamAllCSVsToDisk(graph, repoPath, csvDir);
```

**修改后**:
```typescript
export const loadGraphToLbug = async (
  graph: KnowledgeGraph,
  repoPath: string | string[],  // ← 支持数组
  storagePath: string,
  onProgress?: LbugProgressCallback
) => {
  // ...
  const csvResult = await streamAllCSVsToDisk(graph, repoPath, csvDir);
```

**影响范围**:
- API 签名变更，但向后兼容（单字符串仍可用）

---

### 3. src/cli/analyze.ts
**变更类型**: Bug 修复

**变更内容**:
- **loadGraphToLbug 调用** (行 299-306)
  - 修改传入参数：`pipelineResult.repoPath` → `roots.length > 1 ? roots : repoPath`
  - 多目录时传入完整 roots 数组
  - 单目录时保持原有 repoPath

**修改前**:
```typescript
const lbugResult = await loadGraphToLbug(
  pipelineResult.graph,
  pipelineResult.repoPath,  // 只传第一个 root
  storagePath,
  (msg) => { ... }
);
```

**修改后**:
```typescript
const lbugResult = await loadGraphToLbug(
  pipelineResult.graph,
  roots.length > 1 ? roots : repoPath,  // 传入完整 roots
  storagePath,
  (msg) => { ... }
);
```

**影响范围**:
- 多目录索引时正确传递所有 root 路径
- 单目录索引不受影响

---

### 4. src/core/ingestion/java-call-resolver.ts
**变更类型**: 功能增强 + Bug 修复

**变更内容**:

#### A. findClassByTypeName 函数 (行 725-759)
**添加 importMap 参数，实现同名类消歧**

**修改前**:
```typescript
const findClassByTypeName = (
  typeName: string,
  currentFile: string,
  symbolTable: SymbolTable,
): SymbolDefinition | null => {
  // 1. Same-file lookup
  const localDef = symbolTable.lookupExactFull(currentFile, typeName);
  if (localDef && ...) return localDef;

  // 2. Fuzzy lookup
  const allDefs = symbolTable.lookupFuzzy(typeName);
  const classDefs = allDefs.filter(def => def.type === 'Class' || ...);

  // 3. Return first match (没有消歧！)
  return classDefs.length > 0 ? classDefs[0] : null;
};
```

**修改后**:
```typescript
const findClassByTypeName = (
  typeName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap?: ImportMap,  // ← 新增参数
): SymbolDefinition | null => {
  // 1. Same-file lookup (不变)
  const localDef = symbolTable.lookupExactFull(currentFile, typeName);
  if (localDef && ...) return localDef;

  // 2. Fuzzy lookup (不变)
  const allDefs = symbolTable.lookupFuzzy(typeName);
  const classDefs = allDefs.filter(def => def.type === 'Class' || ...);

  if (classDefs.length === 0) return null;
  if (classDefs.length === 1) return classDefs[0];

  // 3. 多个同名类 - 使用 import 消歧 (新增)
  if (importMap) {
    const importedFiles = importMap.get(currentFile);
    if (importedFiles) {
      const importedDef = classDefs.find(def =>
        importedFiles.has(def.filePath)
      );
      if (importedDef) return importedDef;  // ← 优先返回 import 的类
    }
  }

  // 4. Fallback: 返回第一个 (向后兼容)
  return classDefs[0];
};
```

#### B. resolveMethodInstanceByType 函数 (行 436-477)
**添加 importMap 参数并传递**

**修改**:
```typescript
// 函数签名
const resolveMethodInstanceByType = (
  calledName: string,
  typeName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap: ImportMap,  // ← 新增
): JavaResolveResult | null => {

  // 调用 findClassByTypeName 时传入 importMap
  const classDef = trackTime('findClassByTypeName', () =>
    findClassByTypeName(typeName, currentFile, symbolTable, importMap)
  );

  // ... 其余逻辑不变
};
```

#### C. resolveMethodInstance 函数 (行 490-563)
**添加 importMap 参数并传递**

**修改**:
```typescript
const resolveMethodInstance = (
  calledName: string,
  objectName: string,
  currentFile: string,
  enclosingFunctionId: string | null,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
  importMap: ImportMap,  // ← 新增（位置在 astCache 前）
  astCache: ASTCache,
): JavaResolveResult | null => {

  // ... 前面逻辑不变

  const classDef = trackTime('findClassByTypeName', () =>
    findClassByTypeName(variable.typeName, currentFile, symbolTable, importMap)
  );

  // ... 后续逻辑不变
};
```

#### D. resolveClassInstance 函数 (行 773-852)
**添加 importMap 参数并传递**

**修改**:
```typescript
const resolveClassInstance = (
  calledName: string,
  objectName: string,
  currentFile: string,
  enclosingFunctionId: string | null,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
  importMap: ImportMap,  // ← 新增
): JavaResolveResult | null => {

  // ... 前面逻辑不变

  const classDef = trackTime('findClassByTypeName', () =>
    findClassByTypeName(typeName, currentFile, symbolTable, importMap)
  );

  // ... 后续逻辑不变
};
```

#### E. resolveSuperCall 函数 (行 1083-1175)
**添加 importMap 参数并传递**

**修改**:
```typescript
const resolveSuperCall = (
  calledName: string,
  currentFile: string,
  enclosingFunctionId: string | null,
  graph: KnowledgeGraph,
  symbolTable: SymbolTable,
  importMap: ImportMap,  // ← 新增
): JavaResolveResult | null => {

  // ... 前面逻辑不变

  // 在 fallback 逻辑中传入 importMap
  const parentClass = findClassByTypeName(
    parentClassName,
    currentFile,
    symbolTable,
    importMap
  );

  // ... 后续逻辑不变
};
```

#### F. resolveJavaCallTarget 函数调用更新 (行 285, 307, 328, 375)
**所有 resolve* 函数调用添加 importMap 参数**

**修改位置**:
1. 行 285: `resolveMethodInstanceByType(..., importMap)`
2. 行 307: `resolveClassInstance(..., importMap)`
3. 行 328: `resolveMethodInstance(..., importMap, astCache)`
4. 行 375: `resolveSuperCall(..., importMap)`

**示例 (行 285)**:
```typescript
// 修改前
const result = resolveMethodInstanceByType(
  calledName, objectTypeName, currentFile, symbolTable
);

// 修改后
const result = resolveMethodInstanceByType(
  calledName, objectTypeName, currentFile, symbolTable, importMap
);
```

**影响范围**:
- Java 调用解析准确率提升：同名类能正确消歧
- 跨文件 same-file 边大幅减少（预计从 632+ 降到 0）
- methodInstance 边增加 632+

---

## 统计信息

### 代码行数变更
| 文件 | 新增行 | 删除行 | 净增加 |
|------|--------|--------|--------|
| csv-generator.ts | 18 | 11 | +7 |
| lbug-adapter.ts | 1 | 1 | 0 |
| analyze.ts | 1 | 1 | 0 |
| java-call-resolver.ts | 45 | 15 | +30 |
| **合计** | **65** | **28** | **+37** |

### 函数签名变更
| 函数 | 参数变更 | 兼容性 |
|------|----------|--------|
| FileContentCache.constructor | `string` → `string \| string[]` | ✅ 向后兼容 |
| streamAllCSVsToDisk | `repoPath: string` → `string \| string[]` | ✅ 向后兼容 |
| loadGraphToLbug | `repoPath: string` → `string \| string[]` | ✅ 向后兼容 |
| findClassByTypeName | 添加 `importMap?: ImportMap` | ✅ 可选参数 |
| resolveMethodInstanceByType | 添加 `importMap: ImportMap` | ⚠️ 内部函数 |
| resolveMethodInstance | 添加 `importMap: ImportMap` | ⚠️ 内部函数 |
| resolveClassInstance | 添加 `importMap: ImportMap` | ⚠️ 内部函数 |
| resolveSuperCall | 添加 `importMap: ImportMap` | ⚠️ 内部函数 |

---

## 测试验证

### 编译测试
```bash
npm run build
# 结果: ✅ 编译成功，无类型错误
```

### 功能测试
**测试脚本**:
- `gitnexus/diagnose-same-file.js` - 诊断 same-file 边
- `gitnexus/diagnose-java-resolution.js` - 诊断 Java 解析分布
- `gitnexus/test-content-fix.js` - 验证 content 属性

**测试步骤**:
1. 重新索引：`npx gitnexus analyze --customization ... --common ... --force`
2. 运行诊断脚本验证修复效果

**预期结果**:
- ✅ 跨文件 same-file 边从 632+ 降到 0
- ✅ methodInstance 边增加 632+
- ✅ common 目录 Method 节点有 content

---

## 回滚方案

### Git 回滚
```bash
# 查看当前分支
git log --oneline -5

# 回滚到修复前
git revert <commit-hash>

# 或者直接重置
git reset --hard <commit-hash>
```

### 手动回滚
如果需要手动恢复，按以下步骤：

1. **恢复 csv-generator.ts**
```typescript
// FileContentCache 改回单个 repoPath
private repoPath: string;
constructor(repoPath: string, maxSize: number = 3000) {
  this.repoPath = repoPath;
}

async get(relativePath: string): Promise<string> {
  try {
    const fullPath = path.join(this.repoPath, relativePath);
    // ... 原有逻辑
  } catch { ... }
}
```

2. **恢复 lbug-adapter.ts**
```typescript
export const loadGraphToLbug = async (
  graph: KnowledgeGraph,
  repoPath: string,  // 改回 string
  // ...
```

3. **恢复 analyze.ts**
```typescript
const lbugResult = await loadGraphToLbug(
  pipelineResult.graph,
  pipelineResult.repoPath,  // 改回使用 pipelineResult.repoPath
  // ...
```

4. **恢复 java-call-resolver.ts**
```typescript
// 删除所有 importMap 参数
// findClassByTypeName 逻辑改回：
const classDefs = allDefs.filter(def => def.type === 'Class' || ...);
return classDefs.length > 0 ? classDefs[0] : null;
```

---

## 部署注意事项

### 重新索引需求
**必须重新索引**：本次修复只改变索引逻辑，不影响已有索引数据

**索引命令**:
```bash
npx gitnexus analyze --force
# 或多目录
npx gitnexus analyze --customization ... --common ... --force
```

### 性能影响
- **索引阶段**：无明显性能影响（importMap 查询为 O(1)）
- **查询阶段**：无影响（修改仅在索引时生效）
- **磁盘占用**：无变化（边数量增加但总量不变）

### 兼容性检查
- ✅ Node.js 版本：无变更要求
- ✅ 依赖库：无新增依赖
- ✅ 数据库 Schema：无变更
- ✅ MCP 协议：无影响
- ✅ API 接口：向后兼容

---

## 变更审批

| 项目 | 状态 |
|------|------|
| 代码审查 | ⏳ 待审批 |
| 测试验证 | ⏳ 待测试 |
| 文档更新 | ✅ 已完成 |
| 发布审批 | ⏳ 待审批 |

---

## 相关文档

- [技术方案](./fix-java-call-resolution-same-file-solution.md)
- [用户手册](./fix-java-call-resolution-same-file-userguide.md)
- [测试用例](./fix-java-call-resolution-same-file-testcase.md)
- [需求说明](./README.md)
