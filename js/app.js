/* 页面控制：只负责显示与交互，所有分析规则都在 analyzer.js 中。 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const editor = $('source'), examples = window.DeclarationExamples;
  let result = null, view = 'symbols', dirty = false;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function formatValue(row) {
    if (!row.initialized) return '未初始化';
    if (row.type === 'char') return JSON.stringify(row.value);
    return String(row.value);
  }
  function lineNumbers() {
    const count = editor.value.split('\n').length;
    $('line-numbers').textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
    $('editor-info').textContent = `${count} 行 · UTF-8`;
    $('line-numbers').scrollTop = editor.scrollTop;
  }
  function state(message, className) {
    $('status').textContent = message; $('status').className = `status ${className || ''}`;
  }
  function setExport(enabled) {
    $('export-json').disabled = !enabled; $('export-markdown').disabled = !enabled;
  }
  function empty(title, detail) {
    const block = element('div', undefined, 'empty');
    block.append(element('strong', title), element('span', detail));
    $('result-content').replaceChildren(block);
  }
  function table(headers, rows, wideColumns = [], lexemeColumns = []) {
    const output = element('table'), head = element('thead'), header = element('tr'), body = element('tbody');
    for (const text of headers) { const th = element('th', text); th.scope = 'col'; header.append(th); }
    head.append(header);
    for (const row of rows) {
      const tr = element('tr');
      row.forEach((value, index) => {
        const td = element('td');
        if (value instanceof Node) td.append(value); else td.textContent = String(value ?? '—');
        if (wideColumns.includes(index)) td.classList.add('wide');
        if (lexemeColumns.includes(index)) td.classList.add('lexeme');
        tr.append(td);
      }); body.append(tr);
    }
    output.append(head, body); $('result-content').replaceChildren(output);
  }
  function render() {
    if (!result) { $('result-caption').textContent = '输入声明后点击“开始分析”。'; empty('准备好后，开始分析', '可以从左侧内置示例开始。'); return; }
    if (view === 'diagnostics') {
      $('result-caption').textContent = '词法、语法和语义错误按位置排序；错误声明不登记、不占存储空间。';
      if (!result.diagnostics.length) { empty('没有发现错误', '所有声明均通过检查，结束标记有效。'); return; }
      table(['位置', '阶段', '错误原因'], result.diagnostics.map(d => [`${d.line}:${d.column}`, d.stage, d.message]), [2]);
    } else if (view === 'tokens') {
      $('result-caption').textContent = '注释与空白已跳过。每个 Token 保留种别码、原文、值与行列位置。';
      if (!result.tokens.length) { empty('暂无 Token', '当前输入为空或仅包含注释。'); return; }
      table(['序号', '种别码', '类别', '原文', '值', '位置'], result.tokens.map((t, i) => [i + 1, t.code, t.label, t.raw, t.kind === 'CHAR' ? JSON.stringify(t.value) : t.value, `${t.line}:${t.column}`]), [], [3, 4]);
    } else if (view === 'trace') {
      $('result-caption').textContent = '逐条记录登记、拒绝与地址分配过程；区间 [起点, 终点) 不包含终点。';
      if (!result.trace.length) { empty('暂无处理步骤', '输入声明并重新分析。'); return; }
      table(['步骤', '行号', '状态', '处理说明'], result.trace.map(t => [t.step, t.line, t.status, t.message]), [3]);
    } else {
      const rows = result[view];
      const captions = { symbols: '全局符号表 · 仅登记通过全部检查的声明；常量与变量共用名字空间。', constants: '常量表 · 初值必填，值固定；不分配变量存储空间。', variables: '变量属性表 · 地址为教学模型的模拟偏移量，未初始化值不会自动设为 0。' };
      $('result-caption').textContent = captions[view];
      if (!rows.length) { empty('暂无有效记录', '可查看错误信息，或载入其他示例。'); return; }
      table(['名字', '类别', '类型', '值', '地址', '字节', '行号'], rows.map(s => [s.name, element('span', s.category, `tag ${s.category === '变量' ? 'variable' : ''}`), s.type, formatValue(s), s.address, s.size, s.line]), [], [3]);
    }
  }
  function selectView(next) {
    view = next;
    document.querySelectorAll('.tab').forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $('result-content').setAttribute('aria-labelledby', `tab-${view}`); render();
  }
  function analyze() {
    try {
      result = window.DeclarationAnalyzer.analyze(editor.value); dirty = false;
      $('constant-count').textContent = result.constants.length;
      $('variable-count').textContent = result.variables.length;
      $('byte-count').textContent = result.summary.bytes;
      $('error-count').textContent = result.diagnostics.length;
      $('error-count').parentElement.classList.toggle('error', result.diagnostics.length > 0);
      state(result.summary.success ? '✓ 分析通过' : `发现 ${result.diagnostics.length} 个错误`, result.summary.success ? 'success' : 'error');
      $('result-summary').textContent = `已登记 ${result.symbols.length} 条声明 · ${result.tokens.length} 个 Token`;
      $('notice').textContent = ''; setExport(true); render();
    } catch (error) {
      state('分析未完成', 'error'); setExport(false);
      $('notice').textContent = '运行出现异常，请保留当前输入与错误信息。';
      console.error(error);
    }
  }
  function modified() {
    dirty = true; lineNumbers(); setExport(false);
    state('输入已修改 · 请重新分析');
    $('result-summary').textContent = '以下为上次分析结果，请重新分析以更新';
    $('notice').textContent = '';
  }
  function loadExample() {
    const example = examples[$('example-select').value];
    editor.value = example.source; $('example-description').textContent = example.description;
    editor.scrollTop = 0; lineNumbers(); selectView('symbols'); analyze();
  }
  function download(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    $('notice').textContent = `已请求保存 ${filename}`;
  }
  function markdown() {
    const cell = value => String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const rows = result.symbols.map(s => `| ${[s.name, s.category, s.type, formatValue(s), s.address, s.size, s.line].map(cell).join(' | ')} |`).join('\n');
    const errors = result.diagnostics.map(d => `| ${d.line}:${d.column} | ${d.stage} | ${cell(d.message)} |`).join('\n');
    return `# 声明分析结果\n\n导出时间：${new Date().toLocaleString('zh-CN')}\n\n## 输入\n\n${result.source.split('\n').map(line => '    ' + line).join('\n')}\n\n## 汇总\n\n- 分析结果：${result.summary.success ? '通过' : '存在错误'}\n- 常量：${result.constants.length}\n- 变量：${result.variables.length}\n- 模拟存储：${result.summary.bytes} 字节\n- 错误：${result.diagnostics.length}\n\n## 符号表\n\n| 名字 | 类别 | 类型 | 值 | 地址 | 字节 | 行号 |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows || '| 无记录 | | | | | | |'}\n\n## 错误信息\n\n| 位置 | 阶段 | 原因 |\n| --- | --- | --- |\n${errors || '| 无错误 | | |'}\n\n## 存储规则\n\nint 4B，real 8B，char 4B，bool 1B。从 0 连续分配，不对齐。常量不占变量空间。该文件是当前输入的实际分析结果，不是完整实验报告。\n`;
  }
  for (const [key, example] of Object.entries(examples)) {
    const option = element('option', example.title); option.value = key; $('example-select').append(option);
  }
  $('analyze').addEventListener('click', analyze);
  $('load-example').addEventListener('click', loadExample);
  $('example-select').addEventListener('change', () => { $('example-description').textContent = examples[$('example-select').value].description + ' 点击“载入”替换输入。'; });
  editor.addEventListener('input', modified);
  editor.addEventListener('scroll', () => { $('line-numbers').scrollTop = editor.scrollTop; });
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); analyze(); }
  });
  document.querySelectorAll('.tab').forEach(button => {
    button.addEventListener('click', () => selectView(button.dataset.view));
    button.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const tabs = [...document.querySelectorAll('.tab')];
      let index = tabs.indexOf(button);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectView(tabs[index].dataset.view); tabs[index].focus();
    });
  });
  $('clear').addEventListener('click', () => {
    editor.value = ''; result = null; dirty = false; lineNumbers();
    for (const id of ['constant-count', 'variable-count', 'byte-count', 'error-count']) $(id).textContent = '—';
    $('error-count').parentElement.classList.remove('error');
    $('example-description').textContent = '输入新声明，或从上方选择示例后点击“载入”。';
    $('result-summary').textContent = '尚未分析'; $('notice').textContent = '';
    state('等待分析'); setExport(false); render(); editor.focus();
  });
  $('import-button').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 512 * 1024) throw new Error('请导入不超过 512 KB 的 UTF-8 文本文件。');
      editor.value = (await file.text()).replace(/^\uFEFF/, '');
      $('example-description').textContent = `已导入 ${file.name}，点击“开始分析”查看结果。`;
      editor.scrollTop = 0; modified();
    } catch (error) { $('notice').textContent = error.message; }
    event.target.value = '';
  });
  $('export-source').addEventListener('click', () => download('declarations.txt', editor.value, 'text/plain'));
  $('export-json').addEventListener('click', () => { if (result && !dirty) download('analysis-result.json', JSON.stringify(result, null, 2), 'application/json'); });
  $('export-markdown').addEventListener('click', () => { if (result && !dirty) download('analysis-summary.md', markdown(), 'text/markdown'); });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  loadExample();
})();
