/* 可选开发测试。打开网页不需要 Node.js；本文件供维护与核验使用。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyze, lex } = require('../js/analyzer.js');
const examples = require('../js/examples.js');
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function run(source) { return analyze(source + '\n*'); }
function good(source) { const r = run(source); assert.equal(r.summary.success, true, JSON.stringify(r.diagnostics)); return r; }
function bad(source, fragment) {
  const r = run(source); assert.equal(r.summary.success, false);
  if (fragment) assert.ok(r.diagnostics.some(d => d.message.includes(fragment)), JSON.stringify(r.diagnostics));
  return r;
}

test('综合示例：4 常量 / 5 变量 / 21 字节 / 无错误', () => {
  const r = analyze(examples.complete.source); assert.equal(r.summary.success, true);
  assert.equal(r.constants.length, 4); assert.equal(r.variables.length, 5); assert.equal(r.summary.bytes, 21);
  assert.deepEqual(r.variables.map(s => s.address), [0, 4, 12, 16, 17]);
});
test('常量示例：四类值及转义，无变量空间', () => {
  const r = analyze(examples.constants.source); assert.equal(r.summary.success, true);
  assert.deepEqual(r.constants.map(s => s.value), [-128, 3.14159, '\n', true]); assert.equal(r.summary.bytes, 0);
});
test('变量示例：连续地址且不对齐', () => {
  const r = analyze(examples.variables.source); assert.equal(r.summary.success, true);
  assert.deepEqual(r.variables.map(s => s.address), [0, 4, 12, 16]); assert.equal(r.summary.bytes, 17);
});
test('重定义示例：3 成功 / 2 错误 / 8 字节', () => {
  const r = analyze(examples.duplicate.source); assert.equal(r.symbols.length, 3); assert.equal(r.diagnostics.length, 2);
  assert.equal(r.summary.bytes, 8); assert.equal(r.variables[1].address, 4);
});
test('类型示例：4 语义错误，后续声明成功', () => {
  const r = analyze(examples.types.source); assert.equal(r.diagnostics.length, 4);
  assert.ok(r.diagnostics.every(d => d.stage === '语义')); assert.equal(r.variables[0].name, 'valid'); assert.equal(r.summary.bytes, 8);
});
test('错误恢复示例：3 错误 / 3 变量 / 9 字节', () => {
  const r = analyze(examples.recovery.source); assert.equal(r.diagnostics.length, 3);
  assert.deepEqual(r.variables.map(s => s.name), ['afterMissing', 'good', 'last']); assert.equal(r.summary.bytes, 9);
});
test('单独结束标记允许空程序', () => { const r = analyze('*'); assert.equal(r.summary.success, true); assert.equal(r.symbols.length, 0); });
test('空输入需要结束标记', () => { assert.ok(analyze('').diagnostics.some(d => d.message.includes('缺少'))); });
test('缺结束标记时保留有效声明但判定失败', () => { const r = analyze('int a;'); assert.equal(r.symbols.length, 1); assert.equal(r.summary.success, false); assert.equal(r.summary.ended, false); });
test('结束标记必须单独占一行', () => { assert.equal(analyze('int a; *').summary.success, false); });
test('结束标记后不能有声明', () => { const r = analyze('*\nint a;'); assert.equal(r.symbols.length, 0); assert.ok(r.diagnostics.some(d => d.message.includes('结束标记后'))); });
test('结束标记后允许合法注释', () => { assert.equal(analyze('*\n// end\n/* done */').summary.success, true); });
test('重复结束标记被拒绝', () => { assert.equal(analyze('*\n*').summary.success, false); });
test('十进制含前导零仍按十进制', () => { assert.equal(good('const int A = 010;').constants[0].value, 10); });
test('十六进制及负号', () => { assert.equal(good('int a = -0X2A;').variables[0].value, -42); });
test('int 上下界可表示', () => { good('int a = -2147483648; int b = 2147483647;'); });
test('int 正向越界拒绝', () => { assert.equal(bad('int a = 2147483648;', '范围').summary.bytes, 0); });
test('int 负向越界拒绝', () => { bad('int a = -2147483649;', '范围'); });
test('real 支持小数点后无数字', () => { assert.equal(good('real x = 12.;').variables[0].value, 12); });
test('real 支持科学计数', () => { assert.equal(good('real x = -1.2E-2;').variables[0].value, -0.012); });
test('real 接收整数', () => { assert.equal(good('real x = +12;').variables[0].value, 12); });
test('real 无穷大拒绝', () => { bad('real x = 1.0e+999;', '有限'); });
test('实数字面量必须带小数点', () => { bad('real x = 12e+2;', '数值格式'); });
test('非法十六进制整体作为错误单词', () => { const r = bad('int x = 0xGG;', '数值格式'); assert.ok(r.tokens.some(t => t.kind === 'ERROR' && t.raw === '0xGG')); });
test('数字连接字母不能拆开蒙混通过', () => { bad('int x = 12abc;', '数值格式'); });
test('不允许小数赋给 int', () => { bad('int a = 1.5;', '不匹配'); });
test('bool 不接受数字', () => { bad('bool b = 1;', '不匹配'); });
test('bool 正确接收 true/false', () => { const r = good('bool a = true; bool b = false;'); assert.deepEqual(r.variables.map(s => s.value), [true, false]); });
test('字符支持中文单码点，分配4字节', () => { const r = good("char a = '优';"); assert.equal(r.variables[0].value, '优'); assert.equal(r.summary.bytes, 4); });
test('字符支持非BMP单码点', () => { assert.equal(good("char a = '😀';").variables[0].value, '😀'); });
test('字符中的星号不是结束标记', () => { assert.equal(good("char star = '*';").variables[0].value, '*'); });
test('单引号和反斜线转义', () => { const r = good("char a = '\\''; char b = '\\\\';"); assert.deepEqual(r.variables.map(s => s.value), ["'", '\\']); });
test('空字符和多字符拒绝', () => { bad("char a = '';", '一个 Unicode'); bad("char a = 'AB';", '一个 Unicode'); });
test('未知转义拒绝', () => { bad("char a = '\\q';", '转义'); });
test('字符引号未闭合时在下一行恢复', () => { const r = bad("char a = 'x\nint b = 2;", '单引号'); assert.equal(r.variables[0].name, 'b'); });
test('关键字不能作为名字', () => { bad('int bool;', '标识符'); });
test('允许下划线开头的名字，大小写敏感', () => { const r = good('int _a1; int A; int a;'); assert.equal(r.variables.length, 3); });
test('常量必须有初值', () => { bad('const int A;', '必须'); });
test('未初始化变量保留空值而非设零', () => { const s = good('int a;').variables[0]; assert.equal(s.initialized, false); assert.equal(s.value, null); });
test('常量和变量共用名字空间', () => { const r = bad('const int A = 1; int A;', '重定义'); assert.equal(r.symbols.length, 1); assert.equal(r.summary.bytes, 0); });
test('同一行多个独立声明可以分析', () => { assert.equal(good('int a; bool b;').variables.length, 2); });
test('不支持逗号多变量声明', () => { assert.equal(bad('int a, b;').symbols.length, 0); });
test('不支持算术表达式', () => { assert.equal(bad('int a = 1 + 2;').symbols.length, 0); });
test('不支持常量名字作为初值', () => { const r = bad('const int A = 1; int b = A;', '字面量'); assert.equal(r.variables.length, 0); });
test('分号缺失不吞掉下一行声明', () => { const r = bad('int a = 1\nbool b = false;', '分号'); assert.equal(r.variables[0].name, 'b'); assert.equal(r.variables[0].address, 0); });
test('失败声明不占名字，后续可以同名成功声明', () => { const r = bad('int a = true; int a = 2;'); assert.equal(r.variables.length, 1); assert.equal(r.variables[0].value, 2); });
test('类型错误不改变后续变量地址', () => { const r = bad('bool a; real wrong = true; int b;'); assert.deepEqual(r.variables.map(s => s.address), [0, 1]); assert.equal(r.summary.bytes, 5); });
test('正负号不能用于布尔值', () => { bad('bool a = -true;', '正负号'); });
test('双重符号被拒绝', () => { bad('int a = --1;'); });
test('单行与多行注释跳过，行号正确', () => { const r = good('// hi\n/* one\n two */\nint a;'); assert.equal(r.variables[0].line, 4); assert.equal(r.tokens[0].line, 4); });
test('未闭合注释报告词法错误', () => { const r = analyze('/* open'); assert.ok(r.diagnostics.some(d => d.stage === '词法' && d.message.includes('*/'))); });
test('Windows 换行正常解析并定位', () => { const r = analyze('int a;\r\nbool b;\r\n*'); assert.equal(r.summary.success, true); assert.equal(r.variables[1].line, 2); });
test('Token 带种别码、原文和值', () => { const t = lex('int a = 0x2A;').tokens.find(t => t.kind === 'INT'); assert.equal(t.code, 20); assert.equal(t.raw, '0x2A'); assert.equal(t.value, 42); });
test('反复分析相互隔离，无全局符号残留', () => { good('int a;'); const r = good('int a;'); assert.equal(r.variables[0].address, 0); });
test('标识符 __proto__ 和 constructor 不污染内建对象', () => { const r = good('int __proto__; int constructor;'); assert.equal(r.variables.length, 2); });
test('恶意HTML字符仅作为输入错误，不被执行', () => { const r = run('<img src=x onerror=alert(1)>'); assert.equal(r.summary.success, false); assert.equal(r.symbols.length, 0); });
test('较大输入：1000条声明地址一致', () => { const r = good(Array.from({ length: 1000 }, (_, i) => `int v${i};`).join('\n')); assert.equal(r.variables.length, 1000); assert.equal(r.summary.bytes, 4000); });

let failures = 0;
const report = [];
for (const item of tests) {
  try { item.fn(); console.log(`PASS ${item.name}`); report.push(`| ${item.name} | 通过 |`); }
  catch (error) { failures++; console.error(`FAIL ${item.name}\n${error.stack}`); report.push(`| ${item.name} | 失败 |`); }
}
console.log(`\n${tests.length - failures}/${tests.length} tests passed.`);
if (process.argv.includes('--report')) {
  const text = `# 核心算法自动化测试记录\n\n测试入口：tests/analyzer.test.js。以下为实际执行结果。\n\n结果：${tests.length - failures}/${tests.length} 通过。\n\n范围：词法、声明语法、类型检查、符号表、地址分配、错误恢复与内置示例。此记录不代替浏览器界面操作验证。\n\n| 测试项目 | 结果 |\n| --- | --- |\n${report.join('\n')}\n`;
  fs.writeFileSync(path.join(__dirname, '../docs/TEST_RESULTS.md'), text, 'utf8');
}
process.exitCode = failures ? 1 : 0;
