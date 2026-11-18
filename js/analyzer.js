/*
 * 声明分析核心。与页面无关，可在浏览器中运行，也可由 Node.js 执行测试。
 * 流程：字符流 -> Token -> 递归下降分析 -> 类型检查 -> 符号表/模拟地址。
 * 失败的声明不会进入符号表，也不会占用存储空间。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DeclarationAnalyzer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TYPES = Object.freeze({ int: 4, real: 8, char: 4, bool: 1 });
  const KEYWORDS = new Set(['const', ...Object.keys(TYPES), 'true', 'false']);
  const TOKEN_NAMES = {
    CONST: '常量关键字', TYPE: '类型关键字', ID: '标识符', INT: '整数',
    REAL: '实数', CHAR: '字符', BOOL: '布尔值', EQUAL: '赋值符',
    SEMI: '分号', SIGN: '数值符号', END: '结束标记', ERROR: '错误单词', EOF: '输入结束'
  };
  const SYN = { CONST: 1, TYPE: 2, ID: 10, INT: 20, REAL: 21, CHAR: 22,
    BOOL: 23, EQUAL: 30, SEMI: 31, SIGN: 32, END: 40, ERROR: -1, EOF: 0 };

  function lex(input) {
    const source = String(input).replace(/\r\n?/g, '\n');
    const tokens = [], diagnostics = [];
    let index = 0, line = 1, column = 1;
    const peek = (n = 0) => source[index + n] || '';
    function advance() {
      const char = source[index++];
      if (char === '\n') { line++; column = 1; } else column++;
      return char;
    }
    function emit(kind, raw, value, startLine, startColumn) {
      tokens.push({ kind, code: SYN[kind], label: TOKEN_NAMES[kind], raw, value,
        line: startLine, column: startColumn });
    }
    function fail(raw, message, startLine, startColumn) {
      emit('ERROR', raw, null, startLine, startColumn);
      diagnostics.push({ stage: '词法', line: startLine, column: startColumn, message });
    }
    while (index < source.length) {
      if (/\s/.test(peek())) { advance(); continue; }
      const begin = index, startLine = line, startColumn = column;
      if (peek() === '/' && peek(1) === '/') {
        while (index < source.length && peek() !== '\n') advance();
        continue;
      }
      if (peek() === '/' && peek(1) === '*') {
        advance(); advance();
        while (index < source.length && !(peek() === '*' && peek(1) === '/')) advance();
        if (index === source.length) fail(source.slice(begin, index), '多行注释缺少结束符 */。', startLine, startColumn);
        else { advance(); advance(); }
        continue;
      }
      if (/[A-Za-z_]/.test(peek())) {
        while (peek() && /[A-Za-z0-9_]/.test(peek())) advance();
        const raw = source.slice(begin, index);
        const kind = raw === 'const' ? 'CONST' : Object.hasOwn(TYPES, raw) ? 'TYPE'
          : raw === 'true' || raw === 'false' ? 'BOOL' : 'ID';
        emit(kind, raw, kind === 'BOOL' ? raw === 'true' : raw, startLine, startColumn);
        continue;
      }
      if (/[0-9]/.test(peek())) {
        // 完整收集数值候选，避免将 12abc、0xG 等错误片段拆成合法单词。
        while (peek() && /[A-Za-z0-9_.]/.test(peek())) {
          advance();
          if (/[eE]/.test(source[index - 1]) && /[+-]/.test(peek())) advance();
        }
        const raw = source.slice(begin, index);
        if (/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(raw)) {
          emit('INT', raw, Number(raw), startLine, startColumn);
        } else if (/^[0-9]+\.[0-9]*(?:[eE][+-]?[0-9]+)?$/.test(raw)) {
          emit('REAL', raw, Number(raw), startLine, startColumn);
        } else fail(raw, '数值格式错误；支持十进制/十六进制整数和带小数点的实数，如 12、0x2A、12.5、1.2e+3。', startLine, startColumn);
        continue;
      }
      if (peek() === "'") {
        advance();
        let value = '', closed = false, badEscape = false;
        const escapes = { n: '\n', r: '\r', t: '\t', '0': '\0', "'": "'", '"': '"', '\\': '\\' };
        while (index < source.length && peek() !== '\n') {
          const char = advance();
          if (char === "'") { closed = true; break; }
          if (char === '\\') {
            if (!peek() || peek() === '\n') break;
            const escaped = advance();
            if (Object.hasOwn(escapes, escaped)) value += escapes[escaped];
            else badEscape = true;
          } else value += char;
        }
        const raw = source.slice(begin, index);
        if (!closed) fail(raw, '字符常量缺少结束单引号，且不能跨行。', startLine, startColumn);
        else if (badEscape) fail(raw, '不支持该转义写法；支持 \\n、\\r、\\t、\\0、\\\'、\\"、\\\\。', startLine, startColumn);
        else if (Array.from(value).length !== 1) fail(raw, 'char 必须包含一个 Unicode 字符或一个转义字符。', startLine, startColumn);
        else emit('CHAR', raw, value, startLine, startColumn);
        continue;
      }
      const punctuation = { '=': 'EQUAL', ';': 'SEMI', '+': 'SIGN', '-': 'SIGN', '*': 'END' };
      if (Object.hasOwn(punctuation, peek())) {
        const raw = advance();
        emit(punctuation[raw], raw, raw, startLine, startColumn);
      } else {
        const raw = advance();
        fail(raw, `无法识别符号 ${JSON.stringify(raw)}。字符常量请使用英文单引号。`, startLine, startColumn);
      }
    }
    emit('EOF', '', null, line, column);
    return { source, tokens, diagnostics };
  }

  class AnalysisError extends Error {
    constructor(token, message, stage = '语法', reported = false) {
      super(message); this.token = token; this.stage = stage; this.reported = reported;
    }
  }

  function analyze(input) {
    const scanned = lex(input), { source, tokens } = scanned;
    const diagnostics = [...scanned.diagnostics], symbols = [], trace = [];
    const table = new Map(), lines = source.split('\n');
    let cursor = 0, nextAddress = 0, ended = false, attempts = 0;
    const current = () => tokens[cursor];
    function expect(kind, message) {
      const token = current();
      if (token.kind === 'ERROR') throw new AnalysisError(token, '', '词法', true);
      if (token.kind !== kind) throw new AnalysisError(token, message);
      cursor++; return token;
    }
    function diagnostic(token, message, stage = '语法') {
      diagnostics.push({ stage, line: token.line, column: token.column, message });
    }
    function readLiteral() {
      let sign = 1, signToken = null;
      if (current().kind === 'SIGN') { signToken = tokens[cursor++]; sign = signToken.raw === '-' ? -1 : 1; }
      const token = current();
      if (token.kind === 'ERROR') throw new AnalysisError(token, '', '词法', true);
      if (!['INT', 'REAL', 'CHAR', 'BOOL'].includes(token.kind)) {
        throw new AnalysisError(token, '等号后需要一个常量字面量；本系统不支持表达式和名字引用。');
      }
      cursor++;
      if (signToken && !['INT', 'REAL'].includes(token.kind)) throw new AnalysisError(signToken, '正负号只能用于数值。', '语义');
      return { token, kind: token.kind, value: ['INT', 'REAL'].includes(token.kind) ? sign * token.value : token.value };
    }
    function checkValue(type, literal) {
      if (!literal) return null;
      const { kind, token, value } = literal;
      const compatible = { int: ['INT'], real: ['INT', 'REAL'], char: ['CHAR'], bool: ['BOOL'] };
      if (!compatible[type].includes(kind)) throw new AnalysisError(token, `${type} 与初值类型不匹配。real 可接收整数，其余类型不进行隐式转换。`, '语义');
      if (type === 'int' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) {
        throw new AnalysisError(token, 'int 超出 32 位有符号整数范围 [-2147483648, 2147483647]。', '语义');
      }
      if (type === 'real' && !Number.isFinite(value)) throw new AnalysisError(token, 'real 超出可表示的有限数值范围。', '语义');
      return value;
    }
    function declaration() {
      const first = current();
      const isConstant = first.kind === 'CONST';
      if (isConstant) cursor++;
      const typeToken = expect('TYPE', '声明需要类型关键字 int、real、char 或 bool。');
      const id = expect('ID', '类型后需要标识符；名字由英文字母、数字、下划线组成且不能以数字开头，也不能使用关键字。');
      let literal = null;
      if (current().kind === 'EQUAL') { cursor++; literal = readLiteral(); }
      else if (isConstant) throw new AnalysisError(current(), 'const 常量必须使用 = 提供初值。');
      expect('SEMI', '声明末尾缺少分号，或出现多余内容；每条声明只允许一个名字和一个字面量初值。');
      if (table.has(id.raw)) throw new AnalysisError(id, `名字 ${id.raw} 已在第 ${table.get(id.raw).line} 行声明，不能重定义。`, '语义');
      const value = checkValue(typeToken.raw, literal);
      const size = isConstant ? 0 : TYPES[typeToken.raw];
      const record = { name: id.raw, category: isConstant ? '常量' : '变量', type: typeToken.raw,
        value, initialized: literal !== null, address: isConstant ? null : nextAddress,
        size, line: id.line };
      // 在所有检查通过后一次性提交，保证失败声明不会污染符号表。
      symbols.push(record); table.set(record.name, record); nextAddress += size;
      trace.push({ step: trace.length + 1, line: first.line, status: '成功',
        message: isConstant ? `登记常量 ${id.raw}，类型 ${record.type}，不分配变量存储空间。`
          : `登记变量 ${id.raw}，类型 ${record.type}；分配 [${record.address}, ${nextAddress})，共 ${size} 字节。` });
    }
    function recover(startCursor, startLine) {
      // 分号同步；下一行出现声明开头时保留它，以恢复缺分号的情况。
      if (cursor > startCursor && tokens[cursor - 1].kind === 'SEMI') return;
      while (!['EOF', 'END'].includes(current().kind)) {
        if (cursor > startCursor && current().line > startLine && ['CONST', 'TYPE'].includes(current().kind)) return;
        if (tokens[cursor++].kind === 'SEMI') return;
      }
    }
    while (current().kind !== 'EOF') {
      if (current().kind === 'END') {
        const marker = tokens[cursor++];
        if ((lines[marker.line - 1] || '').trim() !== '*') {
          diagnostic(marker, '结束标记 * 必须单独占一行。'); continue;
        }
        ended = true;
        trace.push({ step: trace.length + 1, line: marker.line, status: '结束', message: '读取结束标记，完成分析。' });
        if (current().kind !== 'EOF') diagnostic(current(), '结束标记后不能再有声明或其他内容（空白和合法注释除外）。');
        break;
      }
      const startCursor = cursor, startLine = current().line;
      attempts++;
      try { declaration(); }
      catch (error) {
        if (!(error instanceof AnalysisError)) throw error;
        if (!error.reported) diagnostic(error.token, error.message, error.stage);
        trace.push({ step: trace.length + 1, line: startLine, status: '拒绝', message: error.reported ? '本条声明存在词法错误，跳过且不分配存储空间。' : error.message });
        recover(startCursor, startLine);
      }
      if (cursor === startCursor) cursor++; // 错误输入也必须保证向前推进。
    }
    if (!ended) diagnostic(tokens[tokens.length - 1], '缺少单独一行的结束标记 *。');
    diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
    return { source, tokens: tokens.filter(token => token.kind !== 'EOF'), symbols,
      constants: symbols.filter(symbol => symbol.category === '常量'),
      variables: symbols.filter(symbol => symbol.category === '变量'), diagnostics, trace,
      summary: { success: diagnostics.length === 0, ended, attempts, accepted: symbols.length,
        errors: diagnostics.length, bytes: nextAddress } };
  }
  return { analyze, lex, TYPES, TOKEN_NAMES, KEYWORDS: [...KEYWORDS] };
});
