# TFM 多层索引 - 快速开始

## 🚀 基本使用

### 单层索引（默认）
```bash
cd /path/to/your-project
npx gitnexus analyze
```

### 多层索引 - 新方式（推荐）⭐

#### Windows:
```cmd
# 定制层 + 公共层
cd E:\customization
npx gitnexus analyze --common E:\common

# 定制层 + 公共层 + 产品层
cd E:\customization
npx gitnexus analyze --common E:\common --product E:\product

# 显式指定所有层
npx gitnexus analyze ^
  --customization E:\customization ^
  --common E:\common ^
  --product E:\product
```

#### Unix/Linux:
```bash
# 定制层 + 公共层
cd /customization
npx gitnexus analyze --common /common

# 定制层 + 公共层 + 产品层
cd /customization
npx gitnexus analyze --common /common --product /product

# 显式指定所有层
npx gitnexus analyze \
  --customization /customization \
  --common /common \
  --product /product
```

### 多层索引 - 旧方式（仍支持）

#### Windows:
```cmd
set GITNEXUS_EXTRA_ROOTS=E:\common;E:\product
cd E:\customization
npx gitnexus analyze
```

#### Unix/Linux:
```bash
export GITNEXUS_EXTRA_ROOTS=/common:/product
cd /customization
npx gitnexus analyze
```

## 📊 层级优先级

当多个层都有同名类时，优先级从高到低：

1. **定制层** (Customization) - 最高优先级
2. **公共层** (Common) - 中等优先级
3. **产品层** (Product) - 最低优先级

## 💡 参数说明

| 参数 | 说明 | 是否必需 | 默认值 |
|------|------|----------|--------|
| `--customization` | 定制层目录 | 否 | 当前目录 |
| `--common` | 公共层目录 | 否 | - |
| `--product` | 产品层目录 | 否 | - |

## 📝 输出示例

```
GitNexus Analyzer

Multi-layer indexing:
  Customization: E:\workspace\customization
  Common: E:\workspace\common
  Product: E:\workspace\product

Repository indexed successfully (198.9s)

246,060 nodes | 705,137 edges | 6,895 clusters | 300 flows
```

## 🔍 验证 TFM 关系

### 查询 TFM 调用（带服务名）

```bash
npx gitnexus cypher "
  MATCH (caller)-[r:CodeRelation {
    type: 'CALLS',
    reason: 'tfm-service-resolution'
  }]->(target)
  RETURN
    caller.name AS Caller,
    r.serviceName AS ServiceName,
    target.name AS Target,
    r.confidence AS Confidence
  LIMIT 10
"
```

### 按服务名过滤

```bash
npx gitnexus cypher "
  MATCH (caller)-[r:CodeRelation {
    type: 'CALLS',
    serviceName: 'QryUserInfo'
  }]->(target)
  RETURN caller.name, target.name
"
```

### 统计各服务调用次数

```bash
npx gitnexus cypher "
  MATCH ()-[r:CodeRelation {
    type: 'CALLS',
    reason: 'tfm-service-resolution'
  }]->()
  RETURN
    r.serviceName AS Service,
    count(*) AS CallCount
  ORDER BY CallCount DESC
  LIMIT 20
"
```

## ⚠️ 注意事项

1. **参数优先级**: 命令行参数 > 环境变量
2. **路径去重**: 自动跳过重复路径
3. **当前目录**: 不指定 `--customization` 时，默认使用当前目录
4. **向后兼容**: 原有的 `GITNEXUS_EXTRA_ROOTS` 仍然工作

## 🆚 新旧方式对比

| 特性 | 旧方式 (环境变量) | 新方式 (命令行参数) |
|------|-------------------|---------------------|
| 明确性 | ❌ 依赖 cd 位置 | ✅ 显式指定 |
| 可读性 | ❌ Layer 1/2/3 | ✅ Customization/Common/Product |
| 灵活性 | ⚠️ 需要设置环境 | ✅ 一行命令 |
| 平台差异 | ⚠️ `;` vs `:` | ✅ 统一语法 |
| 向后兼容 | ✅ | ✅ |

## 🎯 推荐用法

**开发环境**（频繁切换）:
```bash
# 使用命令行参数，灵活明确
gitnexus analyze --common ../common --product ../product
```

**CI/CD 环境**（固定配置）:
```bash
# 使用环境变量，统一配置
export GITNEXUS_EXTRA_ROOTS=/ci/common:/ci/product
gitnexus analyze
```

## 📚 更多文档

- 完整实现细节: `tfm-multi-layer-indexing-solution.md`
- 变更记录: `tfm-multi-layer-indexing-changelist.md`
- 用户手册: `tfm-multi-layer-indexing-userguide.md`
- 测试用例: `tfm-multi-layer-indexing-testcase.md`

---

**版本**: GitNexus 1.4.8+
**状态**: ✅ 生产可用
