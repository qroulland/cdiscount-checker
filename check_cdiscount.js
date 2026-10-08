const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Product page to watch. On GitHub Actions it comes from the repository variable PRODUCT_URL.
const URL = process.env.PRODUCT_URL;
const CART_URL = 'https://www.cdiscount.com/basket.html';

const ADD_TO_CART_BUTTON = '[data-e2e="product-add-to-cart"]';
const ADD_TO_CART_WORDING = 'Ajouter au panier';
const ADDED_TO_CART_WORDING = 'Produit ajouté au panier';
const ADDED_TO_CART_CLASS = '.sc-dvXCMe.hJwwjS'; // hashed styled-components class, used as fallback only

// Usage:
//   node check_cdiscount.js                 -> loop: check, add to cart, alert, save session
//   node check_cdiscount.js open [file]     -> reopen a saved session (default: latest) in a visible browser on the cart page
const MODE = process.argv[2];
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 60_000); // 1 min
const ITERATIONS = Number(process.env.ITERATIONS || 0); // 0 = loop forever
// Stop looping after this long (0 = no limit). On GitHub Actions a check cycle takes ~80s, so the job must end on its own
// before its timeout: a timed-out job counts as cancelled and would not chain the next run.
const MAX_RUNTIME_MS = Number(process.env.MAX_RUNTIME_MIN || 0) * 60_000;
const HEADLESS = MODE !== 'open' && process.env.HEADLESS !== 'false';
const HEARTBEAT = process.env.HEARTBEAT === 'true'; // Telegram message when a run starts
const ERROR_ALERT_THRESHOLD = Number(process.env.ERROR_ALERT_THRESHOLD || 3); // consecutive failed checks before warning
// On GitHub Actions a restarted job gets a fresh VM, hence a new IP and a clean browser: the way out of a ban.
const RESTART_AFTER_ERRORS = Number(process.env.RESTART_AFTER_ERRORS || 30); // any kind of error, consecutive
const BAN_RESTARTS = Number(process.env.BAN_RESTARTS || 0); // how many ban restarts already happened in a row
const BAN_RESTART_COOLDOWN_MS = 60 * 60_000; // after 3 restarts in a row, wait 1h before trying again
const IN_CI = Boolean(process.env.GITHUB_OUTPUT);
const LABEL = process.env.LABEL || 'default'; // short name of the watched product (UI + Telegram), "default" = PRODUCT_URL of the repo

// --- Live status for the UI (ui/): a GitHub check run on the commit, updated after every check ---
// The logs of a running job cannot be downloaded, so the job publishes a small JSON status itself (job token, no extra secret).
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_API = process.env.GITHUB_API_URL || 'https://api.github.com';
const REPORT_STATUS = IN_CI && Boolean(GITHUB_TOKEN && GITHUB_REPOSITORY && process.env.GITHUB_SHA);
const STATUS_CHECK_NAME = `Cdiscount status · ${LABEL}`;

// Session files are written next to the script as cdiscount-session-<timestamp>.json
const SESSION_PREFIX = 'cdiscount-session-';
const sessionFilePath = () => path.join(__dirname, `${SESSION_PREFIX}${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const latestSessionFile = () =>
    fs
        .readdirSync(__dirname)
        .filter((f) => f.startsWith(SESSION_PREFIX) && f.endsWith('.json'))
        .sort()
        .map((f) => path.join(__dirname, f))
        .pop();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// copyText: optional inline button that copies the given text to the clipboard (Bot API "copy_text" button)
async function notify(message, copyText) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            ...(copyText && {
                reply_markup: { inline_keyboard: [[{ text: '📋 Copier la commande', copy_text: { text: copyText } }]] },
            }),
        }),
    });
    if (!res.ok) log(`⚠️ Telegram sendMessage ${res.status}: ${await res.text()}`);
}

async function sendDocument(filePath, caption) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`;
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('caption', caption);
    form.append('document', new Blob([fs.readFileSync(filePath)], { type: 'application/json' }), path.basename(filePath));
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) log(`⚠️ Telegram sendDocument ${res.status}: ${await res.text()}`);
}

const STATE_TITLES = {
    starting: 'Démarrage',
    unavailable: 'Indisponible, surveillance en cours',
    error: 'Erreurs de vérification',
    found: 'Ajouté au panier',
    restarting: 'Redémarrage sur une nouvelle instance',
    ended: 'Terminé, relais vers le prochain job',
    crashed: 'Le script a planté',
};

