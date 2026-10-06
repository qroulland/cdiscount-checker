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
const HEADLESS = MODE !== 'open' && process.env.HEADLESS !== 'false';

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

async function notify(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
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

async function cartItemCount(context) {
    const cookie = (await context.cookies('https://www.cdiscount.com')).find((c) => c.name === 'articles_count');
    return Number(cookie?.value || 0);
}

async function checkAvailability(context) {
    const page = await context.newPage();
    try {
        await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        // The React app must be hydrated before the button reacts to clicks.
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await acceptCookies(page);
        await page.waitForTimeout(2_000);

        // 1. Button "Ajouter au panier" present?
        const addToCart = await findAddToCartButton(page);
        const buttonVisible = addToCart ? await addToCart.isVisible({ timeout: 5_000 }).catch(() => false) : false;
        if (!buttonVisible) {
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
        log(`✅ ${ADDED_TO_CART_WORDING} (${await cartItemCount(context)} article(s) dans le panier)`);
        const sessionFile = await saveSession(context);
        const sessionName = path.basename(sessionFile);
        await notify(
            [
                '🔥 Produit ajouté au panier, passer commande maintenant',
                '',
                'Pour récupérer le panier :',
                `1. Télécharge le fichier ${sessionName} ci-dessous`,
                `2. npm run open -- ~/Downloads/${sessionName}`,
                '3. Connecte-toi à ton compte dans la fenêtre et valide la commande',
                '',
                CART_URL,
            ].join('\n'),
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

    let run = 0;
    try {
        while (ITERATIONS === 0 || run < ITERATIONS) {
            run += 1;
            try {
                if (await checkAvailability(context)) break; // stop looping once alerted
            } catch (error) {
                log(`💥 Erreur: ${error.message}`);
            }
            if (ITERATIONS === 0 || run < ITERATIONS) await sleep(INTERVAL_MS);
        }
    } finally {
        await browser.close();
    }
}

if (MODE !== 'open' && !URL) {
    console.error('PRODUCT_URL manquant. Exemple: PRODUCT_URL="https://www.cdiscount.com/..." npm start');
    process.exit(1);
}

(MODE === 'open' ? openSession() : watch());
