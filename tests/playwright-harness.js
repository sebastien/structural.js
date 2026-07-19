import { afterAll, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = join(import.meta.dirname, "..");

let browser = null;
let launchPromise = null;

export async function getBrowser() {
	if (browser) return browser;
	if (!launchPromise) {
		launchPromise = chromium
			.launch({ headless: true })
			.then((b) => {
				browser = b;
				return b;
			})
			.catch((err) => {
				launchPromise = null;
				throw err;
			});
	}
	return launchPromise;
}

export async function newPage() {
	const b = await getBrowser();
	const page = await b.newPage();
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		const fp = join(root, url.pathname);
		if (existsSync(fp)) {
			const ext = fp.split(".").pop();
			const mime =
				ext === "js"
					? "application/javascript"
					: ext === "html"
						? "text/html"
						: "text/plain";
			route.fulfill({ body: readFileSync(fp, "utf-8"), contentType: mime });
		} else {
			route.continue();
		}
	});
	return page;
}

export async function closePage(page) {
	try {
		if (page && !page.isClosed()) await page.close();
	} catch (_) {}
}

export async function loadResult(pathname, { timeout = 15000 } = {}) {
	const page = await newPage();
	try {
		await page.goto(`http://localhost${pathname}`, { timeout });
		await page.waitForFunction(() => window.__result !== undefined, null, {
			timeout,
		});
		return await page.evaluate(() => window.__result);
	} finally {
		await closePage(page);
	}
}

export async function loadPath(pathname, { timeout = 15000 } = {}) {
	const page = await newPage();
	await page.goto(`http://localhost${pathname}`, { timeout });
	return page;
}

export function installBrowserLifecycle() {
	beforeAll(async () => {
		await getBrowser();
	});
	// Keep one Chromium for the whole process. Closing between files exhausts
	// Playwright/Bun after ~12 launches and hangs subsequent pages.
	if (!globalThis.__structuralBrowserExitHook) {
		globalThis.__structuralBrowserExitHook = true;
		const shutdown = async () => {
			const b = browser;
			browser = null;
			launchPromise = null;
			if (!b) return;
			try {
				await Promise.race([
					b.close(),
					new Promise((resolve) => setTimeout(resolve, 1500)),
				]);
			} catch (_) {}
		};
		process.once("exit", () => {
			try {
				browser?.close?.();
			} catch (_) {}
		});
		process.once("beforeExit", () => {
			shutdown();
		});
	}
}
