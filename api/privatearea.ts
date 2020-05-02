import { Router } from 'express'
import session from 'express-session'
import { pool, login, aw } from './util'
import request from 'request-promise'
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '../.env') })

let privatearea = Router()
if (!process.env.COOKIE_SECRET) throw new Error('COOKIE_SECRET env must be set')
privatearea.use(session({
    secret: process.env.COOKIE_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}))

privatearea.get('/check', aw(async req => {
    return { success: !!req.session?.logged }
}))

privatearea.post('/login', aw(async req => {
    if (!req.session) throw new Error('Session uninitialized, how tho')
    req.session.logged = false
    let r = await request({
        uri: 'https://www.google.com/recaptcha/api/siteverify',
        method: 'post',
        form: {
            secret: process.env.RECAPTCHA_SECRET,
            response: req.body.recaptchaToken
        }
    }).promise()
    let response = JSON.parse(r)
    if (!response.success) return { success: false, error: 'Captcha non valido' }
    if (req.body.password === process.env.PRIVATEAREA_PASSWORD) {
        req.session.logged = true
        return { success: true }
    } else return { success: false, error: 'password non valida' }
}))

privatearea.post('/post', aw(async req => {
    if (!req.session?.logged) return { success: false, error: 'invalid session, please log in (ricarica la pagina)' }
    if (!req.body.title) return { success: false, error: 'post title must be provided' }
    if (!req.body.author) return { success: false, error: 'post author must be provided' }
    let client = await pool.connect()
    try {
        await client.query({
            text: 'INSERT INTO posts (title, author, body, image) VALUES ($1, $2, $3, $4)',
            values: [req.body.title, req.body.author, req.body.description, req.body.image]
        })
        return { success: true }
    } catch (e) {
        return { success: false, error: e.message }
    } finally {
        client.release()
    }
}))

privatearea.post('/event', aw(async req => {
    if (!req.session?.logged) return { success: false, error: 'invalid session, please log in (ricarica la pagina)' }
    if (!req.body.title) return { success: false, error: 'post title must be provided' }
    if (!req.body.start) return { success: false, error: 'post start datetime must be provided' }
    if (!req.body.end) return { success: false, error: 'post end datetime must be provided' }
    let client = await pool.connect()
    try {
        await client.query({
            text: 'INSERT INTO events ("start", "end", "title", "body") VALUES ($1, $2, $3, $4)',
            values: [req.body.start, req.body.end, req.body.title, req.body.description]
        })
        return { success: true }
    } catch (e) {
        return { success: false, error: e.message }
    } finally {
        client.release()
    }
}))

export default privatearea