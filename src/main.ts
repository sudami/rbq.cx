import * as Koa from 'koa'
import * as Router from 'koa-router'
import * as helmet from 'koa-helmet'
import * as bodyParser from 'koa-bodyparser'
import * as SQLite from 'sqlite3'
import { isURL, isISO8601 } from 'validator'
import serve = require('koa-static')

const PORT = process.env.PORT == undefined ? 3000 : process.env.PORT;

const sqlite3 = SQLite.verbose();
const db = new sqlite3.Database('./data.db');

db.run(
    'CREATE TABLE IF NOT EXISTS urls (' +
    'object_id  CHAR(8) PRIMARY KEY,' +
    'url        TEXT,' +
    'expires_in TEXT)'
);

const rateLimiter: Router.IMiddleware = async (ctx, next) => {
    await next()
}

const router: Router = new Router();
router
    .post('/api', rateLimiter, async ctx => {
        const args = ctx.request.body;
        const domain: string = ctx.request.headers.host;
        const url: string = args.url;
        const expires_in: string = args.expires_in;
        if (url == null || !isURL(url, { require_protocol: true })) {
            return ctx.body = { url: null, err: "Please enter a correct URL." }
        }
        if (expires_in != undefined && !isISO8601(expires_in)) {
            return ctx.body = { url: null, err: "Please enter a valid ISO-8601 date." }
        }
        if (new RegExp(`https?://${domain.replace(/\./g, '\\.')}`).test(url)) {
            return ctx.body = { url: null, err: "The URL has been shortened." }
        }
        const base64: string = Buffer.from(url).toString('base64').replace(/=/g, '');
        let object_id: string = '';
        for (let i = 0; i < 8; i++) {
            object_id += base64.charAt(Math.round(Math.random() * base64.length))
        }
        const row: any = await execSQL(`SELECT * FROM urls WHERE object_id = \'${object_id}\' OR url = \'${url}\'`);
        if (row.length == 0) {
            db.run(`INSERT INTO urls VALUES (\'${object_id}\', \'${url}\', \'${expires_in}\')`);
            ctx.body = { url: `https://${domain}/${object_id}`, err: null }
        } else if (row[0].url == url) {
            ctx.body = { url: `https://${domain}/${row[0].object_id}`, err: null }
        } else if (row[0].object_id == object_id) {
            ctx.body = { url: null, err: "Internal server error, please retry." }
        }
    })
    .get('/:id', async ctx => {
        const object_id: string = ctx.params.id;
        if (!object_id.match(/[a-zA-Z0-9]{7,8}/)) {
            return ctx.redirect('/')
        }
        const row: any = await execSQL(`SELECT * FROM urls WHERE object_id = \'${object_id}\'`);
        if (row.length == 0) {
            ctx.status = 404;
            return ctx.body = '<body style="text-align: center;">链接不存在</body>'
        }
        const expires_in: string = row[0].expires_in;
        if (expires_in == 'undefined' || Date.now() < Date.parse(expires_in)) {
            ctx.status = 301;
            ctx.set('Location', row[0].url)
        } else {
            db.run(`DELETE FROM urls WHERE object_id = \'${object_id}\'`);
            return ctx.body = '<body style="text-align: center;">链接已过期</body>'
        }
    });

const app: Koa = new Koa();
app.use(serve('./public'));
app.use(helmet());
app.use(bodyParser());
app.use(router.routes());
app.listen(PORT, () => {
    console.log(`Server started at http://127.0.0.1:${PORT}`)
});

function execSQL(sql: string): Promise<any> {
    return new Promise((resolve, reject) => {
        db.all(sql, (err: Error, row: any) => {
            if (err != null) {
                reject(err)
            } else {
                resolve(row)
            }
        })
    })
}
