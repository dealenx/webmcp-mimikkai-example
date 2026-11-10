// Runs in the page's JS world (world: "MAIN"); installs document.modelContext
// when the browser has no native WebMCP, then registers the tool there.
import '@mcp-b/global';

const LOG = '[webmcp-mimikkai]';

interface BlogArticle {
	title: string;
	url: string;
	date: string;
	excerpt: string;
}

async function listBlogArticles(): Promise<BlogArticle[]> {
	const res = await fetch('/blog', { credentials: 'same-origin' });
	if (!res.ok) throw new Error(`GET /blog failed: ${res.status}`);
	const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
	const cards = doc.querySelectorAll('article.publication-card[data-publication-kind="article"]');
	return Array.from(cards, (card) => {
		const link = card.querySelector<HTMLAnchorElement>('h2 a');
		const time = card.querySelector('time');
		return {
			title: (link?.textContent ?? '').trim(),
			url: link?.getAttribute('href')
				? new URL(link.getAttribute('href') as string, location.origin).href
				: '',
			date: time?.getAttribute('datetime') ?? '',
			excerpt: (card.querySelector('.publication-card__excerpt')?.textContent ?? '').trim(),
		};
	});
}

interface PageModelContext {
	registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => Promise<void>;
	getTools?: () => Promise<unknown[]>;
	listTools?: () => Promise<unknown[]>;
	dynamicTools?: Record<string, unknown>;
	addEventListener?: (type: string, listener: () => void) => void;
}

// Native Chrome exposes getTools(); the @mcp-b polyfill exposes listTools()/dynamicTools.
async function pageTools(mc: PageModelContext): Promise<{ api: string; tools: unknown[] }> {
	if (typeof mc.getTools === 'function') return { api: 'native getTools()', tools: await mc.getTools() };
	if (typeof mc.listTools === 'function') return { api: 'polyfill listTools()', tools: await mc.listTools() };
	return { api: 'polyfill dynamicTools', tools: Object.values(mc.dynamicTools ?? {}) };
}

const toolNames = (tools: unknown[]) =>
	tools.map((t) => {
		if (t && typeof t === 'object' && 'name' in t && typeof t.name === 'string') return t.name;
		return String(t);
	});

const { modelContext } = document as Document & { modelContext?: PageModelContext };
if (!modelContext) {
	console.warn(LOG, 'WebMCP unavailable: document.modelContext missing');
	throw new Error('document.modelContext missing');
}

void (async () => {
	const before = await pageTools(modelContext);
	console.log(
		LOG,
		`WebMCP present via ${before.api}; tools already on page (${before.tools.length}):`,
		toolNames(before.tools),
	);

	await modelContext.registerTool({
		name: 'list_blog_articles',
		description:
			'Return the list of blog articles published on mimikkai.ru as JSON: title, url, date (ISO), excerpt.',
		inputSchema: { type: 'object', properties: {} },
		annotations: { readOnlyHint: true },
		execute: async () => ({ articles: await listBlogArticles() }),
	});

	const after = await pageTools(modelContext);
	console.log(
		LOG,
		`registered list_blog_articles; page tools now (${after.tools.length}):`,
		toolNames(after.tools),
	);

	modelContext.addEventListener?.('toolchange', () => {
		void pageTools(modelContext).then((r) =>
			console.log(LOG, `toolchange → ${r.tools.length} tool(s):`, toolNames(r.tools)),
		);
		console.log(LOG, 'toolchange event fired');
	});
})().catch((error) => console.warn(LOG, 'setup failed:', error));
