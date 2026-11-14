const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('js/content.js', 'utf8');

function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source section: ${start}`);
  return source.slice(first, last);
}

const matcher = section('  function targetWordPattern(', '  async function processSpecificWords(');

test('container discovery includes semantic paragraphs with nested or split short text nodes', () => {
  const paragraphWithNestedText = {
    tagName: 'P',
    childNodes: [{ nodeType: 1 }],
    textContent: 'A paragraph whose content is entirely inside inline elements.'
  };
  const paragraphWithSplitText = {
    tagName: 'P',
    childNodes: [
      { nodeType: 3, textContent: 'Short ' },
      { nodeType: 3, textContent: 'text nodes ' },
      { nodeType: 3, textContent: 'combine.' }
    ],
    textContent: 'Short text nodes combine.'
  };
  const wrapper = { tagName: 'ARTICLE', childNodes: [], textContent: paragraphWithNestedText.textContent };
  const nodes = [paragraphWithNestedText, paragraphWithSplitText, wrapper];
  const context = {
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    shouldSkipNode: () => false,
    document: {
      createTreeWalker(root, type, filter) {
        const accepted = nodes.filter(node => filter.acceptNode(node) === 1);
        let index = 0;
        return { nextNode: () => accepted[index++] || null };
      }
    }
  };
  const discovery = section('  function findTextContainers(', '  function getTextContent(');
  vm.runInNewContext(discovery + '\nthis.find = findTextContainers;', context);
  const found = context.find({});
  assert.equal(found.length, 2);
  assert.equal(found[0], paragraphWithNestedText);
  assert.equal(found[1], paragraphWithSplitText);
});

test('word matching escapes metacharacters and respects Unicode boundaries', () => {
  const context = {};
  vm.runInNewContext(matcher + '\nthis.match = (text, word) => targetWordPattern(word).test(text);', context);
  assert.equal(context.match('a cat sits', 'cat'), true);
  assert.equal(context.match('concatenate', 'cat'), false);
  assert.equal(context.match('écat', 'cat'), false);
  assert.equal(context.match('cat\u0301', 'cat'), false);
  assert.equal(context.match('use cc++ today', 'cc++'), true);
  assert.equal(context.match('这是中文词汇', '中文词'), true);
});

test('stacked replacement content treats translation text as plain text', () => {
  const context = {
    document: {
      createElement: () => ({ className: '', textContent: '' })
    }
  };
  const renderer = section('  function renderReplacementContent(', '  function applyReplacements(');
  vm.runInNewContext(renderer + '\nthis.render = renderReplacementContent;', context);
  const wrapper = {
    children: [],
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); }
  };
  context.render(wrapper, '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', 'translation-stacked');
  assert.deepEqual(wrapper.children.map(child => [child.className, child.textContent]), [
    ['vocabmeld-word', '<svg onload=alert(1)>'],
    ['vocabmeld-original', '<img src=x onerror=alert(1)>']
  ]);
});

test('tooltip placement stays within the viewport and moves above a lower-edge anchor', () => {
  const positioner = section('  function getTooltipPosition(', '  function showTooltip(');
  const context = {};
  vm.runInNewContext(positioner + '\nthis.position = getTooltipPosition;', context);
  const position = context.position(
    { left: 290, top: 170, bottom: 190 },
    { width: 180, height: 100 },
    320,
    200
  );
  assert.equal(position.left, 132);
  assert.equal(position.top, 62);
});

test('replacement skips partial and translated words and can replace all occurrences', () => {
  const parent = {
    closest: () => null, tagName: 'P', className: '', offsetParent: {}, isContentEditable: false
  };
  const translatedParent = { ...parent, closest: () => ({}) };
  let nodes = [
    { parentElement: parent, textContent: 'concatenate cat cat' },
    { parentElement: translatedParent, textContent: 'cat' }
  ];
  const element = { contains: node => nodes.includes(node), setAttribute() {} };
  let inserted = 0;
  const context = {
    SKIP_TAGS: [], SKIP_CLASSES: [],
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    document: {
      createTreeWalker(root, type, filter) {
        const accepted = nodes.filter(node => filter.acceptNode(node) === 1);
        let index = 0;
        return { nextNode: () => accepted[index++] || null };
      },
      createRange() {
        let node, start, end;
        return {
          setStart(n, position) { node = n; start = position; },
          setEnd(n, position) { end = position; },
          toString() { return node.textContent.slice(start, end); },
          deleteContents() {},
          insertNode() {
            const index = nodes.indexOf(node);
            nodes.splice(index, 1,
              { parentElement: parent, textContent: node.textContent.slice(0, start) },
              { parentElement: parent, textContent: node.textContent.slice(end) });
            inserted++;
          }
        };
      }
    },
    createReplacementElement: () => ({}), console
  };
  const replacement = section('  function applyReplacements(', '  function restoreOriginal(');
  vm.runInNewContext(matcher + replacement + '\nthis.apply = applyReplacements;', context);
  assert.equal(context.apply(element, [{ original: 'cat', translation: '猫' }], true), 2);
  assert.equal(inserted, 2);
  assert.equal(nodes[0].textContent, 'concatenate ');
});

test('specific-word processing includes short and repeated identical containers', async () => {
  const calls = [];
  function parent(translated = false) {
    return {
      tagName: 'P', className: '', offsetParent: {}, style: {}, isContentEditable: false,
      closest(selector) { return selector === '.vocabmeld-translated' && translated ? {} : null; }
    };
  }
  const first = parent();
  const second = parent();
  const nodes = [
    { parentElement: parent(true), textContent: 'cat' },
    { parentElement: first, textContent: 'cat' },
    { parentElement: first, textContent: 'cat' },
    { parentElement: second, textContent: 'cat' },
    { parentElement: parent(), textContent: 'caterpillar' }
  ];
  const context = {
    config: { enabled: true }, SKIP_TAGS: [], SKIP_CLASSES: [],
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    document: {
      body: {},
      createTreeWalker(root, type, filter) {
        const accepted = nodes.filter(node => filter.acceptNode(node) === 1);
        let index = 0;
        return { nextNode: () => accepted[index++] || null };
      }
    },
    isCodeText: () => false, getTextContent: () => 'cat',
    translateSpecificWords: async () => [{ original: 'cat', translation: '猫' }],
    applyReplacements: (element, replacements, all) => { calls.push({ element, all }); return 1; },
    prefetchDictionaryData: () => {}
  };
  const process = section('  async function processSpecificWords(', '  // ============ 页面处理 ============');
  vm.runInNewContext(matcher + process + '\nthis.process = processSpecificWords;', context);
  assert.equal(await context.process(['cat']), 2);
  assert.deepEqual(calls.map(call => call.element), [first, second]);
  assert.equal(calls.every(call => call.all), true);
});

test('learned metacharacter words are filtered and processing marks are cleared on failure', async () => {
  function container(text) {
    const attributes = new Set();
    return {
      text, attributes,
      hasAttribute: name => attributes.has(name),
      setAttribute: name => attributes.add(name),
      removeAttribute: name => attributes.delete(name)
    };
  }
  const eligible = container('The cc++ language and 中文词 appear in this sufficiently long paragraph about programming.');
  const shortParagraph = container('This paragraph is short, but should still be processed.');
  const tooShort = container('short text');
  const batches = [];
  const context = {
    config: { learnedWords: [{ original: 'cc++' }, { original: '中文词' }] },
    pendingContainers: new Set([eligible, shortParagraph, tooShort]), processedFingerprints: new Set(),
    MAX_SEGMENTS_PER_BATCH: 10, MAX_SEGMENTS_PER_REQUEST: 5, REQUEST_INTERVAL_MS: 0,
    debounce: fn => fn, getTextContent: element => element.text, isCodeText: () => false,
    getElementPath: () => 'p', generateFingerprint: text => text,
    processBatchSegments: async batch => { batches.push(batch); }
  };
  const pending = section('  const processPendingContainers = debounce(', '  // 批量处理多个段落');
  vm.runInNewContext(matcher + '\nlet isProcessing = false;\n' + pending +
    '\nthis.process = processPendingContainers;', context);
  await context.process();
  assert.doesNotMatch(batches[0][0].filteredText, /cc\+\+|中文词/i);
  assert.equal(batches[0].length, 2);
  assert.equal(batches[0][1].element, shortParagraph);
  assert.equal(eligible.hasAttribute('data-vocabmeld-processing'), false);
  assert.equal(tooShort.hasAttribute('data-vocabmeld-processing'), false);
  context.pendingContainers.add(eligible);
  context.processBatchSegments = async () => { throw new Error('test failure'); };
  await assert.rejects(context.process(), /test failure/);
  assert.equal(eligible.hasAttribute('data-vocabmeld-processing'), false);
});

test('memorized words use the learning language and selected words avoid duplicate requests', async () => {
  const processed = [];
  let added = true;
  const context = {
    config: { nativeLanguage: 'zh-CN' }, showToast() {}, console,
    translateSpecificWords: async words => [{
      original: words[0], translation: words[0] === 'apple' ? '苹果' : 'apple'
    }],
    addToMemorizeList: async word => { if (added) processed.push(word); return added; },
    processSpecificWords: async words => { processed.push(words[0]); }
  };
  const language = section('  function detectLanguage(', '  function isCodeText(');
  const selection = section('  async function translateAndAddToMemorize(', '  async function removeFromMemorizeList(');
  vm.runInNewContext(language + selection + '\nthis.add = translateAndAddToMemorize;', context);
  await context.add('apple');
  assert.deepEqual(processed, ['apple']);
  processed.length = 0;
  added = false;
  await context.add('apple');
  assert.deepEqual(processed, ['apple']);
  processed.length = 0;
  added = true;
  await context.add('苹果');
  assert.deepEqual(processed, ['apple', '苹果']);
});

test('memorized words can be removed regardless of letter case', async () => {
  const context = {
    config: { memorizeList: [{ word: 'Apple' }], enabled: false },
    chrome: { storage: { local: { set: (value, callback) => callback?.() } } },
    showToast() {}
  };
  const add = section('  async function addToMemorizeList(', '  // 翻译后添加到记忆列表');
  const remove = section('  async function removeFromMemorizeList(', '  // ============ DOM 处理 ============');
  vm.runInNewContext(add + remove + '\nthis.add = addToMemorizeList; this.remove = removeFromMemorizeList;', context);
  assert.equal(await context.add('apple'), false);
  await context.remove('apple');
  assert.equal(context.config.memorizeList.length, 0);
});
