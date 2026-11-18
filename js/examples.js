(function (root, factory) {
  const examples = factory();
  if (typeof module === 'object' && module.exports) module.exports = examples;
  else root.DeclarationExamples = examples;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return {
    complete: {
      title: '综合正确示例',
      description: '四种类型、常量和变量、十六进制、科学计数法与注释。预期：4 个常量，5 个变量，21 字节，0 个错误。',
      source: `// 常量声明：const 类型 名称 = 字面量;
const int MAX_COUNT = 100;
const real RATE = 1.25e+2;
const char GRADE = 'A';
const bool READY = true;

/* 变量声明：类型 名称 [= 字面量];
   使用从 0 开始的连续模拟地址，不进行对齐。 */
int count = 0;
real price = 19.5;
char level = '优';
bool enabled = false;
int mask = 0x2A;
*`
    },
    constants: {
      title: '四类常量', description: '预期：4 个常量，0 个变量，0 字节，0 个错误。',
      source: `const int LIMIT = -128;
const real PI = 3.14159;
const char NEWLINE = '\\n';
const bool ACTIVE = true;
*`
    },
    variables: {
      title: '变量与地址分配', description: '预期：地址依次为 0、4、12、16；共 17 字节，0 个错误。',
      source: `int counter;
real average = 12.5;
char label = 'A';
bool finished = false;
*`
    },
    duplicate: {
      title: '重定义检查', description: '预期：3 个成功声明，2 个语义错误；错误声明不占地址，共 8 字节。',
      source: `int count = 1;
real count = 2.5;
const bool READY = true;
char READY = 'Y';
int next = 2;
*`
    },
    types: {
      title: '类型与范围错误', description: '预期：4 个语义错误；最后一条正确声明仍被处理，分配 8 字节。',
      source: `int score = 9.5;
bool ready = 1;
char code = true;
int overflow = 2147483648;
real valid = 12;
*`
    },
    recovery: {
      title: '格式错误与恢复', description: '预期：3 个错误；仍保留 afterMissing、good、last 三个变量，共 9 字节。',
      source: `int missing = 1
int afterMissing = 2;
const int BAD = 0xGG;
bool good = true;
char tooLong = 'AB';
int last = 3;
*`
    }
  };
});