// Everything the UI shows about this job. Serialized as JSON in the check run output.
const status = {
    v: 1,
    runId: process.env.GITHUB_RUN_ID || null,
    label: LABEL,
    productUrl: URL || null,
    productName: null,
    state: 'starting',
    checks: 0,
    lastCheckAt: null,
    startedAt: new Date().toISOString(),
    updatedAt: null,
    intervalMs: INTERVAL_MS,
    iterations: ITERATIONS,
    maxRuntimeMs: MAX_RUNTIME_MS,
    consecutiveErrors: 0,
    lastError: null,
    found: false,
    banRestarts: BAN_RESTARTS,
};
let statusCheckRunId = null;

async function githubApi(method, route, body) {
    const res = await fetch(`${GITHUB_API}${route}`, {
        method,
        headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${route} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

// patch: fields merged into the status. conclusion ('success' | 'neutral' | 'failure'): closes the check run.
// Never throws: a status that cannot be published must not stop the checker.
async function reportStatus(patch, conclusion) {
    Object.assign(status, patch, { updatedAt: new Date().toISOString() });
    if (!REPORT_STATUS) return;
    const title = STATE_TITLES[status.state] || status.state;
    const summary = [
        `**${title}**`,
        status.productName && `Produit : ${status.productName}`,
        `Vérifications : ${status.checks}${status.iterations ? ` / ${status.iterations}` : ''}`,
        status.lastCheckAt && `Dernière vérification : ${status.lastCheckAt}`,
        status.lastError && `Dernière erreur [${status.lastError.kind}] : ${status.lastError.message}`,
    ]
        .filter(Boolean)
        .join('\n\n');
    const payload = {
        name: STATUS_CHECK_NAME,
        external_id: String(status.runId),
        details_url: `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${status.runId}`,
        status: conclusion ? 'completed' : 'in_progress',
        ...(conclusion && { conclusion, completed_at: status.updatedAt }),
        output: { title, summary, text: JSON.stringify(status) },
    };
    try {
        if (statusCheckRunId) {
            await githubApi('PATCH', `/repos/${GITHUB_REPOSITORY}/check-runs/${statusCheckRunId}`, payload);
        } else {
            const created = await githubApi('POST', `/repos/${GITHUB_REPOSITORY}/check-runs`, {
                ...payload,
                head_sha: process.env.GITHUB_SHA,
                started_at: status.startedAt,
            });
            statusCheckRunId = created.id;
        }
    } catch (error) {
        log(`⚠️ Statut non publié: ${error.message}`);
    }
}

async function saveSession(context) {
    const filePath = sessionFilePath();
    await context.storageState({ path: filePath });
    log(`💾 Session sauvegardée: ${filePath}`);
    return filePath;
}

async function acceptCookies(page) {
    // Best effort: the consent banner would otherwise cover the page.
    const candidates = [
        '#footer_tc_privacy_button_2',
        'button:has-text("Accepter")',
        'button:has-text("Tout accepter")',
        'button:has-text("Accepter et fermer")',
    ];
    for (const selector of candidates) {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await button.click({ timeout: 5_000 }).catch(() => {});
            return;
        }
    }
}

// The page contains two "Ajouter au panier" buttons: the real one in the buy box and a copy in a sticky
// bar that sits off-screen until you scroll. Only the one inside the viewport can be clicked.
async function findAddToCartButton(page) {
    const buttons = page.locator(ADD_TO_CART_BUTTON, { hasText: ADD_TO_CART_WORDING });
    await buttons.first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
    const viewport = page.viewportSize();
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
        const box = await buttons.nth(i).boundingBox();
        if (box && box.y >= 0 && box.y + box.height <= viewport.height) return buttons.nth(i);
    }
    return count > 0 ? buttons.last() : null;
}

async function productName(page) {
    const title = await page.locator('[data-e2e="title"]').first().textContent({ timeout: 3_000 }).catch(() => '');
    const fallback = (await page.title()).replace(/\s*-\s*Cdiscount.*$/i, '');
    return (title || fallback).replace(/\s+/g, ' ').trim();
}

async function cartItemCount(context) {
    const cookie = (await context.cookies('https://www.cdiscount.com')).find((c) => c.name === 'articles_count');
    return Number(cookie?.value || 0);
}

// kind: 'ban' (anti-bot block), 'down' (site unreachable), 'unexpected' (page changed / unknown)
class CheckError extends Error {
    constructor(kind, message) {
        super(message);
        this.kind = kind;
    }
}

function classifyError(error) {
    if (error instanceof CheckError) return error.kind;
    if (/net::ERR_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|Timeout \d+ms exceeded.*goto|navigating to/i.test(error.message)) return 'down';
    return 'unexpected';
}

const ERROR_LABELS = {
    ban: '🚫 Blocage probable (ban / anti-bot)',
    down: '🌐 Site inaccessible',
    unexpected: '⚠️ Page inattendue (changement de site ?)',
};

async function checkAvailability(context) {
    const page = await context.newPage();
    try {
        const response = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        const status = response?.status() ?? 0;
        if ([403, 429].includes(status)) throw new CheckError('ban', `HTTP ${status}`);
        if (status >= 500) throw new CheckError('down', `HTTP ${status}`);
        if (status >= 400) throw new CheckError('unexpected', `HTTP ${status}`);
        const title = await page.title();
        if (/just a moment|attention required|access denied|captcha|blocked|accès refusé/i.test(title)) {
            throw new CheckError('ban', `page anti-bot "${title}"`);
        }
        // The React app must be hydrated before the button reacts to clicks.
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await acceptCookies(page);
        await page.waitForTimeout(2_000);

        // 1. Button "Ajouter au panier" present?
        const addToCart = await findAddToCartButton(page);
        const buttonVisible = addToCart ? await addToCart.isVisible({ timeout: 5_000 }).catch(() => false) : false;
        if (!buttonVisible) {
            // A sold-out product page shows an "unavailable" block. Nothing at all means we got a block page or a redesign.
            const soldOut = await page.locator('[data-e2e="unavailable-message"]').first().isVisible({ timeout: 3_000 }).catch(() => false);
            if (!soldOut) throw new CheckError('unexpected', `ni bouton ni message indisponible, titre: "${await page.title()}"`);
            if (!status.productName) status.productName = (await productName(page).catch(() => '')) || null;
            log(`❌ Bouton "${ADD_TO_CART_WORDING}" absent, produit indisponible`);
            return false;
        }

        // 2. Add to cart
        log(`🛒 Bouton "${ADD_TO_CART_WORDING}" présent, ajout au panier`);
        await addToCart.click({ timeout: 10_000 });

        // 3. Confirmation "Produit ajouté au panier" displayed (or cart counter incremented)?
        const confirmation = page
            .getByText(ADDED_TO_CART_WORDING, { exact: false })
            .or(page.locator(ADDED_TO_CART_CLASS, { hasText: ADDED_TO_CART_WORDING }))
            .first();
        let confirmed = await confirmation.isVisible({ timeout: 15_000 }).catch(() => false);
        if (!confirmed) {
            await page.waitForTimeout(3_000);
            confirmed = (await cartItemCount(context)) > 0;
        }
        if (!confirmed) {
            log(`⚠️ Clic effectué mais "${ADDED_TO_CART_WORDING}" non affiché et panier vide`);
            return false;
        }

        // 4. Save the session (cart cookies) and alert on Telegram with the session file attached
        const name = await productName(page);
        status.productName = name || status.productName;
        log(`✅ "${name}" ajouté au panier (${await cartItemCount(context)} article(s) dans le panier)`);
        const sessionFile = await saveSession(context);
        const sessionName = path.basename(sessionFile);
        const openCommand = `cd ~/Sites/personal-projects/cdiscount-checker && npm run open -- ~/Downloads/${sessionName}`;
        await notify(
            [
                `🔥 "${name}" ajouté au panier, passer commande maintenant`,
                '',
                'Pour récupérer le panier :',
                `1. Télécharge le fichier ${sessionName} ci-dessous`,
                '2. Lance la commande (bouton pour la copier)',
                '3. Connecte-toi à ton compte dans la fenêtre et valide la commande',
            ].join('\n'),
            openCommand,
        );
        await sendDocument(sessionFile, 'Session Cdiscount avec le panier. Ouvre-la avec: npm run open -- <fichier>').catch(
            (error) => log(`⚠️ Envoi du fichier de session impossible: ${error.message}`),
        );
        return true;
    } finally {
        await page.close().catch(() => {});
    }
}

async function openSession() {
    // Explicit file argument, otherwise the most recent session file next to the script
    const sessionFile = process.argv[3] ? path.resolve(process.argv[3]) : latestSessionFile();
    if (!sessionFile || !fs.existsSync(sessionFile)) {
        console.error(`Fichier de session introuvable: ${sessionFile || `${SESSION_PREFIX}*.json`}`);
        process.exit(1);
    }
    log(`📂 Session: ${sessionFile}`);
    const browser = await chromium.launch({ headless: false, channel: 'chrome' }).catch(() => chromium.launch({ headless: false }));
    // Same user agent as the checker: Cloudflare's cf_clearance cookie is bound to it.
    const context = await browser.newContext({ storageState: sessionFile, locale: 'fr-FR', userAgent: USER_AGENT, viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    await page.goto(CART_URL);
    log('🪟 Session restaurée sur le panier. Connecte-toi et passe commande. Ctrl+C pour fermer.');
    await new Promise(() => {}); // keep the browser open
}

async function watch() {
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ locale: 'fr-FR', userAgent: USER_AGENT, viewport: { width: 1366, height: 900 } });

    if (HEARTBEAT) {
        const span = ITERATIONS ? `${ITERATIONS} vérifications` : 'en continu';
        const who = LABEL === 'default' ? '' : ` [${LABEL}]`;
        await notify(`👀 Surveillance active${who} (${span}, toutes les ${Math.round(INTERVAL_MS / 60_000)} min)`).catch(() => {});
    }
    await reportStatus({ state: 'starting' });

    let run = 0;
    let found = false;
    let banRestart = false;
    let consecutiveErrors = 0;
    let errorAlertSent = false;
    let outcome = 'ended'; // ended (iterations or time exhausted, chained) | found | restarting | crashed
    const startedAt = Date.now();
    const keepGoing = () => (ITERATIONS === 0 || run < ITERATIONS) && (MAX_RUNTIME_MS === 0 || Date.now() - startedAt + INTERVAL_MS < MAX_RUNTIME_MS);
    try {
        while (keepGoing()) {
            run += 1;
            try {
                found = await checkAvailability(context);
                await reportStatus({ state: found ? 'found' : 'unavailable', checks: run, lastCheckAt: new Date().toISOString(), consecutiveErrors: 0, lastError: null, found });
                if (errorAlertSent) {
                    errorAlertSent = false;
                    await notify(`✅ Le checker fonctionne à nouveau (après ${consecutiveErrors} échecs)`).catch(() => {});
                }
                consecutiveErrors = 0;
                if (found) {
                    outcome = 'found';
                    break; // stop looping once alerted
                }
            } catch (error) {
                consecutiveErrors += 1;
                const kind = classifyError(error);
                const reason = error.message.split('\n')[0];
                log(`💥 Erreur [${kind}] (${consecutiveErrors} d'affilée): ${reason}`);
                await reportStatus({ state: 'error', checks: run, lastCheckAt: new Date().toISOString(), consecutiveErrors, lastError: { kind, message: reason } });

                // Restart on a fresh instance: right away on a ban, or after a long streak of any error
                const restart = IN_CI && (kind === 'ban' ? consecutiveErrors >= ERROR_ALERT_THRESHOLD : consecutiveErrors >= RESTART_AFTER_ERRORS);
                if (consecutiveErrors >= ERROR_ALERT_THRESHOLD && (!errorAlertSent || restart)) {
                    errorAlertSent = true;
                    const lines = [ERROR_LABELS[kind], `${consecutiveErrors} vérifications échouées d'affilée.`, `Dernière erreur : ${reason}`];
                    if (restart) {
                        lines.push(`🔄 Redémarrage sur une nouvelle instance GitHub (nouvelle IP), n°${BAN_RESTARTS + 1}`);
                        if (BAN_RESTARTS >= 3) lines.push('⏸️ Blocage persistant : pause d\'1h avant le prochain essai.');
                    }
                    const text = lines.join('\n');
                    log(`📣 Alerte Telegram: ${text.replace(/\n/g, ' | ')}`);
                    await notify(text).catch(() => {});
                }
                if (restart) {
                    banRestart = true;
                    outcome = 'restarting';
                    await reportStatus({ state: 'restarting' });
                    if (BAN_RESTARTS >= 3) await sleep(BAN_RESTART_COOLDOWN_MS);
                    break;
                }
            }
            if (keepGoing()) await sleep(INTERVAL_MS);
        }
        if (outcome === 'ended') log(`🏁 Fin de la session après ${run} vérifications (${Math.round((Date.now() - startedAt) / 60_000)} min)`);
    } catch (error) {
        outcome = 'crashed';
        await reportStatus({ state: 'crashed', lastError: { kind: 'crash', message: error.message.split('\n')[0] } }, 'failure');
        throw error;
    } finally {
        if (outcome !== 'crashed') await reportStatus({ state: outcome }, outcome === 'found' ? 'success' : 'neutral');
        await browser.close();
        // Tell the GitHub Actions workflow whether to chain a new run, and whether this was a ban restart
        if (IN_CI) fs.appendFileSync(process.env.GITHUB_OUTPUT, `found=${found}\nban_restart=${banRestart}\n`);
    }
}

if (MODE !== 'open' && !URL) {
    console.error('PRODUCT_URL manquant. Exemple: PRODUCT_URL="https://www.cdiscount.com/..." npm start');
    process.exit(1);
}

(MODE === 'open' ? openSession() : watch());
