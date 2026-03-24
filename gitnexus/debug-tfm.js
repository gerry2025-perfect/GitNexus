#!/usr/bin/env node

/**
 * TFM 调试脚本 - 检查 TFM 提取是否正常工作
 */

import fs from 'fs/promises';
import path from 'path';
import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';

const parser = new Parser();
parser.setLanguage(Java);

// 测试文件路径
const testFile = process.argv[2] || 'E:\\workspace-iwc\\9E-COC\\core92-atom\\atom-coc-parent\\atom-adapter-client\\src\\main\\java\\com\\ztesoft\\zsmart\\bss\\coc\\atom\\adapter\\client\\balc\\impl\\UmRechargeServiceImpl.java';

console.log(`🔍 TFM 调试脚本\n`);
console.log(`测试文件: ${testFile}\n`);

try {
  // 读取文件
  const content = await fs.readFile(testFile, 'utf-8');
  console.log(`✓ 文件读取成功 (${content.length} 字符)\n`);

  // 解析 AST
  const tree = parser.parse(content);
  console.log(`✓ AST 解析成功\n`);

  // 查找 ServiceFlow.callService() 调用
  let callServiceCount = 0;
  let setServiceNameCount = 0;
  const tfmCalls = [];

  function walk(node, depth = 0) {
    if (node.type === 'method_invocation') {
      const object = node.childForFieldName('object');
      const name = node.childForFieldName('name');
      const args = node.childForFieldName('arguments');

      // ServiceFlow.callService(param)
      if (object?.text === 'ServiceFlow' && name?.text === 'callService') {
        callServiceCount++;
        const argList = args?.namedChildren || [];
        const paramVarName = argList[0]?.text || 'unknown';

        console.log(`\n🎯 找到 ServiceFlow.callService() #${callServiceCount}:`);
        console.log(`   行号: ${node.startPosition.row + 1}`);
        console.log(`   参数变量: ${paramVarName}`);

        // 查找 setServiceName
        const serviceName = findServiceNameInParent(node.parent, paramVarName);
        if (serviceName) {
          console.log(`   ✓ 服务名: ${serviceName}`);
          tfmCalls.push({ line: node.startPosition.row + 1, param: paramVarName, service: serviceName });
        } else {
          console.log(`   ✗ 未找到 ${paramVarName}.setServiceName()`);
        }
      }

      // param.setServiceName("...")
      if (name?.text === 'setServiceName') {
        setServiceNameCount++;
        const objText = object?.text || 'unknown';
        const argList = args?.namedChildren || [];
        const serviceNameNode = argList[0];
        if (serviceNameNode?.type === 'string_literal') {
          const serviceName = serviceNameNode.text.replace(/^["']|["']$/g, '');
          console.log(`\n📝 找到 setServiceName() #${setServiceNameCount}:`);
          console.log(`   行号: ${serviceNameNode.startPosition.row + 1}`);
          console.log(`   变量: ${objText}`);
          console.log(`   服务名: ${serviceName}`);
        }
      }
    }

    for (const child of node.children || []) {
      walk(child, depth + 1);
    }
  }

  function findServiceNameInParent(node, varName) {
    // 向上找到方法声明
    let current = node;
    while (current && current.type !== 'method_declaration' && current.type !== 'constructor_declaration') {
      current = current.parent;
    }

    if (!current) return null;

    // 在方法内查找 setServiceName
    return findServiceNameInScope(current, varName);
  }

  function findServiceNameInScope(scopeNode, varName) {
    function search(node) {
      if (node.type === 'method_invocation') {
        const object = node.childForFieldName('object');
        const name = node.childForFieldName('name');
        const args = node.childForFieldName('arguments');

        if (object?.text === varName && name?.text === 'setServiceName' && args) {
          const argList = args.namedChildren || [];
          for (const arg of argList) {
            if (arg.type === 'string_literal') {
              return arg.text.replace(/^["']|["']$/g, '');
            }
          }
        }
      }

      for (const child of node.children || []) {
        const result = search(child);
        if (result) return result;
      }

      return null;
    }

    return search(scopeNode);
  }

  walk(tree.rootNode);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 统计结果:`);
  console.log(`   ServiceFlow.callService() 调用: ${callServiceCount}`);
  console.log(`   setServiceName() 调用: ${setServiceNameCount}`);
  console.log(`   成功匹配的 TFM 调用: ${tfmCalls.length}`);

  if (tfmCalls.length > 0) {
    console.log(`\n✅ TFM 提取逻辑正常！`);
    console.log(`\n匹配的调用:`);
    tfmCalls.forEach((call, i) => {
      console.log(`   ${i + 1}. 行${call.line}: ${call.param} → ${call.service}`);
    });
  } else if (callServiceCount > 0) {
    console.log(`\n⚠️ 找到了 callService 调用，但未匹配到 setServiceName`);
    console.log(`   可能原因:`);
    console.log(`   1. setServiceName 在不同作用域`);
    console.log(`   2. 参数变量名不匹配`);
    console.log(`   3. 服务名不是字符串字面量`);
  } else {
    console.log(`\n❌ 文件中没有 ServiceFlow.callService() 调用`);
  }

  console.log(`\n如果提取正常，但索引后没有 TFM 关系，请检查:`);
  console.log(`   1. 是否使用了正确的命令参数`);
  console.log(`   2. 是否存在 tfm_service/*.xml 文件`);
  console.log(`   3. XML 文件名是否与服务名匹配`);

} catch (err) {
  console.error('❌ 错误:', err.message);
  process.exit(1);
}
